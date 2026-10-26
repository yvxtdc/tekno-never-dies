/**
 * Tâches de fond (toutes les minutes) :
 *  - programmations arrivées à échéance (services/schedule.mjs) : appliquées dans l'ordre prévu, puis
 *    mise en ligne automatique tant que des programmations appliquées ne sont pas en ligne (nouvel
 *    essai espacé après un échec : 5, 10, 20, 40 puis 60 minutes) ;
 *  - sauvegarde automatique de la base (CMS_BACKUP_EVERY_HOURS) ;
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

const RETRY_MINUTES = [5, 10, 20, 40, 60];

export function startScheduler({ config, db, publisher, log }) {
  let busy = false;
  let failures = 0;
  let retryAt = 0;
  const tick = async () => {
    if (busy) return;
    busy = true;
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
      if (config.backupEveryHours > 0) {
        const last = lastBackupAt(config);
        if (!last || Date.now() - Date.parse(last) > config.backupEveryHours * 3600e3) {
          const b = await createBackup(config, db, "auto");
          log.info(`Sauvegarde automatique : ${b.name}`);
        }
      }
      purgeExpiredSessions(db);
      purgeLoginAttempts(db);
      purgePreviewTokens(db);
    } catch (error) {
      log.error("Planificateur : erreur", error);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, 60e3);
  timer.unref();
  const first = setTimeout(tick, 2000);
  first.unref();
  return { stop: () => { clearInterval(timer); clearTimeout(first); }, tick };
}
