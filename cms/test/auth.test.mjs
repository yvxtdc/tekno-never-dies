import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startCms, PASSWORD, ORIGIN } from "./helpers.mjs";
import { hashPassword, verifyPassword, passwordProblem } from "../server/auth/passwords.mjs";
import { can } from "../server/auth/permissions.mjs";

describe("mots de passe et rôles", () => {
  test("scrypt : vérification, sel aléatoire, mauvais mot de passe refusé", async () => {
    const a = await hashPassword("correct horse battery");
    const b = await hashPassword("correct horse battery");
    assert.notEqual(a, b, "deux empreintes du même mot de passe diffèrent (sel)");
    assert.match(a, /^scrypt\$32768\$8\$1\$/);
    assert.equal(await verifyPassword("correct horse battery", a), true);
    assert.equal(await verifyPassword("correct horse batterz", a), false);
    assert.equal(await verifyPassword("x", "n'importe quoi"), false);
  });

  test("règles de mot de passe", () => {
    assert.ok(passwordProblem("court"));
    assert.ok(passwordProblem("aaaaaaaaaaaaaaa"));
    assert.ok(passwordProblem("motdepasse"));
    assert.ok(passwordProblem("yannis-2026-tekno", { email: "yannis@x.fr" }));
    assert.equal(passwordProblem("une phrase de passe longue"), null);
  });

  test("permissions par rôle", () => {
    const admin = { role: "admin", active: true };
    const editor = { role: "editor", active: true };
    assert.equal(can(admin, "users.manage"), true);
    assert.equal(can(editor, "users.manage"), false);
    assert.equal(can(editor, "content.write"), true);
    assert.equal(can(editor, "content.delete"), false);
    assert.equal(can(editor, "media.delete"), false);
    assert.equal(can({ ...admin, active: false }, "content.read"), false);
    assert.throws(() => can(admin, "inconnue"));
  });
});

