/**
 * Suivi des déploiements GitHub Pages (API GitHub simulée, jamais appelée) et tableau de santé.
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { startCms, tempDir } from "./helpers.mjs";
import { REPO_ROOT } from "../server/config.mjs";
import { runtime } from "../server/runtime.mjs";
import { checkDeployments, deploymentView } from "../server/publish/deploy-tracker.mjs";

const realFetch = runtime.fetch;
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** Petit dépôt Git : A → B (B contient A), et C sur une autre branche (ne contient pas B). */
function gitRepo() {
  const dir = tempDir("tnd-deploy-");
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  const commit = (msg) => { git("-c", "user.email=t@t.t", "-c", "user.name=T", "commit", "-q", "--allow-empty", "-m", msg); return git("rev-parse", "HEAD"); };
  const A = commit("A");
  const B = commit("B");
  git("checkout", "-q", "-b", "autre", A);
  const C = commit("C");
  git("checkout", "-q", "main");
  return { dir, A, B, C };
}

describe("suivi du déploiement GitHub Pages", { timeout: 60e3 }, () => {
  let cms, repo, config, calls, responder;
  before(async () => {
    cms = await startCms();
    repo = gitRepo();
    config = { ...cms.config, siteDir: repo.dir, githubRepo: "asso/site", githubToken: "" };
    runtime.fetch = async (url, init) => {
      calls.push({ url: String(url), headers: init?.headers || {} });
      return responder(String(url));
    };
  });
  after(async () => {
    runtime.fetch = realFetch;
    await cms.close();
    fs.rmSync(repo.dir, { recursive: true, force: true });
  });
  beforeEach(() => { calls = []; });

  /** Mise en ligne réussie en mode push, envoyée il y a `ago` minutes. */
  const sent = (sha, ago = 1) => {
    const at = new Date(Date.now() - ago * 60e3).toISOString();
    return Number(cms.db.run(
      "INSERT INTO publications (status, trigger, mode, started_at, finished_at, commit_sha, summary, deploy_status, deploy_next_check_at) VALUES ('success', 'manual', 'push', ?, ?, ?, '', 'waiting', NULL)",
      at, at, sha
    ).lastInsertRowid);
  };
  const run = (id, sha, status, conclusion, { created = Date.now() - 60e3, updated = Date.now() - 30e3 } = {}) => ({
    id, head_sha: sha, status, conclusion, run_attempt: 1, created_at: new Date(created).toISOString(), run_started_at: new Date(created).toISOString(), updated_at: new Date(updated).toISOString(), html_url: `https://github.com/asso/site/actions/runs/${id}`
  });
  const state = (id) => cms.db.get("SELECT * FROM publications WHERE id = ?", id);
  const runsOnly = (runs) => () => json(200, { total_count: runs.length, workflow_runs: runs });
  const reset = () => cms.db.run("UPDATE publications SET deploy_status = 'success', deploy_finished_at = '2000-01-01T00:00:00Z', deploy_next_check_at = NULL WHERE deploy_status IN ('waiting', 'queued', 'in_progress', 'unknown')");

  test("envoi réussi : en attente, puis en cours, puis déployé pour le commit exact", async () => {
    reset();
    const id = sent(repo.B);
    responder = runsOnly([]);
    await checkDeployments(cms.db, config, { force: true });
    assert.equal(state(id).deploy_status, "waiting");
    assert.match(calls[0].url, /\/repos\/asso\/site\/actions\/workflows\/deploy-pages\.yml\/runs\?branch=main&event=push/);
    assert.equal(calls[0].headers.Authorization, undefined, "dépôt public : aucun jeton envoyé s'il n'est pas configuré");
    responder = runsOnly([run(11, repo.B, "in_progress", null)]);
    await checkDeployments(cms.db, config, { force: true });
    assert.equal(state(id).deploy_status, "in_progress");
    responder = runsOnly([run(11, repo.B, "completed", "success")]);
    await checkDeployments(cms.db, config, { force: true });
    const done = state(id);
    assert.equal(done.deploy_status, "success");
    assert.equal(done.deploy_run_url, "https://github.com/asso/site/actions/runs/11");
    assert.ok(done.deploy_finished_at);
    const view = deploymentView(done, { siteUrl: "https://exemple.org/" });
    assert.equal(view.label, "Déployé sur le site");
    assert.equal(view.siteUrl, "https://exemple.org/");
  });

  test("workflow en échec", async () => {
    reset();
    const id = sent(repo.B);
    responder = runsOnly([run(12, repo.B, "completed", "failure")]);
    await checkDeployments(cms.db, config, { force: true });
    assert.equal(state(id).deploy_status, "failure");
    assert.equal(deploymentView(state(id)).level, "error");
  });

  test("annulé : remplacé par un déploiement réussi qui contient le commit, sinon simplement annulé", async () => {
    reset();
    const id = sent(repo.A);
    const t = Date.now();
    responder = runsOnly([run(21, repo.A, "completed", "cancelled", { created: t - 120e3 }), run(22, repo.B, "completed", "success", { created: t - 60e3 })]);
    await checkDeployments(cms.db, config, { force: true });
    assert.equal(state(id).deploy_status, "superseded");
    assert.match(state(id).deploy_message, new RegExp(repo.B.slice(0, 7)));
    reset();
    const id2 = sent(repo.B);
    responder = runsOnly([run(23, repo.B, "completed", "cancelled", { created: t - 120e3 }), run(24, repo.C, "completed", "success", { created: t - 60e3 })]);
    await checkDeployments(cms.db, config, { force: true });
    assert.equal(state(id2).deploy_status, "cancelled", "le déploiement plus récent ne contient pas ce commit");
  });

  test("ancien workflow terminé en retard : le commit plus récent n'est pas présenté comme en ligne", async () => {
    reset();
    const id = sent(repo.B);
    const t = Date.now();
    // B réussi d'abord, puis l'exécution du commit antérieur A se termine après : le site montre A.
    responder = runsOnly([run(31, repo.B, "completed", "success", { created: t - 100e3, updated: t - 50e3 }), run(30, repo.A, "completed", "success", { created: t - 200e3, updated: t - 10e3 })]);
    await checkDeployments(cms.db, config, { force: true });
    assert.equal(state(id).deploy_status, "overwritten");
    assert.equal(deploymentView(state(id)).level, "error");
    // Commit antérieur : un succès de A ne vaut pas pour B.
    reset();
    const id2 = sent(repo.B);
    responder = runsOnly([run(32, repo.A, "completed", "success")]);
    await checkDeployments(cms.db, config, { force: true });
    assert.equal(state(id2).deploy_status, "waiting", "aucune exécution pour B : jamais « déployé »");
  });

  test("erreur de l'API GitHub ou limite d'appels : état inchangé, nouvel essai programmé, jamais un succès", async () => {
    reset();
    const id = sent(repo.B);
    responder = () => json(500, { message: "boom" });
    await checkDeployments(cms.db, config, { force: true });
    assert.equal(state(id).deploy_status, "waiting");
    assert.match(state(id).deploy_message, /momentanément impossible/);
    const resetAt = Math.floor(Date.now() / 1000) + 1800;
    responder = () => json(403, { message: "rate limit" }, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(resetAt) });
    await checkDeployments(cms.db, config, { force: true });
    assert.equal(state(id).deploy_status, "waiting");
    assert.match(state(id).deploy_message, /Limite d'appels/);
    assert.ok(Date.parse(state(id).deploy_next_check_at) >= resetAt * 1000, "nouvel essai après la remise à zéro de la limite");
    responder = () => { throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); };
    await checkDeployments(cms.db, config, { force: true });
    assert.match(state(id).deploy_message, /GitHub ne répond pas/);
    assert.notEqual(state(id).deploy_status, "success");
  });

  test("état inconnu : aucune exécution trouvée, ou aucune réponse pendant 6 heures", async () => {
    reset();
    const id = sent(repo.B, 20);
    responder = runsOnly([]);
    await checkDeployments(cms.db, config, { force: true });
    assert.equal(state(id).deploy_status, "unknown");
    assert.equal(deploymentView(state(id)).level, "unknown");
    reset();
    const id2 = sent(repo.B, 7 * 60);
    responder = () => json(502, {});
    await checkDeployments(cms.db, config, { force: true });
    assert.equal(state(id2).deploy_status, "unknown");
    assert.equal(state(id2).deploy_next_check_at, null, "suivi arrêté");
  });

  test("jeton facultatif : envoyé seulement à GitHub, jamais renvoyé par l'API du CMS", async () => {
    reset();
    sent(repo.B);
    responder = runsOnly([run(41, repo.B, "completed", "success")]);
    await checkDeployments(cms.db, { ...config, githubToken: "jeton-secret-de-test" }, { force: true });
    assert.equal(calls[0].headers.Authorization, "Bearer jeton-secret-de-test");
    const editor = await cms.login("editor");
    const res = await editor.get("/api/deployments");
    assert.equal(res.status, 200);
    assert.doesNotMatch(JSON.stringify(res.data), /jeton-secret|asso\/site\/actions\/workflows/);
  });

  test("dépôt non identifiable : inconnu, avec la marche à suivre", async () => {
    reset();
    const id = sent(repo.B);
    await checkDeployments(cms.db, { ...config, githubRepo: "", siteDir: tempDir() }, { force: true });
    assert.equal(state(id).deploy_status, "unknown");
    assert.match(state(id).deploy_message, /CMS_GITHUB_REPO/);
  });
});

