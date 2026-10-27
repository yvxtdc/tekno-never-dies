/**
 * Tableau de santé du CMS : serveur et base, planificateur et programmations, mise en ligne et
 * déploiement, sauvegardes. Chaque indicateur : ok, info (normal, en cours), warning, error (intervention)
 * ou unknown (non vérifiable, non configuré) : une information impossible à vérifier n'est jamais verte.
 *
 * Calcul rapide, sans appel externe ni opération lourde : l'intégrité de la base est contrôlée par le
 * planificateur (toutes les 6 h) ou à la demande, le déploiement par le suivi des déploiements.
 * Visibilité : les éditeurs voient le planificateur et la mise en ligne ; serveur, base, sauvegardes et
 * test de restauration de la sauvegarde externe sont réservés aux administrateurs. Aucun chemin,
 * identifiant ou secret n'est renvoyé.
 */
import fs from "node:fs";
import { runtime } from "../runtime.mjs";
import { listMigrations } from "../db/migrate.mjs";
import { listBackups, externalBackupStatus } from "./backup.mjs";
import { readRestoreReport } from "./restore-test.mjs";
import { deploymentView } from "../publish/deploy-tracker.mjs";
import { CHANGE_STATUSES } from "./schedule.mjs";
import { fromJson } from "../db/index.mjs";

