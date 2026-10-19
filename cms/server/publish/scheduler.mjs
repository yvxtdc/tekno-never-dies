/**
 * Tâches de fond (toutes les minutes) :
 *  - publication des soirées programmées arrivées à échéance, puis mise en ligne automatique ;
 *  - sauvegarde automatique de la base (CMS_BACKUP_EVERY_HOURS) ;
 *  - purge des sessions expirées, anciennes tentatives de connexion et liens d'aperçu expirés.
 * Fiabilité : la vérification se fait aussi au démarrage, donc une échéance passée pendant un arrêt
 * du serveur est rattrapée dès le redémarrage.
 */
import { publishDue } from "../services/events.mjs";
import { audit } from "../services/audit.mjs";
import { purgeExpiredSessions } from "../auth/sessions.mjs";
import { purgeLoginAttempts } from "../auth/rate-limit.mjs";
import { purgePreviewTokens } from "../preview/preview.mjs";
import { createBackup, lastBackupAt } from "../services/backup.mjs";

export function startScheduler({ config, db, publisher, log }) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const due = publishDue(db);
      for (const ev of due) audit(db, null, "event.published.scheduled", "event", ev.id, `Mise en ligne programmée : ${ev.title}`);
      if (due.length) {
        log.info(`Planificateur : ${due.length} soirée(s) programmée(s) publiée(s).`);
        if (config.autoPublishScheduled) {
          const result = await publisher.publish({ trigger: "schedule" }).catch((error) => ({ status: "failed", summary: error.message }));
          log.info(`Mise en ligne programmée : ${result.status} — ${result.summary}`);
        }
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
  setTimeout(tick, 2000).unref();
  return { stop: () => clearInterval(timer), tick };
}