describe("tableau de santé", { timeout: 60e3 }, () => {
  let cms, admin, editor;
  before(async () => {
    cms = await startCms();
    admin = await cms.login("admin");
    editor = await cms.login("editor");
  });
  after(() => cms.close());
  const item = (report, section, id) => report.sections.find((s) => s.id === section)?.items.find((i) => i.id === id);

  test("droits : les éditeurs ne voient ni le serveur ni les sauvegardes ; aucun chemin dans les réponses", async () => {
    const forEditor = (await editor.get("/api/health")).data;
    assert.deepEqual(forEditor.sections.map((s) => s.id), ["scheduler", "publication"]);
    const forAdmin = (await admin.get("/api/health")).data;
    assert.deepEqual(forAdmin.sections.map((s) => s.id), ["server", "scheduler", "publication", "backups", "restore"]);
    for (const data of [forEditor, forAdmin]) assert.ok(!JSON.stringify(data).includes(cms.dataDir), "aucun chemin du serveur");
    assert.equal((await editor.post("/api/health/restore-test", {})).status, 403);
    assert.equal((await editor.post("/api/health/integrity", {})).status, 403);
    assert.equal((await cms.client().get("/api/health")).status, 401);
  });

  test("serveur et base : migrations à jour, intégrité contrôlée à la demande, planificateur désactivé signalé", async () => {
    let report = (await admin.get("/api/health")).data;
    assert.equal(item(report, "server", "migrations").level, "ok");
    assert.equal(item(report, "scheduler", "scheduler").level, "warning", "CMS_SCHEDULER=0 dans les tests");
    const check = await admin.post("/api/health/integrity", {});
    assert.equal(check.data.ok, true);
    report = (await admin.get("/api/health")).data;
    assert.equal(item(report, "server", "integrity").level, "ok");
  });

  test("programmations en retard, bloquées, en échec : intervention signalée", async () => {
    const t = new Date().toISOString();
    const add = (status, runAt, result = "") => cms.db.run(
      "INSERT INTO scheduled_changes (entity_type, entity_id, entity_generation, entity_label, summary, changes, run_at, status, result, created_at, updated_at) VALUES ('event', 999, 999, 'Test', 'Prix', '[]', ?, ?, ?, ?, ?)",
      runAt, status, result, t, t
    );
    add("pending", new Date(Date.now() - 2 * 3600e3).toISOString());
    add("blocked", t);
    add("failed", t);
    const report = (await editor.get("/api/health")).data;
    assert.equal(item(report, "scheduler", "late").level, "error");
    assert.equal(item(report, "scheduler", "attention").level, "error");
    assert.match(item(report, "scheduler", "attention").value, /1 bloquée/);
    assert.equal(item(report, "scheduler", "attention").link, "/admin/schedule?status=attention");
    cms.db.run("DELETE FROM scheduled_changes WHERE entity_id = 999");
  });

  test("sauvegardes : absente, trop ancienne, hors serveur non configurée ou en échec, test de restauration", async () => {
    let report = (await admin.get("/api/health")).data;
    assert.equal(item(report, "backups", "local").level, "error", "aucune sauvegarde");
    assert.equal(item(report, "backups", "external").level, "unknown");
    assert.match(item(report, "backups", "external").value, /Non configurée/);
    assert.equal(item(report, "backups", "restore-test").level, "unknown");
    // Sauvegarde vieille de 4 jours (attendue toutes les 24 h) : erreur.
    await admin.post("/api/backups", {});
    const [file] = fs.readdirSync(cms.config.backupDir);
    const old = new Date(Date.now() - 4 * 86400e3);
    fs.utimesSync(path.join(cms.config.backupDir, file), old, old);
    report = (await admin.get("/api/health")).data;
    assert.equal(item(report, "backups", "local").level, "error");
    // Rapport du script hors serveur : réussi mais ancien, puis en échec.
    fs.mkdirSync(path.join(cms.dataDir, "status"), { recursive: true });
    const status = path.join(cms.dataDir, "status", "backup-externe.json");
    fs.writeFileSync(status, JSON.stringify({ finishedAt: new Date(Date.now() - 50 * 3600e3).toISOString(), ok: true, step: "terminé", message: "ok" }));
    report = (await admin.get("/api/health")).data;
    assert.equal(item(report, "backups", "external").level, "warning");
    // Rapport de l'ancienne version du script (envoi seulement) : contenu distant « non vérifié ».
    assert.equal(item(report, "backups", "external-verify").level, "warning");
    assert.equal(item(report, "backups", "external-verify").value, "Non vérifié");
    const write = (data) => fs.writeFileSync(status, JSON.stringify({ finishedAt: new Date().toISOString(), ...data }));
    write({ ok: false, step: "envoi rsync", message: "Échec (code 23)", commandOk: false, verified: null });
    report = (await admin.get("/api/health")).data;
    assert.equal(item(report, "backups", "external").level, "error");
    assert.match(item(report, "backups", "external").message, /envoi rsync/);
    assert.equal(item(report, "backups", "external-verify").level, "unknown");
    // Envoi réussi mais vérification en échec : l'envoi est vert, le contenu distant en erreur.
    write({ ok: false, step: "vérification distante", message: "…", commandOk: true, verified: false, differences: 3, verifiedFiles: 40 });
    report = (await admin.get("/api/health")).data;
    assert.equal(item(report, "backups", "external").level, "ok");
    assert.equal(item(report, "backups", "external-verify").level, "error");
    assert.equal(item(report, "backups", "external-verify").value, "3 différence(s)");
    // Envoi réussi, vérification désactivée : jamais présenté comme vérifié.
    write({ ok: true, step: "terminé", message: "…", commandOk: true, verified: null });
    report = (await admin.get("/api/health")).data;
    assert.equal(item(report, "backups", "external-verify").level, "warning");
    // Rapports incohérents ou vides : jamais verts.
    write({ ok: true, step: "terminé", message: "…", commandOk: true, verified: true, differences: 2, verifiedFiles: 40 });
    assert.equal(item((await admin.get("/api/health")).data, "backups", "external-verify").level, "error");
    write({ ok: true, step: "terminé", message: "…", commandOk: true, verified: true, differences: 0, verifiedFiles: 0 });
    assert.equal(item((await admin.get("/api/health")).data, "backups", "external-verify").level, "warning");
    write({ ok: false, step: "vérification distante", message: "Échec (code 255)", commandOk: true, verified: false, differences: 0, verifiedFiles: 40 });
    assert.equal(item((await admin.get("/api/health")).data, "backups", "external-verify").value, "Vérification impossible");
    // Envoi et vérification réussis, récents : normal ; aucun chemin dans la réponse.
    write({ ok: true, step: "terminé", message: "…", commandOk: true, verified: true, differences: 0, verifiedFiles: 40, latestBackup: "cms-20261026-030000-nuit.sqlite" });
    report = (await admin.get("/api/health")).data;
    assert.equal(item(report, "backups", "external").level, "ok");
    assert.equal(item(report, "backups", "external-verify").level, "ok");
    assert.match(item(report, "backups", "external-verify").message, /40 fichier\(s\) comparé\(s\)/);
    assert.ok(!JSON.stringify(report).includes(cms.dataDir));
    // Test de restauration sur une copie : réussi, base en service intacte.
    const before = fs.statSync(cms.config.dbFile).size;
    const tested = await admin.post("/api/health/restore-test", {});
    assert.equal(tested.data.ok, true, tested.data.detail);
    assert.equal(fs.statSync(cms.config.dbFile).size >= before, true);
    report = (await admin.get("/api/health")).data;
    assert.equal(item(report, "backups", "restore-test").level, "ok");
  });
});

