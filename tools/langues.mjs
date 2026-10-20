// Crée les versions allemande et anglaise des pages : de/<page>.html et en/<page>.html, et sitemap.xml.
//
//   node tools/langues.mjs           (re)génère de/, en/ et sitemap.xml (npm run langues ; lancé aussi par
//                                    npm run partials et npm run calendar)
//   node tools/langues.mjs --check   vérifie seulement qu'ils sont à jour (utilisé par validate)
//
// Chaque page française est traduite avec js/i18n/de.js et en.js, selon les mêmes règles que
// js/i18n/i18n.js dans le navigateur (un texte sans traduction reste en français : npm run traductions).
// Les moteurs de recherche et les aperçus des réseaux sociaux lisent ainsi une vraie page allemande
// ou anglaise, avec sa propre adresse. Ce qui est ajouté par les scripts (événements, galerie, FAQ…)
// reste traduit dans le navigateur par i18n.js.
//
// Une page traduite garde les chemins de la page française grâce à <base href="../"> ; ses liens vers
// les autres pages du site mènent aux pages de la même langue. Le sitemap liste chaque page dans les
// trois langues, avec les liens hreflang entre elles. Ne modifie pas de/, en/ ni sitemap.xml à la main.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse, serialize, attr, setAttr, descendants, find, innerHTML } from "./lib/html.mjs";
import { SKIP, ATTRS, norm, isHeadMeta, isMixed } from "./lib/i18n-rules.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const LANGS = ["de", "en"];
const LOCALES = { fr: "fr-FR", de: "de-DE", en: "en-GB" };
const OG_LOCALES = { de: "de_DE", en: "en_GB" };
const load = (file) => import(pathToFileURL(path.join(ROOT, file)).href);

const { SITE } = await load("js/data/site.js");
const { EVENTS } = await load("js/data/events.js");
const { eventPreview } = await load("js/components/event-preview.js");
const dicts = {};
for (const lang of LANGS) dicts[lang] = (await load(`js/i18n/${lang}.js`)).default;

// 404.html : GitHub Pages ne sert que celle de la racine
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html") && f !== "404.html").sort();
const pageUrl = (file, lang) => new URL((lang === "fr" ? "" : `${lang}/`) + (file === "index.html" ? "" : file), SITE.url).href;

/* ---------- Traduction d'une page (comme translateElement de js/i18n/i18n.js) ---------- */
function translate(el, dict) {
  const tr = (value) => dict[norm(value)] ?? value;
  const translateAttrs = (node) => {
    for (const name of ATTRS) if (attr(node, name)) setAttr(node, name, tr(attr(node, name)));
  };
  if (attr(el, "translate") === "no") return;
  if (el.name === "TEXTAREA") translateAttrs(el);
  if (SKIP.has(el.name)) return;
  translateAttrs(el);
  if (isMixed(el)) {
    const key = norm(innerHTML(el, true));
    if (key in dict) el.children = parse(dict[key]).children;
    for (const child of descendants(el)) if (attr(child, "aria-label") || attr(child, "title")) translateAttrs(child);
    return;
  }
  for (const child of el.children) {
    if (child.type === 3) {
      const key = norm(child.value);
      if (key && key in dict) {
        const [, before, after] = child.value.match(/^(\s*)[\s\S]*?(\s*)$/);
        child.value = before + dict[key] + after;
      }
    } else if (child.type === 1) translate(child, dict);
  }
}

