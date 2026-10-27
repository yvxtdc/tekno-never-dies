/**
 * Test de restauration de la sauvegarde EXTERNE (support de sauvegarde monté dans le conteneur, rempli par
 * cms/deploy/backup-media.sh) : prouve qu'une copie récupérée sur ce support est exploitable, sans jamais
 * toucher aux données actives. Lancé par cms/bin/restore-test.mjs (CLI, minuteur Proxmox) ; le CMS ne fait
 * que lire le rapport (services/health.mjs).
 *
 * Étapes (une étape en échec arrête celles qui en dépendent ; une étape non exécutée n'est jamais réussie) :
 *  1. support : dossier configuré explicitement, point de montage, marqueur .tnd-backup-target conforme ;
 *     jamais de repli sur CMS_DATA_DIR/backups ;
 *  2. sauvegarde : la plus récente de <support>/backups (convention cms-AAAAMMJJ-HHMMSS[-étiquette].sqlite),
 *     fichier ordinaire, non vide, en-tête SQLite ;
 *  3. espace libre du dossier temporaire (base + plus gros original + réserve) ;
 *  4. copie dans un dossier temporaire privé (0700), comparée à la source par SHA-256 ;
 *  5. sur la copie, en lecture seule : ouverture, integrity_check, foreign_key_check, structure comparée au
 *     schéma que produisent les migrations enregistrées dans la sauvegarde (appliquées à une base en mémoire,
 *     jamais à la copie), cohérence des données ;
 *  6. médias : références, images du dépôt (site déployé, chemins confinés), originaux téléversés copiés
 *     un par un depuis <support>/originals et comparés à l'empreinte et à la taille enregistrées en base.
 *     Variantes publiées (assets/img/cms/) et cache (media/cache) : reconstructibles, comptés sans être exigés.
 *
 * Écritures : uniquement le dossier temporaire et le rapport CMS_DATA_DIR/status/restore-test.json
 * (écriture atomique). Aucun chemin, identifiant ni contenu de la base dans le rapport : noms de fichiers de
 * sauvegarde, compteurs, messages.
 *
 * Arrêt et nettoyage : délai maximal (timeoutMs) et signaux arrêtent le test entre deux lectures ; le
 * dossier temporaire de l'exécution est alors supprimé (removeTempDir : jamais un autre chemin). Après un
 * arrêt brutal (SIGKILL, coupure), le dossier reste : il porte une fiche .tnd-restore-run (pid, début) et
 * le test suivant le supprime si ce processus est terminé (sweepStaleTempDirs). Un échec de suppression
 * est signalé dans le rapport (avertissement, cleanup.leftover).
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { listMigrations, MIGRATIONS_DIR } from "../db/migrate.mjs";

export const REPORT_FORMAT = 1;
export const MARKER = ".tnd-backup-target";
const BACKUP_NAME = /^cms-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(-[a-z0-9-]+)?\.sqlite$/;
// Nom d'un original téléversé (services/media.mjs : <uid>[-vN].<ext>) : jamais de séparateur ni de fichier caché.
const ORIGINAL_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*\.[a-z0-9]{2,5}$/;
const TEMP_PREFIX = "tnd-restore-externe-";
// Sauvegarde plus ancienne : la sauvegarde quotidienne n'arrive peut-être plus sur le support.
const BACKUP_MAX_AGE_HOURS = 72;
const MARGIN = 8 * 1024 ** 2;

/** Contrôles obligatoires, dans l'ordre d'exécution. */
export const CHECKS = [
  ["source", "Support de sauvegarde externe"],
  ["backup", "Sauvegarde SQLite externe"],
  ["space", "Espace disponible pour le test"],
  ["copy", "Copie isolée de la sauvegarde"],
  ["sqlite", "Ouverture et intégrité SQLite"],
  ["foreign-keys", "Clés étrangères"],
  ["structure", "Structure de la base"],
  ["consistency", "Cohérence des données"],
  ["media-references", "Références aux médias"],
  ["repo-media", "Images du dépôt (site déployé)"],
  ["upload-originals", "Originaux téléversés (support externe)"]
];

/** Échecs constatés sur l'hôte Proxmox avant le lancement du test (codes fixes : aucun texte libre). */
export const HOST_FAILURES = {
  "graid-not-mounted": "Le disque de sauvegarde n'est pas monté sur l'hôte Proxmox : test impossible.",
  "graid-uuid-mismatch": "Le volume monté sur l'hôte n'est pas le disque de sauvegarde attendu (UUID différent) : test refusé.",
  "target-missing": "Le dossier des sauvegardes du CMS est absent du disque de sauvegarde.",
  "marker-mismatch": "Marqueur .tnd-backup-target absent ou non conforme sur le disque de sauvegarde : test refusé.",
  "ct-mount-missing": "Le dossier des sauvegardes n'est pas monté dans le conteneur du CMS.",
  "ct-mount-mismatch": "Le point de montage du conteneur ne correspond pas au dossier de sauvegarde attendu.",
  "backup-running": "La sauvegarde quotidienne était toujours en cours : test non lancé."
};

/** Références aux médias : mêmes colonnes que mediaUsage (services/media.mjs). */
const MEDIA_REFERENCES = [
  ["events", "flyer_media_id"], ["events", "cover_media_id"], ["event_photos", "media_id"],
  ["artists", "photo_media_id"], ["team_members", "photo_media_id"], ["gallery_photos", "media_id"]
];
/** Colonnes JSON lues par l'export (export/site-data.mjs) : un JSON invalide ferait échouer la mise en ligne. */
const JSON_COLUMNS = [
  ["events", ["genres", "practical", "links", "tickets", "contest"]], ["artists", ["links"]],
  ["team_members", ["tags", "extra"]], ["media", ["variants"]]
];

