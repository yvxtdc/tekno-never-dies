/**
 * Application HTTP du CMS : administration (/admin), API (/api), prévisualisation (/preview, /p).
 *
 * Contrôles appliqués à chaque requête de l'API :
 *  1. session valide (cookie) sauf routes publiques (connexion) ;
 *  2. requêtes qui modifient : en-tête Origin égal à l'origine du CMS + jeton CSRF de la session ;
 *  3. permission du rôle (cms/server/auth/permissions.mjs) ;
 *  4. compte avec mot de passe temporaire : seules la session et le changement de mot de passe sont permis.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { Router } from "./http/router.mjs";
import { HttpError, unauthorized, forbidden, notFound } from "./http/errors.mjs";
import { sendJson, securityHeaders, redirect } from "./http/respond.mjs";
import { safeResolve, serveFile } from "./http/static.mjs";
import { loadSession, parseCookies } from "./auth/sessions.mjs";
import { can } from "./auth/permissions.mjs";
import { Publisher } from "./publish/publisher.mjs";
import { REPO_ROOT } from "./config.mjs";
import { servePreview, resolvePreviewToken } from "./preview/preview.mjs";
import { registerAuthRoutes } from "./api/auth.mjs";
import { registerContentRoutes } from "./api/content.mjs";
import { registerMediaRoutes } from "./api/media.mjs";
import { registerUserRoutes } from "./api/users.mjs";
import { registerSiteRoutes } from "./api/site.mjs";

const ADMIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../admin");
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
// Modules sans dépendance Node partagés avec l'interface (mêmes règles des deux côtés).
const SHARED = { "richtext.mjs": "services/richtext.mjs", "timeutil.mjs": "services/timeutil.mjs", "slug.mjs": "services/slug.mjs" };
// Polices et logo du site, réutilisés par l'interface (identité visuelle commune).
const SITE_ASSETS = /^(fonts\/[\w.-]+\.woff2|img\/badge-white\.webp|img\/favicon\.png)$/;
const SAFE_METHODS = new Set(["GET", "HEAD"]);

/**
 * Version de l'interface : empreinte de ses fichiers, calculée au démarrage. Les fichiers sont servis
 * sous /admin/v/<version>/… : après une mise à jour du CMS (git pull + redémarrage), l'adresse change
 * et le navigateur (ou un proxy) ne peut plus resservir l'ancienne interface depuis son cache.
 */