const ORDER = { error: 4, warning: 3, unknown: 2, info: 1, ok: 0 };
const worst = (levels) => levels.reduce((a, b) => (ORDER[b] > ORDER[a] ? b : a), "ok");
const hours = (iso) => (Date.now() - Date.parse(iso)) / 3600e3;
const ago = (iso) => {
  const h = hours(iso);
  return h < 1 ? `il y a ${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `il y a ${Math.round(h)} h` : `il y a ${Math.round(h / 24)} j`;
};
const STAGES = { preparation: "préparation (Git)", export: "export des contenus", generation: "génération des pages", validation: "validation du site", commit: "commit", push: "envoi sur GitHub" };

function serverSection(db, config) {
  const items = [];
  items.push({ id: "process", label: "Serveur du CMS", level: "ok", value: `Démarré ${ago(runtime.startedAt)}`, message: "" });
  let dbOk = true;
  try {
    db.get("SELECT 1 AS ok");
  } catch {
    dbOk = false;
  }
  items.push({ id: "database", label: "Base de données", level: dbOk ? "ok" : "error", value: dbOk ? "Disponible" : "Indisponible", message: dbOk ? "" : "La base ne répond pas : consultez le journal du service." });
  const integrity = runtime.integrity;
  items.push(integrity
    ? { id: "integrity", label: "Intégrité de la base", level: integrity.ok ? "ok" : "error", value: integrity.ok ? `Contrôlée ${ago(integrity.at)}` : "Anomalie détectée", message: integrity.ok ? "" : `Contrôle SQLite : ${integrity.detail}. Ne rien réparer à chaud : sauvegardez puis voyez la procédure de restauration (docs/cms/exploitation.md).` }
    : { id: "integrity", label: "Intégrité de la base", level: "unknown", value: "Pas encore contrôlée", message: "Contrôle automatique toutes les 6 heures par le planificateur, ou « Contrôler maintenant »." });
  const applied = db.all("SELECT name FROM schema_migrations").map((r) => r.name);
  const known = listMigrations();
  const pending = known.filter((m) => !applied.includes(m));
  const unknownApplied = applied.filter((m) => !known.includes(m));
  items.push({
    id: "migrations", label: "Migrations de la base", level: pending.length ? "error" : unknownApplied.length ? "warning" : "ok",
    value: pending.length ? `${pending.length} en attente` : `À jour (${applied.length})`,
    message: pending.length ? "Le code attend des migrations non appliquées : redémarrez le service (elles s'appliquent au démarrage)." : unknownApplied.length ? "La base contient des migrations inconnues de ce code (code plus ancien que la base ?)." : ""
  });
  const recent = runtime.errors.filter((e) => hours(e.at) < 24);
  items.push({ id: "errors", label: "Erreurs des dernières 24 h", level: recent.length ? "warning" : "ok", value: recent.length ? `${recent.length} erreur(s)` : "Aucune", message: recent.slice(0, 5).map((e) => `${e.at.slice(11, 16)} UTC · ${e.source} : ${e.message}`).join("\n"), detail: recent.slice(0, 10) });
  try {
    const fsStat = fs.statfsSync(config.dataDir);
    const free = fsStat.bavail * fsStat.bsize;
    const ratio = fsStat.bavail / fsStat.blocks;
    const gb = (free / 1024 ** 3).toFixed(1).replace(".", ",");
    items.push({ id: "disk", label: "Espace disque (données)", level: free < 512 * 1024 ** 2 || ratio < 0.05 ? "error" : free < 2 * 1024 ** 3 || ratio < 0.1 ? "warning" : "ok", value: `${gb} Go libres (${Math.round(ratio * 100)} %)`, message: ratio < 0.1 ? "Libérez de l'espace : sauvegardes anciennes, cache des images (media/cache, recalculable)." : "" });
  } catch {
    items.push({ id: "disk", label: "Espace disque (données)", level: "unknown", value: "Non mesurable", message: "" });
  }
  for (const [id, dir, label] of [["data-dir", config.dataDir, "Dossier des données"], ["media-dir", config.mediaDir, "Médiathèque (originaux)"]]) {
    let level = "ok";
    let value = "Accessible en écriture";
    try {
      fs.accessSync(dir, fs.constants.W_OK);
    } catch {
      // Médiathèque absente : normal tant qu'aucune image n'a été importée.
      level = fs.existsSync(dir) ? "error" : id === "media-dir" ? "info" : "error";
      value = fs.existsSync(dir) ? "Non accessible en écriture" : "Absent";
    }
    items.push({ id, label, level, value, message: level === "ok" ? "" : id === "media-dir" && value === "Absent" ? "Aucune image importée pour l'instant, ou dossier déplacé : vérifiez CMS_DATA_DIR." : "Vérifiez les droits de l'utilisateur du service sur le dossier des données." });
  }
  return { id: "server", title: "Serveur et base de données", items };
}

function schedulerSection(db, config) {
  const items = [];
  const s = runtime.scheduler;
  if (!config.scheduler) items.push({ id: "scheduler", label: "Planificateur", level: "warning", value: "Désactivé", message: "CMS_SCHEDULER=0 : les programmations et les sauvegardes automatiques ne s'exécutent pas." });
  else if (!s.enabled || !s.lastTickAt) items.push({ id: "scheduler", label: "Planificateur", level: "unknown", value: "Pas encore exécuté", message: "Première vérification quelques secondes après le démarrage." });
  else {
    const late = hours(s.lastTickAt) * 60;
    items.push({ id: "scheduler", label: "Planificateur", level: late > 3 ? "error" : s.lastTickError ? "warning" : "ok", value: `Dernière vérification ${ago(s.lastTickAt)}`, message: late > 3 ? "Le planificateur ne tourne plus (aucune vérification depuis plus de 3 minutes) : redémarrez le service et consultez son journal." : s.lastTickError ? `Dernière erreur : ${s.lastTickError.message}` : "" });
  }
  const next = db.get("SELECT run_at, summary, id FROM scheduled_changes WHERE status = 'pending' ORDER BY run_at, id LIMIT 1");
  items.push({ id: "next", label: "Prochaine échéance", level: "info", value: next ? next.run_at : "Aucune", message: next ? `n° ${next.id} · ${next.summary}` : "", link: next ? "/admin/schedule" : null, dateValue: Boolean(next) });
  const lateOps = db.all("SELECT id, run_at, result FROM scheduled_changes WHERE status = 'pending' AND run_at < ?", new Date(Date.now() - 5 * 60e3).toISOString());
  const waiting = lateOps.filter((o) => /^En attente de la programmation/.test(o.result || ""));
  const reallyLate = lateOps.length - waiting.length;
  items.push({ id: "late", label: "Programmations en retard", level: reallyLate ? (lateOps.some((o) => hours(o.run_at) > 1) ? "error" : "warning") : waiting.length ? "info" : "ok", value: reallyLate ? `${reallyLate} en retard` : waiting.length ? `${waiting.length} en attente d'une autre` : "Aucune", message: reallyLate ? "L'échéance est passée sans exécution : le planificateur tourne-t-il ?" : "", link: lateOps.length ? "/admin/schedule" : null });
  const counts = Object.fromEntries(db.all("SELECT status, COUNT(*) AS n FROM scheduled_changes WHERE status IN ('conflict', 'blocked', 'failed') GROUP BY status").map((r) => [r.status, r.n]));
  const attention = (counts.conflict || 0) + (counts.blocked || 0) + (counts.failed || 0);
  items.push({ id: "attention", label: "Programmations à traiter", level: attention ? "error" : "ok", value: attention ? Object.entries(counts).map(([k, n]) => `${n} ${CHANGE_STATUSES[k].toLowerCase()}`).join(", ") : "Aucune", message: attention ? "Une intervention est nécessaire : ouvrez chaque programmation (« Résoudre »)." : "", link: attention ? "/admin/schedule?status=attention" : null });
  const retries = db.get("SELECT COUNT(*) AS n FROM scheduled_changes WHERE status = 'pending' AND attempts > 0").n;
  if (retries) items.push({ id: "retries", label: "Nouvelles tentatives", level: "warning", value: `${retries} en cours`, message: "Erreur inattendue à l'exécution : nouvel essai automatique (3 au plus).", link: "/admin/schedule" });
  const applied = db.get("SELECT COUNT(*) AS n, MIN(applied_at) AS since FROM scheduled_changes WHERE status = 'applied'");
  items.push({ id: "applied", label: "Appliquées, mise en ligne à faire", level: applied.n && hours(applied.since) > 0.5 ? "warning" : applied.n ? "info" : "ok", value: applied.n ? `${applied.n} depuis ${ago(applied.since)}` : "Aucune", message: applied.n && hours(applied.since) > 0.5 ? "La mise en ligne automatique n'a pas abouti : voir la page Mise en ligne." : "", link: applied.n ? "/admin/publish" : null });
  return { id: "scheduler", title: "Programmations", items };
}