/**
 * rsync simulé (rsync n'est pas installé ici). Envoi : copie les dossiers sources dans la destination, ou,
 * avec --files-from=-, les fichiers listés sur l'entrée standard ; comme rsync, crée le dernier dossier de
 * la destination mais échoue si son parent n'existe pas. Avec --dry-run --checksum --itemize-changes,
 * compare chaque fichier par empreinte SHA-256 et affiche une ligne « <f… » par fichier absent ou
 * différent. Une destination « machine:/chemin » est simulée sous FAKE_REMOTE_ROOT (jamais dans le dépôt).
 * FAKE_RSYNC : ok, corrupt (copie abîmée d'une sauvegarde de la base), unreachable-verify (destination
 * injoignable à la vérification), fail (envoi impossible).
 */
const FAKE_RSYNC = `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const mode = process.env.FAKE_RSYNC || "ok";
const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const dry = process.argv.includes("--dry-run");
const filesFrom = process.argv.includes("--files-from=-");
let dest = args.pop();
if (/^[^/]+:/.test(dest)) dest = path.join(process.env.FAKE_REMOTE_ROOT, dest.replace(/^[^/]+:/, ""));
if (mode === "fail") process.exit(23);
if (dry && mode === "unreachable-verify") process.exit(255);
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
// Comme rsync : le dernier dossier de la destination est créé, mais pas ses parents.
const ensureDest = () => {
  if (!fs.existsSync(path.dirname(path.resolve(dest)))) { console.error("mkdir failed: No such file or directory"); process.exit(11); }
  if (fs.existsSync(dest) && !fs.statSync(dest).isDirectory()) { console.error("destination is not a directory"); process.exit(11); }
  if (!dry && !fs.existsSync(dest)) fs.mkdirSync(dest);
};
if (filesFrom) {
  const names = fs.readFileSync(0, "utf8").split("\\n").filter(Boolean);
  ensureDest();
  for (const name of names) {
    const src = path.join(args[0], name), copy = path.join(dest, name);
    if (!dry) { if (path.resolve(src) !== path.resolve(copy)) fs.copyFileSync(src, copy); continue; }
    if (!fs.existsSync(copy) || sha(copy) !== sha(src)) console.log(">f+++++++++ " + name);
  }
  if (!dry && mode === "corrupt") fs.appendFileSync(path.join(dest, names[0]), "abîmé");
  process.exit(0);
}
ensureDest();
for (const src of args) {
  const target = path.join(dest, path.basename(src));
  if (!dry) { fs.cpSync(src, target, { recursive: true }); continue; }
  for (const file of walk(src)) {
    const copy = path.join(target, path.relative(src, file));
    if (!fs.existsSync(copy) || sha(copy) !== sha(file)) console.log("<f+++++++++ " + path.join(path.basename(src), path.relative(src, file)));
  }
}
`;

