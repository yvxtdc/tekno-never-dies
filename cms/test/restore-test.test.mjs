/**
 * Test de restauration de la sauvegarde externe : support simulé (dossiers temporaires), jamais le disque
 * de production. Couvre le module, la commande cms/bin/restore-test.mjs, le script de l'hôte Proxmox
 * (pct, findmnt, blkid, systemctl simulés) et l'affichage dans Santé du CMS.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { backup as sqliteBackup } from "node:sqlite";
import { startCms, tempDir } from "./helpers.mjs";
import { REPO_ROOT } from "../server/config.mjs";
import { openDatabase } from "../server/db/index.mjs";
import { runRestoreTest, saveRestoreReport, readRestoreReport, hostFailureReport, restoreReportFile, removeTempDir, sweepStaleTempDirs, MARKER, CHECKS } from "../server/services/restore-test.mjs";

const UUID = "f5b884b5-a8c9-45f2-8275-3bfe71bb5a95";
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
const t = new Date().toISOString();
/** Empreinte de tous les fichiers d'un dossier (contrôle « rien n'a été modifié »). */
const snapshot = (dir) => {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = sha(fs.readFileSync(p));
    }
  };
  walk(dir);
  return out;
};

/**
 * Installation simulée : site déployé (images du dépôt), données actives (base + sauvegarde locale),
 * support externe (marqueur, backups/, originals/) et dossier temporaire.
 */
async function fixture({ breakFk = false, repoPath = "assets/img/soiree.webp", backupAgeHours = 1, originalSize = 0 } = {}) {
  const root = tempDir("tnd-restore-");
  const dirs = { site: path.join(root, "site"), data: path.join(root, "data"), source: path.join(root, "graid"), tmp: path.join(root, "tmp") };
  for (const d of [path.join(dirs.site, "assets/img/cms"), path.join(dirs.data, "backups"), path.join(dirs.source, "backups"), path.join(dirs.source, "originals"), dirs.tmp]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(dirs.source, MARKER), `${UUID}\n`);
  const files = { "assets/img/soiree.webp": Buffer.from("image du dépôt"), "assets/img/galerie-thumb.webp": Buffer.from("vignette"), "assets/img/galerie-full.jpg": Buffer.from("grande") };
  for (const [rel, buf] of Object.entries(files)) fs.writeFileSync(path.join(dirs.site, rel), buf);
  const original = originalSize ? Buffer.alloc(originalSize, 7) : Buffer.from("original téléversé");
  fs.writeFileSync(path.join(dirs.source, "originals", "a1b2c3d4e5f6.jpg"), original);
  fs.writeFileSync(path.join(dirs.site, "assets/img/cms/affiche-a1b2c3d4e5f6-v1.webp"), "variante publiée");
  // Base « active » (jamais lue par le test) et sauvegarde locale (jamais utilisée à la place de l'externe).
  fs.writeFileSync(path.join(dirs.data, "cms.sqlite"), "base active");
  fs.writeFileSync(path.join(dirs.data, "backups", `cms-${stamp(new Date())}-auto.sqlite`), "sauvegarde locale");

  const db = openDatabase(path.join(root, "build.sqlite"));
  db.migrate();
  db.run("INSERT INTO users (email, name, role, password_hash, must_change_password, created_at, updated_at) VALUES ('admin@test.fr', 'Admin', 'admin', 'x', 0, ?, ?)", t, t);
  const repo = db.run("INSERT INTO media (uid, storage, repo_path, original_name, mime, size, sha256, variants, created_at, updated_at) VALUES ('r00000000001', 'repo', ?, 'soiree.webp', 'image/webp', ?, ?, ?, ?, ?)",
    repoPath, files["assets/img/soiree.webp"].length, sha(files["assets/img/soiree.webp"]), JSON.stringify({ thumb: "assets/img/galerie-thumb.webp", full: "assets/img/galerie-full.jpg" }), t, t).lastInsertRowid;
  const upload = db.run("INSERT INTO media (uid, storage, file_name, original_name, mime, size, sha256, created_at, updated_at) VALUES ('a1b2c3d4e5f6', 'upload', 'a1b2c3d4e5f6.jpg', 'affiche.jpg', 'image/jpeg', ?, ?, ?, ?)",
    original.length, sha(original), t, t).lastInsertRowid;
  db.run("INSERT INTO events (slug, title, date, flyer_media_id, created_at, updated_at) VALUES ('soiree-test', 'Soirée test', '2030-01-01', ?, ?, ?)", repo, t, t);
  db.run("INSERT INTO artists (slug, name, match_key, photo_media_id, created_at, updated_at) VALUES ('dj-test', 'DJ Test', 'djtest', ?, ?, ?)", upload, t, t);
  if (breakFk) {
    db.exec("PRAGMA foreign_keys = OFF");
    db.run("INSERT INTO team_members (slug, name, photo_media_id, position, created_at, updated_at) VALUES ('membre', 'Membre', 999, 1, ?, ?)", t, t);
  }
  const name = `cms-${stamp(new Date(Date.now() - backupAgeHours * 3600e3))}-nuit.sqlite`;
  await sqliteBackup(db.raw, path.join(dirs.source, "backups", name));
  const tables = db.get("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").n;
  db.close();
  return {
    root, ...dirs, name, tables, original,
    backupFile: path.join(dirs.source, "backups", name),
    options: (extra = {}) => ({ dataDir: dirs.data, siteDir: dirs.site, source: dirs.source, targetId: UUID, tmpDir: dirs.tmp, requireMount: false, minFreeBytes: 0, ...extra }),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true })
  };
}
const status = (report, id) => report.checks.find((c) => c.id === id)?.status;

