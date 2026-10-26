/** Routes des programmations (modifications ciblées à une date) et de l'historique des versions. */
import { readJson } from "../http/body.mjs";
import { notFound, badRequest } from "../http/errors.mjs";
import { pageParams } from "../http/query.mjs";
import { audit } from "../services/audit.mjs";
import * as schedule from "../services/schedule.mjs";
import { TARGETS } from "../services/schedule-targets.mjs";

const READ = { perm: "content.read" };
// Programmer, c'est publier en différé : même droit que la publication d'une soirée.
const PUBLISH = { perm: "content.publish" };

const type = (value) => {
  if (!TARGETS[value]) throw notFound("Type de contenu non programmable.");
  return value;
};

export function registerScheduleRoutes(router, { db }) {
  router.get("/api/schedule", (ctx) => {
    const q = ctx.query;
    return schedule.listChanges(db, { status: q.get("status") || "", type: q.get("type") || "", entityId: q.get("entityId") || null, period: q.get("period") || "", ...pageParams(q, 50, 200) });
  }, READ);
  router.get("/api/schedule/:id", (ctx) => schedule.getChange(db, ctx.params.id), READ);

  /** Programmer une modification préparée dans un formulaire (preview: true : seulement la calculer). */
  router.post("/api/schedule", async (ctx) => {
    const body = await readJson(ctx.req, 512 * 1024);
    const result = schedule.createChange(db, {
      type: type(String(body.entityType || "")), id: Number(body.entityId), input: body.input || {}, runAt: body.runAt,
      basis: body.basis || {}, replaceId: body.replaceId ? Number(body.replaceId) : null, preview: body.preview === true, user: ctx.user
    });
    if (!result.preview) audit(db, ctx.actor, body.replaceId ? "schedule.edit" : "schedule.create", "schedule", result.change.id, `${result.change.entityName} : ${result.change.summary} (${result.change.runAt})`);
    return result;
  }, PUBLISH);

  /** Programmer un changement de statut d'une soirée (mise en ligne, annulation, retrait, archivage). */
  router.post("/api/schedule/status", async (ctx) => {
    const body = await readJson(ctx.req, 16 * 1024);
    if (body.entityType !== "event") throw badRequest("Seul le statut d'une soirée se programme ainsi.");
    const result = schedule.scheduleStatus(db, { id: Number(body.entityId), action: String(body.action || ""), runAt: body.runAt, user: ctx.user });
    audit(db, ctx.actor, "schedule.create", "schedule", result.change.id, `${result.change.entityName} : ${result.change.summary} (${result.change.runAt})`);
    return result;
  }, PUBLISH);

  router.put("/api/schedule/:id", async (ctx) => {
    const body = await readJson(ctx.req, 16 * 1024);
    const result = schedule.reschedule(db, ctx.params.id, { runAt: body.runAt, version: body.version, user: ctx.user });
    audit(db, ctx.actor, "schedule.reschedule", "schedule", ctx.params.id, `${result.change.entityName} : ${result.change.summary} (${result.change.runAt})`);
    return result;
  }, PUBLISH);

  router.post("/api/schedule/:id/cancel", async (ctx) => {
    const body = await readJson(ctx.req, 4096);
    const result = schedule.cancelChange(db, ctx.params.id, { user: ctx.user, cascade: body.cascade === true, reason: `Annulée par ${ctx.user.name}.` });
    audit(db, ctx.actor, "schedule.cancel", "schedule", ctx.params.id, `${result.change.entityName} : ${result.change.summary}`);
    return result;
  }, PUBLISH);

  /** action : force (imposer les valeurs programmées), retry (réessayer), run (exécuter maintenant). */
  router.post("/api/schedule/:id/resolve", async (ctx) => {
    const body = await readJson(ctx.req, 4096);
    const result = schedule.resolveChange(db, ctx.params.id, { action: String(body.action || ""), user: ctx.user });
    audit(db, ctx.actor, `schedule.${body.action}`, "schedule", ctx.params.id, `${result.change.entityName} : ${result.result.message}`);
    return result;
  }, PUBLISH);

  /** Fiche telle qu'elle sera à une date (heure de Paris), pour préparer une modification qui en suit d'autres. */
  router.get("/api/schedule/predict/:entityType/:entityId", (ctx) =>
    schedule.predictEntity(db, type(ctx.params.entityType), ctx.params.entityId, ctx.query.get("at") || "", { excludeId: Number(ctx.query.get("exclude")) || null }), READ);

  /* ---------- Historique des versions ---------- */
  router.get("/api/history/:entityType/:entityId", (ctx) => schedule.entityHistory(db, type(ctx.params.entityType), ctx.params.entityId), READ);
  router.get("/api/history/:entityType/:entityId/compare", (ctx) => {
    const a = Number(ctx.query.get("a"));
    const b = ctx.query.get("b") === "current" ? "current" : Number(ctx.query.get("b"));
    if (!a || !b) throw badRequest("Choisissez deux versions.");
    return schedule.compareRevisions(db, type(ctx.params.entityType), ctx.params.entityId, a, b);
  }, READ);
  router.post("/api/history/:entityType/:entityId/restore/:revisionId", (ctx) => {
    const entityType = type(ctx.params.entityType);
    const entity = schedule.restoreVersion(db, entityType, ctx.params.entityId, ctx.params.revisionId, ctx.user);
    audit(db, ctx.actor, `${entityType}.restore`, entityType, ctx.params.entityId, `Version restaurée (historique n° ${ctx.params.revisionId})`);
    return entity;
  }, { perm: "content.write" });
}
