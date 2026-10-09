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

/**
 * "a-venir" ou "passe", calculé depuis la date : plus besoin de changer le statut à la main.
 * Une soirée reste « à venir » toute la journée de sa date (elle peut finir après minuit).
 */
export function eventStatus(ev) {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return ev.date >= today ? "a-venir" : "passe";
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

/** Lit un paramètre de l'URL, ex : readParam("slug") pour ?slug=xyz */
export function readParam(name) {
  return new URLSearchParams(location.search).get(name);
}