function publicationSection(db, config, { publisher, siteUrl }) {
  const items = [];
  const running = db.get("SELECT id, started_at FROM publications WHERE status = 'running' ORDER BY id DESC LIMIT 1");
  if (running && hours(running.started_at) * 60 > 15) items.push({ id: "running", label: "Mise en ligne en cours", level: "error", value: `Depuis ${ago(running.started_at)}`, message: "Une mise en ligne dure anormalement longtemps : consultez son journal ; redémarrer le service l'interrompt proprement.", link: "/admin/publish" });
  else if (running) items.push({ id: "running", label: "Mise en ligne en cours", level: "info", value: `Depuis ${ago(running.started_at)}`, message: "", link: "/admin/publish" });
  const last = db.get("SELECT * FROM publications WHERE status <> 'running' ORDER BY id DESC LIMIT 1");
  if (!last) items.push({ id: "last", label: "Dernière mise en ligne", level: "unknown", value: "Aucune depuis le CMS", message: "" });
  else if (last.status === "failed") {
    items.push({ id: "last", label: "Dernière mise en ligne", level: "error", value: `Échec à l'étape « ${STAGES[last.stage] || "inconnue"} »`, message: last.summary, link: `/admin/publish?publication=${last.id}` });
  } else {
    items.push({ id: "last", label: "Dernière mise en ligne", level: "ok", value: `Réussie ${ago(last.finished_at)}`, message: last.summary, link: `/admin/publish?publication=${last.id}` });
  }
  const lastValidated = db.get("SELECT id, validation FROM publications WHERE validation IS NOT NULL ORDER BY id DESC LIMIT 1");
  if (lastValidated) {
    const v = fromJson(lastValidated.validation, null);
    if (v) items.push({ id: "validation", label: "Validation du site", level: v.ok ? "ok" : "error", value: v.ok ? `Sans erreur${v.warnings.length ? `, ${v.warnings.length} point(s) « à compléter »` : ""}` : `${v.errors.length} erreur(s) bloquante(s)`, message: [...v.errors.slice(0, 5), ...v.warnings.slice(0, 5).map((w) => `À compléter (non bloquant) : ${w}`)].join("\n"), link: `/admin/publish?publication=${lastValidated.id}` });
  }
  const sent = db.get("SELECT * FROM publications WHERE status = 'success' ORDER BY id DESC LIMIT 1");
  if (sent) {
    const d = deploymentView(sent, { siteUrl });
    const level = { ok: "ok", pending: "info", info: "info", warning: "warning", error: "error", unknown: "unknown" }[d.level] || "unknown";
    items.push({ id: "deploy", label: "Déploiement du site public", level, value: d.label, message: [d.message, d.commit ? `Commit ${d.commit.slice(0, 7)}` : ""].filter(Boolean).join(" · "), link: d.runUrl, external: Boolean(d.runUrl) });
  }
  const drift = publisher?.drift?.() || [];
  if (drift.length) items.push({ id: "drift", label: "Fichiers modifiés hors du CMS", level: "error", value: `${drift.length} fichier(s)`, message: `${drift.join(", ")} : la prochaine mise en ligne est bloquée.`, link: "/admin/publish" });
  return { id: "publication", title: "Mise en ligne et déploiement", items };
}