describe("cms/deploy/backup-media.sh : envoi et vérification du contenu distant", { timeout: 180e3 }, () => {
  const script = path.join(REPO_ROOT, "cms/deploy/backup-media.sh");
  const FAKE = FAKE_RSYNC;
  let bin;
  before(() => {
    bin = tempDir("tnd-bin-");
    fs.writeFileSync(path.join(bin, "rsync"), FAKE, { mode: 0o755 });
  });
  after(() => fs.rmSync(bin, { recursive: true, force: true }));
  const run = (env) => {
    const data = tempDir("tnd-data-");
    const dest = tempDir("tnd-dest-");
    fs.mkdirSync(path.join(data, "media", "originals"), { recursive: true });
    fs.writeFileSync(path.join(data, "media", "originals", "photo.jpg"), "image");
    const r = spawnSync("sh", [script], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CMS_DATA_DIR: data, TND_BACKUP_DEST: dest, ...env }, encoding: "utf8" });
    const status = JSON.parse(fs.readFileSync(path.join(data, "status", "backup-externe.json"), "utf8"));
    for (const d of [data, dest]) fs.rmSync(d, { recursive: true, force: true });
    return { r, status, dest };
  };

  test("destination absente : échec à la configuration", () => {
    const { r, status } = run({ TND_BACKUP_DEST: "" });
    assert.notEqual(r.status, 0);
    assert.deepEqual([status.ok, status.step, status.commandOk, status.verified], [false, "configuration", false, null]);
  });

  test("envoi puis vérification réussie : copie distante identique (sommes de contrôle)", () => {
    const { r, status, dest } = run({});
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual([status.ok, status.commandOk, status.verified, status.differences], [true, true, true, 0]);
    assert.ok(status.verifiedFiles >= 2, "sauvegarde de la base et image originale comparées");
    assert.match(status.latestBackup, /^cms-\d{8}-\d{6}-nuit\.sqlite$/);
    assert.doesNotMatch(JSON.stringify(status), new RegExp(dest.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "aucun chemin dans le rapport");
  });

  test("copie distante abîmée : l'envoi a réussi, la vérification le détecte", () => {
    const { r, status } = run({ FAKE_RSYNC: "corrupt" });
    assert.notEqual(r.status, 0);
    assert.deepEqual([status.ok, status.step, status.commandOk, status.verified], [false, "vérification distante", true, false]);
    assert.equal(status.differences, 1);
  });

  test("machine de sauvegarde injoignable à la vérification : envoi fait, contenu non vérifié", () => {
    const { r, status } = run({ FAKE_RSYNC: "unreachable-verify" });
    assert.notEqual(r.status, 0);
    assert.deepEqual([status.ok, status.step, status.commandOk, status.verified, status.differences], [false, "vérification distante", true, false, 0]);
  });

  test("vérification désactivée : envoi signalé, contenu distant « non vérifié »", () => {
    const { r, status } = run({ TND_BACKUP_VERIFY: "0" });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual([status.ok, status.commandOk, status.verified], [true, true, null]);
  });

  test("envoi impossible : ni envoi ni vérification", () => {
    const { status } = run({ FAKE_RSYNC: "fail" });
    assert.deepEqual([status.ok, status.step, status.commandOk, status.verified], [false, "envoi rsync", false, null]);
  });
});

