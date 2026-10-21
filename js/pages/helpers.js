/** Petits outils réutilisés par les scripts de pages (formatage de date, échappement HTML, etc). */

import { lang, locale } from "../i18n/i18n.js";

/** "2026-11-14" -> "14 novembre 2026" (« 14. November 2026 », « 14 November 2026 ») ; précision « month » : sans le jour. */
export function formatDate(iso, precision = "day") {
  const [y, m, d] = iso.split("-").map(Number);
  const options = precision === "month" ? { month: "long", year: "numeric" } : { day: "numeric", month: "long", year: "numeric" };
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** Horaires : "21h00 – 4h00" en français, "21:00 – 4:00" en allemand et en anglais. */
export function formatTime(text = "") {
  return lang === "fr" ? text : String(text).replace(/(\d{1,2})h(\d{2})/g, "$1:$2");
}

/** Date et heure actuelles à Paris : "2026-11-29T00:30" (se compare comme du texte). */
function parisNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/**
 * "a-venir" ou "passe", calculé depuis la date à l'heure de Paris (quel que soit le fuseau du
 * visiteur) : plus besoin de changer le statut à la main. Une soirée reste « à venir » toute la
 * journée de sa date, et jusqu'à son heure de fin si elle finit après minuit ("21h00 – 4h00" : jusqu'à
 * 4 h le lendemain), pour garder itinéraire et agenda pendant la soirée.
 */
export function eventStatus(ev) {
  const now = parisNow();
  const [start, end] = [...String(ev.time || "").matchAll(/(\d{1,2})h(\d{2})/g)].map((m) => `${m[1].padStart(2, "0")}:${m[2]}`);
  if (ev.datePrecision !== "month" && start && end && end < start) {
    const [y, m, d] = ev.date.split("-").map(Number);
    const nextDay = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    return now < `${nextDay}T${end}` ? "a-venir" : "passe";
  }
  return ev.date >= now.slice(0, 10) ? "a-venir" : "passe";
}

/** Échappe le texte avant de l'insérer dans du HTML (innerHTML). */
export function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/**
 * Lien externe sûr : seules les adresses https:// (ou http://) sont gardées. Évite qu'une faute de
 * frappe ou un lien piégé dans js/data (« javascript:… ») se retrouve dans un href. Sinon : "".
 */
export function safeUrl(url) {
  try {
    const { protocol, href } = new URL(String(url ?? ""));
    return protocol === "https:" || protocol === "http:" ? href : "";
  } catch {
    return "";
  }
}

/** Vignette grise avec une légende, utilisée tant qu'aucune vraie photo n'est fournie. */
export function placeholderThumb(label = "Photo à ajouter") {
  return `<div class="thumb thumb--placeholder"><span>${esc(label)}</span></div>`;
}

/** Vignette réelle si une image est définie, sinon le placeholder ci-dessus. */
export function thumb(src, alt, label) {
  return src
    ? `<div class="thumb"><img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async" /></div>`
    : placeholderThumb(label);
}

/**
 * Statistiques : compte un clic dans GoatCounter (rubrique « événements » du tableau de bord),
 * ex. track("Billetterie · ICE BOILER v2"). Sans effet si le compteur n'est pas chargé
 * (site ouvert en local, bloqueur de traceurs…).
 */
export function track(name) {
  window.goatcounter?.count?.({ path: name, title: document.title, event: true });
}

/**
 * Adresse de la fiche d'une soirée : "evenement-ice-boiler-v2-2026.html". Les fiches sont des pages
 * statiques générées par tools/event-pages.mjs (npm run calendar), lisibles par les réseaux sociaux.
 */
export function eventPath(slug) {
  return `evenement-${slug}.html`;
}

/** Lit un paramètre de l'URL, ex : readParam("slug") pour ?slug=xyz */
export function readParam(name) {
  return new URLSearchParams(location.search).get(name);
}