function adminVersion() {
  const hash = crypto.createHash("sha256");
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else hash.update(entry.name).update(fs.readFileSync(full));
    }
  };
  walk(ADMIN_DIR);
  for (const file of Object.values(SHARED)) hash.update(fs.readFileSync(path.join(SERVER_DIR, file)));
  return hash.digest("hex").slice(0, 12);
}
const ADMIN_VERSION = adminVersion();
const ADMIN_INDEX = fs.readFileSync(path.join(ADMIN_DIR, "index.html"), "utf8")
  .replace(/(["'])\/admin\/((?:css|js)\/)/g, `$1/admin/v/${ADMIN_VERSION}/$2`);

export function createLogger(level = "info") {
  const quiet = level === "silent";
  const write = (lvl, msg, extra) => {
    if (quiet) return;
    const line = `${new Date().toISOString()} ${lvl.toUpperCase()} ${msg}`;
    if (lvl === "error") console.error(line, extra instanceof Error ? extra.stack : extra ?? "");
    else console.log(line);
  };
  return { info: (m) => write("info", m), warn: (m) => write("warn", m), error: (m, e) => write("error", m, e) };
}

export function createApp({ config, db, log = createLogger(config.logLevel), publisher = new Publisher({ config, db, log }) }) {
  const router = new Router();
  const deps = { config, db, log, publisher };
  registerAuthRoutes(router, deps);
  registerContentRoutes(router, deps);
  registerMediaRoutes(router, deps);
  registerUserRoutes(router, deps);
  registerSiteRoutes(router, deps);

  const clientIp = (req) => {
    if (config.trustProxy) {
      // Dernière adresse : celle ajoutée par notre proxy. Les précédentes viennent du client et
      // pourraient être inventées pour contourner la limitation des connexions.
      const forwarded = String(req.headers["x-forwarded-for"] || "").split(",").map((s) => s.trim()).filter(Boolean).at(-1);
      if (forwarded) return forwarded.slice(0, 64);
    }
    return req.socket.remoteAddress || "inconnue";
  };

  /** L'en-tête Origin (ou Referer) doit être celui du CMS : bloque les formulaires d'autres sites. */
  const sameOrigin = (req) => {
    const origin = req.headers.origin;
    if (origin) return origin === config.publicOrigin;
    const referer = req.headers.referer;
    if (referer) {
      try {
        return new URL(referer).origin === config.publicOrigin;
      } catch {
        return false;
      }
    }
    return false;
  };

  async function handleApi(req, res, url, ctx) {
    const match = router.match(req.method, url.pathname);
    if (!match) throw notFound("Adresse d'API inconnue.");
    if (match.methodNotAllowed) throw new HttpError(405, "Méthode non autorisée.");
    const { route, params } = match;
    const opts = route.options;
    if (!SAFE_METHODS.has(req.method) && !sameOrigin(req)) throw forbidden("Requête refusée (origine non autorisée).");
    if (opts.public !== true) {
      if (!ctx.session) throw unauthorized();
      if (!SAFE_METHODS.has(req.method)) {
        const token = String(req.headers["x-csrf-token"] || "");
        const expected = ctx.session.csrf;
        if (token.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
          throw forbidden("Jeton de sécurité invalide : rechargez la page.");
        }
      }
      if (ctx.user.mustChangePassword && !opts.allowPasswordChange) throw forbidden("Choisissez d'abord un nouveau mot de passe.");
      if (opts.perm && !can(ctx.user, opts.perm)) throw forbidden();
    }
    ctx.params = params;
    const result = await route.handler(ctx);
    if (!res.headersSent && result !== undefined) sendJson(res, opts.status || 200, result);
    else if (!res.headersSent) sendJson(res, 204, null);
  }

  async function handler(req, res) {
    const requestId = crypto.randomBytes(6).toString("hex");
    let url;
    try {
      url = new URL(req.url, "http://cms.invalid");
    } catch {
      res.writeHead(400).end();
      return;
    }
    const p = url.pathname;
    // Tout ce qui lit la requête reste dans le try : une erreur inattendue donne une réponse 500,
    // jamais une exception non gérée qui arrêterait le serveur.
    try {
      const cookies = parseCookies(req.headers.cookie);
      const session = loadSession(db, config, cookies[config.cookieName]);
      const ctx = {
        req, res, url, config, db, log, publisher,
        query: url.searchParams,
        session,
        user: session?.user ?? null,
        ip: clientIp(req),
        requestId,
        get actor() {
          return { user: this.user, ip: this.ip };
        }
      };
      if (p === "/healthz") {
        securityHeaders(res, { secure: config.cookieSecure });
        return sendJson(res, 200, { ok: true });
      }
      if (p === "/" || p === "/admin") return redirect(res, "/admin/");
      if (p.startsWith("/api/")) {
        securityHeaders(res, { secure: config.cookieSecure });
        return await handleApi(req, res, url, ctx);
      }
      if (p.startsWith("/admin/")) {
        securityHeaders(res, { secure: config.cookieSecure });
        if (!SAFE_METHODS.has(req.method)) throw new HttpError(405, "Méthode non autorisée.");
        const rel = p.slice("/admin/".length);
        if (rel.startsWith("shared/") && SHARED[rel.slice(7)]) {
          if (serveFile(req, res, path.join(SERVER_DIR, SHARED[rel.slice(7)]), { cache: "no-cache" })) return;
        }
        if (rel.startsWith("site/") && SITE_ASSETS.test(rel.slice(5))) {
          if (serveFile(req, res, path.join(REPO_ROOT, "assets", rel.slice(5)), { cache: "public, max-age=604800" })) return;
          throw notFound("Fichier introuvable.");
        }
        // Fichiers de l'interface à l'adresse versionnée : jamais modifiés, donc gardés en cache sans risque.
        const versioned = rel.match(/^v\/([0-9a-f]{12})\/(.+)$/);
        if (versioned) {
          const current = versioned[1] === ADMIN_VERSION;
          if (serveFile(req, res, safeResolve(ADMIN_DIR, versioned[2]), { root: ADMIN_DIR, cache: current ? "public, max-age=31536000, immutable" : "no-cache" })) return;
          throw notFound("Fichier introuvable.");
        }
        if (!rel || !/\.[a-z0-9]+$/i.test(rel) || rel === "index.html") {
          // Page de l'interface : jamais en cache, elle désigne la version actuelle des fichiers.
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
          return res.end(req.method === "HEAD" ? undefined : ADMIN_INDEX);
        }
        const file = safeResolve(ADMIN_DIR, rel);
        if (file && serveFile(req, res, file, { root: ADMIN_DIR, cache: "no-cache" })) return;
        throw notFound("Fichier introuvable.");
      }
      if (p.startsWith("/preview/")) {
        if (!SAFE_METHODS.has(req.method)) throw new HttpError(405, "Méthode non autorisée.");
        if (!session) return redirect(res, `/admin/login?next=${encodeURIComponent(p)}`);
        // /preview/site/…  : site tel qu'il serait après la prochaine mise en ligne (+ soirées programmées)
        // /preview/event-12/… : idem + la soirée 12, même en brouillon
        const m = p.match(/^\/preview\/(site|event-(\d{1,12}))(\/.*)?$/);
        if (!m) throw notFound();
        if (!m[3]) return redirect(res, `${p}/`);
        return await servePreview(req, res, { config, db, subPath: m[3], includeEventIds: m[2] ? [Number(m[2])] : [], label: m[2] ? "brouillon" : "prochaine mise en ligne", editLinks: true });
      }
      if (p.startsWith("/p/")) {
        // Lien d'aperçu partageable (sans compte) : une soirée, durée limitée.
        if (!SAFE_METHODS.has(req.method)) throw new HttpError(405, "Méthode non autorisée.");
        const m = p.match(/^\/p\/([A-Za-z0-9_-]{20,64})(\/.*)?$/);
        const eventId = m && resolvePreviewToken(db, m[1]);
        if (!eventId) throw notFound("Lien d'aperçu invalide ou expiré.");
        if (!m[2]) return redirect(res, `${p}/`);
        return await servePreview(req, res, { config, db, subPath: m[2], includeEventIds: [eventId], includeScheduled: false, label: "lien d'aperçu" });
      }
      throw notFound();
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof HttpError) {
        if (p.startsWith("/api/")) return sendJson(res, error.status, { error: error.message, ...error.extra });
        res.writeHead(error.status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        return res.end(error.message);
      }
      // Erreur inattendue : détail dans les journaux uniquement.
      log.error(`[${requestId}] ${req.method} ${p}`, error);
      if (p.startsWith("/api/")) return sendJson(res, 500, { error: "Erreur interne du serveur. Réessayez ; si le problème continue, transmettez ce code à l'administrateur.", requestId });
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end(`Erreur interne (${requestId}).`);
    }
  }

  return { handler, router, publisher };
}
