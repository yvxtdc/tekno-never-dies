/**
 * Prévisualisation : le vrai site (mêmes pages, styles et scripts que la copie de travail), dont les
 * modules de données sont générés à la volée depuis la base. Les brouillons demandés y apparaissent
 * comme s'ils étaient publiés. Réservé aux personnes connectées, ou via un lien partageable limité
 * à une soirée et dans le temps. Jamais indexé (X-Robots-Tag), statistiques de visite désactivées.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { buildSiteData } from "../export/site-data.mjs";
import { renderModules } from "../export/modules.mjs";
import { variantFile } from "../services/media.mjs";
import { renderEventPage } from "../../../tools/lib/event-page.mjs";
import { safeResolve, serveFile } from "../http/static.mjs";
import { sendText, MIME } from "../http/respond.mjs";
import { now } from "../db/index.mjs";
import { notFound } from "../http/errors.mjs";
import { simulate } from "../services/schedule.mjs";
import { utcToParis } from "../services/timeutil.mjs";

// Dossiers et fichiers du dépôt qui ne font pas partie du site.
const BLOCKED = /^(cms|tools|import|node_modules|partials|docs|vendor\/.*\.md$)(\/|$)|^(package(-lock)?\.json|README\.md|A-COMPLETER\.md|serve\.json|CNAME)$/;
const ALLOWED = Object.fromEntries(Object.entries(MIME).filter(([ext]) => ext !== ".json"));

const HEADERS = {
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Cache-Control": "no-store",
  // La page garde sa propre CSP (balise <meta>) ; l'en-tête autorise seulement l'aperçu en iframe dans l'administration.
  "Content-Security-Policy": "frame-ancestors 'self'",
  "X-Frame-Options": "SAMEORIGIN",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer"
};

const banner = (label) =>
  `<div role="status" style="position:fixed;z-index:2147483647;left:50%;bottom:14px;transform:translateX(-50%);max-width:calc(100% - 24px);` +
  `padding:8px 16px;border-radius:999px;background:#b6269a;color:#fff;font:700 13px/1.3 Montserrat,system-ui,sans-serif;` +
  `letter-spacing:.04em;box-shadow:0 6px 24px rgba(0,0,0,.45);pointer-events:none;text-align:center">APERÇU · ${label}</div>`;

/** Raccourcis vers la fiche de la soirée dans l'administration (aperçu des personnes connectées). */
const editBar = (id) => {
  const link = (href, text, main) =>
    `<a href="${href}" target="_top" style="display:inline-block;padding:9px 16px;border-radius:999px;text-decoration:none;color:#fff;` +
    `font:700 13px/1.2 Montserrat,system-ui,sans-serif;${main ? "background:linear-gradient(120deg,#4226b6,#956aff,#b6269a) border-box;" : "border:1px solid rgba(255,255,255,.45);background:rgba(11,7,34,.85);"}">${text}</a>`;
  return `<nav aria-label="Modifier dans le CMS" style="position:fixed;z-index:2147483647;right:14px;top:50%;transform:translateY(-50%);display:grid;gap:8px;justify-items:end">` +
    link(`/admin/events/${id}#billetterie`, "Gérer les billets", true) +
    link(`/admin/events/${id}#contest`, "DJ Contest", false) +
    link(`/admin/events/${id}`, "✎ Modifier la soirée", false) +
    `</nav>`;
};

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function createPreviewToken(db, eventId, userId, days = 7) {
  const token = crypto.randomBytes(24).toString("base64url");
  const expires = new Date(Date.now() + days * 86400e3).toISOString();
  db.run("INSERT INTO preview_tokens (id, event_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    crypto.createHash("sha256").update(token).digest("hex"), eventId, userId, now(), expires);
  return { token, expiresAt: expires };
}

export function resolvePreviewToken(db, token) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token || "")) return null;
  const row = db.get("SELECT event_id, expires_at FROM preview_tokens WHERE id = ?", crypto.createHash("sha256").update(token).digest("hex"));
  if (!row || Date.parse(row.expires_at) < Date.now()) return null;
  return row.event_id;
}

export function purgePreviewTokens(db) {
  db.run("DELETE FROM preview_tokens WHERE expires_at < ?", now());
}

