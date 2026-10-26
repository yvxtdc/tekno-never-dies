/**
 * Suivi du déploiement GitHub Pages d'une mise en ligne (mode push) : exécution du workflow
 * `.github/workflows/deploy-pages.yml` (CMS_GITHUB_WORKFLOW) pour le commit exact envoyé par le CMS,
 * lue dans l'API GitHub, en lecture seule. Le dépôt étant public, aucun jeton n'est nécessaire
 * (60 appels par heure et par adresse) ; CMS_GITHUB_TOKEN, facultatif et en lecture seule, relève la limite.
 *
 * L'état est enregistré sur la mise en ligne (table publications, colonnes deploy_*) : la page Mise en
 * ligne, le tableau de santé, les programmations et le suivi des soirées lisent cette même source, sans
 * jamais appeler GitHub pendant l'affichage. Les vérifications sont faites par le planificateur (chaque
 * minute pendant un déploiement, puis plus espacées) ou à la demande.
 *
 * Règles (aucune réponse indisponible n'est présentée comme un succès) :
 *  - l'exécution suivie est celle dont head_sha est le commit envoyé (dernière tentative) ;
 *  - exécution annulée (concurrency « pages », cancel-in-progress) : « remplacée » seulement si une exécution
 *    plus récente, pour un commit qui CONTIENT celui-ci, a réussi ; sinon annulée ;
 *  - exécution réussie, mais une exécution réussie plus tard pour un commit qui ne le contient pas :
 *    « écrasée par une version antérieure » (le site public ne montre pas ces modifications) ;
 *  - API indisponible, limite atteinte, réponse illisible : état inchangé, nouvel essai plus tard ;
 *    sans réponse exploitable au bout de 6 heures : « inconnu ».
 */
import { execFile } from "node:child_process";
import { now } from "../db/index.mjs";
import { runtime, cleanMessage } from "../runtime.mjs";

export const DEPLOY_STATES = {
  not_sent: { label: "Non envoyé", level: "info" },
  waiting: { label: "Envoyé, déploiement pas encore démarré", level: "pending" },
  queued: { label: "Déploiement en attente", level: "pending" },
  in_progress: { label: "Déploiement en cours", level: "pending" },
  success: { label: "Déployé sur le site", level: "ok" },
  superseded: { label: "Déployé avec une version plus récente", level: "ok" },
  failure: { label: "Déploiement échoué", level: "error" },
  cancelled: { label: "Déploiement annulé", level: "warning" },
  overwritten: { label: "Écrasé par une version antérieure", level: "error" },
  skipped: { label: "Déploiement ignoré par le workflow", level: "warning" },
  unknown: { label: "État du déploiement inconnu", level: "unknown" }
};
const ACTIVE = ["waiting", "queued", "in_progress"];
const GIVE_UP_MS = 6 * 3600e3;
// Un déploiement réussi est encore surveillé une heure (exécution plus ancienne terminée après lui).
const WATCH_SUCCESS_MS = 3600e3;

class RateLimited extends Error {}

const execGit = (cwd, args) => new Promise((resolve) => {
  execFile("git", args, { cwd, timeout: 60e3, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (error, stdout) => resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, out: String(stdout).trim() }));
});

/** « propriétaire/dépôt » : CMS_GITHUB_REPO, sinon l'adresse du dépôt distant Git de la copie du site. */
export async function repoSlug(config) {
  if (config.githubRepo) return /^[\w.-]+\/[\w.-]+$/.test(config.githubRepo) ? config.githubRepo : null;
  const { code, out } = await execGit(config.siteDir, ["remote", "get-url", config.gitRemote]);
  const m = code === 0 && out.match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/);
  return m ? m[1] : null;
}

