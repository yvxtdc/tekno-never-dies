/** Routes des contenus : soirées, artistes, lieux, historique. */
import { readJson } from "../http/body.mjs";
import { notFound, badRequest } from "../http/errors.mjs";
import { pageParams } from "../http/query.mjs";
import { audit, listRevisions, getRevision } from "../services/audit.mjs";
import * as events from "../services/events.mjs";
import * as artists from "../services/artists.mjs";
import * as venues from "../services/venues.mjs";

const READ = { perm: "content.read" };
const WRITE = { perm: "content.write" };
const DELETE = { perm: "content.delete" };

export function registerContentRoutes(router, { db }) {
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
    const ev = events.updateEvent(db, ctx.params.id, await readJson(ctx.req), ctx.user);
    audit(db, ctx.actor, "event.update", "event", ev.id, ev.title);
    return ev;
  }, WRITE);
  router.delete("/api/events/:id", (ctx) => {
    const row = events.deleteEvent(db, ctx.params.id);
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
    const { event, transition } = events.changeStatus(db, ctx.params.id, String(body.action || ""), { publishAt: body.publishAt }, ctx.user);
    audit(db, ctx.actor, `event.${body.action}`, "event", event.id, `${event.title} : ${transition.label}${event.publishAt ? ` (${event.publishAt})` : ""}`);
    return event;
  }, { perm: "content.publish" });
  router.post("/api/events/:id/revisions/:revisionId/restore", (ctx) => {
    const rev = getRevision(db, "event", ctx.params.id, ctx.params.revisionId);
    if (!rev) throw notFound("Version introuvable.");
    const ev = events.restoreRevision(db, ctx.params.id, rev.data, ctx.user);
    audit(db, ctx.actor, "event.restore", "event", ev.id, `${ev.title} : version ${rev.version} restaurée`);
    return ev;
  }, WRITE);

  /* ---------- Historique des versions (toutes fiches) ---------- */
  const TYPES = new Set(["event", "artist", "venue"]);
  router.get("/api/revisions/:type/:id", (ctx) => {
    if (!TYPES.has(ctx.params.type)) throw notFound();
    return listRevisions(db, ctx.params.type, ctx.params.id);
  }, READ);
  router.get("/api/revisions/:type/:id/:revisionId", (ctx) => {
    if (!TYPES.has(ctx.params.type)) throw notFound();
    const rev = getRevision(db, ctx.params.type, ctx.params.id, ctx.params.revisionId);
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
    const a = artists.updateArtist(db, ctx.params.id, await readJson(ctx.req), ctx.user);
    audit(db, ctx.actor, "artist.update", "artist", a.id, a.name);
    return a;
  }, WRITE);
  router.delete("/api/artists/:id", (ctx) => {
    const a = artists.deleteArtist(db, ctx.params.id);
    audit(db, ctx.actor, "artist.delete", "artist", a.id, a.name);
    return { ok: true };
  }, DELETE);
  router.post("/api/artists/:id/merge", async (ctx) => {
    const body = await readJson(ctx.req, 16 * 1024);
    const targetId = Number(body.targetId);
    if (!Number.isInteger(targetId)) throw badRequest("Choisissez la fiche à conserver.");
    const { source, target } = artists.mergeArtists(db, ctx.params.id, targetId, ctx.user);
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
    const v = venues.updateVenue(db, ctx.params.id, await readJson(ctx.req), ctx.user);
    // Les soirées de ce lieu changent aussi (adresse, plan) : elles sont à republier.
    db.run("UPDATE events SET updated_at = ? WHERE venue_id = ?", new Date().toISOString(), v.id);
    audit(db, ctx.actor, "venue.update", "venue", v.id, v.name);
    return v;
  }, WRITE);
  router.delete("/api/venues/:id", (ctx) => {
    const v = venues.deleteVenue(db, ctx.params.id);
    audit(db, ctx.actor, "venue.delete", "venue", v.id, v.name);
    return { ok: true };
  }, DELETE);
}