/* Rétention de backup-media.sh : utilitaires communs (rsync simulé ou vrai rsync). */
const BACKUP_SCRIPT = path.join(REPO_ROOT, "cms/deploy/backup-media.sh");
const BACKUP_NAME = /^cms-\d{8}-\d{6}(-[a-z0-9-]+)?\.sqlite$/;
/** Noms de sauvegardes anciennes (2025), du plus ancien au plus récent ; celle du jour est postérieure. */
const oldNames = (n, label = "nuit") => Array.from({ length: n }, (_, i) => {
  const d = new Date(Date.UTC(2025, 0, 1) + i * 86400e3);
  return `cms-${d.toISOString().slice(0, 10).replace(/-/g, "")}-060000-${label}.sqlite`;
});
const sha256 = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const snapshot = (dir) => Object.fromEntries(fs.readdirSync(dir, { recursive: true }).filter((f) => fs.lstatSync(path.join(dir, f)).isFile()).map((f) => [f, sha256(path.join(dir, f))]));
/**
 * Données locales (une image originale), destination temporaire avec `remote` anciennes sauvegardes et une
 * image originale déjà copiée, puis lancement du script. bin : dossier placé en tête du PATH (rsync simulé,
 * ou enveloppe du vrai rsync) ; prepare(ctx) ajuste avant le lancement ; env complète l'environnement.
 */
function setupRetention({ bin, remote = 0, env = {}, prepare = () => {} } = {}) {
  const root = tempDir("tnd-retention-");
  const ctx = { root, data: path.join(root, "data"), dest: path.join(root, "graid"), remoteRoot: path.join(root, "nas") };
  fs.mkdirSync(path.join(ctx.data, "media", "originals"), { recursive: true });
  fs.writeFileSync(path.join(ctx.data, "media", "originals", "photo.jpg"), "image locale");
  fs.mkdirSync(path.join(ctx.dest, "backups"), { recursive: true });
  fs.mkdirSync(path.join(ctx.dest, "originals"), { recursive: true });
  fs.writeFileSync(path.join(ctx.dest, "originals", "ancienne-photo.jpg"), "image supprimée du serveur, gardée sur la copie");
  ctx.old = oldNames(remote);
  for (const n of ctx.old) fs.writeFileSync(path.join(ctx.dest, "backups", n), `ancienne ${n}`);
  prepare(ctx);
  ctx.before = { local: snapshot(path.join(ctx.data, "media", "originals")), remote: snapshot(path.join(ctx.dest, "originals")) };
  ctx.run = () => {
    ctx.r = spawnSync("sh", [BACKUP_SCRIPT], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CMS_DATA_DIR: ctx.data, TND_BACKUP_DEST: ctx.dest, FAKE_REMOTE_ROOT: ctx.remoteRoot, ...env, ...(ctx.env || {}) },
      encoding: "utf8"
    });
    ctx.status = JSON.parse(fs.readFileSync(path.join(ctx.data, "status", "backup-externe.json"), "utf8"));
    return ctx;
  };
  ctx.run();
  ctx.remoteBackups = (dir = path.join(ctx.dest, "backups")) => fs.readdirSync(dir).filter((f) => BACKUP_NAME.test(f) && fs.lstatSync(path.join(dir, f)).isFile()).sort();
  ctx.cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  return ctx;
}
const originalsIntact = (ctx) => {
  assert.deepEqual(snapshot(path.join(ctx.data, "media", "originals")), ctx.before.local, "originaux locaux intacts");
  const remote = snapshot(path.join(ctx.dest, "originals"));
  for (const [f, h] of Object.entries(ctx.before.remote)) assert.equal(remote[f], h, `${f} : copie distante intacte`);
};

