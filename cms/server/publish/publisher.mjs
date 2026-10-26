/**
 * Mise en ligne : base → fichiers du site → outils existants → (commit) → (push).
 *
 * CMS_PUBLISH_MODE :
 *  - files  : écrit les fichiers dans la copie de travail (développement : on relit `git diff`) ;
 *  - commit : idem + commit Git des seuls fichiers gérés par le CMS ;
 *  - push   : idem + push vers CMS_GIT_REMOTE/CMS_GIT_BRANCH (GitHub Actions déploie le site).
 *
 * Garde-fous :
 *  - une seule mise en ligne à la fois, y compris entre processus (serveur et ligne de commande) : verrou
 *    en base renouvelé à chaque étape ; chaque mise en ligne exporte l'état complet et à jour de la base,
 *    donc une mise en ligne ne peut pas remplacer le site par une version plus ancienne que la sienne ;
 *  - en mode commit/push, les fichiers gérés doivent être propres avant de commencer et la branche
 *    est d'abord mise à jour (fast-forward uniquement) ;
 *  - en mode push, une mise en ligne réussie laisse la branche sans commit à envoyer (un commit du CMS
 *    dont l'envoi avait échoué part avec la suivante), et n'envoie jamais un commit qui ne vient pas du
 *    CMS (autre auteur, fusion, fichier non géré) : elle s'arrête sans rien envoyer ni supprimer ;
 *  - un fichier géré modifié hors du CMS depuis le dernier export (ex. events.js édité à la main)
 *    bloque la mise en ligne au lieu d'être écrasé (option « forcer » réservée aux administrateurs) ;
 *  - si la validation du site échoue, les fichiers sont restaurés (mode commit/push) et rien n'est
 *    poussé : le site en ligne reste dans son dernier état valide.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { now, fromJson } from "../db/index.mjs";
import { conflict } from "../http/errors.mjs";
import { buildSiteData } from "../export/site-data.mjs";
import { renderModules, MANAGED_MODULES } from "../export/modules.mjs";
import { variantFile } from "../services/media.mjs";
import { audit } from "../services/audit.mjs";
import { appliedIds, markPublished, notePublishFailure } from "../services/schedule.mjs";
import { deploymentView } from "./deploy-tracker.mjs";

/** Fichiers et dossiers écrits par la mise en ligne (seuls ceux-ci sont ajoutés au commit). */
export const MANAGED_PATHS = [
  ...MANAGED_MODULES,
  "assets/img/cms",
  "assets/img/events/og",
  "assets/img/maps",
  "evenement-*.html",
  "de",
  "en",
  "calendar",
  "sitemap.xml"
];

const CMS_MEDIA_DIR = "assets/img/cms";
/** Durée du verrou de mise en ligne sans renouvellement (processus arrêté brutalement). */
const LOCK_MS = 15 * 60e3;
/** Chemin géré -> pathspec Git (motif « evenement-*.html » interprété comme un glob). */
const pathspec = (p) => (p.includes("*") ? `:(glob)${p}` : p);
const sha = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const fileSha = (file) => (fs.existsSync(file) ? sha(fs.readFileSync(file)) : null);