describe("test de restauration de la sauvegarde externe", { timeout: 120e3 }, () => {
  test("restauration réussie : tous les contrôles, médias valides, aucune écriture hors du dossier temporaire et du rapport", async () => {
    const f = await fixture();
    try {
      const before = { data: snapshot(f.data), source: snapshot(f.source), site: snapshot(f.site) };
      const report = await runRestoreTest(f.options());
      assert.equal(report.ok, true, JSON.stringify(report.errors));
      assert.equal(report.status, "success");
      assert.ok(report.checks.every((c) => c.status === "ok"));
      assert.equal(report.backup.name, f.name);
      assert.equal(report.sqlite.integrity, "ok");
      assert.equal(report.sqlite.tables, f.tables);
      assert.ok(report.sqlite.tablesChecked > 20);
      assert.equal(report.sqlite.foreignKeyViolations, 0);
      assert.equal(report.consistency.ok, true);
      assert.equal(report.media.references, 2);
      assert.deepEqual([report.media.repo.files, report.media.repo.verified, report.media.repo.missing], [3, 3, 0]);
      assert.deepEqual([report.media.uploads.expected, report.media.uploads.recovered, report.media.uploads.verified], [1, 1, 1]);
      assert.equal(report.media.regenerable.publishedVariants, 1);
      assert.equal(report.media.missingTotal, 0);
      assert.ok(report.durationMs >= 0 && report.finishedAt >= report.startedAt);
      // Dossier temporaire supprimé ; données actives, support et site intacts.
      assert.deepEqual(fs.readdirSync(f.tmp), []);
      assert.deepEqual({ data: snapshot(f.data), source: snapshot(f.source), site: snapshot(f.site) }, before);
      // Rapport : sans chemin ni contenu de la base.
      const saved = saveRestoreReport(f.data, report);
      const text = fs.readFileSync(restoreReportFile(f.data), "utf8");
      for (const secret of [f.root, "admin@test.fr", "affiche.jpg"]) assert.ok(!text.includes(secret), secret);
      assert.equal(saved.lastSuccessAt, report.finishedAt);
      assert.equal(readRestoreReport(f.data).ok, true);
      assert.deepEqual(fs.readdirSync(path.join(f.data, "status")), ["restore-test.json"], "aucun fichier temporaire laissé");
    } finally {
      f.cleanup();
    }
  });

  test("aucune sauvegarde externe : échec, jamais de repli sur la sauvegarde locale", async () => {
    const f = await fixture();
    try {
      fs.rmSync(f.backupFile);
      const report = await runRestoreTest(f.options());
      assert.equal(report.ok, false);
      assert.equal(status(report, "backup"), "failed");
      assert.match(report.errors[0].message, /Aucune sauvegarde SQLite/);
      assert.ok(["space", "copy", "sqlite", "upload-originals"].every((id) => status(report, id) === "skipped"));
      assert.equal(report.backup, null, "la sauvegarde locale n'est pas sélectionnée");
      fs.rmSync(path.join(f.source, "backups"), { recursive: true });
      assert.match((await runRestoreTest(f.options())).errors[0].message, /backups\/ absent/);
    } finally {
      f.cleanup();
    }
  });

  test("support externe non vérifié : non configuré, marqueur faux, pas un point de montage, confondu avec les données", async () => {
    const f = await fixture();
    try {
      const fails = async (extra, pattern) => {
        const report = await runRestoreTest(f.options(extra));
        assert.equal(report.ok, false);
        assert.equal(status(report, "source"), "failed");
        assert.equal(status(report, "backup"), "skipped");
        assert.match(report.errors[0].message, pattern);
      };
      await fails({ source: "" }, /non configuré/);
      await fails({ source: path.join(f.root, "absent") }, /introuvable/);
      await fails({ targetId: "00000000-0000-0000-0000-000000000000" }, /Marqueur .* différent/);
      await fails({ requireMount: true }, /pas un point de montage/);
      await fails({ source: f.data }, /confondu avec le dossier des données/);
      fs.rmSync(path.join(f.source, MARKER));
      await fails({}, /Marqueur .* absent/);
    } finally {
      f.cleanup();
    }
  });

  test("fichier SQLite corrompu ou qui n'est pas une base : échec", async () => {
    const f = await fixture();
    try {
      const buf = fs.readFileSync(f.backupFile);
      // Pages internes écrasées, en-tête intact : ouverture possible, intégrité en échec.
      buf.fill(0x5a, 4096 * 2, buf.length - 4096);
      fs.writeFileSync(f.backupFile, buf);
      let report = await runRestoreTest(f.options());
      assert.equal(report.ok, false);
      assert.equal(status(report, "sqlite"), "failed");
      assert.equal(status(report, "upload-originals"), "skipped");
      fs.writeFileSync(f.backupFile, "ceci n'est pas une base SQLite");
      report = await runRestoreTest(f.options());
      assert.equal(status(report, "backup"), "failed");
      assert.match(report.errors[0].message, /en-tête invalide/);
      fs.writeFileSync(f.backupFile, "");
      assert.match((await runRestoreTest(f.options())).errors[0].message, /vide/);
      assert.deepEqual(fs.readdirSync(f.tmp), []);
    } finally {
      f.cleanup();
    }
  });

  test("média du dépôt manquant ou chemin hors du site : échec chiffré", async () => {
    const f = await fixture();
    try {
      fs.rmSync(path.join(f.site, "assets/img/galerie-full.jpg"));
      const report = await runRestoreTest(f.options());
      assert.equal(report.ok, false);
      assert.equal(status(report, "repo-media"), "failed");
      assert.equal(status(report, "upload-originals"), "ok", "les autres contrôles sont tout de même exécutés");
      assert.deepEqual([report.media.repo.missing, report.media.missingTotal], [1, 1]);
      assert.match(report.errors[0].message, /galerie-full\.jpg absent/);
    } finally {
      f.cleanup();
    }
    const g = await fixture({ repoPath: "../hors-du-site.webp" });
    try {
      fs.writeFileSync(path.join(g.root, "hors-du-site.webp"), "x");
      const report = await runRestoreTest(g.options());
      assert.equal(status(report, "repo-media"), "failed");
      assert.equal(report.media.repo.invalidPaths, 1);
    } finally {
      g.cleanup();
    }
  });

  test("original téléversé absent ou différent sur le support : échec", async () => {
    const f = await fixture();
    try {
      const file = path.join(f.source, "originals", "a1b2c3d4e5f6.jpg");
      fs.writeFileSync(file, "contenu abîmé");
      let report = await runRestoreTest(f.options());
      assert.equal(status(report, "upload-originals"), "failed");
      assert.deepEqual([report.media.uploads.recovered, report.media.uploads.verified, report.media.uploads.corrupted], [1, 0, 1]);
      fs.rmSync(file);
      report = await runRestoreTest(f.options());
      assert.equal(report.ok, false);
      assert.deepEqual([report.media.uploads.expected, report.media.uploads.missing, report.media.missingTotal], [1, 1, 1]);
      assert.match(report.errors.at(-1).message, /a1b2c3d4e5f6\.jpg absent du support/);
      assert.deepEqual(fs.readdirSync(f.tmp), []);
    } finally {
      f.cleanup();
    }
  });

  test("référence vers un média inexistant : clés étrangères et références en échec", async () => {
    const f = await fixture({ breakFk: true });
    try {
      const report = await runRestoreTest(f.options());
      assert.equal(report.ok, false);
      assert.equal(status(report, "foreign-keys"), "failed");
      assert.equal(status(report, "media-references"), "failed");
      assert.equal(report.media.brokenReferences, 1);
    } finally {
      f.cleanup();
    }
  });

  test("espace insuffisant : échec avant toute copie ; sauvegarde ancienne : avertissement", async () => {
    const f = await fixture({ backupAgeHours: 24 * 5 });
    try {
      let report = await runRestoreTest(f.options({ minFreeBytes: Number.MAX_SAFE_INTEGER }));
      assert.equal(status(report, "space"), "failed");
      assert.match(report.errors[0].message, /Espace insuffisant/);
      assert.deepEqual(fs.readdirSync(f.tmp), []);
      report = await runRestoreTest(f.options({ tmpDir: path.join(f.data, "tmp") }));
      assert.equal(status(report, "space"), "failed", "dossier temporaire dans les données refusé");
      report = await runRestoreTest(f.options());
      assert.equal(report.ok, true);
      assert.match(report.warnings.map((w) => w.message).join(), /date de 5 jour/);
    } finally {
      f.cleanup();
    }
  });

  test("interruption : test arrêté, dossier temporaire supprimé, résultat en échec", async () => {
    const f = await fixture();
    try {
      const controller = new AbortController();
      const report = await runRestoreTest(f.options(), { signal: controller.signal, log: (l) => l.startsWith("Sauvegarde testée") && controller.abort() });
      assert.equal(report.ok, false);
      assert.equal(report.interrupted, true);
      assert.match(report.errors[0].message, /interrompu/);
      assert.deepEqual(fs.readdirSync(f.tmp), []);
    } finally {
      f.cleanup();
    }
  });

  test("délai maximal dépassé : arrêt, dossier temporaire supprimé, échec explicite", async () => {
    const f = await fixture();
    try {
      // Le délai (1 ms) est dépassé dès la sélection de la sauvegarde.
      const pause = (l) => { if (l.startsWith("Sauvegarde testée")) { const t0 = Date.now(); while (Date.now() - t0 < 5); } };
      const report = await runRestoreTest(f.options({ timeoutMs: 1 }), { log: pause });
      assert.equal(report.ok, false);
      assert.equal(report.timedOut, true);
      assert.match(report.errors.map((e) => e.message).join(), /Délai maximal dépassé/);
      assert.equal(report.media.missingTotal, null, "aucun décompte présenté comme complet");
      assert.deepEqual(fs.readdirSync(f.tmp), []);
    } finally {
      f.cleanup();
    }
  });

  test("nettoyage impossible : signalé (avertissement, dossier restant nommé), sans fausse réussite des contrôles", async () => {
    const f = await fixture();
    try {
      const report = await runRestoreTest(f.options({ removeDir: () => { throw new Error("EBUSY simulé"); } }));
      assert.equal(report.cleanup.ok, false);
      assert.match(report.cleanup.leftover, /^tnd-restore-externe-/);
      assert.match(report.warnings.map((w) => w.message).join(), /non supprimé \(EBUSY simulé\)/);
      assert.deepEqual(fs.readdirSync(f.tmp), [report.cleanup.leftover]);
      // Sa fiche désigne ce processus, toujours actif : le test suivant le laisse (jamais le dossier
      // d'une exécution en cours) et le compte.
      const again = await runRestoreTest(f.options());
      assert.equal(again.ok, true);
      assert.equal(again.cleanup.staleKept, 1);
      assert.ok(fs.readdirSync(f.tmp).includes(report.cleanup.leftover));
    } finally {
      f.cleanup();
    }
  });

  test("dossiers orphelins : seuls ceux du test, d'un processus terminé ou trop anciens, sont supprimés", () => {
    const parent = fs.realpathSync(tempDir("tnd-sweep-"));
    try {
      const dead = spawnSync(process.execPath, ["-e", "0"]).pid;
      const make = (name, run) => {
        const dir = path.join(parent, name);
        fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, "cms.sqlite"), "copie");
        if (run) fs.writeFileSync(path.join(dir, ".tnd-restore-run"), JSON.stringify(run));
        return dir;
      };
      make("tnd-restore-externe-dead01", { pid: dead, startedAt: new Date().toISOString() });
      make("tnd-restore-externe-live01", { pid: process.pid === 1 ? 2 : 1, startedAt: new Date().toISOString() });
      make("tnd-restore-externe-old001", { pid: 1, startedAt: new Date(Date.now() - 3 * 86400e3).toISOString() });
      make("tnd-restore-externe-nofile", null);
      make("autre-dossier", { pid: dead, startedAt: new Date().toISOString() });
      fs.writeFileSync(path.join(parent, "tnd-restore-externe-fich01"), "fichier");
      const outside = make("cible-du-lien", null);
      fs.symlinkSync(outside, path.join(parent, "tnd-restore-externe-link01"));
      const r = sweepStaleTempDirs(parent, { staleMs: 86400e3 });
      assert.deepEqual(r.removed.sort(), ["tnd-restore-externe-dead01", "tnd-restore-externe-old001"]);
      assert.deepEqual(r.kept.sort(), ["tnd-restore-externe-live01", "tnd-restore-externe-nofile"]);
      assert.deepEqual(fs.readdirSync(parent).sort(), ["autre-dossier", "cible-du-lien", "tnd-restore-externe-fich01", "tnd-restore-externe-link01", "tnd-restore-externe-live01", "tnd-restore-externe-nofile"]);
      assert.ok(fs.existsSync(path.join(outside, "cms.sqlite")), "la cible d'un lien n'est jamais touchée");
      // Suppression directe : jamais hors du périmètre.
      assert.throws(() => removeTempDir(path.join(parent, "autre-dossier"), parent), /hors du périmètre/);
      assert.throws(() => removeTempDir(path.join(parent, "tnd-restore-externe-live01"), path.dirname(parent)), /hors du périmètre/);
      assert.throws(() => removeTempDir(path.join(parent, "tnd-restore-externe-link01"), parent), /pas un dossier ordinaire/);
      assert.throws(() => removeTempDir("/", parent), /hors du périmètre/);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test("rapport : absent, invalide, incohérent ; date du dernier succès conservée après un échec", () => {
    const data = tempDir("tnd-restore-report-");
    try {
      assert.equal(readRestoreReport(data), null);
      fs.mkdirSync(path.join(data, "status"));
      fs.writeFileSync(restoreReportFile(data), "{ pas du JSON");
      assert.equal(readRestoreReport(data).invalid, true);
      fs.writeFileSync(restoreReportFile(data), JSON.stringify({ format: 99, kind: "restore-test" }));
      assert.equal(readRestoreReport(data).invalid, true);
      // Rapport précédent illisible : pas de date de dernier succès inventée.
      const failed = saveRestoreReport(data, hostFailureReport("graid-not-mounted"));
      assert.equal(failed.lastSuccessAt, null);
      assert.match(failed.warnings.map((w) => w.message).join(), /Rapport précédent illisible/);
      // Succès puis échec : la date du succès est conservée.
      const success = hostFailureReport("graid-not-mounted");
      const allOk = CHECKS.map(([id, label]) => ({ id, label, status: "ok", message: "" }));
      Object.assign(success, { ok: true, status: "success", errors: [], checks: allOk, backup: { name: "cms-20261025-040000-nuit.sqlite" } });
      const ok = saveRestoreReport(data, success);
      assert.equal(ok.lastSuccessAt, ok.finishedAt);
      const after = saveRestoreReport(data, hostFailureReport("marker-mismatch", { now: () => new Date(Date.now() + 1000) }));
      assert.equal(after.ok, false);
      assert.equal(after.lastSuccessAt, ok.finishedAt);
      assert.equal(after.lastSuccessBackup, "cms-20261025-040000-nuit.sqlite");
      assert.equal(readRestoreReport(data).lastSuccessAt, ok.finishedAt);
      // « Réussi » avec un contrôle non réussi : incohérent, donc inconnu.
      const bad = JSON.parse(fs.readFileSync(restoreReportFile(data), "utf8"));
      Object.assign(bad, { status: "success", ok: true });
      fs.writeFileSync(restoreReportFile(data), JSON.stringify(bad));
      assert.equal(readRestoreReport(data).invalid, true);
      // « Réussi » sans erreur, mais avec un contrôle obligatoire absent : incohérent.
      Object.assign(bad, { errors: [], checks: allOk.slice(1) });
      fs.writeFileSync(restoreReportFile(data), JSON.stringify(bad));
      assert.equal(readRestoreReport(data).invalid, true);
      Object.assign(bad, { checks: allOk });
      fs.writeFileSync(restoreReportFile(data), JSON.stringify(bad));
      assert.equal(readRestoreReport(data).ok, true);
    } finally {
      fs.rmSync(data, { recursive: true, force: true });
    }
  });
});

describe("cms/bin/restore-test.mjs (ligne de commande)", { timeout: 120e3 }, () => {
  const cli = path.join(REPO_ROOT, "cms/bin/restore-test.mjs");
  const run = (env, args = []) => spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", cli, ...args], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8" });

  test("réussite (code 0), échec (code 1, date du succès conservée), configuration absente (code 2)", async () => {
    const f = await fixture();
    try {
      const env = { CMS_DATA_DIR: f.data, TND_CMS_DIR: f.site, TND_RESTORE_SOURCE: f.source, TND_BACKUP_TARGET_ID: UUID, TND_RESTORE_TMP_DIR: f.tmp, TND_RESTORE_MIN_FREE_MB: "0", TND_RESTORE_REQUIRE_MOUNT: "0" };
      let r = run(env);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /✓ RÉUSSI/);
      const first = readRestoreReport(f.data);
      assert.equal(first.ok, true);
      r = run({ ...env, TND_RESTORE_SOURCE: "" });
      assert.equal(r.status, 1);
      const second = readRestoreReport(f.data);
      assert.equal(second.ok, false);
      assert.equal(second.lastSuccessAt, first.finishedAt);
      // Par défaut, le support doit être un point de montage (un dossier local ne suffit pas).
      r = run({ ...env, TND_RESTORE_REQUIRE_MOUNT: "" });
      assert.equal(r.status, 1);
      assert.match(r.stdout, /pas un point de montage/);
      r = run({ ...env }, ["--host-failure", "graid-uuid-mismatch"]);
      assert.equal(r.status, 1);
      assert.match(readRestoreReport(f.data).errors[0].message, /UUID différent/);
      assert.equal(run({ ...env }, ["--host-failure", "texte libre"]).status, 2);
      assert.equal(run({ ...env, CMS_DATA_DIR: "" }).status, 2);
      assert.equal(run({ ...env }, ["--run-id", "a;b"]).status, 2);
      assert.equal(run({ ...env, TND_RESTORE_TIMEOUT_SECONDS: "0" }).status, 2);
    } finally {
      f.cleanup();
    }
  });

  test("SIGTERM pendant le test : arrêt, dossier temporaire supprimé, rapport « interrompu », code 143", async () => {
    const f = await fixture({ originalSize: 160 * 1024 ** 2 });
    try {
      const env = { PATH: process.env.PATH, CMS_DATA_DIR: f.data, TND_CMS_DIR: f.site, TND_RESTORE_SOURCE: f.source, TND_BACKUP_TARGET_ID: UUID, TND_RESTORE_TMP_DIR: f.tmp, TND_RESTORE_MIN_FREE_MB: "0", TND_RESTORE_REQUIRE_MOUNT: "0" };
      const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", cli, "--run-id", "essai-1"], { env });
      let out = "";
      const closed = new Promise((resolve) => child.on("close", resolve));
      child.stdout.on("data", (d) => {
        out += d;
        if (/Dossier temporaire : tnd-restore-externe-\S+ \(exécution essai-1\)/.test(out) && !child.signalSent) {
          child.signalSent = true;
          child.kill("SIGTERM");
        }
      });
      assert.equal(await closed, 143, out);
      const report = readRestoreReport(f.data);
      assert.equal(report.ok, false);
      assert.match(report.errors.map((e) => e.message).join(), /interrompu/);
      assert.deepEqual(fs.readdirSync(f.tmp), [], "dossier temporaire supprimé");
    } finally {
      f.cleanup();
    }
  });
});