class Aborted extends Error {}
const short = (error) => String(error?.message || error).split("\n")[0].slice(0, 200);
const quote = (name) => `"${String(name).replace(/"/g, '""')}"`;
const inside = (child, parent) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
const real = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

async function sha256(file, signal) {
  const hash = crypto.createHash("sha256");
  let size = 0;
  for await (const chunk of fs.createReadStream(file, signal ? { signal } : {})) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { sha256: hash.digest("hex"), size };
}

/** Date (UTC) inscrite dans le nom d'une sauvegarde (services/backup.mjs : stamp()). */
export function backupDate(name) {
  const m = BACKUP_NAME.exec(name);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
}

function emptyReport(startedAt) {
  return {
    format: REPORT_FORMAT,
    kind: "restore-test",
    startedAt,
    finishedAt: null,
    durationMs: null,
    status: "failure",
    ok: false,
    backup: null,
    sqlite: { opened: false, integrity: null, integrityMessages: [], foreignKeyViolations: null, tables: null, tablesChecked: null, migrations: null, missingStructures: [] },
    consistency: { ok: null, checks: [] },
    media: {
      references: null, brokenReferences: null, rows: null,
      repo: { media: 0, files: 0, verified: 0, missing: 0, invalidPaths: 0, changed: 0 },
      uploads: { expected: 0, recovered: 0, verified: 0, missing: 0, corrupted: 0, invalidPaths: 0, unverifiable: 0, orphans: 0 },
      regenerable: { publishedVariants: 0 },
      missingTotal: null
    },
    checks: CHECKS.map(([id, label]) => ({ id, label, status: "pending", message: "" })),
    errors: [],
    warnings: [],
    lastSuccessAt: null,
    lastSuccessBackup: null
  };
}

function finish(report, now) {
  for (const c of report.checks) {
    if (c.status === "pending") {
      c.status = "skipped";
      c.message = "Non exécuté : une étape précédente a échoué.";
    }
  }
  report.finishedAt = now.toISOString();
  report.durationMs = Math.max(0, Date.parse(report.finishedAt) - Date.parse(report.startedAt));
  // Règle du succès global : tous les contrôles obligatoires exécutés et réussis, aucune erreur.
  report.ok = report.checks.every((c) => c.status === "ok") && report.errors.length === 0;
  report.status = report.ok ? "success" : "failure";
  return report;
}

const TEMP_NAME = /^tnd-restore-externe-[A-Za-z0-9]{6}$/;
const RUN_FILE = ".tnd-restore-run";

/**
 * Suppression d'un dossier temporaire du test, et de lui seul : enfant direct de parent (chemin réel),
 * nom tnd-restore-externe-XXXXXX, vrai dossier (pas un lien), appartenant au compte courant. Aucun autre
 * chemin, même fourni par une variable, ne peut être visé. Lève une erreur si une condition manque.
 */
export function removeTempDir(dir, parent, remove = fs.rmSync) {
  if (!TEMP_NAME.test(path.basename(dir)) || path.dirname(dir) !== parent) throw new Error("dossier hors du périmètre du test, non supprimé");
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("pas un dossier ordinaire, non supprimé");
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("dossier d'un autre compte, non supprimé");
  remove(dir, { recursive: true, force: true });
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};

/**
 * Dossiers laissés par une exécution arrêtée brutalement (SIGKILL, coupure) : supprimés seulement si leur
 * fiche .tnd-restore-run désigne un processus terminé, ou s'ils sont plus anciens que staleMs (aucun test
 * ne peut durer autant : délai maximal). Un dossier d'une exécution en cours n'est jamais touché.
 */
