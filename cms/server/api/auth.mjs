/** Connexion, déconnexion, session, changement de mot de passe. */
import { readJson } from "../http/body.mjs";
import { HttpError, ValidationError } from "../http/errors.mjs";
import { verifyPassword, dummyVerify } from "../auth/passwords.mjs";
import { createSession, destroySession, destroyUserSessions, sessionCookie, loadSession } from "../auth/sessions.mjs";
import { loginBlocked, recordLoginAttempt } from "../auth/rate-limit.mjs";
import { permissionsOf, ROLES } from "../auth/permissions.mjs";
import { changeOwnPassword } from "../services/users.mjs";
import { audit } from "../services/audit.mjs";
import { now } from "../db/index.mjs";
import { cleanText } from "../services/validation.mjs";

export function sessionPayload(ctx) {
  const { user, session, config } = ctx;
  return {
    user: { ...user, roleLabel: ROLES[user.role] },
    csrf: session.csrf,
    permissions: permissionsOf(user),
    publishMode: config.publishMode,
    idleMinutes: config.sessionIdleMinutes
  };
}

export function registerAuthRoutes(router, { config, db }) {
  router.post("/api/auth/login", async (ctx) => {
    const body = await readJson(ctx.req, 16 * 1024);
    const email = cleanText(body.email).toLowerCase().slice(0, 200);
    const password = String(body.password ?? "").slice(0, 200);
    if (!email || !password) throw new ValidationError({ email: email ? undefined : "Adresse e-mail requise.", password: password ? undefined : "Mot de passe requis." });
    if (loginBlocked(db, { email, ip: ctx.ip })) {
      audit(db, { ip: ctx.ip }, "auth.blocked", "user", null, email);
      throw new HttpError(429, "Trop de tentatives de connexion. Réessayez dans 15 minutes.");
    }
    const row = db.get("SELECT * FROM users WHERE email = ?", email);
    const ok = row ? await verifyPassword(password, row.password_hash) : await dummyVerify(password);
    if (!ok || !row.active) {
      recordLoginAttempt(db, { email, ip: ctx.ip, success: false });
      audit(db, { ip: ctx.ip }, "auth.failed", "user", row?.id ?? null, email);
      // Même message pour un compte inconnu, désactivé ou un mauvais mot de passe.
      throw new HttpError(401, "Adresse e-mail ou mot de passe incorrect.");
    }
    recordLoginAttempt(db, { email, ip: ctx.ip, success: true });
    const { token, expires } = createSession(db, config, row, { ip: ctx.ip, userAgent: ctx.req.headers["user-agent"] });
    db.run("UPDATE users SET last_login_at = ? WHERE id = ?", now(), row.id);
    audit(db, { user: row, ip: ctx.ip }, "auth.login", "user", row.id, row.email);
    ctx.res.setHeader("Set-Cookie", sessionCookie(config, token, expires));
    // Nouvelle session : relue pour renvoyer le jeton CSRF et les permissions.
    const session = loadSession(db, config, token);
    return sessionPayload({ ...ctx, session, user: session.user });
  }, { public: true });

  router.post("/api/auth/logout", (ctx) => {
    destroySession(db, ctx.session.id);
    audit(db, ctx.actor, "auth.logout", "user", ctx.user.id, "");
    ctx.res.setHeader("Set-Cookie", sessionCookie(config, "", null));
    return { ok: true };
  }, { allowPasswordChange: true });

  router.get("/api/auth/session", (ctx) => sessionPayload(ctx), { allowPasswordChange: true });

  router.post("/api/auth/password", async (ctx) => {
    const body = await readJson(ctx.req, 16 * 1024);
    await changeOwnPassword(db, ctx.user, ctx.session.id, body);
    audit(db, ctx.actor, "auth.password", "user", ctx.user.id, "Mot de passe modifié");
    return { ok: true };
  }, { allowPasswordChange: true });

  router.post("/api/auth/logout-others", (ctx) => {
    destroyUserSessions(db, ctx.user.id, ctx.session.id);
    audit(db, ctx.actor, "auth.logout-others", "user", ctx.user.id, "Autres sessions fermées");
    return { ok: true };
  });
}
