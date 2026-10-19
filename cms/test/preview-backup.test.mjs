import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startCms, eventInput, tempDir } from "./helpers.mjs";
import { loadConfig } from "../server/config.mjs";
import { openDatabase } from "../server/db/index.mjs";
import { createBackup, restoreBackup, inspectBackup } from "../server/services/backup.mjs";

describe("prévisualisation", () => {
  let cms, editor, draft;
  before(async () => {
    cms = await startCms({ importContent: true });
    editor = await cms.login("editor");
    draft = (await editor.post("/api/events", eventInput({ title: "Brouillon aperçu", slug: "brouillon-apercu-2030" }))).data;
  });
  after(() => cms.close());

  test("réservée aux personnes connectées", async () => {
    const res = await cms.client().get("/preview/site/index.html");
    assert.equal(res.status, 302);
    assert.match(res.headers.get("location"), /^\/admin\/login\?next=/);
  });

  test("site réel avec bandeau, jamais indexé, statistiques désactivées", async () => {
    const res = await editor.get("/preview/site/index.html");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
    assert.match(res.data, /APERÇU/);
    const site = await editor.get("/preview/site/js/data/site.js");
    assert.match(site.data, /goatcounter: ""/);
    const css = await editor.get("/preview/site/css/style.css");
    assert.equal(css.status, 200);
  });

  test("brouillon : visible dans son aperçu, absent de l'aperçu du site", async () => {
    assert.equal((await editor.get(`/preview/site/evenement-${draft.slug}.html`)).status, 404);
    const page = await editor.get(`/preview/event-${draft.id}/evenement-${draft.slug}.html`);
    assert.equal(page.status, 200);
    assert.match(page.data, /<title>Brouillon aperçu — Tekno Never Dies<\/title>/);
    assert.match(page.data, /brouillon/);
    const data = await editor.get(`/preview/event-${draft.id}/js/data/events.js`);
    assert.match(data.data, /brouillon-apercu-2030/);
    assert.doesNotMatch((await editor.get("/preview/site/js/data/events.js")).data, /brouillon-apercu-2030/);
  });

  test("fichiers hors du site jamais servis", async () => {
    for (const url of ["/preview/site/cms/server/config.mjs", "/preview/site/package.json", "/preview/site/%2e%2e/%2e%2e/etc/passwd", "/preview/site/.git/config", "/preview/site/tools/validate.mjs", "/preview/site/README.md", "/preview/site/.cms-data/cms.sqlite"]) {
      assert.equal((await editor.get(url)).status, 404, url);
    }
  });

  test("lien partageable : sans compte, limité à la soirée, expirable et révocable", async () => {
    const link = await editor.post(`/api/events/${draft.id}/preview-link`, {});
    assert.equal(link.status, 200);
    const url = new URL(link.data.url);
    const anon = cms.client();
    const page = await anon.get(url.pathname);
    assert.equal(page.status, 200);
    assert.match(page.data, /Brouillon aperçu/);
    assert.equal(cms.db.get("SELECT COUNT(*) AS n FROM preview_tokens").n, 1);
    assert.ok(!cms.db.get("SELECT id FROM preview_tokens").id.includes(url.pathname.split("/")[2]), "jeton stocké haché");
    cms.db.run("UPDATE preview_tokens SET expires_at = ?", new Date(Date.now() - 1000).toISOString());
    assert.equal((await anon.get(url.pathname)).status, 404);
    const again = new URL((await editor.post(`/api/events/${draft.id}/preview-link`, {})).data.url);
    await editor.delete(`/api/events/${draft.id}/preview-links`);
    assert.equal((await anon.get(again.pathname)).status, 404);
    assert.equal((await anon.get("/p/jeton-invalide-mais-assez-long/index.html")).status, 404);
  });
});

describe("sauvegardes", () => {
  let cms, admin, editor;
  before(async () => {
    cms = await startCms({ importContent: true });
    admin = await cms.login("admin");
    editor = await cms.login("editor");
  });
  after(() => cms.close());

  test("création, liste et téléchargement réservés aux administrateurs", async () => {
    assert.equal((await editor.post("/api/backups", {})).status, 403);
    const created = await admin.post("/api/backups", {});
    assert.equal(created.status, 201);
    const list = await admin.get("/api/backups");
    assert.ok(list.data.items.some((b) => b.name === created.data.name));
    const file = await admin.get(`/api/backups/${created.data.name}`);
    assert.equal(file.status, 200);
    assert.equal(file.data.subarray(0, 15).toString(), "SQLite format 3");
    assert.equal((await admin.get("/api/backups/..%2F..%2Fcms.sqlite")).status, 404);
  });

  test("restauration : contrôle d'intégrité, base précédente conservée, données retrouvées", async () => {
    const { name } = await createBackup(cms.config, cms.db, "test");
    const source = path.join(cms.config.backupDir, name);
    const info = inspectBackup(source);
    assert.ok(info.counts.events >= 4);
    // Restauration dans une autre installation (serveur arrêté)
    const other = loadConfig({ CMS_SKIP_ENV_FILE: "1", CMS_DATA_DIR: tempDir() });
    const db = openDatabase(other.dbFile);
    db.migrate();
    db.close();
    const { safety } = await restoreBackup(other, source);
    assert.ok(fs.existsSync(safety));
    const restored = openDatabase(other.dbFile);
    assert.equal(restored.get("SELECT COUNT(*) AS n FROM events").n, info.counts.events);
    restored.close();
    const garbage = path.join(other.dataDir, "faux.sqlite");
    fs.writeFileSync(garbage, "pas une base");
    await assert.rejects(() => restoreBackup(other, garbage));
    fs.rmSync(other.dataDir, { recursive: true, force: true });
  });
});
