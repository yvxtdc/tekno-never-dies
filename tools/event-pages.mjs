// Crée une page HTML par soirée de js/data/events.js : evenement-<slug>.html
//
//   node tools/event-pages.mjs           (re)génère les fiches (lancé par npm run calendar ; le sitemap est fait par tools/langues.mjs)
//   node tools/event-pages.mjs --check   vérifie seulement qu'elles sont à jour (utilisé par validate)
//
// Pourquoi : les robots des réseaux sociaux (WhatsApp, Instagram, Facebook…) et beaucoup de moteurs
// n'exécutent pas de JavaScript. Chaque fiche contient donc en dur son titre, sa description, son
// flyer (og:image), son adresse canonique et ses données structurées. Le contenu visible reste
// construit par js/pages/evenement.js, comme avant.
//
// Modèle : evenement.html (header, footer, styles, scripts). Ne modifie pas les fiches à la main.
//
// Image d'aperçu : le flyer (portrait, WebP) est recadré en JPEG 1200 × 630 sur fond flouté dans
// assets/img/events/og/<slug>.jpg, le format que tous les réseaux affichent. Il faut sharp
// (npm install) ; l'image est recréée quand le flyer est plus récent. Supprime-la pour la refaire.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const load = (file) => import(pathToFileURL(path.join(ROOT, file)).href);

const { EVENTS } = await load("js/data/events.js");
const { SITE } = await load("js/data/site.js");
const { eventPath, esc } = await load("js/pages/helpers.js");
const { eventSchema } = await load("js/components/event-schema.js");

const OG_DIR = "assets/img/events/og";
const OG_W = 1200, OG_H = 630;
const ogImage = (ev) => `${OG_DIR}/${ev.slug}.jpg`;

/** Crée les images d'aperçu manquantes ou plus anciennes que le flyer (sans sharp : ignoré). */
async function makeOgImages() {
  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    console.warn("! sharp absent (lance npm install) : images d'aperçu JPEG non créées, le flyer WebP est utilisé.");
    return;
  }
  fs.mkdirSync(path.join(ROOT, OG_DIR), { recursive: true });
  for (const ev of EVENTS) {
    const visual = ev.flyer || ev.cover;
    if (!visual || !fs.existsSync(path.join(ROOT, visual))) continue;
    const src = path.join(ROOT, visual);
    const dest = path.join(ROOT, ogImage(ev));
    if (fs.existsSync(dest) && fs.statSync(dest).mtimeMs >= fs.statSync(src).mtimeMs) continue;
    const background = await sharp(src).resize(OG_W, OG_H, { fit: "cover" }).blur(30).modulate({ brightness: 0.55 }).toBuffer();
    const foreground = await sharp(src).resize({ height: OG_H, width: OG_W, fit: "inside" }).toBuffer();
    await sharp(background).composite([{ input: foreground, gravity: "centre" }]).jpeg({ quality: 82, mozjpeg: true }).toFile(dest);
    console.log(`✓ ${ogImage(ev)}`);
  }
}
if (!check) await makeOgImages();

const template = fs.readFileSync(path.join(ROOT, "evenement.html"), "utf8");
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

function page(ev) {
  const url = new URL(eventPath(ev.slug), SITE.url).href;
  const title = `${ev.title} — Tekno Never Dies`;
  const when = [longDate(ev.date, ev.datePrecision), ev.time].filter(Boolean).join(" · ");
  const description = `${longDate(ev.date, ev.datePrecision)}${ev.place ? ` · ${ev.place}` : ""}. ${ev.description || ""}`.trim();
  const visual = ev.flyer || ev.cover;
  const ticketUrl = /^https:\/\//.test(ev.ticketUrl || "") ? ev.ticketUrl : "";
  // "<" échappé : le texte d'un événement ne peut pas fermer la balise <script>.
  const jsonLd = JSON.stringify(eventSchema(ev), null, 2).replace(/</g, "\\u003c").replace(/^/gm, "  ");

  let html = template
    .replace(/\n\s*<!-- Modèle des fiches[^>]*-->\n\s*<meta name="robots" content="noindex" \/>/, "")
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<body data-page="evenements">/, `<body data-page="evenements" data-slug="${esc(ev.slug)}">`);
  html = setMeta(html, 'name="description"', description);
  html = setMeta(html, 'property="og:title"', title);
  html = setMeta(html, 'property="og:description"', description);
  html = setMeta(html, 'name="twitter:title"', title);
  html = setMeta(html, 'name="twitter:description"', description);
  const og = fs.existsSync(path.join(ROOT, ogImage(ev))) ? ogImage(ev) : null;
  if (og || visual) {
    const image = new URL(og || visual, SITE.url).href;
    html = setMeta(html, 'property="og:image"', image);
    html = setMeta(html, 'name="twitter:image"', image);
    html = setMeta(html, 'property="og:image:alt"', `Flyer de ${ev.title}`);
    if (og) {
      html = setMeta(html, 'property="og:image:width"', String(OG_W));
      html = setMeta(html, 'property="og:image:height"', String(OG_H));
    } else {
      // Les dimensions du modèle sont celles de og-image.jpg, pas celles du flyer.
      html = html.replace(/\n\s*<meta property="og:image:(?:width|height)" content="\d+" \/>/g, "");
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
        <p>${esc([when, ev.place].filter(Boolean).join(" · "))}</p>
        ${ev.description ? `<p>${esc(ev.description)}</p>` : ""}
        ${ticketUrl ? `<a class="btn btn-line" href="${esc(ticketUrl)}">Billetterie</a>` : ""}
        <a class="btn btn-line" href="evenements.html">Voir tous les événements</a>
      </section>
    </noscript>`);
  html = html.replace(/<!-- La fiche est générée depuis js\/data\/events.js -->/,
    "<!-- Fiche générée par tools/event-pages.mjs (npm run calendar) depuis evenement.html et js/data/events.js : ne pas modifier à la main. -->");
  return html;
}

const expected = new Map(EVENTS.map((ev) => [eventPath(ev.slug), page(ev)]));
const problems = [];
const write = (name, content) => {
  const file = path.join(ROOT, name);
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (current === content) return;
  if (check) problems.push(`${name} pas à jour`);
  else {
    fs.writeFileSync(file, content);
    console.log(`✓ ${name}`);
  }
};

for (const [name, html] of expected) write(name, html);

// Fiches d'événements retirés de events.js
for (const name of fs.readdirSync(ROOT).filter((f) => /^evenement-.+\.html$/.test(f) && !expected.has(f))) {
  if (check) problems.push(`${name} ne correspond plus à aucun événement`);
  else {
    fs.rmSync(path.join(ROOT, name));
    console.log(`✗ ${name} supprimée`);
  }
}

if (problems.length) {
  console.error(problems.map((p) => `✗ ${p} (lance : npm run calendar)`).join("\n"));
  process.exit(1);
}
console.log(check ? "Fiches événement à jour." : `${expected.size} fiche(s) événement à jour.`);