describe("cms/deploy/backup-media.sh : rétention des sauvegardes de la base dans la destination", { timeout: 300e3 }, () => {
  let bin;
  before(() => {
    bin = tempDir("tnd-bin-");
    fs.writeFileSync(path.join(bin, "rsync"), FAKE_RSYNC, { mode: 0o755 });
  });
  after(() => fs.rmSync(bin, { recursive: true, force: true }));
  const setup = (options = {}) => setupRetention({ ...options, bin });

  test("moins de 60 sauvegardes dans la destination : aucune suppression", () => {
    const ctx = setup({ remote: 5 });
    try {
      assert.equal(ctx.r.status, 0, ctx.r.stderr);
      assert.deepEqual([ctx.status.ok, ctx.status.verified, ctx.status.retention, ctx.status.deletedBackups, ctx.status.remoteBackups, ctx.status.retentionLimit], [true, true, "applied", 0, 6, 60]);
      assert.deepEqual(ctx.remoteBackups(), [...ctx.old, ctx.status.latestBackup].sort());
      originalsIntact(ctx);
    } finally {
      ctx.cleanup();
    }
  });

  test("exactement 60 sauvegardes après l'envoi : aucune suppression", () => {
    const ctx = setup({ remote: 59 });
    try {
      assert.equal(ctx.r.status, 0, ctx.r.stderr);
      assert.deepEqual([ctx.status.retention, ctx.status.deletedBackups, ctx.status.remoteBackups], ["applied", 0, 60]);
      assert.equal(ctx.remoteBackups().length, 60);
    } finally {
      ctx.cleanup();
    }
  });

  test("plus de 60 : seules les plus anciennes sont supprimées, les 60 plus récentes restent ; images intactes", () => {
    const ctx = setup({ remote: 70 });
    try {
      assert.equal(ctx.r.status, 0, ctx.r.stderr);
      assert.deepEqual([ctx.status.retention, ctx.status.deletedBackups, ctx.status.remoteBackups], ["applied", 11, 60]);
      assert.deepEqual(ctx.remoteBackups(), [...ctx.old.slice(11), ctx.status.latestBackup].sort(), "les 59 anciennes les plus récentes et celle du jour");
      for (const n of ctx.old.slice(0, 11)) assert.ok(!fs.existsSync(path.join(ctx.dest, "backups", n)), `${n} supprimée`);
      originalsIntact(ctx);
      assert.ok(fs.existsSync(path.join(ctx.dest, "originals", "photo.jpg")), "nouvelle image envoyée");
      assert.match(ctx.status.message, /60 sauvegarde\(s\) de la base conservée\(s\) \(limite 60\), 11 ancienne\(s\) supprimée\(s\)/);
    } finally {
      ctx.cleanup();
    }
  });

  test("sauvegarde du jour non vérifiée (vérification désactivée) : aucune suppression", () => {
    const ctx = setup({ remote: 70, env: { TND_BACKUP_VERIFY: "0" } });
    try {
      assert.equal(ctx.r.status, 0, ctx.r.stderr);
      assert.deepEqual([ctx.status.verified, ctx.status.retention, ctx.status.deletedBackups, ctx.status.remoteBackups], [null, "unverified", 0, null]);
      assert.equal(ctx.remoteBackups().length, 71);
      originalsIntact(ctx);
    } finally {
      ctx.cleanup();
    }
  });

  test("échec de l'envoi, copie abîmée ou destination injoignable à la vérification : aucune suppression", () => {
    for (const [mode, step, count] of [["fail", "envoi rsync", 70], ["corrupt", "vérification distante", 71], ["unreachable-verify", "vérification distante", 71]]) {
      const ctx = setup({ remote: 70, env: { FAKE_RSYNC: mode } });
      try {
        assert.notEqual(ctx.r.status, 0, mode);
        assert.deepEqual([ctx.status.ok, ctx.status.step, ctx.status.retention, ctx.status.deletedBackups], [false, step, "pending", 0], mode);
        assert.equal(ctx.remoteBackups().length, count, `${mode} : rien supprimé`);
        for (const n of ctx.old) assert.ok(fs.existsSync(path.join(ctx.dest, "backups", n)), `${mode} : ${n} conservée`);
        originalsIntact(ctx);
      } finally {
        ctx.cleanup();
      }
    }
  });

  test("fichiers d'un autre format, dossiers et liens : jamais supprimés ni comptés", () => {
    const strays = ["notes.txt", "cms-2024.sqlite", "cms-20240101-000000-nuit.sqlite-wal", "CMS-20240101-000000.sqlite", "cms-20240101-000000.SQLITE", "cms-20240101-000000-x.sqlite.bak", ".cms-20240101-000000-cache.sqlite"];
    const ctx = setup({
      remote: 70,
      prepare: (c) => {
        const b = path.join(c.dest, "backups");
        for (const n of strays) fs.writeFileSync(path.join(b, n), "à garder");
        fs.mkdirSync(path.join(b, "cms-20240101-000001-dossier.sqlite"));
        fs.writeFileSync(path.join(b, "cms-20240101-000001-dossier.sqlite", "dedans"), "à garder");
        c.outside = path.join(c.root, "hors-perimetre.sqlite");
        fs.writeFileSync(c.outside, "cible du lien");
        fs.symlinkSync(c.outside, path.join(b, "cms-20240101-000002-lien.sqlite"));
      }
    });
    try {
      assert.equal(ctx.r.status, 0, ctx.r.stderr);
      const b = path.join(ctx.dest, "backups");
      for (const n of strays) assert.ok(fs.existsSync(path.join(b, n)), `${n} conservé`);
      assert.ok(fs.existsSync(path.join(b, "cms-20240101-000001-dossier.sqlite", "dedans")), "dossier conservé");
      assert.ok(fs.lstatSync(path.join(b, "cms-20240101-000002-lien.sqlite")).isSymbolicLink(), "lien conservé");
      assert.equal(fs.readFileSync(ctx.outside, "utf8"), "cible du lien", "cible du lien intacte");
      assert.deepEqual([ctx.status.deletedBackups, ctx.status.remoteBackups], [11, 60], "seules les sauvegardes ordinaires sont comptées");
    } finally {
      ctx.cleanup();
    }
  });

  test("destination hors périmètre (dans les données, backups/ en lien) : rétention refusée, rien supprimé", () => {
    // Destination = dossier des données : backups/ de la destination est celui du CMS.
    const inside = setup({
      env: { TND_BACKUP_KEEP_REMOTE: "3" },
      prepare: (c) => {
        fs.mkdirSync(path.join(c.data, "backups"), { recursive: true });
        c.local = oldNames(10, "auto");
        for (const n of c.local) fs.writeFileSync(path.join(c.data, "backups", n), `locale ${n}`);
        c.env = { TND_BACKUP_DEST: c.data };
      }
    });
    try {
      assert.notEqual(inside.r.status, 0);
      assert.deepEqual([inside.status.verified, inside.status.retention, inside.status.step, inside.status.deletedBackups], [true, "refused", "rétention", 0]);
      for (const n of inside.local) assert.ok(fs.existsSync(path.join(inside.data, "backups", n)), `${n} : sauvegarde locale conservée`);
    } finally {
      inside.cleanup();
    }
    // backups/ de la destination est un lien vers un autre dossier.
    const linked = setup({
      env: { TND_BACKUP_KEEP_REMOTE: "3" },
      prepare: (c) => {
        c.target = path.join(c.root, "ailleurs");
        fs.mkdirSync(c.target);
        c.elsewhere = oldNames(10);
        for (const n of c.elsewhere) fs.writeFileSync(path.join(c.target, n), "ailleurs");
        fs.rmSync(path.join(c.dest, "backups"), { recursive: true });
        fs.symlinkSync(c.target, path.join(c.dest, "backups"));
      }
    });
    try {
      assert.notEqual(linked.r.status, 0);
      assert.deepEqual([linked.status.retention, linked.status.deletedBackups], ["refused", 0]);
      for (const n of linked.elsewhere) assert.ok(fs.existsSync(path.join(linked.target, n)), `${n} conservé`);
    } finally {
      linked.cleanup();
    }
  });

  test("destination distante, absente ou réglage invalide : aucune suppression", () => {
    // Autre machine (simulée) : pas de rétention par le CMS.
    const remote = setup({
      env: { TND_BACKUP_KEEP_REMOTE: "3" },
      prepare: (c) => {
        fs.mkdirSync(path.join(c.remoteRoot, "sauvegardes", "backups"), { recursive: true });
        c.nas = oldNames(10);
        for (const n of c.nas) fs.writeFileSync(path.join(c.remoteRoot, "sauvegardes", "backups", n), "nas");
        c.env = { TND_BACKUP_DEST: "backup@nas:/sauvegardes" };
      }
    });
    try {
      assert.equal(remote.r.status, 0, remote.r.stderr);
      assert.deepEqual([remote.status.verified, remote.status.retention, remote.status.deletedBackups], [true, "not-local", 0]);
      assert.equal(remote.remoteBackups(path.join(remote.remoteRoot, "sauvegardes", "backups")).length, 11);
    } finally {
      remote.cleanup();
    }
    // Destination dont le parent n'existe pas : l'envoi échoue, rien n'est supprimé.
    const absent = setup({ prepare: (c) => { c.env = { TND_BACKUP_DEST: path.join(c.root, "absent", "graid") }; } });
    try {
      assert.notEqual(absent.r.status, 0);
      assert.deepEqual([absent.status.step, absent.status.retention, absent.status.deletedBackups], ["envoi rsync", "pending", 0]);
    } finally {
      absent.cleanup();
    }
    // Limite invalide : arrêt à la configuration, avant toute sauvegarde ou suppression.
    for (const keep of ["0", "abc", "-5", "1.5"]) {
      const bad = setup({ remote: 70, env: { TND_BACKUP_KEEP_REMOTE: keep } });
      try {
        assert.notEqual(bad.r.status, 0, keep);
        assert.deepEqual([bad.status.step, bad.status.commandOk, bad.status.deletedBackups], ["configuration", false, 0], keep);
        assert.equal(bad.remoteBackups().length, 70, `${keep} : rien supprimé`);
      } finally {
        bad.cleanup();
      }
    }
  });

  test("chemins avec espaces (destination et données) : rétention limitée au bon dossier", () => {
    const ctx = setup({
      env: { TND_BACKUP_KEEP_REMOTE: "3" },
      prepare: (c) => {
        c.spaced = path.join(c.root, "G RAID monté", "tnd cms");
        fs.mkdirSync(path.join(c.spaced, "backups"), { recursive: true });
        c.spacedOld = oldNames(6);
        for (const n of c.spacedOld) fs.writeFileSync(path.join(c.spaced, "backups", n), "ancienne");
        // Le dossier « graid » habituel, non visé, garde ses fichiers.
        c.untouched = oldNames(6, "autre");
        for (const n of c.untouched) fs.writeFileSync(path.join(c.dest, "backups", n), "non visée");
        const data = path.join(c.root, "données du cms");
        fs.renameSync(c.data, data);
        c.data = data;
        c.env = { TND_BACKUP_DEST: c.spaced, CMS_DATA_DIR: data };
      }
    });
    try {
      assert.equal(ctx.r.status, 0, ctx.r.stderr);
      assert.deepEqual(ctx.remoteBackups(path.join(ctx.spaced, "backups")), [...ctx.spacedOld.slice(-2), ctx.status.latestBackup].sort());
      assert.equal(ctx.remoteBackups().length, 6, "autre dossier intact");
    } finally {
      ctx.cleanup();
    }
  });

  test("limite réglable : les N plus récentes conservées, celle du jour toujours comprise", () => {
    const ctx = setup({ remote: 10, env: { TND_BACKUP_KEEP_REMOTE: "3" } });
    try {
      assert.equal(ctx.r.status, 0, ctx.r.stderr);
      assert.deepEqual(ctx.remoteBackups(), [...ctx.old.slice(-2), ctx.status.latestBackup].sort());
      assert.deepEqual([ctx.status.deletedBackups, ctx.status.remoteBackups, ctx.status.retentionLimit], [8, 3, 3]);
    } finally {
      ctx.cleanup();
    }
  });
});

