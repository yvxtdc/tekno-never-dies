import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { startCms, eventInput, testImage, tempDir } from "./helpers.mjs";
import { verifyRoundtrip } from "../server/export/import-repo.mjs";
import { buildSiteData } from "../server/export/site-data.mjs";
import { renderModules } from "../server/export/modules.mjs";

/** Charge un module rendu (texte) comme le ferait le site. */
async function loadModule(source) {
  const dir = tempDir("tnd-mod-");
  const file = path.join(dir, "m.mjs");
  fs.writeFileSync(file, source);
  const mod = await import(pathToFileURL(file).href);
  fs.rmSync(dir, { recursive: true, force: true });
  return mod;
}

describe("import des contenus existants et export", () => {
  let cms, editor;
  before(async () => {
    cms = await startCms({ importContent: true });
    editor = await cms.login("editor");
  });
  after(() => cms.close());

  test("import puis export : données du site strictement identiques (aucun changement visible)", async () => {
    const counts = Object.fromEntries(["events", "artists", "venues", "faq_items", "team_members", "gallery_albums"].map((t) => [t, cms.db.get(`SELECT COUNT(*) AS n FROM ${t}`).n]));
    assert.ok(counts.events >= 4 && counts.artists >= 10 && counts.faq_items >= 10 && counts.team_members >= 5);
    assert.deepEqual(await verifyRoundtrip(cms.db, cms.config), []);
    const pending = await editor.get("/api/publications/pending");
    assert.equal(pending.data.hasChanges, false, "rien à mettre en ligne juste après l'import");
  });

  test("line-up importé : artistes reliés, B2B découpés, nom d'affiche conservé", async () => {
    const v1 = cms.db.get("SELECT id FROM events WHERE slug = 'ice-boiler-v1-2025'");
    const ev = (await editor.get(`/api/events/${v1.id}`)).data;
    const valk = ev.lineup.find((s) => /valk/i.test(s.label || s.artists.map((a) => a.name).join()));
    assert.deepEqual(valk.artists.map((a) => a.name), ["Valk", "Redfox"]);
    assert.equal(valk.label, "VALK b2b REDFOX");
    assert.equal(ev.startTime, "20:00");
    assert.equal(ev.endTime, "04:00");
  });

  test("brouillon jamais exporté ; publication et annulation exportées", async () => {
    const draft = (await editor.post("/api/events", eventInput({ title: "Brouillon secret" }))).data;
    let data = buildSiteData(cms.db);
    assert.ok(!data.events.some((e) => e.slug === draft.slug));
    await editor.post(`/api/events/${draft.id}/status`, { action: "publish" });
    data = buildSiteData(cms.db);
    const exported = data.events.find((e) => e.slug === draft.slug);
    assert.equal(exported.time, "21h00 – 4h00");
    assert.equal(exported.cancelled, undefined);
    await editor.post(`/api/events/${draft.id}/status`, { action: "cancel" });
    assert.equal(buildSiteData(cms.db).events.find((e) => e.slug === draft.slug).cancelled, true);
    await editor.post(`/api/events/${draft.id}/status`, { action: "archive" });
    assert.ok(!buildSiteData(cms.db).events.some((e) => e.slug === draft.slug));
  });

  test("renommer un artiste change le line-up exporté, sauf le nom d'affiche saisi pour une soirée", async () => {
    const artist = cms.db.get("SELECT * FROM artists WHERE name = 'Mogli'");
    const full = (await editor.get(`/api/artists/${artist.id}`)).data;
    await editor.put(`/api/artists/${artist.id}`, { ...full, name: "Mogli Officiel" });
    const data = buildSiteData(cms.db);
    const v2 = data.events.find((e) => e.slug === "ice-boiler-v2-2026");
    assert.ok(v2.lineup.some((s) => s.name === "Mogli Officiel"));
    assert.equal(data.ARTISTS["Mogli Officiel"], full.instagramUrl);
    assert.ok(data.ARTIST_PHOTOS.mogliofficiel);
    const v1 = data.events.find((e) => e.slug === "ice-boiler-v1-2025");
    assert.ok(v1.lineup.some((s) => s.name === "VALK b2b REDFOX"), "nom d'affiche inchangé");
    await editor.put(`/api/artists/${artist.id}`, { ...full, version: full.version + 1 });
  });

  test("image importée : variante optimisée dans assets/img/cms, champs du site complets", async () => {
    const flyer = (await editor.upload("/api/media", await testImage({ width: 1080, height: 1350, format: "jpeg" }), "Flyer nouvelle.jpg")).data.media;
    const venue = (await editor.post("/api/venues", { name: "Foyer", city: "Lauterbourg", lat: 48.97, lon: 8.18, precise: false, mapSpanKm: 3 })).data;
    const ev = (await editor.post("/api/events", eventInput({
      title: "Nouvelle", slug: "nouvelle-2030", venueId: venue.id, flyerMediaId: flyer.id, doorsTime: "20:30", price: "10 €",
      links: [{ label: "Événement Facebook", url: "https://facebook.com/events/1" }], seoTitle: "Nouvelle — soirée", aboutTitle: "Accroche",
      photos: [{ mediaId: flyer.id, caption: "Légende" }]
    }))).data;
    await editor.put(`/api/media/${flyer.id}`, { alt: "Affiche de la soirée" });
    await editor.post(`/api/events/${ev.id}/status`, { action: "publish" });
    const data = buildSiteData(cms.db);
    const out = data.events.find((e) => e.slug === "nouvelle-2030");
    assert.match(out.flyer, /^assets\/img\/cms\/flyer-nouvelle-[0-9a-f]{12}-v1\.webp$/);
    assert.ok(data.files.has(out.flyer));
    assert.equal(out.place, "Foyer, Lauterbourg");
    assert.deepEqual(out.venue, { lat: 48.97, lon: 8.18, precise: false, span: 3 });
    assert.equal(out.doors, "20h30");
    assert.equal(out.price, "10 €");
    assert.deepEqual(out.links, [{ label: "Événement Facebook", url: "https://facebook.com/events/1" }]);
    assert.deepEqual(out.seo, { title: "Nouvelle — soirée" });
    assert.deepEqual(out.about, { title: "Accroche", photos: [{ src: out.about.photos[0].src, caption: "Légende", alt: "Affiche de la soirée" }] });
  });

  test("modules rendus : JavaScript valide, redirections et traductions exportées", async () => {
    const ev = cms.db.get("SELECT * FROM events WHERE slug = 'center-drop-2026'");
    const full = (await editor.get(`/api/events/${ev.id}`)).data;
    await editor.put(`/api/events/${ev.id}`, { ...full, slug: "center-drop-niederroedern-2026" });
    await editor.put("/api/translations", { source: full.description, lang: "en", text: "Center Drop, techno night." });
    const modules = renderModules(buildSiteData(cms.db));
    const events = await loadModule(modules["js/data/events.js"]);
    assert.equal(events.EVENT_REDIRECTS["center-drop-2026"], "center-drop-niederroedern-2026");
    const en = await loadModule(modules["js/i18n/contenus-en.js"]);
    assert.equal(en.default[full.description], "Center Drop, techno night.");
    const faq = await loadModule(modules["js/data/faq.js"]);
    assert.ok(faq.FAQ.length >= 10);
    for (const source of Object.values(modules)) assert.match(source, /^\/\*\n \* FICHIER GÉNÉRÉ par le CMS/);
  });
});
