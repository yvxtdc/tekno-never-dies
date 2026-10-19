/**
 * Mots de passe : scrypt (intégré à Node.js, résistant aux attaques par GPU), sel aléatoire de
 * 16 octets, comparaison en temps constant. Format stocké : scrypt$N$r$p$sel$empreinte (base64).
 */
import crypto from "node:crypto";

const N = 2 ** 15, R = 8, P = 1, KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

const scrypt = (password, salt, n, r, p) =>
  new Promise((resolve, reject) => {
    crypto.scrypt(password.normalize("NFKC"), salt, KEYLEN, { N: n, r, p, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key)));
  });

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, "base64");
  const key = await scrypt(String(password), Buffer.from(salt, "base64"), Number(n), Number(r), Number(p));
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

// Empreinte factice : on calcule un scrypt même pour une adresse inconnue (temps de réponse identique).
let dummy;
export async function dummyVerify(password) {
  dummy ??= await hashPassword("tnd-dummy-password-for-timing");
  await verifyPassword(password, dummy);
  return false;
}

const COMMON = new Set(["motdepasse", "password", "azertyuiop", "123456789012", "teknoneverdies", "tekno never dies", "qwertyuiop12", "administrateur"]);

/** Règles de mot de passe ; renvoie un message d'erreur ou null. */
export function passwordProblem(password, { email = "", name = "" } = {}) {
  const value = String(password || "");
  if (value.length < 12) return "Le mot de passe doit contenir au moins 12 caractères.";
  if (value.length > 200) return "Le mot de passe est trop long (200 caractères maximum).";
  const lower = value.toLowerCase();
  if (COMMON.has(lower)) return "Ce mot de passe est trop courant.";
  if (/^(.)\1+$/.test(value)) return "Le mot de passe ne doit pas répéter un seul caractère.";
  const local = email.split("@")[0]?.toLowerCase();
  if ((local && local.length >= 4 && lower.includes(local)) || (name && name.length >= 4 && lower.includes(name.toLowerCase()))) {
    return "Le mot de passe ne doit pas contenir votre nom ou votre adresse e-mail.";
  }
  return null;
}

/** Mot de passe temporaire lisible (création de compte, réinitialisation par un administrateur). */
export function generatePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(20);
  let out = "";
  for (let i = 0; i < 20; i++) {
    out += alphabet[bytes[i] % alphabet.length];
    if (i % 5 === 4 && i < 19) out += "-";
  }
  return out;
}
