import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startCms, testImage } from "./helpers.mjs";
import { richTextToHtml, htmlToRichText, richTextProblems, safeHref } from "../server/services/richtext.mjs";
import { Validator, normalizeUrl } from "../server/services/validation.mjs";
import { slugify } from "../server/services/slug.mjs";

describe("texte enrichi et validation", () => {
  test("le texte enrichi n'injecte jamais de HTML ni de script", () => {
    const html = richTextToHtml(`<img src=x onerror=alert(1)> **gras** *italique* [lien](javascript:alert(1)) [ok](https://e.org/a?b=1&c=2) [page](contact.html?type=rejoindre)\nligne 2`);
    assert.doesNotMatch(html, /<img|<script|javascript:|onerror=/i.source ? /<img|javascript:/ : /x/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /<strong>gras<\/strong> <em>italique<\/em>/);
    assert.match(html, /<a href="https:\/\/e.org\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">ok<\/a>/);
    assert.match(html, /<a href="contact.html\?type=rejoindre">page<\/a>/);
    assert.match(html, /<br \/>ligne 2$/);
    assert.equal(safeHref("data:text/html,<script>"), null);
    assert.equal(safeHref("//evil.example"), null);
    assert.ok(richTextProblems("[x](javascript:alert(1))").length);
  });

  test("conversion des réponses HTML existantes, aller-retour identique", () => {
    const original = 'Écris-nous depuis la page <a href="contact.html">Contact</a> ou sur <a href="https://www.instagram.com/tnd6tem/" target="_blank" rel="noopener noreferrer">Instagram @tnd6tem</a>.';
    const markup = htmlToRichText(original);
    assert.equal(markup, "Écris-nous depuis la page [Contact](contact.html) ou sur [Instagram @tnd6tem](https://www.instagram.com/tnd6tem/).");
    assert.equal(richTextToHtml(markup), original);
    assert.equal(htmlToRichText('<iframe src="x"></iframe>'), null, "HTML non reconnu signalé");
  });

  test("validateur : adresses, dates, listes, caractères de contrôle", () => {
    assert.equal(normalizeUrl("javascript:alert(1)"), null);
    assert.equal(normalizeUrl("https://user:pass@e.org"), null);
    assert.equal(normalizeUrl("http://e.org", { httpsOnly: true }), null);
    assert.equal(normalizeUrl(" https://e.org/x "), "https://e.org/x");
    const v = new Validator({ title: "  Un\u0000 titre\n ", date: "2026-02-29", list: ["a", " ", "b"] });
    assert.equal(v.text("title", { required: true }), "Un titre");
    assert.equal(v.date("date"), undefined);
    assert.deepEqual(v.list("list"), ["a", "b"]);
    assert.ok(v.errors.date);
    assert.equal(slugify("Fête de la Musique — Wissembourg 2025 !"), "fete-de-la-musique-wissembourg-2025");
  });
});

describe("FAQ, équipe, galerie et traductions", () => {
  let cms, admin, editor;
  before(async () => {
    cms = await startCms();
    admin = await cms.login("admin");
    editor = await cms.login("editor");
  });
  after(() => cms.close());

  test("FAQ : création, lien interdit refusé, réordonnancement, suppression réservée", async () => {
    const bad = await editor.post("/api/faq", { question: "Q ?", answer: "Voir [ici](javascript:alert(1))", category: "Association" });
    assert.equal(bad.status, 422);
    const a = (await editor.post("/api/faq", { question: "Première ?", answer: "Oui, voir la [FAQ](faq.html).", category: "Association" })).data;
    const b = (await editor.post("/api/faq", { question: "Deuxième ?", answer: "**Non.**", category: "Événements", needsValidation: true })).data;
    assert.equal(a.answerHtml, 'Oui, voir la <a href="faq.html">FAQ</a>.');
    const reordered = await editor.post("/api/faq/reorder", { ids: [b.id, a.id] });
    assert.deepEqual(reordered.data.map((x) => x.id), [b.id, a.id]);
    assert.equal((await editor.post("/api/faq/reorder", { ids: [a.id] })).status, 400, "liste incomplète refusée");
    assert.equal((await editor.delete(`/api/faq/${a.id}`)).status, 403);
    assert.equal((await admin.delete(`/api/faq/${a.id}`)).status, 200);
  });

  test("équipe : détails ordonnés, photo de la médiathèque", async () => {
    const photo = (await editor.upload("/api/media", await testImage({ width: 720, height: 900 }), "membre.png")).data.media;
    const m = await editor.post("/api/team", { name: "Yannis", role: "Président", photoMediaId: photo.id, tags: ["Organisation"], extra: [{ label: "Pôle", value: "Organisation" }, { label: "Rôle", value: "Président" }] });
    assert.equal(m.status, 201);
    assert.deepEqual(m.data.extra.map((e) => e.label), ["Pôle", "Rôle"]);
    const bad = await editor.post("/api/team", { name: "X", role: "Y", extra: [{ label: "", value: "sans intitulé" }] });
    assert.equal(bad.status, 422);
  });

  test("galerie : album, photos ordonnées, doublon refusé", async () => {
    const album = (await editor.post("/api/albums", { title: "ICE BOILER v2", date: "2026-11-28", published: true })).data;
    assert.equal(album.slug, "ice-boiler-v2");
    const p1 = (await editor.upload("/api/media", await testImage({ color: { r: 1, g: 100, b: 1 } }), "p1.png")).data.media;
    const p2 = (await editor.upload("/api/media", await testImage({ color: { r: 1, g: 1, b: 100 } }), "p2.png")).data.media;
    const set = await editor.put(`/api/albums/${album.id}/photos`, { mediaIds: [p2.id, p1.id] });
    assert.deepEqual(set.data.photos.map((p) => p.media.id), [p2.id, p1.id]);
    assert.equal((await editor.put(`/api/albums/${album.id}/photos`, { mediaIds: [p1.id, p1.id] })).status, 400);
    const refused = await admin.delete(`/api/media/${p1.id}`);
    assert.equal(refused.status, 409, "photo d'album protégée");
  });

  test("traductions : textes des contenus listés, enregistrés, effacés", async () => {
    await editor.post("/api/faq", { question: "Peut-on venir en train ?", answer: "Oui.", category: "Événements" });
    const list = (await editor.get("/api/translations?missing=de")).data;
    const entry = list.find((t) => t.source === "Peut-on venir en train ?");
    assert.ok(entry);
    assert.deepEqual(entry.usedIn, ["FAQ"]);
    await editor.put("/api/translations", { source: entry.source, lang: "de", text: "Kann man mit dem Zug kommen?" });
    const after = (await editor.get("/api/translations")).data.find((t) => t.source === entry.source);
    assert.equal(after.de, "Kann man mit dem Zug kommen?");
    await editor.put("/api/translations", { source: entry.source, lang: "de", text: "" });
    assert.equal((await editor.get("/api/translations")).data.find((t) => t.source === entry.source).de, "");
    assert.equal((await editor.put("/api/translations", { source: "x", lang: "it", text: "y" })).status, 400);
  });
});
