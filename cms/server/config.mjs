/**
 * Configuration du CMS, lue dans les variables d'environnement (voir cms/.env.example).
 *
 * Un fichier cms/.env (jamais versionné) est chargé s'il existe ; les variables déjà définies
 * dans l'environnement restent prioritaires. Aucune valeur secrète n'a de défaut : le CMS n'a
 * pas besoin de secret partagé (sessions aléatoires stockées en base, mots de passe hachés).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

const bool = (value, fallback) => {
  if (value === undefined || value === "") return fallback;
  return /^(1|true|yes|oui|on)$/i.test(String(value));
};
const int = (value, fallback, min = 0) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
};

/**
 * @param {Record<string, string | undefined>} [overrides] valeurs prioritaires (tests)
 */
export function loadConfig(overrides = {}) {
  if (!overrides.CMS_SKIP_ENV_FILE) loadEnvFile(path.join(REPO_ROOT, "cms/.env"));
  const env = { ...process.env, ...overrides };
  const publicUrl = new URL(env.CMS_PUBLIC_URL || `http://localhost:${env.CMS_PORT || 8787}`);
  const secure = bool(env.CMS_COOKIE_SECURE, publicUrl.protocol === "https:");
  const publishMode = ["files", "commit", "push"].includes(env.CMS_PUBLISH_MODE) ? env.CMS_PUBLISH_MODE : "files";
  const dataDir = path.resolve(REPO_ROOT, env.CMS_DATA_DIR || ".cms-data");
  return Object.freeze({
    host: env.CMS_HOST || "127.0.0.1",
    port: int(env.CMS_PORT, 8787),
    publicOrigin: publicUrl.origin,
    // Dossier des données persistantes : base SQLite, médias importés, sauvegardes.
    dataDir,
    dbFile: path.join(dataDir, "cms.sqlite"),
    mediaDir: path.join(dataDir, "media"),
    backupDir: path.join(dataDir, "backups"),
    // Copie de travail du site (dépôt Git) dans laquelle la publication écrit.
    siteDir: path.resolve(REPO_ROOT, env.CMS_SITE_DIR || "."),
    cookieSecure: secure,
    // Préfixe __Host- : cookie limité à l'hôte exact, Secure obligatoire (HTTPS).
    cookieName: secure ? "__Host-tnd_cms" : "tnd_cms",
    trustProxy: bool(env.CMS_TRUST_PROXY, false),
    sessionIdleMinutes: int(env.CMS_SESSION_IDLE_MINUTES, 120, 5),
    sessionMaxHours: int(env.CMS_SESSION_MAX_HOURS, 12, 1),
    maxUploadBytes: int(env.CMS_MAX_UPLOAD_MB, 20, 1) * 1024 * 1024,
    publishMode,
    gitRemote: env.CMS_GIT_REMOTE || "origin",
    gitBranch: env.CMS_GIT_BRANCH || "main",
    gitAuthorName: env.CMS_GIT_AUTHOR_NAME || "CMS Tekno Never Dies",
    gitAuthorEmail: env.CMS_GIT_AUTHOR_EMAIL || "cms@teknoneverdies.fr",
    scheduler: bool(env.CMS_SCHEDULER, true),
    autoPublishScheduled: bool(env.CMS_AUTO_PUBLISH_SCHEDULED, true),
    runMaps: bool(env.CMS_RUN_MAPS, true),
    backupKeep: int(env.CMS_BACKUP_KEEP, 30, 1),
    // Sauvegarde automatique quotidienne de la base (0 = désactivée).
    backupEveryHours: int(env.CMS_BACKUP_EVERY_HOURS, 24, 0),
    logLevel: env.CMS_LOG_LEVEL || "info",
    timezone: "Europe/Paris"
  });
}
