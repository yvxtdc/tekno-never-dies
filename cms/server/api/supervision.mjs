/**
 * Supervision et préparation : santé du CMS, suivi des déploiements, vérification avant publication,
 * suivi des soirées (checklists), statistiques GoatCounter.
 */
import { readJson } from "../http/body.mjs";
import { HttpError } from "../http/errors.mjs";
import { audit } from "../services/audit.mjs";
import { healthReport } from "../services/health.mjs";
import { checkIntegrity } from "../publish/scheduler.mjs";
import { checkDeployments, deploymentView } from "../publish/deploy-tracker.mjs";
import { verifyBackupRestore } from "../services/backup.mjs";
import { prepublicationReport } from "../services/event-checklist.mjs";
import { eventLifecycle, lifecycleOverview, setTask } from "../services/lifecycle.mjs";
import { getEvent } from "../services/events.mjs";
import { getStats, getAudience, getPageRefs } from "../services/stats.mjs";
import { SITE } from "../../../js/data/site.js";

export function registerSupervisionRoutes(router, { config, db, publisher }) {
  /* ---------- Santé ---------- */
  // Éditeurs : programmations et mise en ligne ; administrateurs : aussi serveur, base et sauvegardes.
  router.get("/api/health", (ctx) => healthReport(db, config, { full: ctx.user.role === "admin", publisher, siteUrl: SITE.url }), { perm: "content.read" });
  router.post("/api/health/integrity", (ctx) => {
    const result = checkIntegrity(db);
    audit(db, ctx.actor, "health.integrity", null, null, result.ok ? "Contrôle d'intégrité : OK" : `Contrôle d'intégrité : ${result.detail}`);
    return result;
  }, { perm: "backups.manage" });
  router.post("/api/health/restore-test", (ctx) => {
    const result = verifyBackupRestore(config, db);
    audit(db, ctx.actor, "backup.restore-test", "backup", null, `${result.ok ? "Réussi" : "Échec"} : ${result.backup || "aucune sauvegarde"}`);
    return result;
  }, { perm: "backups.manage" });

  /* ---------- Déploiements (même source que Mise en ligne et Santé) ---------- */
  router.get("/api/deployments", () => ({
    items: db.all("SELECT * FROM publications WHERE status = 'success' ORDER BY id DESC LIMIT 15").map((p) => deploymentView(p, { siteUrl: SITE.url })),
    tracking: config.deployTracking
  }), { perm: "content.read" });
  let lastForced = 0;
  router.post("/api/deployments/check", async () => {
    // Pas plus d'une vérification forcée toutes les 15 s (limite d'appels de l'API GitHub sans jeton).
    if (Date.now() - lastForced < 15e3) throw new HttpError(429, "Vérification déjà demandée il y a quelques secondes : patientez.");
    lastForced = Date.now();
    const result = await checkDeployments(db, config, { force: true });
    return { ...result, items: db.all("SELECT * FROM publications WHERE status = 'success' ORDER BY id DESC LIMIT 15").map((p) => deploymentView(p, { siteUrl: SITE.url })) };
  }, { perm: "site.publish" });

  /* ---------- Vérification avant publication et suivi des soirées ---------- */
  router.get("/api/events/:id/check", (ctx) => prepublicationReport(db, config, ctx.params.id), { perm: "content.read" });
  router.get("/api/events/:id/lifecycle", (ctx) => eventLifecycle(db, config, ctx.params.id), { perm: "content.read" });
  router.put("/api/events/:id/tasks/:task", async (ctx) => {
    const body = await readJson(ctx.req, 4096);
    const ev = getEvent(db, ctx.params.id, { withChecks: false });
    setTask(db, ev.id, ctx.params.task, body.state ?? null, ctx.user, body.note || "");
    audit(db, ctx.actor, "event.task", "event", ev.id, `${ev.title} : « ${ctx.params.task} » ${body.state === "done" ? "fait" : body.state === "skipped" ? "non concerné" : "à refaire"}`);
    return eventLifecycle(db, config, ev.id);
  }, { perm: "content.write" });
  router.get("/api/lifecycle", (ctx) => lifecycleOverview(db, config, { filter: ctx.query.get("filter") || "" }), { perm: "content.read" });

  /* ---------- Statistiques (GoatCounter, lecture ; jeton côté serveur uniquement) ---------- */
  const statsQuery = (ctx) => ({ period: ctx.query.get("period") || "30", start: ctx.query.get("start"), end: ctx.query.get("end") });
  router.get("/api/stats", (ctx) => getStats(db, config, statsQuery(ctx)), { perm: "content.read" });
  router.get("/api/stats/audience", (ctx) => getAudience(config, statsQuery(ctx)), { perm: "content.read" });
  router.get("/api/stats/page-refs", (ctx) => getPageRefs(config, { ...statsQuery(ctx), pathId: ctx.query.get("path") }), { perm: "content.read" });
}