/**
 * Sert une ressource de prévisualisation.
 * @param {object} opts
 * @param {string} opts.subPath chemin relatif au site (« evenement-x.html », « js/data/events.js »…)
 * @param {number[]} opts.includeEventIds soirées à montrer même si elles ne sont pas publiées
 * @param {boolean} opts.includeScheduled montrer aussi les soirées programmées
 * @param {string|null} opts.at site public tel qu'il sera à cette date (ISO) : programmations prévues
 *   d'ici là appliquées dans une transaction annulée (rien n'est modifié ni exécuté pour de vrai)
 */
export async function servePreview(req, res, { config, db, subPath, includeEventIds = [], includeScheduled = true, at = null, label = "non publié", editLinks = false }) {
  const rel = subPath.replace(/^\/+/, "") || "index.html";
  const data = at
    ? db.dryRun(() => {
        simulate(db, at);
        return buildSiteData(db, { mode: "public" });
      })
    : buildSiteData(db, { mode: "preview", includeEventIds, includeScheduled });
  if (at) {
    const [date, time] = utcToParis(at).local.split("T");
    label = `état prévu le ${date.split("-").reverse().join("/")} à ${time.replace(":", "h")}`;
  }
  const modules = renderModules(data);

  // Modules de données générés depuis la base.
  if (modules[rel]) return sendText(res, 200, modules[rel], MIME[".js"], HEADERS);
  if (rel === "js/data/site.js") {
    const source = fs.readFileSync(path.join(config.siteDir, rel), "utf8").replace(/goatcounter:\s*"[^"]*"/, 'goatcounter: ""');
    return sendText(res, 200, source, MIME[".js"], HEADERS);
  }

  // Images importées dans le CMS (variantes optimisées).
  if (rel.startsWith("assets/img/cms/")) {
    const entry = data.files.get(rel);
    if (entry) {
      const file = await variantFile(config, entry.media, entry.variant);
      if (serveFile(req, res, file, { headers: HEADERS, cache: "no-store" })) return;
      throw notFound();
    }
    // Image du dépôt enregistrée telle quelle dans ce dossier (site importé alors que le CMS était en
    // service) : servie depuis le site comme les autres fichiers ; sinon, rien à servir.
    if (!db.get("SELECT 1 FROM media WHERE storage = 'repo' AND repo_path = ?", rel)) throw notFound();
  }

  // Fiche d'une soirée (ou ancienne adresse), rendue avec le modèle du site.
  const eventMatch = rel.match(/^evenement-([a-z0-9-]+)\.html$/);
  if (eventMatch) {
    const template = fs.readFileSync(path.join(config.siteDir, "evenement.html"), "utf8");
    const slug = eventMatch[1];
    const target = data.eventRedirects[slug];
    const ev = data.events.find((e) => e.slug === (target || slug));
    if (!ev) throw notFound("Cette soirée n'est pas visible dans l'aperçu.");
    const og = fs.existsSync(path.join(config.siteDir, `assets/img/events/og/${ev.slug}.jpg`)) ? `assets/img/events/og/${ev.slug}.jpg` : null;
    let html = renderEventPage(template, ev, { og, alias: target ? slug : null });
    const status = { draft: "brouillon", scheduled: "programmé", archived: "archivé" }[ev.previewStatus];
    const eventId = editLinks ? db.get("SELECT id FROM events WHERE slug = ?", ev.slug)?.id : null;
    html = html.replace(/(<body[^>]*>)/, `$1${banner(escapeHtml(status ? `${ev.title} — ${status}` : label))}${eventId ? editBar(eventId) : ""}`);
    return sendText(res, 200, html, MIME[".html"], HEADERS);
  }

  if (BLOCKED.test(rel)) throw notFound();
  const file = safeResolve(config.siteDir, rel);
  if (!file) throw notFound();
  if (file.endsWith(".html") && fs.existsSync(file)) {
    const html = fs.readFileSync(file, "utf8").replace(/(<body[^>]*>)/, `$1${banner(escapeHtml(label))}`);
    return sendText(res, 200, html, MIME[".html"], HEADERS);
  }
  if (serveFile(req, res, file, { root: config.siteDir, allowed: ALLOWED, headers: HEADERS, cache: "no-cache" })) return;
  throw notFound();
}