function backupSection(db, config) {
  const items = [];
  const local = listBackups(config).filter((b) => !b.name.includes("-avant-restauration"))[0];
  const every = config.backupEveryHours;
  if (!local) items.push({ id: "local", label: "Sauvegarde locale de la base", level: "error", value: "Aucune", message: "Aucune sauvegarde de la base : « Sauvegarder maintenant » (page Sauvegardes)." });
  else {
    const age = hours(local.createdAt);
    const level = every > 0 && age > every * 3 ? "error" : every > 0 && age > every * 1.5 ? "warning" : every === 0 && age > 72 ? "warning" : "ok";
    items.push({ id: "local", label: "Sauvegarde locale de la base", level, value: `Dernière ${ago(local.createdAt)}`, message: level === "ok" ? "Même disque que la base : protège d'une erreur de manipulation, pas d'une panne du serveur." : `Plus ancienne que prévu (attendue toutes les ${every || "?"} h) : le planificateur tourne-t-il ?` });
  }
  if (every === 0) items.push({ id: "auto", label: "Sauvegardes automatiques", level: "warning", value: "Désactivées", message: "CMS_BACKUP_EVERY_HOURS=0." });
  const failure = runtime.scheduler.lastBackupError;
  if (failure) items.push({ id: "auto-error", label: "Dernière sauvegarde automatique", level: "error", value: `Échec ${ago(failure.at)}`, message: failure.message });
  // Copie externe (cms/deploy/backup-media.sh : disque monté, actuellement le G-RAID de l'hôte, ou machine
  // distante). Deux informations distinctes : l'envoi (commande terminée sans erreur) et la vérification
  // du contenu copié (comparaison par somme de contrôle faite par le script). Seule la seconde, récente,
  // est « normale ».
  const ext = externalBackupStatus(config);
  const age = ext?.finishedAt ? hours(ext.finishedAt) : Infinity;
  const stale = age > config.externalBackupMaxHours;
  const when = ext?.finishedAt ? ago(ext.finishedAt) : "à une date inconnue";
  if (!ext) {
    items.push({ id: "external", label: "Sauvegarde externe : envoi", level: "unknown", value: "Non configurée ou jamais exécutée", message: "Aucun rapport de cms/deploy/backup-media.sh : sans copie sur un autre support, une panne du disque du CMS ferait perdre la base et les images (docs/cms/exploitation.md, § 4)." });
    items.push({ id: "external-verify", label: "Sauvegarde externe : contenu de la copie", level: "unknown", value: "Non vérifié", message: "" });
  } else {
    items.push(ext.commandOk
      ? { id: "external", label: "Sauvegarde externe : envoi", level: stale ? (age > config.externalBackupMaxHours * 2 ? "error" : "warning") : "ok", value: `Terminé ${when}`, message: stale ? `Pas d'envoi réussi depuis plus de ${config.externalBackupMaxHours} h : la tâche planifiée tourne-t-elle ?` : `Commande d'envoi terminée sans erreur${ext.latestBackup ? ` (dernière sauvegarde de la base : ${ext.latestBackup})` : ""}.` }
      : { id: "external", label: "Sauvegarde externe : envoi", level: "error", value: `Échec ${when}`, message: `${ext.step ? `Étape « ${ext.step} » : ` : ""}${ext.message}` });
    if (!ext.commandOk) items.push({ id: "external-verify", label: "Sauvegarde externe : contenu de la copie", level: "unknown", value: "Non vérifié", message: "L'envoi a échoué : rien à vérifier." });
    // Rapport incohérent (vérifié mais avec des différences) ou vérification sans aucun fichier : jamais vert.
    else if (ext.verified === true && ext.differences) items.push({ id: "external-verify", label: "Sauvegarde externe : contenu de la copie", level: "error", value: `${ext.differences} différence(s)`, message: "Rapport incohérent (vérifié, mais avec des différences) : relancez la sauvegarde." });
    else if (ext.verified === true && !ext.verifiedFiles) items.push({ id: "external-verify", label: "Sauvegarde externe : contenu de la copie", level: "warning", value: "Aucun fichier comparé", message: "La vérification n'a comparé aucun fichier : vérifiez que la sauvegarde de la base et les images sont bien dans le dossier des données." });
    else if (ext.verified === true) items.push({ id: "external-verify", label: "Sauvegarde externe : contenu de la copie", level: stale ? "warning" : "ok", value: `Vérifié ${when}`, message: `${ext.verifiedFiles ?? "?"} fichier(s) comparé(s) par somme de contrôle avec la copie externe : identiques.${stale ? " Vérification ancienne." : ""}` });
    else if (ext.verified === false) items.push({ id: "external-verify", label: "Sauvegarde externe : contenu de la copie", level: "error", value: ext.differences ? `${ext.differences} différence(s)` : "Vérification impossible", message: ext.differences ? "Des fichiers sont absents ou différents dans la copie externe : relancez la sauvegarde et contrôlez l'espace libre du support." : `Le support de sauvegarde (disque monté ou machine distante) n'a pas répondu lors de la vérification. ${ext.message}` });
    else items.push({ id: "external-verify", label: "Sauvegarde externe : contenu de la copie", level: "warning", value: "Non vérifié", message: "Le script a terminé l'envoi sans vérifier la copie externe (vérification désactivée, ou ancienne version du script) : une copie incomplète passerait inaperçue." });
  }
  const originals = `${config.mediaDir}/originals`;
  items.push({ id: "originals", label: "Originaux des images", level: fs.existsSync(originals) ? "ok" : "unknown", value: fs.existsSync(originals) ? `${fs.readdirSync(originals).length} fichier(s)` : "Dossier absent", message: fs.existsSync(originals) ? "" : "Aucune image importée, ou dossier introuvable." });
  const test = fromJson(db.get("SELECT value FROM settings WHERE key = 'backup.restoreTest'")?.value, null);
  if (!test) items.push({ id: "restore-test", label: "Test de restauration (copie locale)", level: "unknown", value: "Jamais effectué", message: "« Tester la restauration » contrôle la dernière sauvegarde locale sur une copie, sans toucher à la base." });
  else items.push({ id: "restore-test", label: "Test de restauration (copie locale)", level: !test.ok ? "error" : hours(test.at) > 24 * 90 ? "warning" : "ok", value: `${test.ok ? "Réussi" : "Échec"} ${ago(test.at)}`, message: `${test.backup || ""} ${test.detail}`.trim() });
  return { id: "backups", title: "Sauvegardes", items };
}

