import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { startCms, testImage, eventInput, tempDir } from "./helpers.mjs";
import { sniffType, cleanFileName, exportPath, registerRepoImage, createUpload, syncRepoMedia, describeRepoMediaSync } from "../server/services/media.mjs";

describe("médiathèque", () => {
  let cms, admin, editor;
  before(async () => {
    cms = await startCms();
    admin = await cms.login("admin");
    editor = await cms.login("editor");
  });
  after(() => cms.close());

  test("détection du type réel et noms de fichiers", async () => {
    assert.equal(sniffType(await testImage({ format: "png" })).mime, "image/png");
    assert.equal(sniffType(await testImage({ format: "jpeg" })).mime, "image/jpeg");
    assert.equal(sniffType(await testImage({ format: "webp" })).mime, "image/webp");
    assert.equal(sniffType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>")), null);
    assert.equal(cleanFileName("../../etc/passwd"), "passwd");
    assert.equal(cleanFileName('C:\\Users\\x\\fly<er>.jpg'), "flyer.jpg");
    assert.match(exportPath({ original_name: "Flyer ICE BOILER été.png", uid: "abcdef123456", version: 2 }, "flyer"), /^assets\/img\/cms\/flyer-ice-boiler-ete-abcdef123456-v2\.webp$/);
  });

  test("import valide : stocké sous un nom aléatoire, vignette générée, doublon reconnu", async () => {
    const png = await testImage({ width: 800, height: 600 });
    const res = await editor.upload("/api/media", png, "../Affiche soirée.png");
    assert.equal(res.status, 201);
    assert.equal(res.data.duplicate, false);
    const m = res.data.media;
    assert.equal(m.originalName, "Affiche soirée.png");
    assert.equal(m.width, 800);
    const row = cms.db.get("SELECT * FROM media WHERE id = ?", m.id);
    assert.match(row.file_name, /^[0-9a-f]{12}\.png$/);
    assert.ok(fs.existsSync(path.join(cms.config.mediaDir, "originals", row.file_name)));
    const thumb = await editor.get(m.thumbUrl);
    assert.equal(thumb.status, 200);
    assert.equal(thumb.headers.get("content-type"), "image/webp");
    const again = await editor.upload("/api/media", png, "copie.png");
    assert.equal(again.data.duplicate, true);
    assert.equal(again.data.media.id, m.id);
  });

  test("en-têtes mal encodés (nom, texte alternatif) : valeurs par défaut, pas d'erreur 500", async () => {
    const png = await testImage({ width: 400, height: 400, color: { r: 7, g: 70, b: 170 } });
    const res = await editor.request("POST", "/api/media", { raw: png, headers: { "content-type": "application/octet-stream", "x-file-name": "%E0%A4%A", "x-alt": "%" } });
    assert.equal(res.status, 201);
    assert.equal(res.data.media.originalName, "image");
    assert.equal(res.data.media.alt, "");
  });

  test("imports refusés : faux fichier, SVG, extension trompeuse, trop petit, trop gros, sans session", async () => {
    const text = Buffer.from("Ceci n'est pas une image mais prétend l'être.".repeat(10));
    assert.equal((await editor.upload("/api/media", text, "photo.jpg")).status, 415);
    const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' width='800' height='800'><script>alert(1)</script></svg>");
    assert.equal((await editor.upload("/api/media", svg, "logo.svg")).status, 415);
    const png = await testImage({ width: 500, height: 500, color: { r: 1, g: 2, b: 3 } });
    assert.equal((await editor.upload("/api/media", png, "image.jpg")).status, 415, "PNG nommé .jpg");
    assert.equal((await editor.upload("/api/media", png, "script.php")).status, 415, "extension non image");
    const tiny = await testImage({ width: 50, height: 50 });
    assert.equal((await editor.upload("/api/media", tiny, "petit.png")).status, 400);
    const truncated = (await testImage({ width: 900, height: 900, format: "jpeg", color: { r: 9, g: 9, b: 9 } })).subarray(0, 200);
    assert.equal((await editor.upload("/api/media", truncated, "coupe.jpg")).status, 415);
    const big = Buffer.alloc(cms.config.maxUploadBytes + 10);
    assert.equal((await editor.upload("/api/media", big, "gros.png")).status, 413);
    assert.equal((await cms.client().upload("/api/media", png, "x.png")).status, 401);
  });

  test("usages : suppression refusée tant que le média est utilisé, réservée aux administrateurs", async () => {
    const upload = (await editor.upload("/api/media", await testImage({ color: { r: 200, g: 10, b: 10 } }), "flyer.png")).data.media;
    const ev = (await editor.post("/api/events", eventInput({ flyerMediaId: upload.id, photos: [{ mediaId: upload.id, caption: "Légende" }] }))).data;
    const info = await editor.get(`/api/media/${upload.id}`);
    assert.equal(info.data.usage.length, 2);
    assert.equal((await editor.delete(`/api/media/${upload.id}`)).status, 403);
    const refused = await admin.delete(`/api/media/${upload.id}`);
    assert.equal(refused.status, 409);
    assert.equal(refused.data.usage[0].id, ev.id);
    await editor.put(`/api/events/${ev.id}`, { ...ev, flyerMediaId: null, photos: [] });
    assert.equal((await admin.delete(`/api/media/${upload.id}`)).status, 200);
  });

  test("remplacement : même identifiant, nouvelle version, fiches mises à jour", async () => {
    const m = (await editor.upload("/api/media", await testImage({ color: { r: 10, g: 200, b: 10 } }), "v1.png")).data.media;
    const replaced = await editor.upload(`/api/media/${m.id}/file`, await testImage({ width: 1200, height: 900, format: "jpeg", color: { r: 10, g: 10, b: 200 } }), "v2.jpg", "PUT");
    assert.equal(replaced.status, 200);
    assert.equal(replaced.data.id, m.id);
    assert.equal(replaced.data.version, 2);
    assert.equal(replaced.data.width, 1200);
    assert.equal(replaced.data.mime, "image/jpeg");
  });

  test("texte alternatif, recherche et filtres", async () => {
    const m = (await editor.upload("/api/media", await testImage({ color: { r: 33, g: 66, b: 99 } }), "Dancefloor.png")).data.media;
    const updated = await editor.put(`/api/media/${m.id}`, { alt: "Le dancefloor <b>plein</b>" });
    assert.equal(updated.data.alt, "Le dancefloor <b>plein</b>", "stocké tel quel, échappé à l'affichage");
    assert.ok((await editor.get("/api/media?q=dancefloor")).data.items.some((x) => x.id === m.id));
    assert.ok((await editor.get("/api/media?usage=unused")).data.items.some((x) => x.id === m.id));
    assert.ok(!(await editor.get("/api/media?usage=noalt")).data.items.some((x) => x.id === m.id));
  });
});

describe("images du dépôt modifiées dans Git : resynchronisation des métadonnées", () => {
  let cms, site;
  const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
  before(async () => {
    site = tempDir("tnd-site-sync-");
    fs.mkdirSync(path.join(site, "assets/img"), { recursive: true });
    cms = await startCms({ siteDir: site });
  });
  after(async () => {
    await cms.close();
    fs.rmSync(site, { recursive: true, force: true });
  });
  const row = (id) => cms.db.get("SELECT * FROM media WHERE id = ?", id);

  test("empreinte, taille, format et dimensions remis à jour ; version augmentée ; rien d'autre touché", async () => {
    const write = async (name, options) => fs.writeFileSync(path.join(site, "assets/img", name), await testImage(options));
    // Comme josephine.webp : un PNG 1080×1350 nommé .webp, réencodé ensuite en vrai WebP 720×900.
    await write("photo.webp", { width: 1080, height: 1350, format: "png" });
    await write("soiree.webp", { width: 800, height: 450, format: "jpeg" });
    await write("intacte.webp", { width: 720, height: 900, format: "webp" });
    await write("disparue.webp", { width: 720, height: 900, format: "webp" });
    const reg = async (name) => (await registerRepoImage(cms.config, cms.db, `assets/img/${name}`)).id;
    const ids = { photo: await reg("photo.webp"), soiree: await reg("soiree.webp"), intacte: await reg("intacte.webp"), disparue: await reg("disparue.webp") };
    const upload = (await createUpload(cms.config, cms.db, await testImage({ format: "jpeg" }), "importee.jpg", null)).media;
    // Chemin hors du site : refusé avant toute lecture.
    const outside = cms.db.run("INSERT INTO media (uid, storage, repo_path, original_name, mime, size, sha256, created_at, updated_at) VALUES ('zz0000000001', 'repo', '../hors-site.webp', 'x.webp', 'image/webp', 1, 'x', ?, ?)", new Date().toISOString(), new Date().toISOString()).lastInsertRowid;
    const before = Object.fromEntries(Object.entries({ ...ids, upload: upload.id, outside }).map(([k, id]) => [k, row(id)]));
    // Miniature de l'administration en cache pour l'image qui va changer.
    const cache = path.join(cms.config.mediaDir, "cache", `${before.photo.uid}-v1-thumb_admin.webp`);
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.writeFileSync(cache, "ancienne miniature");

    // Modifications faites dans Git.
    await write("photo.webp", { width: 720, height: 900, format: "webp" });
    await write("soiree.webp", { width: 800, height: 450, format: "webp" });
    fs.rmSync(path.join(site, "assets/img/disparue.webp"));

    const r = await syncRepoMedia(cms.config, cms.db);
    assert.equal(r.checked, 5);
    assert.deepEqual(r.updated.map((u) => u.id).sort(), [ids.photo, ids.soiree].sort());
    assert.deepEqual(r.problems.map((p) => p.id).sort(), [ids.disparue, Number(outside)].sort());
    const photoNow = row(ids.photo);
    const file = fs.readFileSync(path.join(site, "assets/img/photo.webp"));
    assert.deepEqual([photoNow.width, photoNow.height, photoNow.mime, photoNow.size, photoNow.sha256, photoNow.version], [720, 900, "image/webp", file.length, sha(file), 2]);
    assert.deepEqual([row(ids.soiree).mime, row(ids.soiree).width, row(ids.soiree).version], ["image/webp", 800, 2]);
    assert.ok(!fs.existsSync(cache), "ancienne miniature purgée");
    for (const k of ["intacte", "disparue", "upload", "outside"]) assert.deepEqual(row(before[k].id), before[k], `${k} inchangé`);
    // Inchangé pour le reste de la fiche : texte alternatif, chemin, identifiant.
    assert.deepEqual([photoNow.uid, photoNow.repo_path, photoNow.alt], [before.photo.uid, before.photo.repo_path, before.photo.alt]);
    const text = describeRepoMediaSync(r);
    assert.match(text, /assets\/img\/photo\.webp \(\d+ → \d+ octets, 1080×1350 → 720×900, image\/png → image\/webp\)/);
    assert.match(text, /assets\/img\/soiree\.webp \(\d+ → \d+ octets, image\/jpeg → image\/webp\)/);
    // Seconde exécution : rien à faire.
    assert.equal((await syncRepoMedia(cms.config, cms.db)).updated.length, 0);
    assert.equal(row(ids.photo).version, 2);
  });
});
