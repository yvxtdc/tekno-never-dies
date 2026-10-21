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
// Modèle : evenement.html (header, footer, styles, scripts), rendu par tools/lib/event-page.mjs (aussi
// utilisé par la prévisualisation du CMS). Ne modifie pas les fiches à la main.
// Anciennes adresses (EVENT_REDIRECTS, soirée renommée dans le CMS) : evenement-<ancienne>.html, non
// indexée, mène à la fiche actuelle.
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

const { EVENTS, EVENT_REDIRECTS = {} } = await load("js/data/events.js");
const { eventPath } = await load("js/pages/helpers.js");
const { renderEventPage, OG_W, OG_H } = await load("tools/lib/event-page.mjs");

const OG_DIR = "assets/img/events/og";
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
const page = (ev, options = {}) => {
  const og = fs.existsSync(path.join(ROOT, ogImage(ev))) ? ogImage(ev) : null;
  return renderEventPage(template, ev, { og, ...options });
};

const expected = new Map(EVENTS.map((ev) => [eventPath(ev.slug), page(ev)]));
// Anciennes adresses des soirées renommées (CMS) : page non indexée qui mène à la fiche actuelle.
for (const [oldSlug, slug] of Object.entries(EVENT_REDIRECTS)) {
  const ev = EVENTS.find((e) => e.slug === slug);
  if (ev && !expected.has(eventPath(oldSlug))) expected.set(eventPath(oldSlug), page(ev, { alias: oldSlug }));
}
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

// Images d'aperçu des événements retirés (validate les signale comme inutilisées ; pas d'échec en --check).
if (!check && fs.existsSync(path.join(ROOT, OG_DIR))) {
  const slugs = new Set(EVENTS.map((ev) => ev.slug));
  for (const name of fs.readdirSync(path.join(ROOT, OG_DIR)).filter((f) => f.endsWith(".jpg") && !slugs.has(f.slice(0, -4)))) {
    fs.rmSync(path.join(ROOT, OG_DIR, name));
    console.log(`✗ ${OG_DIR}/${name} supprimée`);
  }
}

if (problems.length) {
  console.error(problems.map((p) => `✗ ${p} (lance : npm run calendar)`).join("\n"));
  process.exit(1);
}
console.log(check ? "Fiches événement à jour." : `${expected.size} fiche(s) événement à jour.`);