describe("API d'authentification", () => {
  let cms;
  before(async () => {
    cms = await startCms();
    await cms.createUser("admin");
    await cms.createUser("editor");
  });
  after(() => cms.close());

  test("connexion : cookie HttpOnly SameSite=Strict, jeton CSRF, permissions", async () => {
    const c = cms.client();
    const res = await c.post("/api/auth/login", { email: "ADMIN@test.fr", password: PASSWORD });
    assert.equal(res.status, 200);
    assert.match(res.setCookie, /HttpOnly/);
    assert.match(res.setCookie, /SameSite=Strict/);
    assert.match(res.setCookie, /Path=\//);
    assert.ok(res.data.csrf.length > 20);
    assert.ok(res.data.permissions.includes("users.manage"));
    assert.equal(res.data.user.email, "admin@test.fr");
    assert.equal(res.data.user.password_hash, undefined);
    const session = await c.get("/api/auth/session");
    assert.equal(session.status, 200);
  });

  test("échec : même message pour un compte inconnu ou un mauvais mot de passe", async () => {
    const c = cms.client();
    const wrong = await c.post("/api/auth/login", { email: "admin@test.fr", password: "pas le bon mot de passe" });
    const unknown = await c.post("/api/auth/login", { email: "personne@test.fr", password: "pas le bon mot de passe" });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.data.error, unknown.data.error);
  });

  test("API protégée sans session : 401", async () => {
    const c = cms.client();
    for (const url of ["/api/events", "/api/users", "/api/media", "/api/dashboard"]) {
      assert.equal((await c.get(url)).status, 401, url);
    }
  });

  test("CSRF : requête de modification sans jeton ou avec un mauvais jeton refusée", async () => {
    const c = await cms.login("admin");
    const csrf = c.csrf;
    c.csrf = "";
    assert.equal((await c.post("/api/events", { title: "x" })).status, 403);
    c.csrf = "mauvais-jeton-de-la-bonne-longueur-xx";
    assert.equal((await c.post("/api/events", { title: "x" })).status, 403);
    c.csrf = csrf;
    assert.equal((await c.post("/api/events", { title: "Soirée CSRF", date: "2030-01-01" })).status, 201);
  });

  test("Origin : requête venant d'un autre site refusée, même avec la session", async () => {
    const c = await cms.login("admin");
    c.origin = "https://site-malveillant.example";
    const res = await c.post("/api/events", { title: "x", date: "2030-01-01" });
    assert.equal(res.status, 403);
    c.origin = "";
    assert.equal((await c.post("/api/events", { title: "x", date: "2030-01-01" })).status, 403, "sans Origin ni Referer");
    c.origin = ORIGIN;
  });

  test("rôle éditeur : accès aux contenus, pas aux comptes ni au journal ni aux sauvegardes", async () => {
    const c = await cms.login("editor");
    assert.equal((await c.get("/api/events")).status, 200);
    assert.equal((await c.get("/api/users")).status, 403);
    assert.equal((await c.get("/api/audit")).status, 403);
    assert.equal((await c.get("/api/backups")).status, 403);
    assert.equal((await c.post("/api/users", { email: "x@y.fr", name: "X", role: "admin" })).status, 403);
  });

  test("déconnexion : la session est supprimée côté serveur", async () => {
    const c = await cms.login("admin");
    const cookie = c.cookie;
    assert.equal((await c.post("/api/auth/logout", {})).status, 200);
    c.cookie = cookie; // réutilisation d'un cookie volé après déconnexion
    assert.equal((await c.get("/api/auth/session")).status, 401);
  });

  test("expiration de session après inactivité", async () => {
    const c = await cms.login("admin");
    cms.db.run("UPDATE sessions SET last_seen_at = ?", new Date(Date.now() - 3 * 3600e3).toISOString());
    assert.equal((await c.get("/api/auth/session")).status, 401);
  });

  test("mot de passe temporaire : seules la session et le changement de mot de passe sont permis", async () => {
    const admin = await cms.login("admin");
    const created = await admin.post("/api/users", { email: "nouveau@test.fr", name: "Nouveau", role: "editor" });
    assert.equal(created.status, 201);
    const temporary = created.data.temporaryPassword;
    assert.ok(temporary.length >= 20);
    const c = cms.client();
    const login = await c.post("/api/auth/login", { email: "nouveau@test.fr", password: temporary });
    assert.equal(login.data.user.mustChangePassword, true);
    assert.equal((await c.get("/api/events")).status, 403);
    const weak = await c.post("/api/auth/password", { currentPassword: temporary, newPassword: "court" });
    assert.equal(weak.status, 422);
    const ok = await c.post("/api/auth/password", { currentPassword: temporary, newPassword: "une nouvelle phrase solide" });
    assert.equal(ok.status, 200);
    assert.equal((await c.get("/api/events")).status, 200);
  });

  test("changement de mot de passe : les autres sessions sont fermées", async () => {
    await cms.createUser("editor", "deux@test.fr");
    const first = cms.client();
    await first.post("/api/auth/login", { email: "deux@test.fr", password: PASSWORD });
    const second = cms.client();
    await second.post("/api/auth/login", { email: "deux@test.fr", password: PASSWORD });
    const res = await second.post("/api/auth/password", { currentPassword: PASSWORD, newPassword: "encore une phrase solide" });
    assert.equal(res.status, 200);
    assert.equal((await first.get("/api/auth/session")).status, 401);
    assert.equal((await second.get("/api/auth/session")).status, 200);
  });

  test("limitation des tentatives : blocage après 5 échecs sur un compte, même avec le bon mot de passe", async () => {
    await cms.createUser("editor", "cible@test.fr");
    const c = cms.client();
    for (let i = 0; i < 5; i++) assert.equal((await c.post("/api/auth/login", { email: "cible@test.fr", password: `mauvais ${i}` })).status, 401);
    const blocked = await c.post("/api/auth/login", { email: "cible@test.fr", password: PASSWORD });
    assert.equal(blocked.status, 429);
    assert.ok(cms.db.get("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'auth.blocked'").n >= 1);
  });

  test("derrière un proxy : IP réelle = dernière adresse de X-Forwarded-For (non falsifiable)", async () => {
    const proxied = await startCms({ env: { CMS_TRUST_PROXY: "1" } });
    await proxied.createUser("editor", "proxy@test.fr");
    const c = proxied.client();
    await c.post("/api/auth/login", { email: "proxy@test.fr", password: "mauvais mot de passe" }, { headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.9" } });
    assert.equal(proxied.db.get("SELECT ip FROM login_attempts").ip, "203.0.113.9");
    await proxied.close();
  });

  test("compte désactivé : connexion impossible et sessions fermées", async () => {
    const admin = await cms.login("admin");
    await cms.createUser("editor", "parti@test.fr");
    const user = cms.client();
    await user.post("/api/auth/login", { email: "parti@test.fr", password: PASSWORD });
    const id = cms.db.get("SELECT id FROM users WHERE email = 'parti@test.fr'").id;
    assert.equal((await admin.put(`/api/users/${id}`, { active: false })).status, 200);
    assert.equal((await user.get("/api/auth/session")).status, 401);
    assert.equal((await cms.client().post("/api/auth/login", { email: "parti@test.fr", password: PASSWORD })).status, 401);
  });

  test("garde-fous des comptes : dernier administrateur, soi-même", async () => {
    const admin = await cms.login("admin");
    const me = cms.db.get("SELECT id FROM users WHERE email = 'admin@test.fr'").id;
    assert.equal((await admin.put(`/api/users/${me}`, { role: "editor" })).status, 400);
    assert.equal((await admin.delete(`/api/users/${me}`)).status, 400);
  });

  test("en-têtes de sécurité et erreurs sans détails internes", async () => {
    const c = cms.client();
    const res = await c.get("/api/auth/session");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.match(res.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("access-control-allow-origin"), null, "pas de CORS");
    const bad = await (await cms.login("admin")).request("POST", "/api/events", { raw: "{pas du json", headers: { "content-type": "application/json" } });
    assert.equal(bad.status, 400);
    assert.doesNotMatch(JSON.stringify(bad.data), /at .*\.mjs|SyntaxError/);
  });

  test("corps de requête trop volumineux refusé", async () => {
    const c = await cms.login("admin");
    const res = await c.request("POST", "/api/events", { raw: JSON.stringify({ title: "x".repeat(2 * 1024 * 1024) }), headers: { "content-type": "application/json" } });
    assert.equal(res.status, 413);
  });
});