export function sweepStaleTempDirs(parent, { staleMs, remove = fs.rmSync, now = Date.now() } = {}) {
  const result = { removed: [], kept: [], failed: [] };
  let names;
  try {
    names = fs.readdirSync(parent);
  } catch {
    return result;
  }
  for (const name of names.filter((n) => TEMP_NAME.test(n))) {
    const dir = path.join(parent, name);
    let stat;
    try {
      stat = fs.lstatSync(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory() || (typeof process.getuid === "function" && stat.uid !== process.getuid())) continue;
    let run = null;
    try {
      run = JSON.parse(fs.readFileSync(path.join(dir, RUN_FILE), "utf8"));
    } catch {}
    const started = Date.parse(run?.startedAt) || stat.mtimeMs;
    const old = now - started > staleMs;
    const finished = Number.isInteger(run?.pid) && run.pid > 0 && run.pid !== process.pid && !alive(run.pid);
    if (!old && !finished) {
      result.kept.push(name);
      continue;
    }
    try {
      removeTempDir(dir, parent, remove);
      result.removed.push(name);
    } catch (error) {
      result.failed.push(`${name} (${short(error)})`);
    }
  }
  return result;
}

/**
 * Exécute le test. options : dataDir, siteDir, source (support externe), targetId (contenu attendu du
 * marqueur), tmpDir (parent du dossier temporaire), requireMount, minFreeBytes, backupName (facultatif),
 * timeoutMs (délai maximal, 30 min par défaut : au-delà, le test s'arrête et nettoie), runId (identifiant
 * de l'exécution, noté dans le dossier temporaire), removeDir (tests). Renvoie le rapport (sans
 * l'enregistrer : saveRestoreReport).
 */
export async function runRestoreTest(options, { signal = null, log = () => {}, now = () => new Date() } = {}) {
  const report = emptyReport(now().toISOString());
  report.cleanup = { ok: null, leftover: null, staleRemoved: 0, staleKept: 0, staleFailed: 0 };
  const check = (id) => report.checks.find((c) => c.id === id);
  const pass = (id, message) => Object.assign(check(id), { status: "ok", message });
  const fail = (id, message) => {
    Object.assign(check(id), { status: "failed", message });
    report.errors.push({ check: id, message });
    log(`✗ ${check(id).label} : ${message}`);
    return false;
  };
  const warn = (id, message) => {
    report.warnings.push({ check: id, message });
    log(`! ${message}`);
  };
  const { dataDir, siteDir, source, targetId, requireMount = true, minFreeBytes = 512 * 1024 ** 2, backupName = null, timeoutMs = 30 * 60e3, runId = null, removeDir = fs.rmSync } = options;
  // Arrêt : signal reçu (SIGTERM du service, pkill de l'hôte…) ou délai maximal dépassé. Vérifié entre
  // les étapes et pendant les lectures de fichiers ; une requête SQLite en cours se termine d'abord.
  const internal = new AbortController();
  let stopReason = null;
  const stop = (reason) => {
    stopReason ??= reason;
    internal.abort();
  };
  const onSignal = () => stop("signal");
  if (signal?.aborted) stop("signal");
  else signal?.addEventListener("abort", onSignal, { once: true });
  const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : Infinity;
  const timer = timeoutMs > 0 ? setTimeout(() => stop("timeout"), timeoutMs) : null;
  const stopIfAborted = () => {
    if (Date.now() >= deadline) stop("timeout");
    if (internal.signal.aborted) throw new Aborted();
  };
  const tmpParent = options.tmpDir || os.tmpdir();
  let parentReal = null;
  let tempDir = null;
  let db = null;
  let current = "source";
  try {
    await steps();
    const m = report.media;
    if (["media-references", "repo-media", "upload-originals"].every((id) => check(id).status !== "pending")) m.missingTotal = (m.brokenReferences ?? 0) + m.repo.missing + m.repo.invalidPaths + m.uploads.missing + m.uploads.corrupted + m.uploads.invalidPaths;
  } catch (error) {
    const aborted = error instanceof Aborted || error?.name === "AbortError";
    const message = !aborted ? `Erreur inattendue : ${short(error)}`
      : stopReason === "timeout" ? `Délai maximal dépassé (${Math.round(timeoutMs / 1000)} s) : test arrêté, résultat incomplet.`
        : "Test interrompu (signal reçu) : résultat incomplet.";
    if (check(current).status === "pending") fail(current, message);
    else {
      report.errors.push({ check: current, message });
      log(`✗ ${message}`);
    }
    if (aborted) report.interrupted = true;
    if (stopReason === "timeout") report.timedOut = true;
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", onSignal);
    try {
      db?.close();
    } catch {}
  }
  // Nettoyage du seul dossier de cette exécution ; un échec est signalé, jamais ignoré.
  if (tempDir) {
    try {
      removeTempDir(tempDir, parentReal, removeDir);
      report.cleanup.ok = true;
    } catch (error) {
      report.cleanup = { ...report.cleanup, ok: false, leftover: path.basename(tempDir) };
      warn("cleanup", `Dossier temporaire ${path.basename(tempDir)} non supprimé (${short(error)}) : il sera supprimé au prochain test, ou à la main (docs/cms/exploitation.md, § 4).`);
    }
  }
  return finish(report, now());

  async function steps() {
    /* 1. Support externe */
    if (!(await stepSource())) return;
    /* 2. Sauvegarde */
    stopIfAborted();
    current = "backup";
    const picked = stepBackup();
    if (!picked) return;
    /* 3. Espace (et dossiers orphelins d'exécutions arrêtées brutalement) */
    current = "space";
    if (!stepSpace(picked)) return;
    /* 4. Copie isolée */
    stopIfAborted();
    current = "copy";
    tempDir = fs.mkdtempSync(path.join(parentReal, TEMP_PREFIX));
    fs.chmodSync(tempDir, 0o700);
    fs.writeFileSync(path.join(tempDir, RUN_FILE), JSON.stringify({ pid: process.pid, runId, startedAt: report.startedAt, timeoutMs }), { mode: 0o600 });
    log(`Dossier temporaire : ${path.basename(tempDir)}${runId ? ` (exécution ${runId})` : ""}`);
    const copy = path.join(tempDir, "cms.sqlite");
    await fsp.copyFile(picked.file, copy, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(copy, 0o600);
    const [a, b] = [await sha256(picked.file, internal.signal), await sha256(copy, internal.signal)];
    if (a.sha256 !== b.sha256 || b.size !== picked.size) return fail("copy", "La copie diffère de la sauvegarde lue sur le support (lecture instable ?).");
    pass("copy", `Copie identique (SHA-256) dans un dossier temporaire privé.`);
    /* 5. SQLite (copie, lecture seule) */
    stopIfAborted();
    current = "sqlite";
    try {
      db = new DatabaseSync(copy, { readOnly: true });
      report.sqlite.opened = true;
      const rows = db.prepare("PRAGMA integrity_check").all().map((r) => String(Object.values(r)[0]));
      report.sqlite.integrity = rows.length === 1 && rows[0] === "ok" ? "ok" : "failed";
      report.sqlite.integrityMessages = report.sqlite.integrity === "ok" ? [] : rows.slice(0, 5).map((m) => m.slice(0, 200));
      report.sqlite.tables = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get().n;
    } catch (error) {
      report.sqlite.opened = false;
      return fail("sqlite", `Base illisible : ${short(error)}`);
    }
    if (report.sqlite.integrity !== "ok") return fail("sqlite", `Contrôle d'intégrité SQLite en échec : ${report.sqlite.integrityMessages.join(" ; ")}`);
    pass("sqlite", `Base ouverte en lecture seule ; PRAGMA integrity_check : ok (${report.sqlite.tables} tables).`);
    // Les contrôles suivants portent sur une base lisible : chacun est exécuté, même si un autre échoue.
    current = "foreign-keys";
    stepForeignKeys();
    current = "structure";
    stepStructure();
    current = "consistency";
    stepConsistency();
    current = "media-references";
    stepMediaReferences();
    stopIfAborted();
    current = "repo-media";
    await stepRepoMedia();
    stopIfAborted();
    current = "upload-originals";
    await stepUploads();
  }

  async function stepSource() {
    if (!source) return fail("source", "Support externe non configuré (TND_RESTORE_SOURCE) : aucune sauvegarde locale n'est utilisée à sa place.");
    if (!path.isAbsolute(source)) return fail("source", "Le chemin du support externe doit être absolu.");
    if (!targetId) return fail("source", "Identifiant attendu du marqueur non configuré (TND_BACKUP_TARGET_ID).");
    let stat;
    try {
      stat = fs.lstatSync(source);
    } catch {
      return fail("source", "Support externe introuvable : le disque de sauvegarde est-il monté ?");
    }
    if (!stat.isDirectory()) return fail("source", "Le support externe n'est pas un dossier (lien symbolique refusé).");
    try {
      fs.accessSync(source, fs.constants.R_OK | fs.constants.X_OK);
    } catch {
      return fail("source", "Support externe illisible pour le compte du CMS.");
    }
    const src = real(source);
    for (const [dir, what] of [[dataDir, "le dossier des données du CMS"], [siteDir, "le site"]]) {
      if (dir && (inside(src, real(dir)) || inside(real(dir), src))) return fail("source", `Le support externe est confondu avec ${what} : une copie locale ne prouve pas que la sauvegarde externe est récupérable.`);
    }
    if (requireMount && src !== "/" && fs.statSync(src).dev === fs.statSync(path.dirname(src)).dev) {
      return fail("source", "Le dossier du support externe n'est pas un point de montage : le disque de sauvegarde n'est pas monté (ce dossier serait un simple dossier local).");
    }
    const marker = path.join(source, MARKER);
    let content;
    try {
      const m = fs.lstatSync(marker);
      if (!m.isFile() || m.size > 4096) return fail("source", "Marqueur .tnd-backup-target non conforme (fichier ordinaire attendu).");
      content = fs.readFileSync(marker, "utf8").trim().toLowerCase();
    } catch {
      return fail("source", "Marqueur .tnd-backup-target absent ou illisible : ce n'est pas le support de sauvegarde attendu.");
    }
    if (content !== String(targetId).trim().toLowerCase()) return fail("source", "Marqueur .tnd-backup-target différent de l'identifiant attendu : ce n'est pas le support de sauvegarde attendu.");
    pass("source", `Support ${requireMount ? "monté" : "accessible (point de montage non exigé)"}, marqueur conforme.`);
    return true;
  }

  function stepBackup() {
    const dir = path.join(source, "backups");
    let names;
    try {
      if (!fs.lstatSync(dir).isDirectory()) throw new Error();
      names = fs.readdirSync(dir);
    } catch {
      fail("backup", "Dossier backups/ absent du support externe : aucune sauvegarde de la base n'y a été copiée.");
      return null;
    }
    let name;
    if (backupName) {
      if (!BACKUP_NAME.test(backupName) || !names.includes(backupName)) {
        fail("backup", "Sauvegarde demandée introuvable sur le support externe (nom attendu : cms-AAAAMMJJ-HHMMSS[-étiquette].sqlite).");
        return null;
      }
      name = backupName;
    } else {
      name = names.filter((n) => BACKUP_NAME.test(n) && !n.includes("-avant-restauration")).sort().at(-1);
      if (!name) {
        fail("backup", "Aucune sauvegarde SQLite (cms-AAAAMMJJ-HHMMSS[-étiquette].sqlite) sur le support externe.");
        return null;
      }
    }
    const file = path.join(dir, name);
    const createdAt = backupDate(name);
    report.backup = { name, size: null, createdAt, ageHours: Math.round((Date.parse(report.startedAt) - Date.parse(createdAt)) / 3600e3) };
    let stat;
    try {
      stat = fs.lstatSync(file);
    } catch {
      fail("backup", "Sauvegarde illisible sur le support externe.");
      return null;
    }
    if (!stat.isFile()) {
      fail("backup", "La sauvegarde n'est pas un fichier ordinaire (lien symbolique refusé).");
      return null;
    }
    report.backup.size = stat.size;
    if (!stat.size) {
      fail("backup", "La sauvegarde est vide (0 octet).");
      return null;
    }
    try {
      const fd = fs.openSync(file, "r");
      const head = Buffer.alloc(16);
      fs.readSync(fd, head, 0, 16, 0);
      fs.closeSync(fd);
      if (head.toString("latin1") !== "SQLite format 3\0") {
        fail("backup", "Le fichier n'est pas une base SQLite (en-tête invalide).");
        return null;
      }
    } catch {
      fail("backup", "Sauvegarde illisible sur le support externe.");
      return null;
    }
    if (report.backup.ageHours > BACKUP_MAX_AGE_HOURS) warn("backup", `La sauvegarde la plus récente du support date de ${Math.round(report.backup.ageHours / 24)} jour(s) : la sauvegarde quotidienne arrive-t-elle encore sur le support ?`);
    pass("backup", `${name} (${Math.max(1, Math.round(stat.size / 1024))} Ko).`);
    log(`Sauvegarde testée : ${name}`);
    return { name, file, size: stat.size };
  }

  function stepSpace(picked) {
    if (!path.isAbsolute(tmpParent)) return fail("space", "Le dossier temporaire doit être un chemin absolu.");
    const parent = real(tmpParent);
    try {
      if (!fs.statSync(parent).isDirectory()) throw new Error();
    } catch {
      return fail("space", "Dossier temporaire absent ou qui n'est pas un dossier.");
    }
    for (const dir of [dataDir, siteDir, source]) {
      if (dir && inside(parent, real(dir))) return fail("space", "Le dossier temporaire est situé dans les données du CMS, le site ou le support de sauvegarde : refusé.");
    }
    parentReal = parent;
    // Dossiers orphelins d'une exécution arrêtée brutalement : seulement ceux du test, processus terminé.
    const stale = sweepStaleTempDirs(parent, { staleMs: Math.max(24 * 3600e3, 2 * timeoutMs), remove: removeDir });
    Object.assign(report.cleanup, { staleRemoved: stale.removed.length, staleKept: stale.kept.length, staleFailed: stale.failed.length });
    if (stale.removed.length) log(`Dossier(s) temporaire(s) orphelin(s) supprimé(s) : ${stale.removed.join(", ")}`);
    if (stale.kept.length) log(`Dossier(s) temporaire(s) d'une autre exécution en cours, laissé(s) : ${stale.kept.join(", ")}`);
    if (stale.failed.length) warn("cleanup", `Dossier(s) temporaire(s) orphelin(s) impossible(s) à supprimer : ${stale.failed.join(", ")}.`);
    // Les originaux sont copiés un par un (copie supprimée après contrôle) : il faut la place du plus gros.
    let largest = 0;
    const originals = path.join(source, "originals");
    try {
      for (const f of fs.readdirSync(originals)) {
        const s = fs.lstatSync(path.join(originals, f));
        if (s.isFile()) largest = Math.max(largest, s.size);
      }
    } catch {}
    const needed = picked.size + largest + MARGIN;
    let free;
    try {
      const st = fs.statfsSync(parent);
      free = st.bavail * st.bsize;
    } catch {
      return fail("space", "Dossier temporaire inaccessible : espace libre non mesurable.");
    }
    const mb = (n) => `${Math.ceil(n / 1024 ** 2)} Mo`;
    if (free - needed < minFreeBytes) return fail("space", `Espace insuffisant dans le dossier temporaire : ${mb(needed)} nécessaires, ${mb(free)} libres, ${mb(minFreeBytes)} à laisser libres. Rien n'a été copié.`);
    pass("space", `${mb(needed)} nécessaires, ${mb(free)} libres.`);
    return true;
  }

  function stepForeignKeys() {
    try {
      const rows = db.prepare("PRAGMA foreign_key_check").all();
      report.sqlite.foreignKeyViolations = rows.length;
      if (rows.length) {
        const byTable = {};
        for (const r of rows) byTable[r.table] = (byTable[r.table] || 0) + 1;
        return fail("foreign-keys", `${rows.length} ligne(s) référencent un élément absent : ${Object.entries(byTable).map(([t, n]) => `${t} (${n})`).join(", ")}.`);
      }
      pass("foreign-keys", "PRAGMA foreign_key_check : aucune violation.");
    } catch (error) {
      fail("foreign-keys", `Contrôle impossible : ${short(error)}`);
    }
  }

  /** Schéma attendu : migrations enregistrées dans la sauvegarde, rejouées sur une base vide en mémoire. */
  function stepStructure() {
    let applied;
    try {
      applied = db.prepare("SELECT name FROM schema_migrations ORDER BY name").all().map((r) => r.name);
    } catch {
      return fail("structure", "Table schema_migrations absente : ce n'est pas une base du CMS.");
    }
    const known = listMigrations();
    const replay = known.filter((m) => applied.includes(m));
    const unknown = applied.filter((m) => !known.includes(m));
    const pending = known.filter((m) => !applied.includes(m));
    report.sqlite.migrations = { count: applied.length, latest: applied.at(-1) || null, unknown, pending };
    if (!applied.length) return fail("structure", "Aucune migration enregistrée : base vide ou incomplète.");
    if (unknown.length) warn("structure", `La sauvegarde contient ${unknown.length} migration(s) inconnue(s) de ce code (${unknown.join(", ")}) : code plus ancien que la base ; seules les migrations connues sont comparées.`);
    if (replay.some((m, i) => m !== known[i])) warn("structure", "Les migrations enregistrées ne se suivent pas : structure à examiner.");
    const ref = new DatabaseSync(":memory:");
    try {
      ref.exec("CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
      for (const name of replay) ref.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8"));
      const objects = (conn) => conn.prepare("SELECT type, name, tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND type IN ('table', 'index', 'trigger', 'view')").all();
      const actual = new Map(objects(db).map((o) => [`${o.type}:${o.name}`, o]));
      const expected = objects(ref);
      const missing = [];
      for (const o of expected) {
        if (!actual.has(`${o.type}:${o.name}`)) {
          missing.push(`${o.type} ${o.name}`);
          continue;
        }
        if (o.type === "table") {
          const cols = new Set(db.prepare(`PRAGMA table_info(${quote(o.name)})`).all().map((c) => c.name));
          for (const c of ref.prepare(`PRAGMA table_info(${quote(o.name)})`).all()) if (!cols.has(c.name)) missing.push(`colonne ${o.name}.${c.name}`);
        }
      }
      const extra = [...actual.keys()].filter((k) => !expected.some((o) => `${o.type}:${o.name}` === k));
      report.sqlite.tablesChecked = expected.filter((o) => o.type === "table").length;
      report.sqlite.missingStructures = missing.slice(0, 20);
      if (extra.length) warn("structure", `${extra.length} élément(s) de structure absent(s) du schéma attendu : ${extra.slice(0, 5).join(", ")}.`);
      if (missing.length) return fail("structure", `${missing.length} élément(s) de structure manquant(s) : ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}.`);
      pass("structure", `${report.sqlite.tablesChecked} tables, leurs colonnes, index et déclencheurs conformes aux ${replay.length} migration(s) enregistrée(s)${pending.length ? ` ; ${pending.length} migration(s) plus récente(s) s'appliqueraient au démarrage du CMS` : ""}.`);
    } finally {
      ref.close();
    }
  }

  function stepConsistency() {
    const items = report.consistency.checks;
    const columns = (table) => {
      try {
        return new Set(db.prepare(`PRAGMA table_info(${quote(table)})`).all().map((c) => c.name));
      } catch {
        return new Set();
      }
    };
    const add = (id, label, level, message) => items.push({ id, label, level, message });
    const run = (id, label, fn) => {
      try {
        fn();
      } catch (error) {
        add(id, label, "error", `Contrôle impossible : ${short(error)}`);
      }
    };
    run("migrations", "Migrations enregistrées", () => {
      const n = db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get().n;
      add("migrations", "Migrations enregistrées", n ? "ok" : "error", n ? `${n} migration(s).` : "Aucune migration enregistrée.");
    });
    run("admin", "Compte administrateur actif", () => {
      const n = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get().n;
      add("admin", "Compte administrateur actif", n ? "ok" : "warning", n ? `${n} compte(s).` : "Aucun administrateur actif : après restauration, en créer un (npm run cms:admin -- create-user).");
    });
    run("content", "Contenus", () => {
      const n = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${quote(t)}`).get().n;
      const counts = { events: n("events"), artists: n("artists"), venues: n("venues"), media: n("media") };
      add("content", "Contenus", counts.events + counts.artists ? "ok" : "warning", `${counts.events} soirée(s), ${counts.artists} artiste(s), ${counts.venues} lieu(x), ${counts.media} média(s).`);
    });
    run("media-rows", "Fiches des médias", () => {
      const bad = db.prepare("SELECT COUNT(*) AS n FROM media WHERE (storage = 'upload' AND (file_name IS NULL OR file_name = '')) OR (storage = 'repo' AND (repo_path IS NULL OR repo_path = '')) OR storage NOT IN ('upload', 'repo')").get().n;
      add("media-rows", "Fiches des médias", bad ? "error" : "ok", bad ? `${bad} média(s) sans fichier ni chemin.` : "Chaque média désigne un fichier.");
    });
    run("json", "Données structurées (JSON)", () => {
      let bad = 0;
      const where = [];
      for (const [table, cols] of JSON_COLUMNS) {
        const have = columns(table);
        for (const c of cols.filter((c) => have.has(c))) {
          const n = db.prepare(`SELECT COUNT(*) AS n FROM ${quote(table)} WHERE json_valid(${quote(c)}) = 0`).get().n;
          if (n) where.push(`${table}.${c} (${n})`);
          bad += n;
        }
      }
      add("json", "Données structurées (JSON)", bad ? "error" : "ok", bad ? `${bad} valeur(s) JSON invalide(s) : ${where.join(", ")} ; la mise en ligne échouerait.` : "Listes et réglages lisibles.");
    });
    const errors = items.filter((i) => i.level === "error");
    for (const i of items.filter((i) => i.level === "warning")) warn("consistency", i.message);
    report.consistency.ok = !errors.length;
    if (errors.length) return fail("consistency", errors.map((i) => `${i.label} : ${i.message}`).join(" "));
    pass("consistency", `${items.length} contrôle(s) de cohérence réussi(s).`);
  }

  function stepMediaReferences() {
    let total = 0;
    let broken = 0;
    for (const [table, col] of MEDIA_REFERENCES) {
      total += db.prepare(`SELECT COUNT(*) AS n FROM ${quote(table)} WHERE ${quote(col)} IS NOT NULL`).get().n;
      broken += db.prepare(`SELECT COUNT(*) AS n FROM ${quote(table)} t LEFT JOIN media m ON m.id = t.${quote(col)} WHERE t.${quote(col)} IS NOT NULL AND m.id IS NULL`).get().n;
    }
    report.media.references = total;
    report.media.brokenReferences = broken;
    report.media.rows = db.prepare("SELECT COUNT(*) AS n FROM media").get().n;
    if (broken) return fail("media-references", `${broken} référence(s) vers un média absent de la base, sur ${total}.`);
    pass("media-references", `${total} référence(s) vers ${report.media.rows} média(s), toutes valides.`);
  }

  /** Fichier du dépôt : chemin relatif, confiné au site (y compris après résolution des liens). */
  function repoFile(rel) {
    if (typeof rel !== "string" || !rel || rel.includes("\0") || path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) return null;
    const root = path.resolve(siteDir);
    const file = path.resolve(root, rel);
    if (!inside(file, root + path.sep)) return null;
    if (fs.existsSync(file) && !inside(real(file), real(root) + path.sep)) return null;
    return file;
  }

  async function stepRepoMedia() {
    const r = report.media.repo;
    const rows = db.prepare("SELECT id, repo_path, sha256, variants FROM media WHERE storage = 'repo' ORDER BY id").all();
    r.media = rows.length;
    const problems = [];
    for (const row of rows) {
      stopIfAborted();
      let variants = {};
      try {
        variants = JSON.parse(row.variants || "{}") || {};
      } catch {}
      // Image principale et variantes de la galerie : fichiers sources versionnés, non recalculables par le CMS.
      const files = [[row.repo_path, row.sha256], ...Object.values(variants).filter(Boolean).map((p) => [p, null])];
      for (const [rel, expected] of files) {
        r.files++;
        const file = repoFile(rel);
        if (!file) {
          r.invalidPaths++;
          problems.push(`média n° ${row.id} : chemin refusé`);
          continue;
        }
        try {
          if (!fs.lstatSync(file).isFile()) throw new Error();
          const got = await sha256(file, internal.signal);
          r.verified++;
          if (expected && got.sha256 !== expected) r.changed++;
        } catch (error) {
          if (error?.name === "AbortError") throw error;
          r.missing++;
          problems.push(`${rel} absent`);
        }
      }
    }
    if (r.changed) warn("repo-media", `${r.changed} image(s) du dépôt modifiée(s) depuis leur enregistrement dans le CMS (empreinte différente) : versions du dépôt Git, présentes et lisibles.`);
    if (r.missing || r.invalidPaths) return fail("repo-media", `${r.missing + r.invalidPaths} fichier(s) du dépôt manquant(s) ou refusé(s) sur ${r.files} : ${problems.slice(0, 5).join(", ")}${problems.length > 5 ? "…" : ""}.`);
    pass("repo-media", r.files ? `${r.verified} fichier(s) présents et lisibles dans le site déployé (${r.media} média(s)).` : "Aucune image du dépôt référencée.");
  }

  async function stepUploads() {
    const u = report.media.uploads;
    const rows = db.prepare("SELECT id, uid, version, file_name, size, sha256 FROM media WHERE storage = 'upload' ORDER BY id").all();
    u.expected = rows.length;
    const dir = path.join(source, "originals");
    const present = new Set();
    try {
      if (fs.lstatSync(dir).isDirectory()) for (const f of fs.readdirSync(dir)) present.add(f);
    } catch {}
    const work = path.join(tempDir, "originals");
    fs.mkdirSync(work, { mode: 0o700 });
    const problems = [];
    const expectedNames = new Set();
    for (const row of rows) {
      stopIfAborted();
      const name = row.file_name;
      if (typeof name !== "string" || !ORIGINAL_NAME.test(name)) {
        u.invalidPaths++;
        problems.push(`média n° ${row.id} : nom de fichier refusé`);
        continue;
      }
      expectedNames.add(name);
      const src = path.join(dir, name);
      let stat;
      try {
        stat = fs.lstatSync(src);
      } catch {}
      if (!stat?.isFile()) {
        u.missing++;
        problems.push(`${name} absent du support`);
        continue;
      }
      const copy = path.join(work, name);
      try {
        await fsp.copyFile(src, copy, fs.constants.COPYFILE_EXCL);
        const got = await sha256(copy, internal.signal);
        u.recovered++;
        if (row.sha256 && got.sha256 !== row.sha256) {
          u.corrupted++;
          problems.push(`${name} : contenu différent de l'empreinte enregistrée`);
        } else if (Number.isInteger(row.size) && row.size > 0 && got.size !== row.size) {
          u.corrupted++;
          problems.push(`${name} : taille différente`);
        } else if (!row.sha256) u.unverifiable++;
        else u.verified++;
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        u.missing++;
        problems.push(`${name} illisible`);
      } finally {
        fs.rmSync(copy, { force: true });
      }
    }
    u.orphans = [...present].filter((f) => !expectedNames.has(f)).length;
    // Variantes publiées (reconstructibles par une mise en ligne) : comptées pour information.
    try {
      const published = fs.readdirSync(path.join(siteDir, "assets/img/cms"));
      for (const row of rows) report.media.regenerable.publishedVariants += published.filter((f) => f.includes(`-${row.uid}-v${row.version}`)).length;
    } catch {}
    if (u.unverifiable) warn("upload-originals", `${u.unverifiable} original(aux) sans empreinte en base : lisibles, mais intégrité non vérifiable.`);
    if (u.missing || u.corrupted || u.invalidPaths) return fail("upload-originals", `${u.missing + u.corrupted + u.invalidPaths} original(aux) manquant(s), illisible(s) ou différent(s) sur ${u.expected} : ${problems.slice(0, 5).join(", ")}${problems.length > 5 ? "…" : ""}.`);
    pass("upload-originals", u.expected ? `${u.verified + u.unverifiable} original(aux) récupéré(s) depuis le support et vérifié(s) sur ${u.expected}.` : "Aucun original téléversé attendu.");
  }
}

/** Rapport d'un échec constaté sur l'hôte avant le lancement (support absent, marqueur faux…). */
export function hostFailureReport(code, { now = () => new Date() } = {}) {
  const message = HOST_FAILURES[code];
  if (!message) throw new Error(`Code d'échec inconnu : ${code}`);
  const report = emptyReport(now().toISOString());
  report.checks.unshift({ id: "host", label: "Contrôles sur l'hôte Proxmox", status: "failed", message });
  report.errors.push({ check: "host", message });
  return finish(report, now());
}

export const restoreReportFile = (dataDir) => path.join(dataDir, "status", "restore-test.json");

const iso = (v) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null);
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
const text = (v, n = 300) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").slice(0, n);

/**
 * Dernier rapport, contrôlé : null s'il n'existe pas ; { invalid: true } s'il est illisible, d'un autre
 * format ou incohérent (affiché « résultat inconnu », jamais comme une réussite).
 */
export function readRestoreReport(dataDir) {
  const file = restoreReportFile(dataDir);
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    return error.code === "ENOENT" ? null : { invalid: true, reason: "Rapport illisible." };
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { invalid: true, reason: "Rapport illisible (JSON invalide)." };
  }
  if (!data || data.format !== REPORT_FORMAT || data.kind !== "restore-test") return { invalid: true, reason: "Rapport d'un format inconnu." };
  const finishedAt = iso(data.finishedAt);
  const checks = Array.isArray(data.checks) ? data.checks.slice(0, 30).map((c) => ({ id: text(c?.id, 40), label: text(c?.label, 80), status: ["ok", "failed", "skipped"].includes(c?.status) ? c.status : "unknown", message: text(c?.message) })) : null;
  if (!finishedAt || !checks?.length || !["success", "failure"].includes(data.status)) return { invalid: true, reason: "Rapport incomplet." };
  const errors = Array.isArray(data.errors) ? data.errors.slice(0, 20).map((e) => ({ check: text(e?.check, 40), message: text(e?.message) })) : [];
  // Un rapport « réussi » doit l'être de bout en bout : sinon il est incohérent, donc inconnu.
  const ok = data.status === "success" && data.ok === true;
  if (ok && (errors.length || checks.some((c) => c.status !== "ok") || CHECKS.some(([id]) => !checks.some((c) => c.id === id)))) return { invalid: true, reason: "Rapport incohérent (réussi, mais avec des contrôles absents ou non réussis)." };
  const s = data.sqlite || {};
  const m = data.media || {};
  const u = m.uploads || {};
  const r = m.repo || {};
  return {
    invalid: false,
    ok,
    startedAt: iso(data.startedAt),
    finishedAt,
    durationMs: count(data.durationMs),
    backup: data.backup && BACKUP_NAME.test(data.backup.name || "") ? { name: data.backup.name, size: count(data.backup.size), createdAt: iso(data.backup.createdAt) } : null,
    sqlite: { integrity: ["ok", "failed"].includes(s.integrity) ? s.integrity : null, tables: count(s.tables), tablesChecked: count(s.tablesChecked), foreignKeyViolations: count(s.foreignKeyViolations), latestMigration: text(s.migrations?.latest, 80) || null },
    consistency: { ok: data.consistency?.ok === true ? true : data.consistency?.ok === false ? false : null },
    media: {
      references: count(m.references), brokenReferences: count(m.brokenReferences), missingTotal: count(m.missingTotal),
      repo: { media: count(r.media), files: count(r.files), verified: count(r.verified), missing: count(r.missing) },
      uploads: { expected: count(u.expected), recovered: count(u.recovered), verified: count(u.verified), missing: count(u.missing), corrupted: count(u.corrupted) }
    },
    checks,
    errors,
    warnings: Array.isArray(data.warnings) ? data.warnings.slice(0, 20).map((w) => text(w?.message ?? w)) : [],
    lastSuccessAt: iso(data.lastSuccessAt),
    lastSuccessBackup: BACKUP_NAME.test(data.lastSuccessBackup || "") ? data.lastSuccessBackup : null
  };
}

/**
 * Enregistre le rapport (fichier temporaire unique, fsync, renommage : jamais à moitié écrit). La date du
 * dernier succès est reprise du rapport précédent s'il est valide, et n'est remplacée que par un succès.
 */
export function saveRestoreReport(dataDir, report) {
  const previous = readRestoreReport(dataDir);
  let last = previous && !previous.invalid && previous.lastSuccessAt ? { at: previous.lastSuccessAt, backup: previous.lastSuccessBackup } : null;
  if (previous?.invalid) report.warnings.push({ check: "report", message: "Rapport précédent illisible : date du dernier test réussi inconnue." });
  if (report.ok) last = { at: report.finishedAt, backup: report.backup?.name ?? null };
  report.lastSuccessAt = last?.at ?? null;
  report.lastSuccessBackup = last?.backup ?? null;
  const file = restoreReportFile(dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o750 });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  const fd = fs.openSync(tmp, "wx", 0o640);
  try {
    fs.writeSync(fd, `${JSON.stringify(report, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
  return report;
}
