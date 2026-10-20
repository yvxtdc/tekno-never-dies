/**
 * Sessions côté serveur : jeton aléatoire de 32 octets dans un cookie HttpOnly, SameSite=Strict,
 * Secure en production (préfixe __Host-). La base ne garde que son empreinte SHA-256.
 * Expiration après inactivité (CMS_SESSION_IDLE_MINUTES) et durée maximale (CMS_SESSION_MAX_HOURS).
 * Chaque session a son jeton CSRF, exigé dans l'en-tête X-CSRF-Token des requêtes qui modifient.
 */
import crypto from "node:crypto";
import { now } from "../db/index.mjs";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

export function createSession(db, config, user, { ip, userAgent }) {
  const token = crypto.randomBytes(32).toString("base64url");
  const csrf = crypto.randomBytes(24).toString("base64url");
  const created = new Date();
  const expires = new Date(created.getTime() + config.sessionMaxHours * 3600e3);
  db.run(
    `INSERT INTO sessions (id, user_id, csrf_token, created_at, last_seen_at, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    sha256(token), user.id, csrf, created.toISOString(), created.toISOString(), expires.toISOString(), ip, String(userAgent || "").slice(0, 300)
  );
  return { token, csrf, expires };
}

/** Session valide (et prolongée) pour ce jeton, ou null. */
export function loadSession(db, config, token) {
  if (!token || token.length > 100) return null;
  const id = sha256(token);
  const row = db.get(
    `SELECT s.id, s.csrf_token, s.last_seen_at, s.expires_at, s.created_at,
            u.id AS user_id, u.email, u.name, u.role, u.active, u.must_change_password
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    id
  );
  if (!row) return null;
  const t = Date.now();
  const idleLimit = Date.parse(row.last_seen_at) + config.sessionIdleMinutes * 60e3;
  if (!row.active || t > Date.parse(row.expires_at) || t > idleLimit) {
    db.run("DELETE FROM sessions WHERE id = ?", id);
    return null;
  }
  // Mise à jour de l'activité au plus une fois par minute (évite une écriture par requête).
  if (t - Date.parse(row.last_seen_at) > 60e3) db.run("UPDATE sessions SET last_seen_at = ? WHERE id = ?", now(), id);
  return {
    id,
    csrf: row.csrf_token,
    user: { id: row.user_id, email: row.email, name: row.name, role: row.role, active: Boolean(row.active), mustChangePassword: Boolean(row.must_change_password) }
  };
}

export function destroySession(db, sessionId) {
  db.run("DELETE FROM sessions WHERE id = ?", sessionId);
}

export function destroyUserSessions(db, userId, exceptSessionId = null) {
  db.run("DELETE FROM sessions WHERE user_id = ? AND id IS NOT ?", userId, exceptSessionId);
}

export function purgeExpiredSessions(db) {
  db.run("DELETE FROM sessions WHERE expires_at < ?", now());
}

export function parseCookies(header = "") {
  const out = {};
  for (const part of String(header).split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (key && !(key in out)) out[key] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(config, token, expires) {
  const parts = [`${config.cookieName}=${token}`, "Path=/", "HttpOnly", "SameSite=Strict"];
  if (config.cookieSecure) parts.push("Secure");
  parts.push(expires ? `Expires=${expires.toUTCString()}` : "Max-Age=0");
  return parts.join("; ");
}
