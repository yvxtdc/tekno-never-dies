/** Petits outils réutilisés par les scripts de pages (formatage de date, etc). */

const MONTHS = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];

/** "2026-11-14" -> "14 novembre 2026" */
export function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Vignette grise avec une légende, utilisée tant qu'aucune vraie photo n'est fournie. */
export function placeholderThumb(label = "Photo à ajouter") {
  return `<div class="thumb thumb--placeholder"><span>${label}</span></div>`;
}

/** Vignette réelle si une image est définie, sinon le placeholder ci-dessus. */
export function thumb(src, alt, label) {
  return src
    ? `<div class="thumb"><img src="${src}" alt="${alt}" loading="lazy" /></div>`
    : placeholderThumb(label);
}

/** Lit un paramètre de l'URL, ex : readParam("slug") pour ?slug=xyz */
export function readParam(name) {
  return new URLSearchParams(location.search).get(name);
}