/*
 * Même script avec le VRAI rsync (paquet Debian « rsync »), dans des dossiers temporaires uniquement :
 * compatibilité de --files-from, de la vérification --checksum --dry-run --itemize-changes et de la
 * rétention. Ignorés, avec la raison, si rsync n'est pas installé.
 */
const REAL_RSYNC = spawnSync("sh", ["-c", "command -v rsync"], { encoding: "utf8" }).stdout.trim();
describe("cms/deploy/backup-media.sh avec le vrai rsync (dossiers temporaires)", { timeout: 300e3, skip: REAL_RSYNC ? false : "rsync n'est pas installé ici : installer le paquet « rsync » puis relancer npm test" }, () => {
  // Dossier vide en tête du PATH : c'est le vrai rsync qui est utilisé. Pour la copie abîmée, une
  // enveloppe appelle le vrai rsync puis altère la sauvegarde la plus récente de la destination.
  let plain, corrupting;
  before(() => {
    plain = tempDir("tnd-bin-vide-");
    corrupting = tempDir("tnd-bin-abime-");
    fs.writeFileSync(path.join(corrupting, "rsync"), `#!/bin/sh
"${REAL_RSYNC}" "$@" || exit $?
case " $* " in *" --dry-run "*) exit 0 ;; esac
case " $* " in *"--files-from=-"*)
  f="$(ls -1 "$TND_BACKUP_DEST/backups" | LC_ALL=C sort | tail -n 1)"
  printf 'abime' >> "$TND_BACKUP_DEST/backups/$f" ;;
esac
`, { mode: 0o755 });
  });
  after(() => { for (const d of [plain, corrupting]) fs.rmSync(d, { recursive: true, force: true }); });

  test("envoi par --files-from, vérification et rétention ; autres fichiers, liens et images intacts", () => {
    const ctx = setupRetention({
      bin: plain,
      remote: 6,
      env: { TND_BACKUP_KEEP_REMOTE: "3" },
      prepare: (c) => {
        const b = path.join(c.dest, "backups");
        fs.writeFileSync(path.join(b, "notes.txt"), "à garder");
        fs.writeFileSync(path.join(b, "cms-20240101-000000-nuit.sqlite-wal"), "à garder");
        c.outside = path.join(c.root, "hors-perimetre.sqlite");
        fs.writeFileSync(c.outside, "cible du lien");
        fs.symlinkSync(c.outside, path.join(b, "cms-20240101-000002-lien.sqlite"));
      }
    });
    try {
      assert.equal(ctx.r.status, 0, ctx.r.stderr);
      assert.deepEqual([ctx.status.ok, ctx.status.verified, ctx.status.differences, ctx.status.verifiedFiles], [true, true, 0, 2]);
      assert.deepEqual([ctx.status.retention, ctx.status.deletedBackups, ctx.status.remoteBackups, ctx.status.retentionLimit], ["applied", 4, 3, 3]);
      assert.deepEqual(ctx.remoteBackups(), [...ctx.old.slice(-2), ctx.status.latestBackup].sort());
      const local = path.join(ctx.data, "backups", ctx.status.latestBackup);
      assert.equal(sha256(path.join(ctx.dest, "backups", ctx.status.latestBackup)), sha256(local), "copie identique à la sauvegarde locale");
      for (const n of ["notes.txt", "cms-20240101-000000-nuit.sqlite-wal"]) assert.ok(fs.existsSync(path.join(ctx.dest, "backups", n)), `${n} conservé`);
      assert.ok(fs.lstatSync(path.join(ctx.dest, "backups", "cms-20240101-000002-lien.sqlite")).isSymbolicLink());
      assert.equal(fs.readFileSync(ctx.outside, "utf8"), "cible du lien");
      originalsIntact(ctx);
      assert.equal(fs.readFileSync(path.join(ctx.dest, "originals", "photo.jpg"), "utf8"), "image locale");
      // Seconde exécution (nouvelle seconde : nouveau nom) : rien d'ancien à renvoyer, copie toujours vérifiée.
      const first = ctx.status.latestBackup;
      const wait = Date.now() + 1100;
      while (Date.now() < wait);
      ctx.run();
      assert.equal(ctx.r.status, 0, ctx.r.stderr);
      assert.notEqual(ctx.status.latestBackup, first);
      assert.deepEqual([ctx.status.verified, ctx.status.differences, ctx.status.remoteBackups], [true, 0, 3]);
      assert.ok(ctx.remoteBackups().includes(first), "la sauvegarde précédente reste parmi les 3 plus récentes");
    } finally {
      ctx.cleanup();
    }
  });

  test("limite par défaut : 60 sauvegardes conservées", () => {
    const ctx = setupRetention({ bin: plain, remote: 61 });
    try {
      assert.equal(ctx.r.status, 0, ctx.r.stderr);
      assert.deepEqual([ctx.status.retentionLimit, ctx.status.deletedBackups, ctx.status.remoteBackups], [60, 2, 60]);
      assert.deepEqual(ctx.remoteBackups(), [...ctx.old.slice(2), ctx.status.latestBackup].sort());
    } finally {
      ctx.cleanup();
    }
  });

  test("vérification désactivée, ou copie abîmée détectée par le vrai rsync : aucune suppression", () => {
    const off = setupRetention({ bin: plain, remote: 6, env: { TND_BACKUP_KEEP_REMOTE: "1", TND_BACKUP_VERIFY: "0" } });
    try {
      assert.equal(off.r.status, 0, off.r.stderr);
      assert.deepEqual([off.status.retention, off.status.deletedBackups], ["unverified", 0]);
      assert.equal(off.remoteBackups().length, 7);
    } finally {
      off.cleanup();
    }
    const bad = setupRetention({ bin: corrupting, remote: 3, env: { TND_BACKUP_KEEP_REMOTE: "1" } });
    try {
      assert.notEqual(bad.r.status, 0);
      assert.deepEqual([bad.status.step, bad.status.verified, bad.status.retention, bad.status.deletedBackups], ["vérification distante", false, "pending", 0]);
      assert.ok(bad.status.differences >= 1, "différence détectée par rsync --checksum");
      assert.equal(bad.remoteBackups().length, 4, "rien supprimé");
    } finally {
      bad.cleanup();
    }
  });
});

