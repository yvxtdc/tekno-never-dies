/**
 * Médiathèque. Import : corps brut de la requête (le fichier), nom dans l'en-tête X-File-Name
 * (encodé en URI). Pas d'analyse multipart : moins de code, taille limitée pendant la lecture.
 */
import { readBuffer, readJson } from "../http/body.mjs";
import { notFound } from "../http/errors.mjs";
import { pageParams } from "../http/query.mjs";
import { serveFile } from "../http/static.mjs";
import { audit } from "../services/audit.mjs";
import * as media from "../services/media.mjs";

/** En-tête encodé en URI ; valeur mal encodée : valeur par défaut (pas d'erreur 500). */
const header = (req, name, fallback) => {
  try {
    return decodeURIComponent(String(req.headers[name] || fallback));
  } catch {
    return fallback;
  }
};
const fileName = (req) => header(req, "x-file-name", "image");

export function registerMediaRoutes(router, { config, db }) {
  router.get("/api/media", (ctx) => {
    const q = ctx.query;
    return media.listMedia(db, { q: q.get("q") || "", usage: q.get("usage") || "", storage: q.get("storage") || "", sort: q.get("sort") || "recent", ...pageParams(q, 40, 200) });
  }, { perm: "content.read" });

  router.post("/api/media", async (ctx) => {
    const buffer = await readBuffer(ctx.req, config.maxUploadBytes);
    const { media: row, duplicate } = await media.createUpload(config, db, buffer, fileName(ctx.req), ctx.user, {
      alt: header(ctx.req, "x-alt", "")
    });
    if (!duplicate) audit(db, ctx.actor, "media.upload", "media", row.id, row.original_name);
    return { media: media.serializeMedia(row), duplicate };
  }, { perm: "media.write", status: 201 });

  router.get("/api/media/:id", (ctx) => {
    const row = media.getMediaRow(db, ctx.params.id);
    if (!row) throw notFound("Média introuvable.");
    return { ...media.serializeMedia(row), usage: media.mediaUsage(db, row.id) };
  }, { perm: "content.read" });

  router.put("/api/media/:id", async (ctx) => {
    const body = await readJson(ctx.req, 16 * 1024);
    const row = media.updateMediaMeta(db, ctx.params.id, body);
    // Le texte alternatif est publié avec les photos : les fiches concernées sont « à republier ».
    db.run("UPDATE events SET updated_at = ? WHERE id IN (SELECT event_id FROM event_photos WHERE media_id = ?)", new Date().toISOString(), row.id);
    audit(db, ctx.actor, "media.update", "media", row.id, row.original_name);
    return { ...media.serializeMedia(row), usage: media.mediaUsage(db, row.id) };
  }, { perm: "media.write" });

  router.put("/api/media/:id/file", async (ctx) => {
    const buffer = await readBuffer(ctx.req, config.maxUploadBytes);
    const row = await media.replaceUpload(config, db, ctx.params.id, buffer, fileName(ctx.req));
    const usage = media.mediaUsage(db, row.id);
    db.run(`UPDATE events SET updated_at = ? WHERE flyer_media_id = ? OR cover_media_id = ? OR id IN (SELECT event_id FROM event_photos WHERE media_id = ?)`, new Date().toISOString(), row.id, row.id, row.id);
    audit(db, ctx.actor, "media.replace", "media", row.id, `${row.original_name} (utilisé ${usage.length} fois)`);
    return { ...media.serializeMedia(row), usage };
  }, { perm: "media.write" });

  router.delete("/api/media/:id", (ctx) => {
    const row = media.deleteMedia(config, db, ctx.params.id);
    audit(db, ctx.actor, "media.delete", "media", row.id, row.original_name);
    return { ok: true };
  }, { perm: "media.delete" });

  // Fichiers d'aperçu pour l'administration (jamais l'original tel quel).
  for (const [suffix, variant] of [["thumb", "thumb_admin"], ["preview", "web"]]) {
    router.get(`/api/media/:id/${suffix}`, async (ctx) => {
      const row = media.getMediaRow(db, ctx.params.id);
      if (!row) throw notFound("Média introuvable.");
      const file = await media.variantFile(config, row, variant);
      if (!serveFile(ctx.req, ctx.res, file, { cache: "private, max-age=86400", headers: { "Content-Security-Policy": "default-src 'none'" } })) throw notFound();
    }, { perm: "content.read" });
  }
}
