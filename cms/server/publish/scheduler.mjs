/**
 * Tâches de fond (toutes les minutes) :
 *  - programmations arrivées à échéance (services/schedule.mjs) : appliquées dans l'ordre prévu, puis
 *    mise en ligne automatique tant que des programmations appliquées ne sont pas en ligne (nouvel
 *    essai espacé après un échec : 5, 10, 20, 40 puis 60 minutes) ;
 *  - suivi du déploiement GitHub Pages des mises en ligne envoyées (publish/deploy-tracker.mjs) ;
 *  - sauvegarde automatique de la base (CMS_BACKUP_EVERY_HOURS) ; contrôle d'intégrité léger de la base
 *    (PRAGMA quick_check, lecture seule) toutes les 6 heures, pour le tableau de santé ;
 *  - purge des sessions expirées, anciennes tentatives de connexion et liens d'aperçu expirés.
 * Fiabilité : la vérification se fait aussi au démarrage, donc une échéance passée pendant un arrêt
 * du serveur est rattrapée dès le redémarrage ; les programmations et leur état sont en base.
 */
import { runDue, appliedIds } from "../services/schedule.mjs";
import { audit } from "../services/audit.mjs";
import { purgeExpiredSessions } from "../auth/sessions.mjs";
import { purgeLoginAttempts } from "../auth/rate-limit.mjs";
import { purgePreviewTokens } from "../preview/preview.mjs";
import { createBackup, lastBackupAt } from "../services/backup.mjs";
import { checkDeployments } from "./deploy-tracker.mjs";
import { runtime, cleanMessage, recordError } from "../runtime.mjs";

const RETRY_MINUTES = [5, 10, 20, 40, 60];

export function startScheduler({ config, db, publisher, log }) {
  let busy = false;
  let failures = 0;
  let retryAt = 0;
  Object.assign(runtime.scheduler, { enabled: true, startedAt: new Date().toISOString() });
  const tick = async () => {
    if (busy) return;
    busy = true;
    // Battement : le tableau de santé signale un planificateur qui ne tourne plus.
    runtime.scheduler.lastTickAt = new Date().toISOString();
    try {
      const results = runDue(db);
      for (const r of results) {
        if (r.waiting) continue;
        log[r.status === "applied" ? "info" : "warn"](`Programmation n° ${r.id} : ${r.status} — ${r.message}`);
        audit(db, null, `schedule.${r.status}`, "schedule", r.id, `Programmation n° ${r.id} : ${r.message}`);
      }
      if (config.autoPublishScheduled && appliedIds(db).length && !publisher.running && Date.now() >= retryAt) {
        const result = await publisher.publish({ trigger: "schedule" }).catch((error) => ({ status: "failed", summary: error.message }));
        log.info(`Mise en ligne programmée : ${result.status} — ${result.summary}`);
        if (result.status === "success") failures = 0;
        else retryAt = Date.now() + RETRY_MINUTES[Math.min(failures++, RETRY_MINUTES.length - 1)] * 60e3;
      }
      // Une indisponibilité de GitHub n'empêche pas le reste du planificateur.
      await checkDeployments(db, config).catch((error) => recordError("Suivi des déploiements", error));
      if (config.backupEveryHours > 0) {
        const last = lastBackupAt(config);
        if (!last || Date.now() - Date.parse(last) > config.backupEveryHours * 3600e3) {
          try {
            const b = await createBackup(config, db, "auto");
            runtime.scheduler.lastBackupError = null;
            log.info(`Sauvegarde automatique : ${b.name}`);
          } catch (error) {
            runtime.scheduler.lastBackupError = { at: new Date().toISOString(), message: cleanMessage(error) };
            log.error("Sauvegarde automatique : échec", error);
          }
        }
      }
      if (!runtime.integrity || Date.now() - Date.parse(runtime.integrity.at) > 6 * 3600e3) checkIntegrity(db);
      purgeExpiredSessions(db);
      purgeLoginAttempts(db);
      purgePreviewTokens(db);
      runtime.scheduler.lastTickError = null;
    } catch (error) {
      runtime.scheduler.lastTickError = { at: new Date().toISOString(), message: cleanMessage(error) };
      log.error("Planificateur : erreur", error);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, 60e3);
  timer.unref();
  const first = setTimeout(tick, 2000);
  first.unref();
  return { stop: () => { clearInterval(timer); clearTimeout(first); runtime.scheduler.enabled = false; }, tick };
}

/** Contrôle d'intégrité léger (lecture seule, aucune réparation) ; résultat gardé pour le tableau de santé. */
export function checkIntegrity(db) {
  try {
    const rows = db.all("PRAGMA quick_check(5)").map((r) => Object.values(r)[0]);
    runtime.integrity = { at: new Date().toISOString(), ok: rows.length === 1 && rows[0] === "ok", detail: rows.slice(0, 5).join(" ; ") };
  } catch (error) {
    runtime.integrity = { at: new Date().toISOString(), ok: false, detail: cleanMessage(error) };
  }
  return runtime.integrity;
}