/** Lien vers une page du site ("faq.html", "./", "contact.html?type=…") -> page de la même langue. */
function localizeLink(href, lang) {
  if (!href || /^([a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)) return href;
  const url = new URL(href, "https://site.invalid/");
  const file = url.pathname.slice(1);
  if (!/^([\w-]+\.html)?$/.test(file) || file === "404.html" || (file && !pages.includes(file))) return href;
  return `${lang}/${file}${url.search}${url.hash}`;
}

/** Fiche événement : titre et description de l'aperçu refaits dans la langue (js/components/event-preview.js). */
function eventMeta(file, lang) {
  const ev = EVENTS.find((e) => `evenement-${e.slug}.html` === file);
  if (!ev) return null;
  const tr = (text) => dicts[lang][norm(text || "")] ?? text;
  const preview = eventPreview(ev, { tr, locale: LOCALES[lang], time: (t) => t.replace(/(\d{1,2})h(\d{2})/g, "$1:$2") });
  const alt = (dicts[lang]["Flyer de {title}"] ?? "Flyer de {title}").replace("{title}", ev.title);
  return { ...preview, alt };
}

function translatePage(file, lang) {
  const html = fs.readFileSync(path.join(ROOT, file), "utf8");
  const doc = parse(html);
  const dict = dicts[lang];
  const root = find(doc, (el) => el.name === "HTML");
  const head = find(doc, (el) => el.name === "HEAD");
  const body = find(doc, (el) => el.name === "BODY");
  setAttr(root, "lang", lang);

  // <base href="../"> juste après <meta charset> : avant le script de langue, qui en a besoin
  const charset = head.children.findIndex((n) => n.type === 1 && n.name === "META" && attr(n, "charset"));
  head.children.splice(charset + 1, 0, { type: 3, value: "\n  " }, { type: 1, name: "BASE", tag: "base", attrs: [["href", "../"]], children: [], selfClosing: " /" });

  const event = eventMeta(file, lang);
  // og:locale:alternate : les deux autres langues de la page
  const otherLocales = Object.entries({ fr: "fr_FR", ...OG_LOCALES }).filter(([l]) => l !== lang).map(([, v]) => v);
  for (const el of descendants(head)) {
    if (el.name === "TITLE") el.children = [{ type: 3, value: dict[norm(el.children[0]?.value || "")] ?? el.children[0]?.value ?? "" }];
    else if (el.name === "META" && isHeadMeta(el) && attr(el, "content")) {
      const content = attr(el, "content");
      setAttr(el, "content", dict[norm(content)] ?? content);
      if (event && /description$/.test(attr(el, "name") || attr(el, "property"))) setAttr(el, "content", event.description);
      if (event && attr(el, "property") === "og:image:alt") setAttr(el, "content", event.alt);
      if (event && /:title$/.test(attr(el, "name") || attr(el, "property"))) setAttr(el, "content", event.title);
    } else if (el.name === "META" && attr(el, "property") === "og:locale") setAttr(el, "content", OG_LOCALES[lang]);
    else if (el.name === "META" && attr(el, "property") === "og:locale:alternate") setAttr(el, "content", otherLocales.shift());
    else if (el.name === "META" && attr(el, "property") === "og:url") setAttr(el, "content", pageUrl(file, lang));
    else if (el.name === "LINK" && attr(el, "rel") === "canonical") setAttr(el, "href", pageUrl(file, lang));
    // Ancienne adresse d'une soirée (tools/event-pages.mjs) : redirige vers la fiche dans la même langue.
    else if (el.name === "META" && attr(el, "http-equiv") === "refresh") {
      setAttr(el, "content", attr(el, "content").replace(/url=(.+)$/, (_, target) => `url=${localizeLink(target, lang)}`));
    }
  }

  translate(body, dict);
  for (const a of descendants(body).filter((el) => el.name === "A")) {
    const href = attr(a, "href");
    if (href) setAttr(a, "href", localizeLink(href, lang));
  }
  return serialize(doc);
}

/* ---------- Écriture (ou vérification) ---------- */
const problems = [];
const write = (name, content) => {
  const file = path.join(ROOT, name);
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (current === content) return false;
  if (check) problems.push(`${name} pas à jour`);
  else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return true;
};

let changed = 0;
for (const lang of LANGS) {
  for (const file of pages) changed += write(`${lang}/${file}`, translatePage(file, lang));
  // Pages françaises supprimées : leur traduction aussi
  const dir = path.join(ROOT, lang);
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (pages.includes(name)) continue;
    if (check) problems.push(`${lang}/${name} ne correspond plus à aucune page`);
    else {
      fs.rmSync(path.join(dir, name));
      console.log(`✗ ${lang}/${name} supprimée`);
    }
  }
}

// Sitemap : pages indexables (pas de noindex), chacune dans les trois langues
const indexable = pages.filter((file) => !/<meta name="robots" content="noindex"/.test(fs.readFileSync(path.join(ROOT, file), "utf8")));
indexable.sort((a, b) => (a === "index.html" ? -1 : b === "index.html" ? 1 : a.localeCompare(b)));
const alternates = (file) => [...["fr", ...LANGS].map((lang) => [lang, pageUrl(file, lang)]), ["x-default", pageUrl(file, "fr")]]
  .map(([lang, url]) => `    <xhtml:link rel="alternate" hreflang="${lang}" href="${url}"/>`).join("\n");
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Généré par tools/langues.mjs (npm run langues) : ne pas modifier à la main. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${indexable.flatMap((file) => ["fr", ...LANGS].map((lang) => `  <url>
    <loc>${pageUrl(file, lang)}</loc>
${alternates(file)}
  </url>`)).join("\n")}
</urlset>
`;
changed += write("sitemap.xml", sitemap);

if (problems.length) {
  console.error(problems.map((p) => `✗ ${p} (lance : npm run langues)`).join("\n"));
  process.exit(1);
}
console.log(check ? "Pages de/ et en/ à jour." : `Pages de/ et en/ à jour (${pages.length} pages × ${LANGS.length} langues, ${changed} fichier(s) réécrit(s)).`);
