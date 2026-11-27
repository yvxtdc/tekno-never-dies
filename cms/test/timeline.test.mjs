/**
 * « Notre histoire » (history_items, migration 009) : étapes de départ = site actuel, saisie et
 * validation, export (js/data/histoire.js) et traductions, photo de la médiathèque protégée.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startCms, tempDir, testImage } from "./helpers.mjs";
import { openDatabase } from "../server/db/index.mjs";
import { buildSiteData } from "../server/export/site-data.mjs";
import { exportTimeline } from "../server/services/timeline.mjs";
import { HISTORY } from "../../js/data/histoire.js";

describe("Notre histoire (CMS)", { timeout: 120e3 }, () => {
  let cms, admin, editor;
  before(async () => {
    cms = await startCms({ importContent: true });
    admin = await cms.login("admin");
    editor = await cms.login("editor");
  });
  after(async () => { await cms.close(); });

  test("étapes de départ de la migration 009 = site actuel, avec leurs traductions", () => {
    const dir = tempDir();
    try {
      const db = openDatabase(path.join(dir, "cms.sqlite"));
      db.migrate();
      assert.deepEqual(exportTimeline(db, () => ""), HISTORY);
      const de = Object.fromEntries(db.all("SELECT source, text FROM translations WHERE lang = 'de'").map((t) => [t.source, t.text]));
      for (const it of HISTORY) {
        assert.ok(de[it.title], it.title);
        assert.ok(de[it.text], it.text);
      }
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("validation : date, photo obligatoire pour l'illustration « photo » ; mois et année ramenés au 1er", async () => {
    const bad = await editor.post("/api/timeline", { date: "2025-02-30", title: "", visual: "photo" });
    assert.equal(bad.status, 422);
    for (const field of ["date", "title", "mediaId"]) assert.ok(bad.data.fields[field], field);
    const month = await editor.post("/api/timeline", { date: "2025-03-17", datePrecision: "month", title: "Premier sound system", text: "Le mur de son est monté." });
    assert.equal(month.status, 201, JSON.stringify(month.data));
    assert.equal(month.data.date, "2025-03-01");
    const year = await editor.put(`/api/timeline/${month.data.id}`, { ...month.data, datePrecision: "year" });
    assert.equal(year.data.date, "2025-01-01");
    assert.equal((await editor.put(`/api/timeline/${month.data.id}`, { ...month.data, version: 1 })).status, 409, "version périmée");
  });

  test("export : étapes publiées seulement, par date ; traductions à faire ; à mettre en ligne", async () => {
    const hidden = (await editor.post("/api/timeline", { date: "2022-01-10", title: "Étape masquée", published: false })).data;
    const history = buildSiteData(cms.db).HISTORY;
    assert.deepEqual(history.map((it) => it.date), [...history.map((it) => it.date)].sort());
    assert.ok(!history.some((it) => it.title === "Étape masquée"));
    assert.ok(history.some((it) => it.title === "Premier sound system" && it.datePrecision === "year"));
    const missing = (await editor.get("/api/translations?missing=de")).data.map((i) => i.source);
    assert.ok(missing.includes("Premier sound system") && missing.includes("Étape masquée"), "traduisible avant publication");
    assert.ok((await editor.get("/api/publications/pending")).data.sections.includes("Notre histoire"));
    // Suppression : administrateurs seulement
    assert.equal((await editor.delete(`/api/timeline/${hidden.id}`)).status, 403);
    assert.equal((await admin.delete(`/api/timeline/${hidden.id}`)).status, 200);
  });

  test("photo de la médiathèque : exportée, et protégée contre la suppression tant qu'elle est utilisée", async () => {
    const media = (await editor.upload("/api/media", await testImage({ width: 800, height: 1000, format: "jpeg" }), "local.jpg")).data.media;
    const item = await editor.post("/api/timeline", { date: "2025-06-21", title: "Fête de la musique", visual: "photo", mediaId: media.id });
    assert.equal(item.status, 201, JSON.stringify(item.data));
    const exported = buildSiteData(cms.db).HISTORY.find((it) => it.title === "Fête de la musique");
    assert.match(exported.image, /^assets\/img\/cms\/.+\.webp$/);
    assert.equal((await admin.delete(`/api/media/${media.id}`)).status, 409, "photo utilisée");
    const usage = (await admin.get(`/api/media/${media.id}`)).data.usage;
    assert.ok(usage.some((u) => u.type === "timeline" && u.label === "Fête de la musique"), JSON.stringify(usage));
    // Autre illustration : la photo n'est plus liée
    await editor.put(`/api/timeline/${item.data.id}`, { ...item.data, visual: "badge" });
    assert.equal(cms.db.get("SELECT media_id FROM history_items WHERE id = ?", item.data.id).media_id, null);
  });
});
