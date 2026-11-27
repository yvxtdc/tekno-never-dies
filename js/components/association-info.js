/**
 * Infos de l'association (coordonnées, responsable de publication, hébergeur) : valeurs affichées sur le
 * site, calculées depuis js/data/association.js (exporté par le CMS, écran « Infos de l'association »).
 *
 * Dans les pages, chaque valeur est marquée par un attribut data-info, qui dit quelle partie de
 * l'élément reçoit quelle valeur : data-info="href=emailHref text=email" (lien mailto), "text=address",
 * "href=instagram title=instagramHandle"… Une cible reçoit toujours la valeur entière (jamais un morceau
 * de phrase) : tools/sync-infos.mjs réécrit les pages et les partials, et tools/langues.mjs traduit avec
 * des clés où la valeur est remplacée par {info:nom} (changer l'e-mail ne casse aucune traduction).
 * Une cible « text » ne contient que du texte (pas de balise). Sur un <script type="application/ld+json">,
 * seule la cible sameAs=instagram est permise (liste « sameAs » des données structurées).
 *
 * Aucun accès au DOM : partagé par le site (js/data/site.js), les outils et le CMS.
 */

/** Nom -> valeur affichée. */
export function infoValues(a) {
  const handle = (a.instagram.match(/instagram\.com\/([^/?#]+)/i) || [])[1] || "";
  return {
    email: a.email,
    emailHref: `mailto:${a.email}`,
    phone: a.phone,
    phoneHref: `tel:${a.phone.replace(/[^\d+]/g, "")}`,
    instagram: a.instagram,
    instagramHandle: handle ? `@${handle}` : a.instagram,
    address: `${a.address.street}, ${a.address.postalCode} ${a.address.city}`,
    publisherName: a.publisher.name,
    publisherRole: a.publisher.role,
    hostName: a.host.name,
    hostAddress: a.host.address,
    hostUrl: a.host.url,
    hostLabel: a.host.url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "")
  };
}

/** Valeurs en français à traduire (traductions saisies dans le CMS, écran Traductions). */
export const TRANSLATABLE_INFO = new Set(["publisherRole", "hostAddress"]);

/** Cibles permises d'un data-info : contenu texte, ou attribut. */
export const INFO_TARGETS = new Set(["text", "href", "title", "aria-label", "sameAs"]);

/** Repère de la valeur dans les clés de traduction (js/i18n/de.js, en.js) : « Écrire à {info:email} ». */
export const infoToken = (name) => `{info:${name}}`;
export const INFO_TOKEN = /\{info:(\w+)\}/g;

/**
 * Lecture d'un data-info : [[cible, nom], …]. Lève une erreur lisible si la cible ou le nom est inconnu
 * (tools/sync-infos.mjs --check, lancé par npm run validate, le signale).
 */
export function parseInfoSpec(spec, names) {
  return String(spec).trim().split(/\s+/).filter(Boolean).map((pair) => {
    const [target, name] = pair.split("=");
    if (!INFO_TARGETS.has(target)) throw new Error(`data-info : cible inconnue « ${target} » (permises : ${[...INFO_TARGETS].join(", ")})`);
    if (!names.includes(name)) throw new Error(`data-info : valeur inconnue « ${name} »`);
    return [target, name];
  });
}
