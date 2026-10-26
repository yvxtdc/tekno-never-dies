/** Routes des contenus : soirées, artistes, lieux, FAQ, équipe, albums, traductions, historique. */
import { readJson } from "../http/body.mjs";
import { notFound, badRequest } from "../http/errors.mjs";
import { pageParams } from "../http/query.mjs";
import { audit, listRevisions, getRevision } from "../services/audit.mjs";
import * as events from "../services/events.mjs";
import * as artists from "../services/artists.mjs";
import * as venues from "../services/venues.mjs";
import * as faq from "../services/faq.mjs";
import * as team from "../services/team.mjs";
import * as gallery from "../services/gallery.mjs";
import * as translations from "../services/translations.mjs";
import { eventStatusAction, mergeStale, orphanChanges } from "../services/schedule.mjs";
import { generationOf } from "../services/schedule-targets.mjs";
import { createPreviewToken } from "../preview/preview.mjs";

const READ = { perm: "content.read" };
const WRITE = { perm: "content.write" };
const DELETE = { perm: "content.delete" };

/**
 * Enregistrement d'un formulaire : sur une version périmée (modifiée entre-temps par une programmation
 * ou une autre personne), fusion champ par champ (services/schedule.mjs, mergeStale) ; mergedFields :
 * champs modifiés entre-temps dont la valeur actuelle a été conservée.
 */
const saveMerged = (db, type, id, body, update) => db.tx(() => {
  const { input, merged } = mergeStale(db, type, id, body);
  return { ...update(input), mergedFields: merged };
});