describe("Santé du CMS : rétention de la sauvegarde externe", { timeout: 60e3 }, () => {
  let cms, admin;
  before(async () => {
    cms = await startCms();
    admin = await cms.login("admin");
  });
  after(() => cms.close());
  const line = async () => (await admin.get("/api/health")).data.sections.find((s) => s.id === "backups").items.find((i) => i.id === "external-retention");
  const write = (data) => {
    fs.mkdirSync(path.join(cms.dataDir, "status"), { recursive: true });
    fs.writeFileSync(path.join(cms.dataDir, "status", "backup-externe.json"), JSON.stringify({ finishedAt: new Date().toISOString(), ok: true, step: "terminé", message: "…", commandOk: true, verified: true, differences: 0, verifiedFiles: 31, ...data }));
  };

  test("appliquée, refusée, non vérifiée, destination distante ; rapport ancien sans rétention : pas de ligne", async () => {
    write({});
    assert.equal(await line(), undefined, "rapport d'une version sans rétention");
    write({ retention: "applied", retentionLimit: 60, remoteBackups: 60, deletedBackups: 2 });
    let l = await line();
    assert.deepEqual([l.level, l.value], ["ok", "60 sauvegarde(s) conservée(s)"]);
    assert.match(l.message, /les 60 plus récentes .* 2 ancienne\(s\) supprimée\(s\)/);
    write({ ok: false, step: "rétention", retention: "refused", retentionLimit: 30, deletedBackups: 0 });
    assert.equal((await line()).level, "warning");
    write({ verified: null, retention: "unverified", retentionLimit: 30 });
    assert.equal((await line()).level, "warning");
    write({ retention: "not-local", retentionLimit: 30 });
    assert.equal((await line()).level, "info");
    write({ retention: "n'importe quoi" });
    assert.equal(await line(), undefined, "valeur inconnue ignorée");
  });
});
