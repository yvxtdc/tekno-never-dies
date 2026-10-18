// Textes des pages HTML encore sans traduction allemande ou anglaise.
//
//   node tools/i18n-pages.mjs        liste tous les textes manquants, page par page (npm run traductions)
//
// npm run validate en affiche le nombre. Utile surtout après avoir corrigé un texte français :
// sa clé dans js/i18n/de.js et en.js ne correspond plus, et la page resterait en français.
//
// Les clés sont trouvées comme le fait js/i18n/i18n.js dans le navigateur : texte simple (espaces
// regroupés), paragraphe avec liens ou gras (son HTML), attributs alt, aria-label, placeholder,
// title, titre et description de la page. Seul le HTML écrit dans les pages est contrôlé ; les
// textes de js/data sont contrôlés par validate. Les fiches evenement-….html (même modèle
// qu'evenement.html, titre et description remplacés par js/pages/evenement.js) sont ignorées.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse, attr, textContent, descendants, find, innerHTML } from "./lib/html.mjs";
import { SKIP, ATTRS, norm, hasLetters, isHeadMeta, isMixed } from "./lib/i18n-rules.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function collect(el, keys) {
  const addAttrs = (node) => {
    for (const name of ATTRS) {
      const value = attr(node, name);
      if (value) keys.add(norm(value));
    }
  };
  if (attr(el, "translate") === "no") return;
  if (el.name === "TEXTAREA") addAttrs(el);
  if (SKIP.has(el.name)) return;
  addAttrs(el);
  if (isMixed(el)) {
    keys.add(norm(innerHTML(el, true)));
    for (const child of descendants(el)) if (attr(child, "aria-label") || attr(child, "title")) addAttrs(child);
    return;
  }
  for (const child of el.children) {
    if (child.type === 3) keys.add(norm(child.value));
    else if (child.type === 1) collect(child, keys);
  }
}

/** Textes de chaque page absents de chaque dictionnaire : { de: Map(page -> [textes]), en: … } */
export async function missingTranslations() {
  const dicts = {};
  for (const lang of ["de", "en"]) dicts[lang] = (await import(pathToFileURL(path.join(ROOT, "js/i18n", `${lang}.js`)).href)).default;
  const result = { de: new Map(), en: new Map() };
  const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html") && !/^evenement-.+\.html$/.test(f)).sort();
  for (const page of pages) {
    const doc = parse(fs.readFileSync(path.join(ROOT, page), "utf8"));
    const head = find(doc, (el) => el.name === "HEAD");
    const body = find(doc, (el) => el.name === "BODY");
    const keys = new Set();
    const title = head && find(head, (el) => el.name === "TITLE");
    if (title) keys.add(norm(textContent(title)));
    for (const meta of head ? descendants(head).filter((el) => el.name === "META") : []) {
      if (isHeadMeta(meta) && attr(meta, "content")) keys.add(norm(attr(meta, "content")));
    }
    if (body) collect(body, keys);
    for (const lang of ["de", "en"]) {
      const missing = [...keys].filter((key) => key && hasLetters(key) && !(key in dicts[lang]));
      if (missing.length) result[lang].set(page, missing);
    }
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await missingTranslations();
  let total = 0;
  for (const [lang, pages] of Object.entries(result)) {
    for (const [page, texts] of pages) {
      total += texts.length;
      console.log(`\njs/i18n/${lang}.js — ${page} (${texts.length}) :`);
      for (const text of texts) console.log(`  "${text}"`);
    }
  }
  console.log(total ? `\n${total} texte(s) sans traduction : à ajouter dans js/i18n/de.js et en.js ("texte français": "traduction").` : "Toutes les pages sont traduites.");
}