const duration = (ms) => (ms === null ? "durée inconnue" : ms < 60e3 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.floor(ms / 60e3)} min ${Math.round((ms % 60e3) / 1000)} s`);

/**
 * Test de restauration de la sauvegarde externe : lecture du dernier rapport de cms/bin/restore-test.mjs
 * (aucun test lancé ici). Absent, illisible ou incohérent : inconnu ; réussi mais ancien : avertissement,
 * puis erreur au-delà du double de CMS_RESTORE_TEST_MAX_HOURS.
 */
function restoreSection(config) {
  const items = [];
  const report = readRestoreReport(config.dataDir);
  if (!report) {
    items.push({ id: "restore-status", label: "Dernier test", level: "unknown", value: "Jamais exécuté", message: "Aucun rapport de cms/bin/restore-test.mjs : le test hebdomadaire (minuteur sur l'hôte Proxmox) n'a pas encore tourné, ou n'a pas pu écrire son rapport. Voir docs/cms/exploitation.md, § 4." });
    return { id: "restore", title: "Test de restauration de la sauvegarde externe", items };
  }
  if (report.invalid) {
    items.push({ id: "restore-status", label: "Dernier test", level: "unknown", value: "Résultat inconnu", message: `${report.reason} Relancez le test (docs/cms/exploitation.md, § 4).` });
    return { id: "restore", title: "Test de restauration de la sauvegarde externe", items };
  }
  const max = config.restoreTestMaxHours;
  const age = hours(report.finishedAt);
  const checkLevel = (...ids) => worst(ids.map((id) => {
    const c = report.checks.find((x) => x.id === id);
    return !c ? "unknown" : c.status === "ok" ? "ok" : c.status === "failed" ? "error" : "unknown";
  }));
  const messages = (...ids) => report.checks.filter((c) => ids.includes(c.id) && c.message).map((c) => c.message).join("\n");
  if (report.ok) {
    const level = age > max * 2 ? "error" : age > max ? "warning" : "ok";
    items.push({ id: "restore-status", label: "Dernier test", level, value: `Réussi ${ago(report.finishedAt)}`, message: level === "ok" ? "Tous les contrôles obligatoires ont été exécutés et ont réussi." : `Résultat ancien (plus de ${Math.round(max / 24)} jours) : le minuteur hebdomadaire tourne-t-il ? Voir le journal de tnd-cms-restore-test sur l'hôte.` });
  } else {
    items.push({ id: "restore-status", label: "Dernier test", level: "error", value: `Échec ${ago(report.finishedAt)}`, message: report.errors.map((e) => `${report.checks.find((c) => c.id === e.check)?.label || "Test"} : ${e.message}`).join("\n") || "Au moins un contrôle obligatoire n'a pas réussi." });
  }
  items.push({ id: "restore-date", label: "Date et durée", level: items[0].level === "ok" ? "ok" : "info", value: report.finishedAt, dateValue: true, message: `Durée : ${duration(report.durationMs)}.` });
  if (report.checks.some((c) => c.id === "host")) return { id: "restore", title: "Test de restauration de la sauvegarde externe", items: [...items, lastSuccess(report)] };
  items.push({ id: "restore-backup", label: "Sauvegarde externe testée", level: checkLevel("source", "backup", "space", "copy"), value: report.backup?.name || "Aucune", message: messages("source", "backup", "space", "copy") });
  const sq = report.sqlite;
  items.push({ id: "restore-sqlite", label: "Base SQLite restaurée", level: checkLevel("sqlite", "foreign-keys", "structure"), value: sq.integrity === "ok" ? `Intègre${sq.tables !== null ? ` · ${sq.tables} tables` : ""}` : sq.integrity === "failed" ? "Intégrité en échec" : "Non contrôlée", message: messages("sqlite", "foreign-keys", "structure") });
  items.push({ id: "restore-consistency", label: "Contrôles de cohérence", level: checkLevel("consistency"), value: report.consistency.ok === true ? "Réussis" : report.consistency.ok === false ? "En échec" : "Non exécutés", message: messages("consistency") });
  const m = report.media;
  const n = (v) => (v === null ? "?" : v);
  items.push({ id: "restore-media", label: "Médias du dépôt", level: checkLevel("media-references", "repo-media"), value: `${n(m.repo.verified)}/${n(m.repo.files)} fichier(s) présent(s)`, message: [messages("media-references", "repo-media"), m.missingTotal ? `${m.missingTotal} référence(s) cassée(s) ou fichier(s) absent(s) au total.` : ""].filter(Boolean).join("\n") });
  items.push({ id: "restore-originals", label: "Originaux téléversés", level: checkLevel("upload-originals"), value: `${n(m.uploads.verified)}/${n(m.uploads.expected)} récupéré(s) et vérifié(s)`, message: messages("upload-originals") });
  if (report.warnings.length) items.push({ id: "restore-warnings", label: "Avertissements", level: "warning", value: `${report.warnings.length} point(s)`, message: report.warnings.join("\n") });
  items.push(lastSuccess(report));
  return { id: "restore", title: "Test de restauration de la sauvegarde externe", items };
}

function lastSuccess(report) {
  return report.lastSuccessAt
    ? { id: "restore-last-success", label: "Dernier test réussi", level: report.ok ? "ok" : "info", value: report.lastSuccessAt, dateValue: true, message: report.lastSuccessBackup ? `Sauvegarde ${report.lastSuccessBackup}.` : "" }
    : { id: "restore-last-success", label: "Dernier test réussi", level: "unknown", value: "Aucun", message: "Aucun test réussi enregistré." };
}

/** Rapport de santé ; full : sections réservées aux administrateurs incluses. */
export function healthReport(db, config, { full = false, publisher = null, siteUrl = null } = {}) {
  const sections = [
    ...(full ? [serverSection(db, config)] : []),
    schedulerSection(db, config),
    publicationSection(db, config, { publisher, siteUrl }),
    ...(full ? [backupSection(db, config), restoreSection(config)] : [])
  ].map((s) => ({ ...s, level: worst(s.items.map((i) => i.level)) }));
  return { generatedAt: new Date().toISOString(), level: worst(sections.map((s) => s.level)), sections, full };
}
