/** Écriture des modules JavaScript du site (js/data/*.js, js/i18n/contenus-*.js) depuis les données. */
const HEADER = (what) =>
  `/*\n * FICHIER GÉNÉRÉ par le CMS (cms/, « Mettre en ligne ») : ${what}.\n` +
  " * Ne pas modifier à la main : les modifications seraient écrasées à la prochaine mise en ligne.\n" +
  " * Les contenus se gèrent dans l'administration ; voir docs/cms/README.md.\n */\n";

const json = (value) => JSON.stringify(value, null, 2);

/** { "js/data/events.js": "…" } : contenu de chaque fichier géré par le CMS. */
export function renderModules(data) {
  return {
    "js/data/events.js":
      HEADER("soirées publiées (statut, line-up, lieux, visuels)") +
      `export const EVENTS = ${json(data.events)};\n\n` +
      "// Anciennes adresses des soirées renommées : evenement-<ancienne>.html mène à la fiche actuelle.\n" +
      `export const EVENT_REDIRECTS = ${json(data.eventRedirects)};\n`,
    "js/data/artistes.js":
      HEADER("artistes (liens Instagram et styles, clé = nom de la fiche artiste)") +
      `export const ARTISTS = ${json(data.ARTISTS)};\n\n` +
      `export const ARTIST_STYLES = ${json(data.ARTIST_STYLES)};\n`,
    "js/data/artistes-photos.js": HEADER("photos des artistes (clé : nom sans espaces ni ponctuation)") + `export const ARTIST_PHOTOS = ${json(data.ARTIST_PHOTOS)};\n`,
    "js/data/faq.js": HEADER("questions fréquentes") + `export const FAQ = ${json(data.FAQ)};\n`,
    "js/data/equipe.js": HEADER("équipe de l'association") + `export const TEAM = ${json(data.TEAM)};\n`,
    "js/data/galerie.js": HEADER("galerie photo") + `export const GALLERY = ${json(data.GALLERY)};\n`,
    "js/i18n/contenus-de.js": HEADER("traductions allemandes des contenus, fusionnées par js/i18n/de.js") + `export default ${json(data.translations.de)};\n`,
    "js/i18n/contenus-en.js": HEADER("traductions anglaises des contenus, fusionnées par js/i18n/en.js") + `export default ${json(data.translations.en)};\n`
  };
}

export const MANAGED_MODULES = Object.keys(renderModules({ events: [], eventRedirects: {}, ARTISTS: {}, ARTIST_STYLES: {}, ARTIST_PHOTOS: {}, FAQ: [], TEAM: [], GALLERY: [], translations: { de: {}, en: {} } }));