describe("cms/deploy/proxmox/tnd-cms-restore-test.sh (hôte simulé)", { timeout: 180e3 }, () => {
  const script = path.join(REPO_ROOT, "cms/deploy/proxmox/tnd-cms-restore-test.sh");
  // pct : status, config, exec (commande lancée ici, sans runuser) ; findmnt / blkid : disque simulé.
  const FAKES = {
    pct: `#!/bin/sh
case "$1" in
  status) echo "status: \${FAKE_CT_STATUS:-running}" ;;
  config) echo "arch: amd64"
    if [ -n "\${FAKE_ENTRY:-}" ]; then echo "lxc.mount.entry: \${FAKE_MP_SRC} \${FAKE_MP_DST#/} none bind,create=dir 0 0"
    else echo "mp0: \${FAKE_MP_SRC},mp=\${FAKE_MP_DST},backup=0"; fi ;;
  exec) shift 2; [ "$1" = "--" ] && shift
    if [ "$1" = "runuser" ]; then shift 3; [ "$1" = "--" ] && shift; fi
    exec "$@" ;;
esac
`,
    findmnt: `#!/bin/sh
while [ $# -gt 0 ]; do case "$1" in -M) point="$2"; shift ;; -o) col="$2"; shift ;; esac; shift; done
if [ "$point" = "$FAKE_HOST_MOUNT" ] && [ "\${FAKE_GRAID:-ok}" != absent ]; then
  case "$col" in SOURCE) echo /dev/sdz1 ;; UUID) echo "$FAKE_UUID" ;; esac
elif [ "$point" = "$FAKE_MP_DST" ] && [ "\${FAKE_CT_MOUNTED:-1}" = 1 ]; then echo "$point"; fi
`,
    blkid: `#!/bin/sh\necho "$FAKE_UUID"\n`,
    systemctl: `#!/bin/sh\nexit 3\n`,
    // pkill du conteneur (-u <compte>) : noté, puis appliqué ici sans le compte (absent de cette machine).
    pkill: `#!/bin/sh
echo "$*" >> "\${FAKE_PKILL_LOG:-/dev/null}"
for last; do :; done
case " $* " in *" -u "*) exec /usr/bin/pkill -TERM -f "$last" ;; esac
exec /usr/bin/pkill "$@"
`,
    // « Node » lent du conteneur : note son lancement et le SIGTERM reçu (journal à côté du site simulé).
    "slow-node": `#!/bin/sh
log="\${2%/cms/bin/restore-test.mjs}/fake-node.log"
echo "start $*" >> "$log"
trap 'echo TERM >> "$log"; kill $pid 2>/dev/null; exit 143' TERM
sleep 20 & pid=$!
wait $pid
echo end >> "$log"
`
  };
  let bin;
  before(() => {
    bin = tempDir("tnd-bin-");
    for (const [name, body] of Object.entries(FAKES)) fs.writeFileSync(path.join(bin, name), body, { mode: 0o755 });
  });
  after(() => fs.rmSync(bin, { recursive: true, force: true }));

  /** Hôte simulé ; slowNode : « Node » lent à la place du vrai test (arrêt pendant le test). */
  async function setup(env = {}, { slowNode = false } = {}) {
    const f = await fixture();
    const graid = path.join(f.root, "yPlexLib");
    const target = path.join(graid, "sauvegardes/tnd-cms");
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, MARKER), UUID);
    // Site déployé simulé : images de la fixture, et le code du CMS par un lien vers le dépôt.
    if (slowNode) fs.mkdirSync(path.join(f.site, "cms/bin"), { recursive: true });
    else fs.symlinkSync(path.join(REPO_ROOT, "cms"), path.join(f.site, "cms"));
    return {
      f,
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        TND_GRAID_MOUNT: graid, TND_GRAID_UUID: UUID, TND_BACKUP_TARGET: target, TND_CTID: "126",
        TND_CT_MOUNT: f.source, TND_CT_SITE: f.site, TND_CT_DATA: f.data, TND_CT_USER: "tnd-cms",
        TND_CT_NODE: slowNode ? path.join(bin, "slow-node") : process.execPath,
        TND_CT_TMP: f.tmp, TND_CT_MIN_FREE_MB: "0", TND_CT_REQUIRE_MOUNT: "0", TND_RESTORE_LOCK: path.join(f.root, "lock"),
        TND_WAIT_CT_SECONDS: "0", TND_WAIT_BACKUP_SECONDS: "0", TND_POLL_SECONDS: "1",
        FAKE_HOST_MOUNT: graid, FAKE_UUID: UUID, FAKE_MP_SRC: target, FAKE_MP_DST: f.source,
        ...env
      }
    };
  }
  async function host(env = {}) {
    const { f, env: all } = await setup(env);
    const r = spawnSync("sh", [script], { encoding: "utf8", env: all });
    const report = readRestoreReport(f.data);
    f.cleanup();
    return { r, report };
  }
  const waitFor = async (cond, ms = 10e3) => {
    const end = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > end) throw new Error("délai d'attente du test dépassé");
      await new Promise((r) => setTimeout(r, 50));
    }
  };

  test("montage déclaré en lxc.mount.entry : accepté", async () => {
    const { r, report } = await host({ FAKE_ENTRY: "1" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(report.ok, true);
  });

  test("arrêt du service pendant le test : arrêt ciblé (compte et identifiant d'exécution) dans le conteneur, code 143", async () => {
    const { f, env } = await setup({ TND_STOP_GRACE_SECONDS: "5" }, { slowNode: true });
    const pkillLog = path.join(f.root, "pkill.log");
    try {
      const child = spawn("sh", [script], { env: { ...env, FAKE_PKILL_LOG: pkillLog } });
      let stderr = "";
      child.stderr.on("data", (d) => { stderr += d; });
      const closed = new Promise((resolve) => child.on("close", resolve));
      const log = path.join(f.site, "fake-node.log");
      await waitFor(() => fs.existsSync(log) && fs.readFileSync(log, "utf8").includes("start"));
      child.kill("SIGTERM");
      assert.equal(await closed, 143, stderr);
      const text = fs.readFileSync(log, "utf8");
      const runId = /--run-id (\S+)/.exec(text)[1];
      assert.match(text, /TERM/, "le test du conteneur a reçu SIGTERM");
      assert.doesNotMatch(text, /end/);
      assert.ok(fs.readFileSync(pkillLog, "utf8").includes(`-TERM -u tnd-cms -f restore-test\\.mjs --run-id ${runId}`));
      assert.match(stderr, /Arrêt demandé pendant le test/);
    } finally {
      f.cleanup();
    }
  });

  test("test déjà en cours (verrou pris) : refus immédiat, aucun rapport ni lancement", async () => {
    const { f, env } = await setup();
    try {
      const holder = spawn("flock", [env.TND_RESTORE_LOCK, "sleep", "10"]);
      await waitFor(() => fs.existsSync(env.TND_RESTORE_LOCK));
      await new Promise((r) => setTimeout(r, 300));
      const r = spawnSync("sh", [script], { encoding: "utf8", env });
      holder.kill();
      assert.equal(r.status, 1);
      assert.match(r.stderr, /déjà en cours/);
      assert.equal(readRestoreReport(f.data), null);
    } finally {
      f.cleanup();
    }
  });

  test("contrôles de l'hôte réussis : test lancé dans le conteneur, rapport enregistré", async () => {
    const { r, report } = await host();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Contrôles de l'hôte réussis/);
    assert.match(r.stdout, /✓ Test de restauration réussi/);
    assert.equal(report.ok, true);
    assert.equal(report.media.uploads.verified, 1);
  });

  test("disque absent, UUID ou marqueur faux, montage du conteneur incorrect : refus, échec enregistré", async () => {
    for (const [env, code, pattern] of [
      [{ FAKE_GRAID: "absent" }, "graid-not-mounted", /n'est pas un point de montage/],
      [{ FAKE_UUID: "11111111-2222-3333-4444-555555555555" }, "graid-uuid-mismatch", /pas depuis le disque attendu/],
      [{ FAKE_MP_SRC: "/ailleurs" }, "ct-mount-mismatch", /ne monte pas/],
      [{ FAKE_CT_MOUNTED: "0" }, "ct-mount-missing", /n'est pas monté dans le conteneur/]
    ]) {
      const { r, report } = await host(env);
      assert.notEqual(r.status, 0, code);
      assert.match(r.stderr, pattern);
      assert.equal(report.ok, false);
      assert.equal(report.checks[0].id, "host");
      assert.ok(report.checks.slice(1).every((c) => c.status === "skipped"), "aucun contrôle présenté comme fait");
    }
  });

  test("conteneur arrêté : échec dans le journal seulement, aucun rapport", async () => {
    const { r, report } = await host({ FAKE_CT_STATUS: "stopped" });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /non démarré/);
    assert.equal(report, null);
  });
});

describe("Santé du CMS : test de restauration de la sauvegarde externe", { timeout: 60e3 }, () => {
  let cms, admin, editor;
  before(async () => {
    cms = await startCms();
    admin = await cms.login("admin");
    editor = await cms.login("editor");
  });
  after(() => cms.close());
  const section = async () => (await admin.get("/api/health")).data.sections.find((s) => s.id === "restore");
  const item = (s, id) => s.items.find((i) => i.id === id);
  const file = () => restoreReportFile(cms.dataDir);
  const write = (report) => {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), typeof report === "string" ? report : JSON.stringify(report));
  };

  test("réservé aux administrateurs ; jamais exécuté, illisible : inconnu", async () => {
    assert.ok(!(await editor.get("/api/health")).data.sections.some((s) => s.id === "restore"));
    assert.equal((await cms.client().get("/api/health")).status, 401);
    let s = await section();
    assert.equal(s.level, "unknown");
    assert.equal(item(s, "restore-status").value, "Jamais exécuté");
    write("{ illisible");
    s = await section();
    assert.equal(item(s, "restore-status").level, "unknown");
    assert.equal(item(s, "restore-status").value, "Résultat inconnu");
  });

  test("réussi récent, réussi ancien, échec : niveaux et détails, sans chemin", async () => {
    const f = await fixture();
    try {
      const report = await runRestoreTest(f.options());
      write(saveRestoreReport(f.data, report));
      let s = await section();
      assert.equal(s.level, "ok", JSON.stringify(s.items));
      assert.equal(item(s, "restore-backup").value, f.name);
      assert.match(item(s, "restore-sqlite").value, /^Intègre · \d+ tables$/);
      assert.equal(item(s, "restore-originals").value, "1/1 récupéré(s) et vérifié(s)");
      assert.equal(item(s, "restore-media").value, "3/3 fichier(s) présent(s)");
      assert.equal(item(s, "restore-last-success").value, report.finishedAt);
      // Réussite ancienne : jamais présentée comme récente.
      const old = (h) => ({ ...report, finishedAt: new Date(Date.now() - h * 3600e3).toISOString() });
      write(old(24 * 10));
      assert.equal(item(await section(), "restore-status").level, "warning");
      write(old(24 * 20));
      assert.equal(item(await section(), "restore-status").level, "error");
      // Échec : détail compréhensible, date du dernier succès conservée.
      fs.rmSync(path.join(f.source, "originals", "a1b2c3d4e5f6.jpg"));
      write(saveRestoreReport(f.data, await runRestoreTest(f.options())));
      s = await section();
      assert.equal(s.level, "error");
      assert.match(item(s, "restore-status").value, /^Échec/);
      assert.match(item(s, "restore-status").message, /Originaux téléversés.*absent du support/);
      assert.equal(item(s, "restore-originals").level, "error");
      assert.equal(item(s, "restore-last-success").value, report.finishedAt);
      assert.equal(item(s, "restore-last-success").level, "info");
      const all = JSON.stringify((await admin.get("/api/health")).data);
      for (const p of [f.root, cms.dataDir]) assert.ok(!all.includes(p));
    } finally {
      f.cleanup();
    }
  });
});