async function githubGet(config, slug, pathAndQuery) {
  const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "tnd-cms" };
  if (config.githubToken) headers.Authorization = `Bearer ${config.githubToken}`;
  const res = await runtime.fetch(`https://api.github.com/repos/${slug}/${pathAndQuery}`, { headers, signal: AbortSignal.timeout(10e3) });
  if (res.status === 429 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0")) {
    const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000 || Date.now() + (Number(res.headers.get("retry-after")) || 900) * 1000;
    throw Object.assign(new RateLimited("Limite d'appels à l'API GitHub atteinte."), { resetAt: reset });
  }
  if (!res.ok) throw new Error(`API GitHub : réponse ${res.status}.`);
  const data = await res.json();
  if (!Array.isArray(data?.workflow_runs)) throw new Error("API GitHub : réponse inattendue.");
  return data.workflow_runs;
}

/** Le commit a est-il contenu dans b ? true / false / null (impossible à déterminer). */
export async function isAncestor(config, a, b) {
  if (a === b) return true;
  let r = await execGit(config.siteDir, ["merge-base", "--is-ancestor", a, b]);
  if (r.code !== 0 && r.code !== 1) {
    await execGit(config.siteDir, ["fetch", "-q", config.gitRemote, config.gitBranch]);
    r = await execGit(config.siteDir, ["merge-base", "--is-ancestor", a, b]);
  }
  return r.code === 0 ? true : r.code === 1 ? false : null;
}

/** Lien vers une exécution : seulement une adresse https://github.com/… (affichée comme lien dans l'interface). */
const runLink = (url) => (typeof url === "string" && url.startsWith("https://github.com/") ? url : null);

const latestFor = (runs, sha) => runs.filter((r) => r.head_sha === sha).sort((x, y) => (y.run_attempt || 1) - (x.run_attempt || 1) || Date.parse(y.created_at) - Date.parse(x.created_at))[0] || null;
const short = (sha) => String(sha || "").slice(0, 7);

/** État d'une mise en ligne d'après les exécutions du workflow. */
async function evaluate(config, pub, runs) {
  const mine = latestFor(runs, pub.commit_sha);
  const sentAt = Date.parse(pub.finished_at);
  if (!mine) {
    // Déjà constaté déployé : l'absence d'information ne fait jamais revenir en arrière.
    if (pub.deploy_status === "success") return { status: "success", message: pub.deploy_message };
    if (Date.now() - sentAt < 15 * 60e3) return { status: "waiting", message: "Envoyé sur GitHub ; l'exécution du déploiement n'est pas encore visible." };
    return { status: "unknown", message: "Aucune exécution du déploiement trouvée pour ce commit.", keepChecking: true };
  }
  const run = { deploy_run_id: mine.id, deploy_run_url: runLink(mine.html_url), deploy_started_at: mine.run_started_at || mine.created_at };
  if (mine.status !== "completed") {
    if (mine.conclusion === "action_required" || mine.status === "waiting") return { ...run, status: "queued", message: "Déploiement en attente d'une approbation ou d'une place sur GitHub." };
    return { ...run, status: mine.status === "in_progress" ? "in_progress" : "queued", message: mine.status === "in_progress" ? "Déploiement GitHub Pages en cours." : "Déploiement en file d'attente sur GitHub." };
  }
  const done = { ...run, deploy_finished_at: mine.updated_at };
  if (mine.conclusion === "success") {
    // Le site public est celui du dernier déploiement réussi terminé : contient-il ce commit ?
    const latest = runs.filter((r) => r.status === "completed" && r.conclusion === "success").sort((x, y) => Date.parse(y.updated_at) - Date.parse(x.updated_at))[0];
    if (latest && latest.id !== mine.id && Date.parse(latest.updated_at) > Date.parse(mine.updated_at) && latest.head_sha !== mine.head_sha) {
      const contains = await isAncestor(config, pub.commit_sha, latest.head_sha);
      if (contains === false) return { ...done, status: "overwritten", message: `Déployé, puis remplacé par le déploiement du commit ${short(latest.head_sha)}, qui ne contient pas ces modifications : relancez une mise en ligne.` };
      if (contains === null) return { ...done, status: "success", message: `Déployé. Le site a été redéployé depuis (commit ${short(latest.head_sha)}) : relation entre les deux versions non vérifiable.` };
      return { ...done, status: "success", message: `Déployé ; le site actuel (commit ${short(latest.head_sha)}) contient ces modifications.` };
    }
    return { ...done, status: "success", message: "Déployé sur GitHub Pages." };
  }
  if (mine.conclusion === "cancelled") {
    const newer = runs.filter((r) => Date.parse(r.created_at) > Date.parse(mine.created_at) && r.head_sha !== mine.head_sha).sort((x, y) => Date.parse(y.created_at) - Date.parse(x.created_at));
    for (const r of newer) {
      if ((await isAncestor(config, pub.commit_sha, r.head_sha)) !== true) continue;
      if (r.status !== "completed") return { ...run, status: "in_progress", message: `Annulé au profit du déploiement du commit plus récent ${short(r.head_sha)} (qui contient ces modifications), en cours.` };
      if (r.conclusion === "success") return { ...run, status: "superseded", deploy_finished_at: r.updated_at, deploy_run_url: runLink(r.html_url), message: `Inclus dans le déploiement du commit plus récent ${short(r.head_sha)}, réussi.` };
      return { ...run, status: "failure", deploy_finished_at: r.updated_at, deploy_run_url: runLink(r.html_url), message: `Annulé au profit du déploiement du commit ${short(r.head_sha)}, qui a échoué.` };
    }
    return { ...done, status: "cancelled", message: "Déploiement annulé sans déploiement plus récent contenant ces modifications : relancez une mise en ligne." };
  }
  if (mine.conclusion === "skipped") return { ...done, status: "skipped", message: "Le workflow n'a pas déployé ce commit (condition du workflow, ex. dépôt copié)." };
  if (["failure", "timed_out", "startup_failure"].includes(mine.conclusion)) return { ...done, status: "failure", message: `Déploiement en échec (${mine.conclusion}) : voir le journal GitHub Actions.` };
  return { ...done, status: "unknown", message: `Résultat inhabituel du workflow (${mine.conclusion || "?"}).` };
}

