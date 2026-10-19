// Rendu HTML d'une fiche soirée (evenement-<slug>.html) à partir du modèle evenement.html.
// Partagé par tools/event-pages.mjs (fiches publiées) et par la prévisualisation du CMS (cms/),
// pour que l'aperçu soit exactement la page publiée.
import { SITE } from "../../js/data/site.js";
import { eventPath, esc } from "../../js/pages/helpers.js";
import { eventSchema } from "../../js/components/event-schema.js";
import { eventPreview } from "../../js/components/event-preview.js";

export const OG_W = 1200, OG_H = 630;

const longDate = (iso, precision = "day") => {
  const [y, m, d] = iso.split("-").map(Number);
  const options = precision === "month" ? { month: "long", year: "numeric" } : { day: "numeric", month: "long", year: "numeric" };
  return new Intl.DateTimeFormat("fr-FR", { ...options, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
};

/** Remplace l'attribut content d'une balise <meta> du modèle (erreur si la balise a disparu). */
function setMeta(html, attr, value) {
  const re = new RegExp(`(<meta ${attr} content=")[^"]*(")`);
  if (!re.test(html)) throw new Error(`evenement.html : balise <meta ${attr}> introuvable`);
  return html.replace(re, (_, a, b) => a + esc(value) + b);
}

/**
 * @param {string} template contenu de evenement.html
 * @param {object} ev soirée (format de js/data/events.js)
 * @param {object} [options]
 * @param {string|null} [options.og] chemin de l'image d'aperçu 1200 × 630 si elle existe
 * @param {string|null} [options.alias] ancienne adresse (slug) : page de redirection vers la fiche
 */
export function renderEventPage(template, ev, { og = null, alias = null } = {}) {
  const url = new URL(eventPath(ev.slug), SITE.url).href;
  const title = `${ev.title} — Tekno Never Dies`;
  const when = [longDate(ev.date, ev.datePrecision), ev.time].filter(Boolean).join(" · ");
  // Aperçu au partage : titre avec la date, description courte et factuelle (js/components/event-preview.js),
  // ou titre et description SEO saisis dans le CMS.
  const preview = eventPreview(ev);
  const description = ev.seo?.description || preview.description;
  const shareTitle = ev.seo?.title || preview.title;
  const visual = ev.flyer || ev.cover;
  const ticketUrl = /^https:\/\//.test(ev.ticketUrl || "") ? ev.ticketUrl : "";
  // "<" échappé : le texte d'un événement ne peut pas fermer la balise <script>.
  const jsonLd = JSON.stringify(eventSchema(ev), null, 2).replace(/</g, "\\u003c").replace(/^/gm, "  ");

  let html = template;
  if (alias) {
    // Ancienne adresse d'une soirée renommée : non indexée, renvoie vers la fiche actuelle (même rendu sans JavaScript).
    html = html.replace(/(\n\s*)<!-- Modèle des fiches[^>]*-->(\n\s*<meta name="robots" content="noindex" \/>)/,
      `$1<!-- Ancienne adresse de ${esc(ev.title)} (evenement-${esc(alias)}.html) : mène à la fiche actuelle. -->$2$1<meta http-equiv="refresh" content="0; url=${esc(eventPath(ev.slug))}" />`);
  } else {
    html = html.replace(/\n\s*<!-- Modèle des fiches[^>]*-->\n\s*<meta name="robots" content="noindex" \/>/, "");
  }
  html = html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<body data-page="evenements">/, `<body data-page="evenements" data-slug="${esc(ev.slug)}">`);
  html = setMeta(html, 'name="description"', description);
  html = setMeta(html, 'property="og:title"', shareTitle);
  html = setMeta(html, 'property="og:description"', description);
  html = setMeta(html, 'name="twitter:title"', shareTitle);
  html = setMeta(html, 'name="twitter:description"', description);
  if (og || visual) {
    const image = new URL(og || visual, SITE.url).href;
    html = setMeta(html, 'property="og:image"', image);
    html = setMeta(html, 'name="twitter:image"', image);
    html = setMeta(html, 'property="og:image:alt"', `Flyer de ${ev.title}`);
    if (og) {
      html = setMeta(html, 'property="og:image:width"', String(OG_W));
      html = setMeta(html, 'property="og:image:height"', String(OG_H));
    } else {
      // Les dimensions et le format du modèle sont ceux de og-image.jpg, pas ceux du flyer.
      html = html.replace(/\n\s*<meta property="og:image:(?:width|height|type)" content="[^"]+" \/>/g, "");
    }
  }
  html = html.replace(
    /(\n\s*)(<link rel="icon")/,
    `$1<meta property="og:url" content="${esc(url)}" />$1<link rel="canonical" href="${esc(url)}" />$1<script type="application/ld+json">\n${jsonLd}\n  </script>$1$2`
  );
  // Sans JavaScript : l'essentiel de la soirée, à la place du message du modèle.
  html = html.replace(/<noscript>[\s\S]*?<\/noscript>/, `<noscript>
      <section class="event-not-found">
        <h1>${esc(ev.title)}</h1>
        ${ev.cancelled ? "<p><strong>Soirée annulée.</strong></p>\n        " : ""}<p>${esc([when, ev.place].filter(Boolean).join(" · "))}</p>
        ${ev.description ? `<p>${esc(ev.description)}</p>` : ""}
        ${ticketUrl && !ev.cancelled ? `<a class="btn btn-line" href="${esc(ticketUrl)}">Billetterie</a>` : ""}
        <a class="btn btn-line" href="evenements.html">Voir tous les événements</a>
      </section>
    </noscript>`);
  html = html.replace(/<!-- La fiche est générée depuis js\/data\/events.js -->/,
    "<!-- Fiche générée par tools/event-pages.mjs (npm run calendar) depuis evenement.html et js/data/events.js : ne pas modifier à la main. -->");
  return html;
}
