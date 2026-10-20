/** Comptes (administrateurs uniquement, pas d'inscription publique) et journal d'activité. */
import { readJson } from "../http/body.mjs";
import { pageParams } from "../http/query.mjs";
import { audit, listAudit } from "../services/audit.mjs";
import * as users from "../services/users.mjs";

export function registerUserRoutes(router, { db }) {
  /* ---------- Comptes ---------- */
  router.get("/api/users", () => users.listUsers(db), { perm: "users.manage" });
  router.post("/api/users", async (ctx) => {
    const { user, temporaryPassword } = await users.createUser(db, await readJson(ctx.req, 16 * 1024));
    audit(db, ctx.actor, "user.create", "user", user.id, `${user.email} (${user.roleLabel})`);
    return { user, temporaryPassword };
  }, { perm: "users.manage", status: 201 });
  router.put("/api/users/:id", async (ctx) => {
    const user = users.updateUser(db, ctx.params.id, await readJson(ctx.req, 16 * 1024), ctx.user);
    audit(db, ctx.actor, "user.update", "user", user.id, `${user.email} : ${user.roleLabel}${user.active ? "" : ", désactivé"}`);
    return user;
  }, { perm: "users.manage" });
  router.post("/api/users/:id/reset-password", async (ctx) => {
    const temporaryPassword = await users.resetPassword(db, ctx.params.id);
    audit(db, ctx.actor, "user.reset-password", "user", ctx.params.id, "Mot de passe réinitialisé");
    return { temporaryPassword };
  }, { perm: "users.manage" });
  router.delete("/api/users/:id", (ctx) => {
    const user = users.deleteUser(db, ctx.params.id, ctx.user);
    audit(db, ctx.actor, "user.delete", "user", user.id, user.email);
    return { ok: true };
  }, { perm: "users.manage" });

  /* ---------- Journal ---------- */
  router.get("/api/audit", (ctx) => {
    const q = ctx.query;
    return listAudit(db, { ...pageParams(q, 50, 200), entityType: q.get("entityType") || "", q: q.get("q") || "" });
  }, { perm: "audit.read" });
}
