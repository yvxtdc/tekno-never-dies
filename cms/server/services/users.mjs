/** Comptes : création par un administrateur uniquement (pas d'inscription publique). */
import { now } from "../db/index.mjs";
import { badRequest, conflict, notFound, ValidationError } from "../http/errors.mjs";
import { Validator } from "./validation.mjs";
import { hashPassword, verifyPassword, passwordProblem, generatePassword } from "../auth/passwords.mjs";
import { destroyUserSessions } from "../auth/sessions.mjs";
import { ROLES } from "../auth/permissions.mjs";

const serialize = (r) => ({
  id: r.id,
  email: r.email,
  name: r.name,
  role: r.role,
  roleLabel: ROLES[r.role],
  active: Boolean(r.active),
  mustChangePassword: Boolean(r.must_change_password),
  lastLoginAt: r.last_login_at,
  createdAt: r.created_at
});

export const listUsers = (db) => db.all("SELECT * FROM users ORDER BY active DESC, name COLLATE NOCASE").map(serialize);

export function getUser(db, id) {
  const row = db.get("SELECT * FROM users WHERE id = ?", id);
  if (!row) throw notFound("Compte introuvable.");
  return serialize(row);
}

const activeAdmins = (db) => db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").n;

/** Crée un compte avec un mot de passe temporaire (à changer à la première connexion). */
export async function createUser(db, input, { password } = {}) {
  const v = new Validator(input);
  const email = v.email("email", { required: true });
  const name = v.text("name", { required: true, max: 80, label: "Le nom" });
  const role = v.oneOf("role", Object.keys(ROLES), { fallback: "editor", label: "Le rôle" });
  v.throwIfErrors();
  if (db.get("SELECT 1 FROM users WHERE email = ?", email)) throw conflict("Un compte existe déjà avec cette adresse e-mail.");
  const temporary = password || generatePassword();
  if (password) {
    const problem = passwordProblem(password, { email, name });
    if (problem) throw new ValidationError({ password: problem });
  }
  const t = now();
  const { lastInsertRowid } = db.run(
    "INSERT INTO users (email, name, role, password_hash, must_change_password, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
    email, name, role, await hashPassword(temporary), password ? 0 : 1, t, t
  );
  return { user: getUser(db, Number(lastInsertRowid)), temporaryPassword: password ? null : temporary };
}

export function updateUser(db, id, input, actor) {
  const current = db.get("SELECT * FROM users WHERE id = ?", id);
  if (!current) throw notFound("Compte introuvable.");
  const v = new Validator(input);
  const name = v.has("name") ? v.text("name", { required: true, max: 80, label: "Le nom" }) : current.name;
  const role = v.has("role") ? v.oneOf("role", Object.keys(ROLES), { label: "Le rôle" }) : current.role;
  const active = v.has("active") ? (v.bool("active") ? 1 : 0) : current.active;
  v.throwIfErrors();
  if (id === actor.id && (role !== current.role || !active)) throw badRequest("Vous ne pouvez pas modifier votre propre rôle ni désactiver votre compte.");
  if (current.role === "admin" && current.active && (role !== "admin" || !active) && activeAdmins(db) <= 1) {
    throw badRequest("Il doit rester au moins un administrateur actif.");
  }
  db.run("UPDATE users SET name = ?, role = ?, active = ?, updated_at = ? WHERE id = ?", name, role, active, now(), id);
  if (!active || role !== current.role) destroyUserSessions(db, id);
  return getUser(db, id);
}

export async function resetPassword(db, id) {
  getUser(db, id);
  const temporary = generatePassword();
  db.run("UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?", await hashPassword(temporary), now(), id);
  destroyUserSessions(db, id);
  return temporary;
}

export async function changeOwnPassword(db, user, sessionId, { currentPassword, newPassword }) {
  const row = db.get("SELECT * FROM users WHERE id = ?", user.id);
  if (!row || !(await verifyPassword(String(currentPassword || ""), row.password_hash))) {
    throw new ValidationError({ currentPassword: "Mot de passe actuel incorrect." });
  }
  const problem = passwordProblem(newPassword, { email: row.email, name: row.name });
  if (problem) throw new ValidationError({ newPassword: problem });
  if (await verifyPassword(String(newPassword), row.password_hash)) throw new ValidationError({ newPassword: "Choisissez un mot de passe différent de l'actuel." });
  const t = now();
  db.run("UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = ?, updated_at = ? WHERE id = ?", await hashPassword(String(newPassword)), t, t, user.id);
  // Les autres sessions ouvertes (autre appareil, session volée) sont fermées.
  destroyUserSessions(db, user.id, sessionId);
}

export function deleteUser(db, id, actor) {
  if (id === actor.id) throw badRequest("Vous ne pouvez pas supprimer votre propre compte.");
  const user = getUser(db, id);
  if (user.role === "admin" && user.active && activeAdmins(db) <= 1) throw badRequest("Il doit rester au moins un administrateur actif.");
  db.run("DELETE FROM users WHERE id = ?", id);
  return user;
}