export function registerContentRoutes(router, { config, db }) {
  /* ---------- Soirées ---------- */
  router.get("/api/events", (ctx) => {
    const q = ctx.query;
    return events.listEvents(db, { q: q.get("q") || "", status: q.get("status") || "", period: q.get("period") || "", sort: q.get("sort") || "date_desc", ...pageParams(q) });
  }, READ);
  router.post("/api/events", async (ctx) => {
    const ev = events.createEvent(db, await readJson(ctx.req), ctx.user);
    audit(db, ctx.actor, "event.create", "event", ev.id, ev.title);
    return ev;
  }, { ...WRITE, status: 201 });
  router.get("/api/events/:id", (ctx) => events.getEvent(db, ctx.params.id), READ);
  router.put("/api/events/:id", async (ctx) => {
    const body = await readJson(ctx.req);
    const ev = saveMerged(db, "event", ctx.params.id, body, (input) => events.updateEvent(db, ctx.params.id, input, ctx.user));
    audit(db, ctx.actor, "event.update", "event", ev.id, `${ev.title}${ev.mergedFields.length ? ` (fusion : ${ev.mergedFields.join(", ")} conservés)` : ""}`);
    return ev;
  }, WRITE);
  router.delete("/api/events/:id", (ctx) => {
    const row = events.deleteEvent(db, ctx.params.id);
    orphanChanges(db, "event", row.id, ctx.user);
    audit(db, ctx.actor, "event.delete", "event", row.id, row.title);
    return { ok: true };
  }, DELETE);
  router.post("/api/events/:id/duplicate", (ctx) => {
    const ev = events.duplicateEvent(db, ctx.params.id, ctx.user);
    audit(db, ctx.actor, "event.duplicate", "event", ev.id, `${ev.title} (depuis #${ctx.params.id})`);
    return ev;
  }, { ...WRITE, status: 201 });
  router.post("/api/events/:id/status", async (ctx) => {
    const body = await readJson(ctx.req, 16 * 1024);
    const { event, transition } = eventStatusAction(db, ctx.params.id, String(body.action || ""), { publishAt: body.publishAt, runAt: body.runAt }, ctx.user);
    audit(db, ctx.actor, `event.${body.action}`, "event", event.id, `${event.title} : ${transition.label}${event.publishAt ? ` (${event.publishAt})` : ""}`);
    return event;
  }, { perm: "content.publish" });
  router.post("/api/events/:id/preview-link", (ctx) => {
    const ev = events.getEventRow(db, ctx.params.id);
    const { token, expiresAt } = createPreviewToken(db, ev.id, ctx.user.id);
    audit(db, ctx.actor, "event.preview-link", "event", ev.id, `Lien d'aperçu jusqu'au ${expiresAt.slice(0, 10)}`);
    return { url: `${config.publicOrigin}/p/${token}/evenement-${ev.slug}.html`, expiresAt };
  }, WRITE);
  router.delete("/api/events/:id/preview-links", (ctx) => {
    db.run("DELETE FROM preview_tokens WHERE event_id = ?", ctx.params.id);
    audit(db, ctx.actor, "event.preview-links.revoke", "event", ctx.params.id, "Liens d'aperçu révoqués");
    return { ok: true };
  }, WRITE);
  router.post("/api/events/:id/revisions/:revisionId/restore", (ctx) => {
    // Versions de cette soirée seulement (pas d'une soirée supprimée dont l'identifiant a été réutilisé).
    const rev = getRevision(db, "event", ctx.params.id, ctx.params.revisionId, { generation: generationOf(db, "event", ctx.params.id) });
    if (!rev) throw notFound("Version introuvable.");
    const ev = db.tx(() => events.restoreRevision(db, ctx.params.id, rev.data, ctx.user));
    audit(db, ctx.actor, "event.restore", "event", ev.id, `${ev.title} : version ${rev.version} restaurée`);
    return ev;
  }, WRITE);

  /* ---------- Historique des versions (toutes fiches) ---------- */
  const TYPES = new Set(["event", "artist", "venue", "faq", "team"]);
  router.get("/api/revisions/:type/:id", (ctx) => {
    if (!TYPES.has(ctx.params.type)) throw notFound();
    return listRevisions(db, ctx.params.type, ctx.params.id, { generation: generationOf(db, ctx.params.type, ctx.params.id) });
  }, READ);
  router.get("/api/revisions/:type/:id/:revisionId", (ctx) => {
    if (!TYPES.has(ctx.params.type)) throw notFound();
    const rev = getRevision(db, ctx.params.type, ctx.params.id, ctx.params.revisionId, { generation: generationOf(db, ctx.params.type, ctx.params.id) });
    if (!rev) throw notFound("Version introuvable.");
    return rev;
  }, READ);

  /* ---------- Artistes ---------- */
  router.get("/api/artists", (ctx) => {
    const q = ctx.query;
    return artists.listArtists(db, { q: q.get("q") || "", archived: q.get("archived") ?? "0", sort: q.get("sort") || "name", missing: q.get("missing") || "", ...pageParams(q, 50, 500) });
  }, READ);
  router.get("/api/artists/similar", (ctx) => artists.similarArtists(db, ctx.query.get("name") || "", Number(ctx.query.get("exclude")) || null), READ);
  router.post("/api/artists", async (ctx) => {
    const a = artists.createArtist(db, await readJson(ctx.req), ctx.user);
    audit(db, ctx.actor, "artist.create", "artist", a.id, a.name);
    return a;
  }, { ...WRITE, status: 201 });
  router.get("/api/artists/:id", (ctx) => artists.getArtist(db, ctx.params.id), READ);
  router.put("/api/artists/:id", async (ctx) => {
    const body = await readJson(ctx.req);
    const a = saveMerged(db, "artist", ctx.params.id, body, (input) => artists.updateArtist(db, ctx.params.id, input, ctx.user));
    audit(db, ctx.actor, "artist.update", "artist", a.id, a.name);
    return a;
  }, WRITE);
  router.delete("/api/artists/:id", (ctx) => {
    const a = artists.deleteArtist(db, ctx.params.id);
    orphanChanges(db, "artist", a.id, ctx.user);
    audit(db, ctx.actor, "artist.delete", "artist", a.id, a.name);
    return { ok: true };
  }, DELETE);
  router.post("/api/artists/:id/merge", async (ctx) => {
    const body = await readJson(ctx.req, 16 * 1024);
    const targetId = Number(body.targetId);
    if (!Number.isInteger(targetId)) throw badRequest("Choisissez la fiche à conserver.");
    const { source, target } = artists.mergeArtists(db, ctx.params.id, targetId, ctx.user);
    orphanChanges(db, "artist", source.id, ctx.user);
    audit(db, ctx.actor, "artist.merge", "artist", target.id, `« ${source.name} » fusionné dans « ${target.name} »`);
    return target;
  }, DELETE);

  /* ---------- Lieux ---------- */
  router.get("/api/venues", (ctx) => venues.listVenues(db, { q: ctx.query.get("q") || "", archived: ctx.query.get("archived") ?? "0", sort: ctx.query.get("sort") || "name" }), READ);
  router.post("/api/venues", async (ctx) => {
    const v = venues.createVenue(db, await readJson(ctx.req), ctx.user);
    audit(db, ctx.actor, "venue.create", "venue", v.id, v.name);
    return v;
  }, { ...WRITE, status: 201 });
  router.get("/api/venues/:id", (ctx) => venues.getVenue(db, ctx.params.id), READ);
  router.put("/api/venues/:id", async (ctx) => {
    const body = await readJson(ctx.req);
    const v = saveMerged(db, "venue", ctx.params.id, body, (input) => venues.updateVenue(db, ctx.params.id, input, ctx.user));
    // Les soirées de ce lieu changent aussi (adresse, plan) : elles sont à republier.
    db.run("UPDATE events SET updated_at = ? WHERE venue_id = ?", new Date().toISOString(), v.id);
    audit(db, ctx.actor, "venue.update", "venue", v.id, v.name);
    return v;
  }, WRITE);
  router.delete("/api/venues/:id", (ctx) => {
    const v = venues.deleteVenue(db, ctx.params.id);
    orphanChanges(db, "venue", v.id, ctx.user);
    audit(db, ctx.actor, "venue.delete", "venue", v.id, v.name);
    return { ok: true };
  }, DELETE);

  /* ---------- FAQ ---------- */
  router.get("/api/faq", () => faq.listFaq(db), READ);
  router.post("/api/faq", async (ctx) => {
    const item = faq.createFaq(db, await readJson(ctx.req), ctx.user);
    audit(db, ctx.actor, "faq.create", "faq", item.id, item.question);
    return item;
  }, { ...WRITE, status: 201 });
  router.put("/api/faq/:id", async (ctx) => {
    const body = await readJson(ctx.req);
    const item = saveMerged(db, "faq", ctx.params.id, body, (input) => faq.updateFaq(db, ctx.params.id, input, ctx.user));
    audit(db, ctx.actor, "faq.update", "faq", item.id, item.question);
    return item;
  }, WRITE);
  router.delete("/api/faq/:id", (ctx) => {
    const item = faq.deleteFaq(db, ctx.params.id);
    orphanChanges(db, "faq", item.id, ctx.user);
    audit(db, ctx.actor, "faq.delete", "faq", item.id, item.question);
    return { ok: true };
  }, DELETE);
  router.post("/api/faq/reorder", async (ctx) => {
    faq.reorder(db, "faq_items", (await readJson(ctx.req)).ids || []);
    audit(db, ctx.actor, "faq.reorder", "faq", null, "Ordre de la FAQ modifié");
    return faq.listFaq(db);
  }, WRITE);

  /* ---------- Équipe ---------- */
  router.get("/api/team", () => team.listTeam(db), READ);
  router.post("/api/team", async (ctx) => {
    const m = team.createMember(db, await readJson(ctx.req), ctx.user);
    audit(db, ctx.actor, "team.create", "team", m.id, m.name);
    return m;
  }, { ...WRITE, status: 201 });
  router.get("/api/team/:id", (ctx) => team.getMember(db, ctx.params.id), READ);
  router.put("/api/team/:id", async (ctx) => {
    const body = await readJson(ctx.req);
    const m = saveMerged(db, "team", ctx.params.id, body, (input) => team.updateMember(db, ctx.params.id, input, ctx.user));
    audit(db, ctx.actor, "team.update", "team", m.id, m.name);
    return m;
  }, WRITE);
  router.delete("/api/team/:id", (ctx) => {
    const m = team.deleteMember(db, ctx.params.id);
    orphanChanges(db, "team", m.id, ctx.user);
    audit(db, ctx.actor, "team.delete", "team", m.id, m.name);
    return { ok: true };
  }, DELETE);
  router.post("/api/team/reorder", async (ctx) => {
    faq.reorder(db, "team_members", (await readJson(ctx.req)).ids || []);
    audit(db, ctx.actor, "team.reorder", "team", null, "Ordre de l'équipe modifié");
    return team.listTeam(db);
  }, WRITE);

  /* ---------- Galerie ---------- */
  router.get("/api/albums", () => gallery.listAlbums(db), READ);
  router.post("/api/albums", async (ctx) => {
    const a = gallery.createAlbum(db, await readJson(ctx.req));
    audit(db, ctx.actor, "album.create", "album", a.id, a.title);
    return a;
  }, { ...WRITE, status: 201 });
  router.get("/api/albums/:id", (ctx) => gallery.getAlbum(db, ctx.params.id), READ);
  router.put("/api/albums/:id", async (ctx) => {
    const a = gallery.updateAlbum(db, ctx.params.id, await readJson(ctx.req));
    audit(db, ctx.actor, "album.update", "album", a.id, a.title);
    return a;
  }, WRITE);
  router.put("/api/albums/:id/photos", async (ctx) => {
    const a = gallery.setAlbumPhotos(db, ctx.params.id, (await readJson(ctx.req)).mediaIds);
    audit(db, ctx.actor, "album.photos", "album", a.id, `${a.title} : ${a.photos.length} photo(s)`);
    return a;
  }, WRITE);
  router.delete("/api/albums/:id", (ctx) => {
    const a = gallery.deleteAlbum(db, ctx.params.id);
    audit(db, ctx.actor, "album.delete", "album", a.id, a.title);
    return { ok: true };
  }, DELETE);

  /* ---------- Traductions ---------- */
  router.get("/api/translations", (ctx) => translations.listTranslations(db, { missing: ctx.query.get("missing") || "", q: ctx.query.get("q") || "" }), READ);
  router.put("/api/translations", async (ctx) => {
    const body = await readJson(ctx.req, 64 * 1024);
    const text = translations.setTranslation(db, body, ctx.user);
    audit(db, ctx.actor, "translation.update", "translation", null, `${body.lang} : ${String(body.source).slice(0, 80)}`);
    return { text };
  }, WRITE);
}