function run(cmd, args, { cwd, env, timeout = 300e3, input } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 127, out: `${out}${error.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out: out.trim() });
    });
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

/**
 * Résultat de tools/validate.mjs --json ; sortie illisible (outil interrompu…) : une erreur explicite,
 * jamais une validation réussie par défaut.
 */
export function parseValidation(result) {
  const line = String(result.out || "").trim().split("\n").reverse().find((l) => l.startsWith("{"));
  try {
    const report = JSON.parse(line);
    if (Array.isArray(report.errors) && Array.isArray(report.warnings)) return { ...report, ok: Boolean(report.ok) && result.code === 0 };
  } catch { /* sortie non structurée */ }
  return { ok: false, errors: [`Résultat de la validation illisible (code ${result.code}).`], warnings: [], files: 0, pages: 0, unreadable: true };
}

export class Publisher {
  constructor({ config, db, log = () => {} }) {
    this.config = config;
    this.db = db;
    this.log = log;
    this.running = null;
    this.owner = `${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
    // Une mise en ligne interrompue (arrêt du serveur) ne doit pas rester « en cours ». Ses fichiers
    // à moitié écrits sont remis en état au début de la prochaine mise en ligne (sinon elle refuserait
    // de démarrer : « fichiers gérés modifiés »). Sauf si un autre processus est en train de publier.
    const lock = this.getSetting("publish.lock", null);
    const busyElsewhere = lock && Date.parse(lock.expiresAt) > Date.now();
    const { changes } = busyElsewhere ? { changes: 0 } : db.run("UPDATE publications SET status = 'failed', finished_at = ?, summary = 'Interrompue (redémarrage du serveur).' WHERE status = 'running'", now());
    this.interrupted = changes > 0;
  }

  /** Verrou de mise en ligne partagé par les processus (serveur, ligne de commande) : true si obtenu. */
  acquireLock() {
    return this.db.tx(() => {
      const lock = this.getSetting("publish.lock", null);
      if (lock && lock.owner !== this.owner && Date.parse(lock.expiresAt) > Date.now()) return false;
      this.setSetting("publish.lock", { owner: this.owner, pid: process.pid, expiresAt: new Date(Date.now() + LOCK_MS).toISOString() });
      return true;
    });
  }

  releaseLock() {
    this.db.tx(() => {
      if (this.getSetting("publish.lock", null)?.owner === this.owner) this.db.run("DELETE FROM settings WHERE key = 'publish.lock'");
    });
  }

  getSetting(key, fallback) {
    return fromJson(this.db.get("SELECT value FROM settings WHERE key = ?", key)?.value, fallback);
  }

  setSetting(key, value) {
    this.db.run("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)", key, JSON.stringify(value), now());
  }

  /**
   * Fichiers de données que la prochaine mise en ligne modifierait : comparaison du rendu actuel avec
   * celui de la dernière mise en ligne (ou de l'import, s'il a été vérifié identique au site).
   */
  pending() {
    const data = buildSiteData(this.db, { mode: "public" });
    const modules = renderModules(data);
    const published = this.getSetting("export.rendered", {});
    const changed = Object.entries(modules)
      .filter(([file, content]) => {
        const current = sha(Buffer.from(content));
        return published[file] ? published[file] !== current : fileSha(path.join(this.config.siteDir, file)) !== current;
      })
      .map(([file]) => file);
    const missingMedia = [...data.files.keys()].filter((p) => !fs.existsSync(path.join(this.config.siteDir, p)));
    const last = this.db.get("SELECT finished_at FROM publications WHERE status = 'success' ORDER BY id DESC LIMIT 1")?.finished_at;
    const since = last || "";
    const events = this.db.all("SELECT id, title, status, updated_at FROM events WHERE updated_at > ? ORDER BY updated_at DESC LIMIT 20", since);
    return { changed, missingMedia, events, hasChanges: changed.length > 0 || missingMedia.length > 0, lastPublishedAt: last || null };
  }

  /**
   * Plans des lieux absents (outil maps désactivé ou OpenStreetMap injoignable) : la soirée est
   * publiée sans la section « Y aller » plutôt que de bloquer toute la mise en ligne.
   */
  dropMissingMaps(data, step) {
    const dropped = [];
    for (const ev of data.events) {
      if (!ev.venue) continue;
      const maps = [`${ev.slug}-village`, ...(ev.venue.precise === false ? [] : [`${ev.slug}-lieu`])];
      if (maps.every((m) => fs.existsSync(path.join(this.config.siteDir, "assets/img/maps", `${m}.svg`)))) continue;
      delete ev.venue;
      dropped.push(ev.title);
    }
    if (dropped.length) step(`Attention : plan du lieu indisponible pour ${dropped.join(", ")} ; publiée(s) sans la section « Y aller » (nouvel essai à la prochaine mise en ligne).`);
    return dropped;
  }

  rememberHashes() {
    this.setSetting("export.hashes", Object.fromEntries(MANAGED_MODULES.map((f) => [f, fileSha(path.join(this.config.siteDir, f))])));
  }

  /** Empreinte du rendu publié (pour savoir s'il reste des modifications à mettre en ligne). */
  rememberRendered(modules) {
    this.setSetting("export.rendered", Object.fromEntries(Object.entries(modules).map(([f, c]) => [f, sha(Buffer.from(c))])));
  }

  /** Fichiers gérés modifiés hors du CMS depuis le dernier import ou export. */
  drift() {
    const known = this.getSetting("export.hashes", null);
    if (!known) return [];
    return MANAGED_MODULES.filter((file) => {
      const current = fileSha(path.join(this.config.siteDir, file));
      return file in known && known[file] !== current && current !== null;
    });
  }

  /**
   * Remet les seuls fichiers gérés par le CMS dans l'état du dernier commit : fichiers suivis modifiés ou
   * supprimés (git diff tolère les dossiers gérés pas encore commités), puis fichiers nouveaux (git clean).
   * Renvoie null, ou la sortie de Git si la restauration a échoué.
   */
  async restoreManaged() {
    const pathspecs = MANAGED_PATHS.map(pathspec);
    const changed = (await this.git(["diff", "--name-only", "HEAD", "--", ...pathspecs])).out.split("\n").filter(Boolean);
    const restore = changed.length ? await this.git(["checkout", "HEAD", "--", ...changed]) : { code: 0, out: "" };
    const clean = await this.git(["clean", "-fdq", "--", ...pathspecs]);
    this.rememberHashes();
    return restore.code === 0 && clean.code === 0 ? null : `${restore.out}\n${clean.out}`;
  }

  /**
   * Commits locaux absents de la branche distante, laissés par une mise en ligne dont l'envoi a été refusé
   * (quelqu'un avait poussé entre-temps). S'ils viennent tous du CMS et ne touchent que des fichiers gérés,
   * ils sont abandonnés : la mise en ligne régénère ces fichiers depuis la base. Un commit fait à la main
   * n'est jamais abandonné. Renvoie true si la branche a été réalignée sur `upstream`.
   */
  async dropUnpushedCmsCommits(upstream) {
    const range = `${upstream}..HEAD`;
    const authors = (await this.git(["log", "--format=%ae", range])).out.split("\n").filter(Boolean);
    if (!authors.length || authors.some((email) => email !== this.config.gitAuthorEmail)) return false;
    const base = (await this.git(["merge-base", upstream, "HEAD"])).out;
    const all = (await this.git(["diff", "--name-only", base, "HEAD"])).out.split("\n").filter(Boolean);
    const managed = (await this.git(["diff", "--name-only", base, "HEAD", "--", ...MANAGED_PATHS.map(pathspec)])).out.split("\n").filter(Boolean);
    if (all.length !== managed.length) return false;
    // --keep : comme --hard, mais refuse plutôt que d'écraser une modification locale non enregistrée.
    return (await this.git(["reset", "-q", "--keep", upstream])).code === 0;
  }

  /**
   * Commits locaux absents de la branche distante qui ne viennent pas du CMS : auteur ou committer autre
   * que le CMS, fusion, ou fichier hors des chemins gérés. Un push envoie TOUS les commits de la branche :
   * la mise en ligne refuse d'envoyer s'il y en a (rien n'est supprimé ni réécrit).
   */
  async foreignCommits(upstream) {
    const email = this.config.gitAuthorEmail;
    const foreign = [];
    for (const line of (await this.git(["rev-list", "--parents", `${upstream}..HEAD`])).out.split("\n").filter(Boolean)) {
      const [sha, ...parents] = line.split(" ");
      const [author, committer, subject] = (await this.git(["log", "-1", "--format=%ae%x09%ce%x09%s", sha])).out.split("\t");
      const files = (await this.git(["diff-tree", "--no-commit-id", "--name-only", "-r", sha])).out.split("\n").filter(Boolean);
      const managed = (await this.git(["diff-tree", "--no-commit-id", "--name-only", "-r", sha, "--", ...MANAGED_PATHS.map(pathspec)])).out.split("\n").filter(Boolean);
      if (parents.length !== 1 || author !== email || committer !== email || files.length !== managed.length) foreign.push(`${sha.slice(0, 7)} ${subject} (${author})`);
    }
    return foreign;
  }

  async git(args, options = {}) {
    const env = {
      GIT_AUTHOR_NAME: this.config.gitAuthorName,
      GIT_AUTHOR_EMAIL: this.config.gitAuthorEmail,
      GIT_COMMITTER_NAME: this.config.gitAuthorName,
      GIT_COMMITTER_EMAIL: this.config.gitAuthorEmail,
      GIT_TERMINAL_PROMPT: "0"
    };
    return run("git", args, { cwd: this.config.siteDir, env, timeout: 120e3, ...options });
  }

  /**
   * Lance une mise en ligne. Renvoie l'enregistrement de publication.
   * @param {{ trigger?: "manual"|"schedule"|"cli", user?: object, force?: boolean, ip?: string }} options
   */
  async publish({ trigger = "manual", user = null, force = false, ip = null } = {}) {
    if (this.running) throw conflict("Une mise en ligne est déjà en cours. Patientez quelques instants.");
    if (!this.acquireLock()) throw conflict("Une mise en ligne est déjà en cours (lancée par un autre processus). Patientez quelques instants.");
    const { db, config } = this;
    const mode = config.publishMode;
    const { lastInsertRowid } = db.run(
      "INSERT INTO publications (status, trigger, mode, user_id, started_at) VALUES ('running', ?, ?, ?, ?)",
      trigger, mode, user?.id ?? null, now()
    );
    const id = Number(lastInsertRowid);
    const lines = [];
    const step = (text) => {
      lines.push(`[${new Date().toISOString().slice(11, 19)}] ${text}`);
      db.run("UPDATE publications SET log = ? WHERE id = ?", lines.join("\n"), id);
      this.acquireLock();
    };
    // Étape en cours : situe un échec (préparation, export, génération, validation, commit, envoi).
    const setStage = (stage) => db.run("UPDATE publications SET stage = ? WHERE id = ?", stage, id);
    setStage("preparation");
    // Programmations appliquées incluses dans l'export de cette mise en ligne (lues en même temps).
    let included = [];
    const finish = (status, summary, commitSha = null) => {
      db.run("UPDATE publications SET status = ?, finished_at = ?, summary = ?, commit_sha = ?, log = ? WHERE id = ?", status, now(), summary, commitSha, lines.join("\n"), id);
      if (status === "success") {
        // Déploiement : suivi par publish/deploy-tracker.mjs pour un commit présent sur GitHub (mode push) ;
        // dans les autres modes, rien n'est envoyé.
        setStage("done");
        const tracked = mode === "push" && commitSha;
        db.run("UPDATE publications SET deploy_status = ?, deploy_next_check_at = ?, deploy_message = ? WHERE id = ?",
          tracked ? "waiting" : "not_sent", tracked ? now() : null,
          tracked ? "Envoyé sur GitHub : en attente du déploiement GitHub Pages." : mode === "commit" ? "Commit local, pas envoyé sur GitHub." : "Fichiers écrits dans la copie de travail, rien n'est envoyé.", id);
      }
      audit(db, { user, ip }, status === "success" ? "site.publish" : "site.publish.failed", "publication", id, summary);
      if (status === "success") markPublished(db, included, id, summary);
      else notePublishFailure(db, included.length ? included : appliedIds(db), summary);
      return db.get("SELECT * FROM publications WHERE id = ?", id);
    };

    this.running = (async () => {
      let wrote = false;
      const gitMode = mode === "commit" || mode === "push";
      try {
        step(`Mise en ligne (${{ files: "fichiers uniquement", commit: "fichiers + commit", push: "fichiers + commit + push" }[mode]}).`);
        const pathspecs = MANAGED_PATHS.map(pathspec);
        if (gitMode) {
          const inside = await this.git(["rev-parse", "--is-inside-work-tree"]);
          if (inside.code !== 0) throw new Error(`Le dossier du site n'est pas un dépôt Git : ${config.siteDir}`);
          const branch = (await this.git(["rev-parse", "--abbrev-ref", "HEAD"])).out;
          if (branch !== config.gitBranch) throw new Error(`Le dépôt est sur la branche « ${branch} » au lieu de « ${config.gitBranch} ».`);
          if (this.interrupted) {
            const problem = await this.restoreManaged();
            if (problem) throw new Error(`Mise en ligne précédente interrompue : restauration des fichiers du site impossible :\n${problem}`);
            this.interrupted = false;
            step("Mise en ligne précédente interrompue (redémarrage du serveur) : fichiers du site remis dans leur dernier état publié.");
          }
          const dirty = await this.git(["status", "--porcelain", "--", ...pathspecs]);
          if (dirty.out) throw new Error(`Des fichiers gérés par le CMS ont des modifications non enregistrées dans le dépôt :\n${dirty.out}`);
          if (mode === "push") {
            const upstream = `${config.gitRemote}/${config.gitBranch}`;
            step(`Mise à jour depuis ${upstream}…`);
            const fetch = await this.git(["fetch", config.gitRemote, config.gitBranch]);
            if (fetch.code !== 0) throw new Error(`git fetch a échoué :\n${fetch.out}`);
            let merge = await this.git(["merge", "--ff-only", upstream]);
            if (merge.code !== 0 && (await this.dropUnpushedCmsCommits(upstream))) {
              step("Commit d'une mise en ligne précédente jamais envoyé (envoi refusé) : abandonné, les fichiers vont être régénérés depuis la base.");
              merge = await this.git(["merge", "--ff-only", upstream]);
            }
            if (merge.code !== 0) throw new Error(`Impossible de mettre à jour la branche sans fusion (historique divergent) :\n${merge.out}`);
            const foreign = await this.foreignCommits(upstream);
            if (foreign.length) {
              throw new Error(`La branche locale contient des commits qui ne viennent pas du CMS ; ils partiraient avec la mise en ligne. Rien n'a été envoyé. Faites-les relire et pousser (ou retirer) par l'équipe technique :\n${foreign.join("\n")}`);
            }
          }
        }

        const drift = this.drift();
        if (drift.length && !force) {
          throw Object.assign(new Error(`Fichiers modifiés hors du CMS depuis la dernière mise en ligne : ${drift.join(", ")}. Reportez ces changements dans le CMS (ou demandez à un administrateur de forcer la mise en ligne, ce qui les remplacera).`), { drift });
        }
        if (drift.length) step(`Fichiers modifiés hors du CMS remplacés (mise en ligne forcée) : ${drift.join(", ")}.`);

        setStage("export");
        step("Export des contenus publiés…");
        // Lecture cohérente : l'export et la liste des programmations qu'il contient viennent du même état.
        const data = db.tx(() => {
          included = appliedIds(db);
          return buildSiteData(db, { mode: "public" });
        });
        if (included.length) step(`Programmations incluses : n° ${included.join(", n° ")}.`);
        wrote = true;
        // Images : variantes optimisées copiées dans assets/img/cms (seulement celles utilisées).
        const mediaDir = path.join(config.siteDir, CMS_MEDIA_DIR);
        fs.mkdirSync(mediaDir, { recursive: true });
        let copied = 0;
        for (const [publicPath, { media, variant }] of data.files) {
          const src = await variantFile(config, media, variant);
          const dest = path.join(config.siteDir, publicPath);
          if (fileSha(dest) !== fileSha(src)) {
            fs.copyFileSync(src, dest);
            copied++;
          }
        }
        let removed = 0;
        const wanted = new Set([...data.files.keys()].map((p) => path.basename(p)));
        for (const name of fs.readdirSync(mediaDir)) {
          if (!wanted.has(name) && /-[0-9a-f]{12}-v\d+(-[a-z]+)?\.(webp|jpg)$/.test(name)) {
            fs.rmSync(path.join(mediaDir, name));
            removed++;
          }
        }
        step(`Images : ${data.files.size} utilisée(s), ${copied} copiée(s), ${removed} retirée(s).`);
        let modules = renderModules(data);
        // Rendu attendu (avec tous les plans) : sert de référence pour « modifications en attente ».
        const expectedModules = modules;
        const writeModules = () => {
          let n = 0;
          for (const [file, content] of Object.entries(modules)) {
            const full = path.join(config.siteDir, file);
            if (fs.existsSync(full) && fs.readFileSync(full, "utf8") === content) continue;
            fs.mkdirSync(path.dirname(full), { recursive: true });
            fs.writeFileSync(`${full}.tmp`, content);
            fs.renameSync(`${full}.tmp`, full);
            n++;
          }
          return n;
        };
        const changedModules = writeModules();
        step(`Données : ${data.events.length} soirée(s), ${data.FAQ.length} question(s), ${data.TEAM.length} membre(s) ; ${changedModules} fichier(s) de données modifié(s).`);
        // Empreintes des fichiers écrits : base de la détection des modifications hors CMS.
        this.rememberHashes();

        const tools = [
          ["tools/event-pages.mjs", "Fiches des soirées et images d'aperçu"],
          ["tools/generate-calendar.mjs", "Agenda .ics"],
          ...(config.runMaps ? [["tools/maps.mjs", "Plans des lieux (OpenStreetMap)"]] : []),
          ["tools/langues.mjs", "Pages allemandes et anglaises, sitemap"],
          ["tools/validate.mjs", "Validation complète du site"]
        ];
        let degraded = [];
        setStage("generation");
        for (const [tool, label] of tools) {
          if (tool === "tools/langues.mjs") degraded = this.dropMissingMaps(data, step);
          if (degraded.length && tool === "tools/langues.mjs") {
            modules = renderModules(data);
            writeModules();
            this.rememberHashes();
          }
          step(`${label}…`);
          if (tool === "tools/validate.mjs") {
            // Validation : résultat structuré (erreurs bloquantes / avertissements « à compléter »).
            setStage("validation");
            const result = await run(process.execPath, [tool, "--json"], { cwd: config.siteDir, timeout: 600e3 });
            const report = parseValidation(result);
            db.run("UPDATE publications SET validation = ? WHERE id = ?", JSON.stringify(report), id);
            if (report.errors.length) step(`Validation : ${report.errors.length} erreur(s) bloquante(s) :\n- ${report.errors.slice(0, 15).join("\n- ")}`);
            if (report.warnings.length) step(`Validation : ${report.warnings.length} avertissement(s) (non bloquants) :\n- ${report.warnings.slice(0, 15).join("\n- ")}`);
            if (!report.ok) throw new Error(`${label} : échec (${report.errors.length || "?"} erreur(s)).`);
            step(`Validation OK : ${report.files} fichiers, ${report.pages} pages.`);
            continue;
          }
          const result = await run(process.execPath, [tool], { cwd: config.siteDir, timeout: 600e3 });
          if (result.out) step(result.out.split("\n").slice(-15).join("\n"));
          // Plans : un échec (OpenStreetMap injoignable) n'empêche pas la mise en ligne (voir dropMissingMaps).
          if (result.code !== 0 && tool !== "tools/maps.mjs") throw new Error(`${label} : échec (code ${result.code}).`);
          if (result.code !== 0) step("Plans : génération impossible pour l'instant (réseau ?).");
        }

        let commitSha = null;
        let summary = "Site mis à jour (fichiers écrits).";
        if (gitMode) {
          setStage("commit");
          await this.git(["add", "-A", "--", ...pathspecs]);
          const staged = await this.git(["diff", "--cached", "--name-only"]);
          if (staged.out) {
            const files = staged.out.split("\n");
            const changedEvents = db.all(
              "SELECT title FROM events WHERE updated_at > COALESCE((SELECT MAX(finished_at) FROM publications WHERE status = 'success'), '') ORDER BY date DESC LIMIT 10"
            ).map((e) => `- ${e.title}`);
            const message = [
              "contenu: mise en ligne depuis le CMS",
              "",
              `Mise en ligne ${trigger === "schedule" ? "programmée" : `par ${user?.name || "la ligne de commande"}`} (${files.length} fichier(s)).`,
              ...(changedEvents.length ? ["", "Soirées modifiées :", ...changedEvents] : [])
            ].join("\n");
            const commit = await this.git(["commit", "-q", "-F", "-"], { input: message });
            if (commit.code !== 0) throw new Error(`git commit a échoué :\n${commit.out}`);
            step(`Commit ${(await this.git(["rev-parse", "--short", "HEAD"])).out} (${files.length} fichier(s)).`);
            summary = `Commit ${(await this.git(["rev-parse", "--short", "HEAD"])).out} : ${files.length} fichier(s).`;
          } else {
            summary = "Aucun changement à mettre en ligne : le site est déjà à jour.";
            step(summary);
          }
          commitSha = (await this.git(["rev-parse", "HEAD"])).out;
          if (mode === "push") {
            // Envoi de tout ce que la branche distante n'a pas encore, y compris un commit d'une mise en
            // ligne précédente dont l'envoi avait échoué : une mise en ligne « réussie » en mode push
            // garantit que le dernier état exporté est sur GitHub.
            const upstream = `${config.gitRemote}/${config.gitBranch}`;
            const ahead = Number((await this.git(["rev-list", "--count", `${upstream}..HEAD`])).out) || 0;
            if (ahead > 0) {
              setStage("push");
              // Nouvelle vérification juste avant l'envoi (commit ajouté à la main pendant la mise en ligne).
              const foreign = await this.foreignCommits(upstream);
              if (foreign.length) throw new Error(`Envoi annulé : des commits qui ne viennent pas du CMS sont apparus sur la branche pendant la mise en ligne (le commit du CMS est conservé localement) :\n${foreign.join("\n")}`);
              if (!staged.out) step(`${ahead} commit(s) d'une mise en ligne précédente pas encore envoyé(s) : envoi.`);
              const push = await this.git(["push", config.gitRemote, `HEAD:${config.gitBranch}`], { timeout: 180e3 });
              if (push.code !== 0) {
                // Le commit reste local : il partira avec la prochaine mise en ligne (ou sera abandonné et
                // refait si la branche distante a avancé entre-temps, voir dropUnpushedCmsCommits).
                throw new Error(`git push a échoué (le commit ${commitSha.slice(0, 7)} est conservé localement) :\n${push.out}`);
              }
              step(`Envoyé sur ${upstream} : GitHub Actions déploie ensuite le site (quelques minutes) ; le CMS suit ce déploiement.`);
              summary = `Envoyé sur GitHub (${commitSha.slice(0, 7)}) : déploiement GitHub Pages en cours de suivi.`;
            }
          }
          if (!staged.out) {
            this.rememberRendered(modules);
            return finish("success", summary, commitSha);
          }
        }
        // Soirée publiée sans plan : la référence reste le rendu complet, donc la modification reste
        // « en attente » et la prochaine mise en ligne réessaiera les plans.
        this.rememberRendered(degraded.length ? { ...expectedModules, "js/data/events.js": "" } : modules);
        if (degraded.length) summary += ` Sans plan « Y aller » pour l'instant : ${degraded.join(", ")}.`;
        step("Terminé.");
        return finish("success", summary, commitSha);
      } catch (error) {
        step(`ÉCHEC : ${error.message}`);
        if (gitMode && wrote && !/git push/.test(error.message)) {
          // Retour à l'état du dernier commit pour les seuls fichiers gérés (vérifiés propres au départ).
          const problem = await this.restoreManaged();
          if (!problem) step("Fichiers du site restaurés dans leur dernier état publié.");
          else step(`Restauration incomplète, vérifiez le dépôt :\n${problem}`);
        }
        return finish("failed", error.message.split("\n")[0].slice(0, 400));
      } finally {
        this.running = null;
        this.releaseLock();
      }
    })();
    return this.running;
  }
}

/** Historique des mises en ligne, avec l'étape d'un échec, la validation et l'état du déploiement. */
export function listPublications(db, { limit = 30, siteUrl = null } = {}) {
  return db.all(
    `SELECT p.*, u.name AS user_name FROM publications p LEFT JOIN users u ON u.id = p.user_id ORDER BY p.id DESC LIMIT ?`,
    limit
  ).map((p) => publicationView(p, siteUrl));
}

/** Mise en ligne pour l'interface : sans le journal (détail à part), validation et déploiement lisibles. */
export function publicationView(p, siteUrl = null, { withLog = false } = {}) {
  const { log, validation, ...rest } = p;
  return { ...rest, ...(withLog ? { log } : {}), validation: fromJson(validation, null), deployment: deploymentView(p, { siteUrl }) };
}
