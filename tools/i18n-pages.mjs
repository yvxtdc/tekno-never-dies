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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Mêmes règles que js/i18n/i18n.js
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "CODE", "TEXTAREA", "TEMPLATE"]);
const INLINE = new Set(["A", "STRONG", "B", "EM", "I", "BR", "SPAN", "SMALL", "ABBR", "TIME", "U", "SUP", "SUB", "MARK"]);
const ATTRS = ["alt", "aria-label", "placeholder", "title"];
const HEAD_META = [["name", "description"], ["property", "og:title"], ["property", "og:description"],
  ["property", "og:image:alt"], ["name", "twitter:title"], ["name", "twitter:description"]];
const norm = (s) => s.replace(/\s+/g, " ").trim();
const hasLetters = (s) => /\p{L}{2}/u.test(s);

/* ---------- Petit lecteur HTML (pages bien formées : validate le vérifie) ---------- */
const VOID = new Set(["AREA", "BASE", "BR", "COL", "EMBED", "HR", "IMG", "INPUT", "LINK", "META", "SOURCE", "TRACK", "WBR"]);
const RAW = new Set(["SCRIPT", "STYLE", "TEXTAREA", "TITLE"]);
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s) => s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e] ?? m);

function parse(html) {
  const root = { type: 1, name: "#ROOT", attrs: [], children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>])*)>|[^<]+|</g;
  let m;
  while ((m = re.exec(html))) {
    const parent = stack.at(-1);
    if (m[0].startsWith("<!--")) continue;
    if (!m[2]) {
      parent.children.push({ type: 3, value: decode(m[0]) });
      continue;
    }
    const name = m[2].toUpperCase();
    if (m[1]) {
      const i = stack.findLastIndex((el) => el.name === name);
      if (i > 0) stack.length = i;
      continue;
    }
    const attrs = [...m[3].matchAll(/([^\s=/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)]
      .map(([, n, a, b, c]) => [n.toLowerCase(), decode(a ?? b ?? c ?? "")]);
    const el = { type: 1, name, attrs, children: [] };
    parent.children.push(el);
    if (RAW.has(name)) {
      const end = html.toLowerCase().indexOf(`</${name.toLowerCase()}`, re.lastIndex);
      el.children.push({ type: 3, value: name === "TITLE" ? decode(html.slice(re.lastIndex, end)) : html.slice(re.lastIndex, end) });
      re.lastIndex = html.indexOf(">", end) + 1;
    } else if (!VOID.has(name) && !m[3].trimEnd().endsWith("/")) stack.push(el);
  }
  return root;
}

const attr = (el, name) => el.attrs.find(([n]) => n === name)?.[1];
const elements = (el) => el.children.filter((c) => c.type === 1);
const textContent = (n) => (n.type === 3 ? n.value : n.children.map(textContent).join(""));
const descendants = (el) => elements(el).flatMap((c) => [c, ...descendants(c)]);
const find = (el, test) => descendants(el).find(test);

// Même sérialisation que innerHTML dans le navigateur
const escText = (s) => s.replace(/&/g, "&amp;").replace(/ /g, "&nbsp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => s.replace(/&/g, "&amp;").replace(/ /g, "&nbsp;").replace(/"/g, "&quot;");
const outerHTML = (n) => {
  if (n.type === 3) return escText(n.value);
  const tag = n.name.toLowerCase();
  const open = `<${tag}${n.attrs.map(([k, v]) => ` ${k}="${escAttr(v)}"`).join("")}>`;
  return VOID.has(n.name) ? open : `${open}${innerHTML(n)}</${tag}>`;
};
const innerHTML = (el) => el.children.map(outerHTML).join("");

/* ---------- Clés à traduire (comme translateElement de js/i18n/i18n.js) ---------- */
function isMixed(el) {
  let ownText = false;
  let inlineText = false;
  for (const child of el.children) {
    if (child.type === 3) ownText ||= Boolean(child.value.trim());
    else {
      if (!INLINE.has(child.name)) return false;
      inlineText ||= child.name === "BR" || Boolean(textContent(child).trim());
    }
  }
  return ownText && inlineText && !find(el, (d) => attr(d, "id") !== undefined || !INLINE.has(d.name));
}

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
    keys.add(norm(innerHTML(el)));
    for (const child of descendants(el)) if (attr(child, "aria-label") || attr(child, "title")) addAttrs(child);
    return;
  }
  for (const child of el.children) {
    if (child.type === 3) keys.add(norm(child.value));
    else collect(child, keys);
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
      if (HEAD_META.some(([k, v]) => attr(meta, k) === v) && attr(meta, "content")) keys.add(norm(attr(meta, "content")));
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