/** Prochaine vérification : chaque minute la première demi-heure, puis espacée. */
const nextCheck = (sentAt) => {
  const age = Date.now() - sentAt;
  return new Date(Date.now() + (age < 30 * 60e3 ? 60e3 : age < 2 * 3600e3 ? 5 * 60e3 : 15 * 60e3)).toISOString();
};

/**
 * Vérifie les déploiements en cours (planificateur, ou « Vérifier maintenant » avec force).
 * Renvoie { checked, error }. Un seul appel à l'API pour toutes les mises en ligne suivies.
 */
export async function checkDeployments(db, config, { force = false } = {}) {
  if (!config.deployTracking) return { checked: 0, disabled: true };
  const t = now();
  const watched = db.all(
    `SELECT * FROM publications WHERE status = 'success' AND commit_sha IS NOT NULL AND mode = 'push'
       AND (deploy_status IN ('waiting', 'queued', 'in_progress') OR (deploy_status = 'unknown' AND deploy_next_check_at IS NOT NULL)
            OR (deploy_status = 'success' AND deploy_finished_at > ?))
       ${force ? "" : "AND (deploy_next_check_at IS NULL OR deploy_next_check_at <= ?)"} ORDER BY id DESC LIMIT 10`,
    new Date(Date.now() - WATCH_SUCCESS_MS).toISOString(), ...(force ? [] : [t])
  );
  if (!watched.length) return { checked: 0 };
  const save = (pub, fields) => {
    const entries = Object.entries({ ...fields, deploy_checked_at: t });
    db.run(`UPDATE publications SET ${entries.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`, ...entries.map(([, v]) => v), pub.id);
  };
  const slug = await repoSlug(config);
  if (!slug) {
    for (const pub of watched) save(pub, { deploy_status: "unknown", deploy_next_check_at: null, deploy_message: "Dépôt GitHub non identifié : renseignez CMS_GITHUB_REPO (propriétaire/dépôt)." });
    return { checked: watched.length, error: "repo" };
  }
  const wf = encodeURIComponent(config.githubWorkflow);
  let runs;
  try {
    runs = await githubGet(config, slug, `actions/workflows/${wf}/runs?branch=${encodeURIComponent(config.gitBranch)}&event=push&per_page=30`);
    // Commit absent des 30 dernières exécutions (mise en ligne ancienne) : recherche par commit.
    for (const pub of watched) {
      if (!runs.some((r) => r.head_sha === pub.commit_sha) && Date.now() - Date.parse(pub.finished_at) > 2 * 60e3) {
        runs = runs.concat(await githubGet(config, slug, `actions/workflows/${wf}/runs?head_sha=${pub.commit_sha}&per_page=5`));
      }
    }
  } catch (error) {
    // Rien n'est conclu : l'état reste celui connu, avec le motif, et une nouvelle vérification est prévue.
    const message = error instanceof RateLimited
      ? `Suivi momentanément impossible : ${error.message} Nouvel essai après ${new Date(error.resetAt).toISOString().slice(11, 16)} UTC.`
      : `Suivi momentanément impossible : ${error.name === "TimeoutError" ? "GitHub ne répond pas." : cleanMessage(error)}`;
    for (const pub of watched) {
      const expired = Date.now() - Date.parse(pub.finished_at) > GIVE_UP_MS;
      save(pub, {
        deploy_status: expired ? "unknown" : pub.deploy_status,
        deploy_next_check_at: expired ? null : error instanceof RateLimited ? new Date(error.resetAt + 5e3).toISOString() : nextCheck(Date.parse(pub.finished_at)),
        deploy_message: expired ? "Aucune réponse exploitable de GitHub pendant 6 heures : vérifiez l'onglet Actions du dépôt." : message
      });
    }
    return { checked: watched.length, error: message };
  }
  for (const pub of watched) {
    const result = await evaluate(config, pub, runs);
    const { status, message, keepChecking, ...fields } = result;
    const expired = Date.now() - Date.parse(pub.finished_at) > GIVE_UP_MS;
    const active = ACTIVE.includes(status) || (keepChecking && !expired) || (status === "success" && Date.now() - Date.parse(fields.deploy_finished_at || t) < WATCH_SUCCESS_MS);
    save(pub, { ...fields, deploy_status: expired && ACTIVE.includes(status) ? "unknown" : status, deploy_message: expired && ACTIVE.includes(status) ? `${message} Suivi arrêté après 6 heures.` : message, deploy_next_check_at: active && !expired ? nextCheck(Date.parse(pub.finished_at)) : null });
  }
  return { checked: watched.length };
}

/** Vue d'une mise en ligne pour l'interface (aucun secret, aucun chemin). */
export function deploymentView(pub, config) {
  if (!pub) return null;
  const status = pub.status !== "success" ? null : pub.deploy_status || (pub.mode === "push" ? "unknown" : "not_sent");
  const state = status ? DEPLOY_STATES[status] : null;
  return {
    publicationId: pub.id,
    publicationStatus: pub.status,
    mode: pub.mode,
    stage: pub.stage,
    commit: pub.commit_sha,
    sentAt: pub.status === "success" ? pub.finished_at : null,
    status,
    label: status === "not_sent" ? (pub.mode === "commit" ? "Commit local, non envoyé" : "Fichiers générés, non envoyés") : state?.label ?? null,
    level: state?.level ?? null,
    message: pub.deploy_message || "",
    runUrl: pub.deploy_run_url || null,
    startedAt: pub.deploy_started_at || null,
    finishedAt: pub.deploy_finished_at || null,
    checkedAt: pub.deploy_checked_at || null,
    nextCheckAt: pub.deploy_next_check_at || null,
    siteUrl: ["success", "superseded"].includes(status) ? config?.siteUrl || null : null
  };
}
