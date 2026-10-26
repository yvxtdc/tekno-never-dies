/**
 * Suivi des déploiements GitHub Pages (API GitHub simulée, jamais appelée) et tableau de santé.
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
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
    assert.deepEqual(forAdmin.sections.map((s) => s.id), ["server", "scheduler", "publication", "backups"]);
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

describe("cms/deploy/backup-media.sh : envoi et vérification du contenu distant", { timeout: 180e3 }, () => {
  const script = path.join(REPO_ROOT, "cms/deploy/backup-media.sh");
  /**
   * rsync simulé (rsync n'est pas installé ici) : copie les dossiers sources dans la destination ; avec
   * --dry-run --checksum --itemize-changes, compare chaque fichier par empreinte SHA-256 et affiche une ligne
   * « <f… » par fichier absent ou différent, comme rsync. FAKE_RSYNC : ok, corrupt (copie abîmée),
   * unreachable-verify (destination injoignable à la vérification), fail (envoi impossible).
   */
  const FAKE = `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const mode = process.env.FAKE_RSYNC || "ok";
const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const dry = process.argv.includes("--dry-run");
const dest = args.pop();
if (mode === "fail") process.exit(23);
if (dry && mode === "unreachable-verify") process.exit(255);
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
for (const src of args) {
  const target = path.join(dest, path.basename(src));
  if (!dry) { fs.cpSync(src, target, { recursive: true }); continue; }
  for (const file of walk(src)) {
    const copy = path.join(target, path.relative(src, file));
    if (!fs.existsSync(copy) || sha(copy) !== sha(file)) console.log("<f+++++++++ " + path.join(path.basename(src), path.relative(src, file)));
  }
}
if (!dry && mode === "corrupt") { const f = walk(path.join(dest, path.basename(args[0])))[0]; fs.appendFileSync(f, "abîmé"); }
`;
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
