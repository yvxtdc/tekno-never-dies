/**
 * Sauvegardes de la base : copie cohérente à chaud (API de sauvegarde SQLite), rotation, contrôle
 * d'intégrité avant restauration. Les originaux des médias (CMS_DATA_DIR/media/originals) sont à
 * sauvegarder avec le reste du dossier de données (voir docs/cms/exploitation.md).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { backup as sqliteBackup, DatabaseSync } from "node:sqlite";

const NAME = /^cms-\d{8}-\d{6}(-[a-z0-9-]+)?\.sqlite$/;

const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

export async function createBackup(config, db, label = "") {
  fs.mkdirSync(config.backupDir, { recursive: true, mode: 0o750 });
  const suffix = label ? `-${label.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 20)}` : "";
  const name = `cms-${stamp()}${suffix}.sqlite`;
  const dest = path.join(config.backupDir, name);
  await sqliteBackup(db.raw, dest);
  fs.chmodSync(dest, 0o640);
  rotateBackups(config);
  return { name, size: fs.statSync(dest).size };
}

export function listBackups(config) {
  if (!fs.existsSync(config.backupDir)) return [];
  return fs
    .readdirSync(config.backupDir)
    .filter((f) => NAME.test(f))
    .map((name) => {
      const stat = fs.statSync(path.join(config.backupDir, name));
      return { name, size: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

export function backupFile(config, name) {
  if (!NAME.test(name)) return null;
  const file = path.join(config.backupDir, name);
  return fs.existsSync(file) ? file : null;
}

export function rotateBackups(config) {
  const all = listBackups(config).filter((b) => !b.name.includes("-avant-restauration"));
  for (const old of all.slice(config.backupKeep)) fs.rmSync(path.join(config.backupDir, old.name), { force: true });
}

export function lastBackupAt(config) {
  return listBackups(config)[0]?.createdAt ?? null;
}

/** Vérifie qu'un fichier est une base du CMS intègre ; renvoie la liste des migrations. */
export function inspectBackup(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const check = db.prepare("PRAGMA integrity_check").get();
    if (Object.values(check)[0] !== "ok") throw new Error("Contrôle d'intégrité SQLite en échec.");
    const migrations = db.prepare("SELECT name FROM schema_migrations ORDER BY name").all().map((r) => r.name);
    const counts = Object.fromEntries(["events", "artists", "venues", "media", "users"].map((t) => [t, db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]));
    return { migrations, counts };
  } finally {
    db.close();
  }
}

/**
 * Restauration (serveur arrêté) : la base actuelle est d'abord copiée dans backups/ avec le suffixe
 * « avant-restauration », puis remplacée par la sauvegarde choisie.
 */
export async function restoreBackup(config, source) {
  const info = inspectBackup(source);
  fs.mkdirSync(config.backupDir, { recursive: true });
  let safety = null;
  if (fs.existsSync(config.dbFile)) {
    safety = path.join(config.backupDir, `cms-${stamp()}-avant-restauration.sqlite`);
    const current = new DatabaseSync(config.dbFile);
    await sqliteBackup(current, safety);
    current.close();
  }
  for (const ext of ["", "-wal", "-shm"]) fs.rmSync(`${config.dbFile}${ext}`, { force: true });
  fs.copyFileSync(source, config.dbFile);
  return { info, safety };
}

/**
 * Test de restauration : la dernière sauvegarde (ou celle indiquée) est copiée dans un dossier temporaire,
 * puis ouverte et contrôlée (intégrité, migrations, contenus). La base en service et les sauvegardes ne
 * sont jamais modifiées. Le résultat est noté (settings « backup.restoreTest ») pour le tableau de santé.
 */
export function verifyBackupRestore(config, db, name = null) {
  const latest = listBackups(config).find((b) => !b.name.includes("-avant-restauration"));
  const target = name ? backupFile(config, name) : latest ? backupFile(config, latest.name) : null;
  const result = { at: new Date().toISOString(), backup: target ? path.basename(target) : null, ok: false, detail: "" };
  if (!target) result.detail = "Aucune sauvegarde à tester.";
  else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnd-restore-test-"));
    try {
      const copy = path.join(dir, "test.sqlite");
      fs.copyFileSync(target, copy);
      const info = inspectBackup(copy);
      result.ok = true;
      result.detail = `${info.counts.events} soirée(s), ${info.counts.artists} artiste(s), ${info.counts.users} compte(s) ; migrations ${info.migrations.at(-1) || "aucune"}.`;
    } catch (error) {
      result.detail = `Sauvegarde inutilisable : ${String(error.message).split("\n")[0].slice(0, 200)}`;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  db.run("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('backup.restoreTest', ?, ?)", JSON.stringify(result), result.at);
  return result;
}

/** Fichier d'état écrit par cms/deploy/backup-media.sh (sauvegarde hors serveur). */
export const externalStatusFile = (config) => path.join(config.dataDir, "status", "backup-externe.json");

/**
 * Dernier rapport de la sauvegarde hors serveur, ou null (script jamais exécuté, ou version sans rapport).
 * commandOk : envoi terminé sans erreur ; verified : contenu distant vérifié identique (true), différences
 * ou machine injoignable à la vérification (false), non vérifié (null : vérification désactivée, ou rapport
 * d'une version du script sans vérification). Jamais de chemin ni d'identifiant.
 */
export function externalBackupStatus(config) {
  const file = externalStatusFile(config);
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const count = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
    return {
      finishedAt: String(data.finishedAt || ""),
      ok: data.ok === true,
      step: String(data.step || ""),
      message: String(data.message || "").slice(0, 300),
      // Rapport sans ces champs (version précédente du script) : envoi seulement, rien de vérifié.
      commandOk: "commandOk" in data ? data.commandOk === true : data.ok === true,
      verified: data.verified === true ? true : data.verified === false ? false : null,
      verifiedFiles: count(data.verifiedFiles),
      differences: count(data.differences),
      latestBackup: /^cms-\d{8}-\d{6}(-[a-z0-9-]+)?\.sqlite$/.test(data.latestBackup || "") ? data.latestBackup : null
    };
  } catch {
    return { finishedAt: "", ok: false, step: "", message: "Rapport illisible.", commandOk: false, verified: null, verifiedFiles: null, differences: null, latestBackup: null };
  }
}
