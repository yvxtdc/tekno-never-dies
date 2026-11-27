/**
 * Infos de l'association (site_info, migration 008) : saisie réservée aux administrateurs, export
 * (js/data/association.js), écriture dans les pages (tools/sync-infos.mjs, attributs data-info) et
 * traductions qui survivent à un changement de valeur (clés {info:…}, tools/langues.mjs).
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startCms, copySite, tempDir } from "./helpers.mjs";
import { openDatabase } from "../server/db/index.mjs";
import { buildSiteData } from "../server/export/site-data.mjs";
import { exportInfo } from "../server/services/site-info.mjs";
import { ASSOCIATION } from "../../js/data/association.js";
import { infoValues, parseInfoSpec, infoToken } from "../../js/components/association-info.js";
import { syncInfoHtml, withInfoTokens } from "../../tools/lib/infos.mjs";
import { parse, innerHTML, find } from "../../tools/lib/html.mjs";

const values = infoValues(ASSOCIATION);
const valid = (over = {}) => ({
  email: "contact@tnd.test", phone: "+33 6 00 00 00 00", instagram: "https://www.instagram.com/tnd.test/",
  street: "1 rue du Rhin", postalCode: "67630", city: "Lauterbourg", publisherName: "Camille Test",
  publisherRole: "présidente de l’association", hostName: "Hébergeur Test", hostAddress: "1 rue Test, 75000 Paris, France",
  hostUrl: "https://hebergeur.test/", ...over
});

describe("infos de l'association : marquage data-info (tools/lib/infos.mjs)", () => {
  test("réécrit chaque cible entière (texte, attributs, sameAs), échappe les valeurs, garde le reste du fichier", () => {
    const html = `<p>Écrire à <a href="mailto:a@b.c" data-info="href=emailHref text=email">a@b.c</a></p>
<a class="x" href="old" data-info="href=instagram title=instagramHandle">ic</a>
<script type="application/ld+json" data-info="sameAs=instagram">{ "sameAs": ["old"], "name": "x" }</script>`;
    const other = infoValues({ ...ASSOCIATION, email: "a&b@c.d" });
    const out = syncInfoHtml(html, other, parseInfoSpec);
    assert.match(out, /<a href="mailto:a&amp;b@c.d" data-info="href=emailHref text=email">a&amp;b@c.d<\/a>/);
    assert.match(out, /href="https:\/\/www.instagram.com\/tnd6tem\/" data-info="href=instagram title=instagramHandle" title="@tnd6tem">ic<\/a>/);
    assert.match(out, /"sameAs": \["https:\/\/www.instagram.com\/tnd6tem\/"\], "name": "x"/);
    assert.equal(syncInfoHtml(out, other, parseInfoSpec), out, "stable");
  });

  test("marquages invalides refusés avec la ligne en cause", () => {
    assert.throws(() => syncInfoHtml(`\n<span data-info="text=email"><b>x</b></span>`, values, parseInfoSpec), /ligne 2.*que du texte/);
    assert.throws(() => syncInfoHtml(`<a data-info="href=licorne">x</a>`, values, parseInfoSpec), /valeur inconnue « licorne »/);
    assert.throws(() => syncInfoHtml(`<a data-info="style=email">x</a>`, values, parseInfoSpec), /cible inconnue « style »/);
    assert.throws(() => syncInfoHtml(`<p data-info="sameAs=instagram">x</p>`, values, parseInfoSpec), /application\/ld\+json/);
  });

  test("clés de traduction sans les valeurs : repères {info:…}, span de marquage retiré", () => {
    const doc = parse(`<p>Siège : <span data-info="text=address">X</span>, France<br>Contact : <a href="mailto:x" data-info="href=emailHref text=email">x</a>.</p><span class="sr-only">Écrire à <span data-info="text=email">x</span></span>`);
    withInfoTokens(doc, { names: Object.keys(values), parseInfoSpec, infoToken });
    assert.equal(innerHTML(find(doc, (e) => e.name === "P"), true), `Siège : {info:address}, France<br>Contact : <a href="{info:emailHref}">{info:email}</a>.`);
    assert.deepEqual(find(doc, (e) => e.name === "SPAN").children, [{ type: 3, value: "Écrire à {info:email}" }], "un seul texte : une seule clé");
  });
});

describe("infos de l'association : saisie et export (CMS)", () => {
  let cms, admin, editor;
  before(async () => {
    cms = await startCms({ importContent: true });
    admin = await cms.login("admin");
    editor = await cms.login("editor");
  });
  after(async () => { await cms.close(); });

  test("valeurs de départ de la migration 008 = site actuel (la première mise en ligne ne change rien)", () => {
    const dir = tempDir();
    try {
      const db = openDatabase(path.join(dir, "cms.sqlite"));
      db.migrate();
      assert.deepEqual(exportInfo(db), ASSOCIATION);
      const tr = Object.fromEntries(db.all("SELECT source, lang, text FROM translations").map((t) => [`${t.lang}:${t.source}`, t.text]));
      assert.equal(tr[`de:${ASSOCIATION.publisher.role}`], "Präsident des Vereins");
      assert.equal(tr[`en:${ASSOCIATION.host.address}`], "88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, United States");
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("lecture pour tous, modification réservée aux administrateurs", async () => {
    assert.equal((await editor.get("/api/site-info")).data.email, ASSOCIATION.email);
    const info = (await editor.get("/api/site-info")).data;
    assert.equal((await editor.put("/api/site-info", { ...valid(), version: info.version })).status, 403);
    assert.equal((await cms.client().get("/api/site-info")).status, 401);
  });

  test("validation : e-mail, téléphone, Instagram, adresses web, champs obligatoires ; version périmée refusée", async () => {
    const info = (await admin.get("/api/site-info")).data;
    const bad = await admin.put("/api/site-info", { ...valid({ email: "pas-un-mail", phone: "appelez-nous", instagram: "https://facebook.com/x", hostUrl: "http://", publisherName: "" }), version: info.version });
    assert.equal(bad.status, 422);
    for (const field of ["email", "phone", "instagram", "hostUrl", "publisherName"]) assert.ok(bad.data.fields[field], field);
    assert.equal((await admin.put("/api/site-info", { ...valid(), version: info.version - 1 })).status, 409);
  });

  test("enregistrement : export, traductions à faire, contenu « Infos de l'association » à mettre en ligne", async () => {
    const info = (await admin.get("/api/site-info")).data;
    const saved = await admin.put("/api/site-info", { ...valid(), version: info.version });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.version, info.version + 1);
    const a = buildSiteData(cms.db).ASSOCIATION;
    assert.deepEqual(a, { email: "contact@tnd.test", phone: "+33 6 00 00 00 00", instagram: "https://www.instagram.com/tnd.test/",
      address: { street: "1 rue du Rhin", postalCode: "67630", city: "Lauterbourg" }, publisher: { name: "Camille Test", role: "présidente de l’association" },
      host: { name: "Hébergeur Test", address: "1 rue Test, 75000 Paris, France", url: "https://hebergeur.test/" } });
    const missing = (await admin.get("/api/translations?missing=de")).data.map((i) => i.source);
    assert.ok(missing.includes("présidente de l’association") && missing.includes("1 rue Test, 75000 Paris, France"));
    assert.ok((await admin.get("/api/publications/pending")).data.sections.includes("Infos de l'association"));
    assert.ok(cms.db.get("SELECT 1 FROM audit_log WHERE action = 'site-info.update'"));
  });
});

describe("infos de l'association : mise en ligne (copie du site)", { timeout: 300e3 }, () => {
  test("nouvel e-mail et nouvelle fonction partout, pages DE/EN toujours traduites, aucune trace de l'ancien e-mail", async () => {
    const siteDir = copySite();
    const cms = await startCms({ importContent: true, siteDir, env: { CMS_PUBLISH_MODE: "files" } });
    try {
      const admin = await cms.login("admin");
      const info = (await admin.get("/api/site-info")).data;
      assert.equal((await admin.put("/api/site-info", { ...info, email: "bonjour@tnd.test", publisherRole: "présidente de l’association" })).status, 200);
      await admin.put("/api/translations", { source: "présidente de l’association", lang: "de", text: "Präsidentin des Vereins" });
      const res = await admin.post("/api/publications", {});
      assert.equal(res.data.status, "success", res.data.log);
      const read = (file) => fs.readFileSync(path.join(siteDir, file), "utf8");
      for (const file of ["index.html", "contact.html", "mentions-legales.html", "partials/footer.html", "de/mentions-legales.html", "en/contact.html", "evenement.html"]) {
        assert.match(read(file), /bonjour@tnd\.test/, file);
        assert.doesNotMatch(read(file), /tnd6tem@gmail\.com/, `${file} : ancien e-mail`);
      }
      // Phrases toujours traduites : seule la valeur a changé
      assert.match(read("de/mentions-legales.html"), /Yannis Metzinger, Präsidentin des Vereins und verantwortlich für den Inhalt\./);
      assert.match(read("de/conditions-evenements.html"), /kontaktieren Sie den Verein unter <a href="mailto:bonjour@tnd\.test">bonjour@tnd\.test<\/a>/);
      assert.match(read("en/index.html"), /<span class="sr-only">Email bonjour@tnd\.test<\/span>/);
      assert.match(read("mentions-legales.html"), /<span data-info="text=publisherRole">présidente de l’association<\/span>/);
      assert.match(read("js/data/association.js"), /"email": "bonjour@tnd\.test"/);
    } finally {
      await cms.close();
      fs.rmSync(siteDir, { recursive: true, force: true });
    }
  });
});
