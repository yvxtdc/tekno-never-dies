/**
 * Limitation des tentatives de connexion, persistée en base (résiste à un redémarrage) :
 *  - 10 échecs en 15 minutes depuis une même adresse IP ;
 *  - 5 échecs en 15 minutes pour un même compte (protège un compte attaqué depuis plusieurs IP).
 * Au-delà, la connexion est refusée jusqu'à la fin de la fenêtre, même avec le bon mot de passe.
 */
import { now } from "../db/index.mjs";

const WINDOW_MS = 15 * 60e3;
const MAX_PER_IP = 10;
const MAX_PER_ACCOUNT = 5;

export function loginBlocked(db, { email, ip }) {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const byIp = db.get("SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND success = 0 AND created_at > ?", ip, since).n;
  const byEmail = db.get("SELECT COUNT(*) AS n FROM login_attempts WHERE email = ? AND success = 0 AND created_at > ?", email, since).n;
  return byIp >= MAX_PER_IP || byEmail >= MAX_PER_ACCOUNT;
}

export function recordLoginAttempt(db, { email, ip, success }) {
  db.run("INSERT INTO login_attempts (email, ip, success, created_at) VALUES (?, ?, ?, ?)", email, ip, success ? 1 : 0, now());
  if (success) {
    // Une connexion réussie remet le compteur du compte à zéro.
    db.run("DELETE FROM login_attempts WHERE email = ? AND success = 0", email);
  }
}

export function purgeLoginAttempts(db) {
  db.run("DELETE FROM login_attempts WHERE created_at < ?", new Date(Date.now() - 30 * 86400e3).toISOString());
}
