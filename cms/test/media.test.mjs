import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startCms, testImage, eventInput } from "./helpers.mjs";
import { sniffType, cleanFileName, exportPath } from "../server/services/media.mjs";

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
