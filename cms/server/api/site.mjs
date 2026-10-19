/** Tableau de bord, mises en ligne, sauvegardes, métadonnées de l'interface. */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT } from "../config.mjs";
import { readJson } from "../http/body.mjs";
import { notFound } from "../http/errors.mjs";
import { audit } from "../services/audit.mjs";
import { listPublications } from "../publish/publisher.mjs";
import { createBackup, listBackups, backupFile, lastBackupAt } from "../services/backup.mjs";
import { STATUSES } from "../services/events.mjs";
import { ROLES } from "../auth/permissions.mjs";
import { FAQ_CATEGORIES } from "../services/faq.mjs";
import { ACCEPTED_EXTENSIONS } from "../services/media.mjs";
import { parisToday } from "../services/timeutil.mjs";
import { eventChecks, serializeEvent } from "../services/events.mjs";
import { listTranslations } from "../services/translations.mjs";

// Adresse publique du site (js/data/site.js), pour afficher les adresses des fiches dans l'interface.
const { SITE } = await import(pathToFileURL(path.join(REPO_ROOT, "js/data/site.js")).href);

export function registerSiteRoutes(router, { config, db, publisher }) {
  router.get("/api/meta", () => ({
    siteUrl: SITE.url,
    statuses: STATUSES,
    roles: ROLES,
    faqCategories: FAQ_CATEGORIES,
    acceptedImages: ACCEPTED_EXTENSIONS,
    maxUploadMb: Math.round(config.maxUploadBytes / 1048576),
    publishMode: config.publishMode,
    timezone: config.timezone
  }), { perm: "content.read" });

  router.get("/api/dashboard", (ctx) => {
    const today = parisToday();
    const count = (sql, ...p) => db.get(sql, ...p).n;
    const upcoming = db
      .all("SELECT * FROM events WHERE date >= ? AND status IN ('draft', 'scheduled', 'published', 'cancelled') ORDER BY date LIMIT 6", today)
      .map((row) => {
        const ev = serializeEvent(db, row, { withChecks: false });
        const checks = eventChecks(db, ev);
        return {
          id: ev.id, title: ev.title, date: ev.date, status: ev.status, statusLabel: ev.statusLabel, publishAt: ev.publishAt,
          venue: ev.venue?.name || "", lineupCount: ev.lineup.length, thumbUrl: ev.flyer?.thumbUrl || ev.cover?.thumbUrl || null,
          warnings: checks.warnings.length, errors: checks.errors.length
        };
      });
    const pending = publisher.pending();
    const lastPublication = db.get("SELECT p.*, u.name AS user_name FROM publications p LEFT JOIN users u ON u.id = p.user_id ORDER BY p.id DESC LIMIT 1") || null;
    const translationsMissing = listTranslations(db, { missing: "any" }).length;
    return {
      counts: {
        events: count("SELECT COUNT(*) AS n FROM events WHERE status <> 'archived'"),
        upcoming: count("SELECT COUNT(*) AS n FROM events WHERE status IN ('published', 'cancelled') AND date >= ?", today),
        drafts: count("SELECT COUNT(*) AS n FROM events WHERE status = 'draft'"),
        scheduled: count("SELECT COUNT(*) AS n FROM events WHERE status = 'scheduled'"),
        artists: count("SELECT COUNT(*) AS n FROM artists WHERE archived = 0"),
        venues: count("SELECT COUNT(*) AS n FROM venues WHERE archived = 0"),
        media: count("SELECT COUNT(*) AS n FROM media"),
        mediaNoAlt: count("SELECT COUNT(*) AS n FROM media m WHERE alt = '' AND storage = 'upload'"),
        artistsNoPhoto: count("SELECT COUNT(*) AS n FROM artists WHERE photo_media_id IS NULL AND archived = 0"),
        translationsMissing
      },
      upcoming,
      pending,
      drift: publisher.drift(),
      lastPublication,
      publishing: Boolean(publisher.running),
      lastBackupAt: ctx.user.role === "admin" ? lastBackupAt(config) : undefined,
      activity: db.all(
        "SELECT a.action, a.summary, a.created_at, a.entity_type, a.entity_id, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.action NOT LIKE 'auth.%' ORDER BY a.id DESC LIMIT 12"
      )
    };
  }, { perm: "content.read" });

  /* ---------- Mise en ligne ---------- */
  router.get("/api/publications", () => ({ items: listPublications(db), running: Boolean(publisher.running), mode: config.publishMode }), { perm: "content.read" });
  router.get("/api/publications/pending", () => ({ ...publisher.pending(), drift: publisher.drift() }), { perm: "content.read" });
  router.get("/api/publications/:id", (ctx) => {
    const row = db.get("SELECT p.*, u.name AS user_name FROM publications p LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ?", ctx.params.id);
    if (!row) throw notFound("Mise en ligne introuvable.");
    return row;
  }, { perm: "content.read" });
  router.post("/api/publications", async (ctx) => {
    const body = await readJson(ctx.req, 4096);
    // Forcer (remplacer des fichiers modifiés hors du CMS) : administrateurs uniquement.
    const force = body.force === true && ctx.user.role === "admin";
    const result = await publisher.publish({ trigger: "manual", user: ctx.user, force, ip: ctx.ip });
    return result;
  }, { perm: "site.publish" });

  /* ---------- Sauvegardes ---------- */
  router.get("/api/backups", () => ({ items: listBackups(config), keep: config.backupKeep, everyHours: config.backupEveryHours }), { perm: "backups.manage" });
  router.post("/api/backups", async (ctx) => {
    const b = await createBackup(config, db, "manuelle");
    audit(db, ctx.actor, "backup.create", "backup", null, b.name);
    return b;
  }, { perm: "backups.manage", status: 201 });
  router.get("/api/backups/:name", (ctx) => {
    const file = backupFile(config, ctx.params.name);
    if (!file) throw notFound("Sauvegarde introuvable.");
    audit(db, ctx.actor, "backup.download", "backup", null, ctx.params.name);
    const stat = fs.statSync(file);
    ctx.res.writeHead(200, {
      "Content-Type": "application/vnd.sqlite3",
      "Content-Length": stat.size,
      "Content-Disposition": `attachment; filename="${ctx.params.name}"`,
      "Cache-Control": "no-store"
    });
    fs.createReadStream(file).pipe(ctx.res);
  }, { perm: "backups.manage" });
}
