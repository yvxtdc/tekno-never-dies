#!/usr/bin/env node
/**
 * Test de restauration de la sauvegarde externe (dans le conteneur du CMS, en tant que tnd-cms) :
 *   node --disable-warning=ExperimentalWarning cms/bin/restore-test.mjs [--backup cms-….sqlite]
 *   node --disable-warning=ExperimentalWarning cms/bin/restore-test.mjs --host-failure <code>
 *
 * Réglages lus UNIQUEMENT dans l'environnement (cms/.env n'est pas lu : aucun réglage implicite) :
 *   CMS_DATA_DIR            dossier des données (obligatoire, absolu) : seul le rapport y est écrit
 *   TND_RESTORE_SOURCE      support externe monté, ex. /mnt/tnd-backups (obligatoire)
 *   TND_BACKUP_TARGET_ID    contenu attendu de <support>/.tnd-backup-target (obligatoire)
 *   TND_CMS_DIR             site déployé (images du dépôt) ; défaut : dossier contenant ce script
 *   TND_RESTORE_TMP_DIR     parent du dossier temporaire ; défaut : dossier temporaire du système
 *   TND_RESTORE_MIN_FREE_MB espace à laisser libre dans ce dossier (défaut 512)
 *   TND_RESTORE_REQUIRE_MOUNT  1 (défaut) : le support doit être un point de montage
 *   TND_RESTORE_TIMEOUT_SECONDS délai maximal du test (défaut 1800) : au-delà, arrêt, nettoyage, échec
 *
 * --run-id <id> : identifiant de l'exécution (lettres, chiffres, tirets), visible dans la liste des
 * processus : le script de l'hôte s'en sert pour arrêter CE test, et lui seul, quand son service s'arrête.
 * --host-failure : enregistre un échec constaté sur l'hôte Proxmox avant le test (codes de
 * HOST_FAILURES), sans rien tester ; la date du dernier succès est conservée.
 *
 * SIGTERM, SIGINT, SIGHUP, ou fermeture de la sortie (processus parent disparu) : arrêt du test,
 * suppression de son dossier temporaire, rapport d'échec. Les signaux suivants sont ignorés pour laisser
 * le nettoyage se terminer (un SIGKILL reste possible : le test suivant supprime alors le dossier).
 *
 * Rapport : CMS_DATA_DIR/status/restore-test.json (affiché dans Santé du CMS). Code de sortie : 0 test
 * réussi, 1 échec ou délai dépassé (rapport écrit), 2 configuration inutilisable (aucun rapport),
 * 128 + n après un signal (rapport d'échec écrit).
 */
import path from "node:path";
import { REPO_ROOT } from "../server/config.mjs";
import { runRestoreTest, hostFailureReport, saveRestoreReport, restoreReportFile, HOST_FAILURES } from "../server/services/restore-test.mjs";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] ?? "" : null;
};
const env = process.env;
const dataDir = env.CMS_DATA_DIR || "";
if (!dataDir || !path.isAbsolute(dataDir)) {
  console.error("✗ CMS_DATA_DIR doit être défini (chemin absolu) : aucun rapport ne peut être écrit.");
  process.exit(2);
}
const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
// Sortie fermée (pct exec arrêté) : plus d'écriture, sinon EPIPE arrêterait Node avant le nettoyage.
let outputClosed = false;
const log = (line) => {
  if (!outputClosed) console.log(`${stamp()} ${line}`);
};
const controller = new AbortController();
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", () => {
    outputClosed = true;
    controller.abort();
  });
}

const hostCode = opt("host-failure");
if (hostCode !== null) {
  if (!HOST_FAILURES[hostCode]) {
    console.error(`✗ Code inconnu : ${hostCode} (attendus : ${Object.keys(HOST_FAILURES).join(", ")})`);
    process.exit(2);
  }
  const report = saveRestoreReport(dataDir, hostFailureReport(hostCode));
  log(`✗ Échec enregistré : ${report.errors[0].message}`);
  log(`Rapport : ${restoreReportFile(dataDir)} ; dernier test réussi : ${report.lastSuccessAt || "aucun"}`);
  process.exit(1);
}

const runId = opt("run-id");
if (runId !== null && !/^[A-Za-z0-9-]{1,64}$/.test(runId)) {
  console.error("✗ --run-id : lettres, chiffres et tirets seulement (64 au plus).");
  process.exit(2);
}
const timeout = Number.parseInt(env.TND_RESTORE_TIMEOUT_SECONDS ?? "1800", 10);
if (!Number.isInteger(timeout) || timeout < 1) {
  console.error("✗ TND_RESTORE_TIMEOUT_SECONDS : nombre de secondes attendu.");
  process.exit(2);
}

let signalCode = 0;
for (const [sig, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]]) {
  process.on(sig, () => {
    if (signalCode) return log(`! ${sig} reçu : arrêt déjà en cours, nettoyage en cours.`);
    signalCode = code;
    log(`! ${sig} reçu : arrêt du test, nettoyage du dossier temporaire.`);
    controller.abort();
  });
}

const minFree = Number.parseInt(env.TND_RESTORE_MIN_FREE_MB ?? "512", 10);
log(`Test de restauration de la sauvegarde externe : début${runId ? ` (exécution ${runId})` : ""}, délai maximal ${timeout} s.`);
const result = await runRestoreTest({
  dataDir,
  siteDir: path.resolve(env.TND_CMS_DIR || REPO_ROOT),
  source: env.TND_RESTORE_SOURCE || "",
  targetId: env.TND_BACKUP_TARGET_ID || "",
  tmpDir: env.TND_RESTORE_TMP_DIR || undefined,
  requireMount: env.TND_RESTORE_REQUIRE_MOUNT !== "0",
  minFreeBytes: (Number.isFinite(minFree) && minFree >= 0 ? minFree : 512) * 1024 ** 2,
  backupName: opt("backup"),
  timeoutMs: timeout * 1000,
  runId
}, { signal: controller.signal, log });

let report;
try {
  report = saveRestoreReport(dataDir, result);
} catch (error) {
  if (!outputClosed) console.error(`✗ Rapport impossible à enregistrer : ${error.message}`);
  process.exit(signalCode || 1);
}
if (report.cleanup?.ok === false) log(`✗ Dossier temporaire ${report.cleanup.leftover} NON supprimé : voir docs/cms/exploitation.md, § 4 (Diagnostic).`);
for (const c of report.checks) log(`${c.status === "ok" ? "✓" : c.status === "failed" ? "✗" : "–"} ${c.label} : ${c.message}`);
for (const w of report.warnings) log(`! ${w.message}`);
const m = report.media;
log(`Médias : ${m.references ?? "?"} référence(s), ${m.repo.verified}/${m.repo.files} fichier(s) du dépôt, ${m.uploads.verified + m.uploads.unverifiable}/${m.uploads.expected} original(aux) récupéré(s) et vérifié(s), ${m.missingTotal ?? "?"} anomalie(s).`);
log(`${report.ok ? "✓ RÉUSSI" : "✗ ÉCHEC"} en ${Math.round(report.durationMs / 100) / 10} s ; sauvegarde : ${report.backup?.name || "aucune"} ; dernier test réussi : ${report.lastSuccessAt || "aucun"}.`);
process.exit(signalCode || (report.ok ? 0 : 1));
