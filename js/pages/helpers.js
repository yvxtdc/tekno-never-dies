/** Petits outils réutilisés par les scripts de pages (formatage de date, échappement HTML, etc). */

const MONTHS = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];

/** "2026-11-14" -> "14 novembre 2026"; month precision omits an unknown day. */
export function formatDate(iso, precision = "day") {
  const [y, m, d] = iso.split("-").map(Number);
  if (precision === "month") return `${MONTHS[m - 1]} ${y}`;
  return `${d} ${MONTHS[m - 1]} ${y}`;
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

/** Lit un paramètre de l'URL, ex : readParam("slug") pour ?slug=xyz */
export function readParam(name) {
  return new URLSearchParams(location.search).get(name);
}
