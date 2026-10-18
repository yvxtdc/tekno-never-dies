// Petit lecteur / écrivain HTML pour les outils (sans dépendance : la CI ne lance pas npm install).
// Prévu pour les pages du site, bien formées (npm run validate le vérifie) : pas de fermeture implicite.
//
// Nœuds : { type: 1, name: "P", attrs: [["class", "x"], ["hidden", null]], children: [] } (élément),
//         { type: 3, value } (texte décodé), { type: 8, raw } (commentaire, doctype : recopiés tels quels).

const VOID = new Set(["AREA", "BASE", "BR", "COL", "EMBED", "HR", "IMG", "INPUT", "LINK", "META", "SOURCE", "TRACK", "WBR"]);
// Contenu brut : recopié à l'identique (les empreintes sha256 de la CSP en dépendent)
const RAW = new Set(["SCRIPT", "STYLE"]);
const RCDATA = new Set(["TEXTAREA", "TITLE"]);
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export const decode = (s) => s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e] ?? m);

export function parse(html) {
  const root = { type: 1, name: "#ROOT", attrs: [], children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<![^>]*>|<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>])*)>|[^<]+|</g;
  let m;
  while ((m = re.exec(html))) {
    const parent = stack.at(-1);
    if (m[0].startsWith("<!")) {
      parent.children.push({ type: 8, raw: m[0] });
      continue;
    }
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
      .map(([, n, a, b, c]) => [n, a ?? b ?? c ?? null]) // casse gardée (viewBox en SVG)
      .map(([n, v]) => [n, v === null ? null : decode(v)]);
    const el = { type: 1, name, tag: m[2], attrs, children: [] };
    // <meta … /> ou <rect …/> (SVG) : réécrit de la même façon
    if (m[3].trimEnd().endsWith("/")) el.selfClosing = m[3].match(/\s*\/\s*$/)[0].trimEnd();
    parent.children.push(el);
    if (RAW.has(name) || RCDATA.has(name)) {
      const end = html.toLowerCase().indexOf(`</${name.toLowerCase()}`, re.lastIndex);
      const content = html.slice(re.lastIndex, end);
      if (content) el.children.push(RAW.has(name) ? { type: 8, raw: content } : { type: 3, value: decode(content) });
      re.lastIndex = html.indexOf(">", end) + 1;
    } else if (!VOID.has(name) && !m[3].trimEnd().endsWith("/")) stack.push(el);
  }
  return root;
}

export const attr = (el, name) => el.attrs.find(([n]) => n === name)?.[1] ?? undefined;
export function setAttr(el, name, value) {
  const found = el.attrs.find(([n]) => n === name);
  if (found) found[1] = value;
  else el.attrs.push([name, value]);
}
export const elements = (el) => el.children.filter((c) => c.type === 1);
export const textContent = (n) => (n.type === 3 ? n.value : n.type === 8 ? "" : n.children.map(textContent).join(""));
export const descendants = (el) => elements(el).flatMap((c) => [c, ...descendants(c)]);
export const find = (el, test) => descendants(el).find(test);

// Même échappement que innerHTML dans le navigateur
const escText = (s) => s.replace(/&/g, "&amp;").replace(/ /g, "&nbsp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => s.replace(/&/g, "&amp;").replace(/ /g, "&nbsp;").replace(/"/g, "&quot;");

/**
 * HTML d'un nœud. browser: true reproduit innerHTML du navigateur (attribut sans valeur -> hidden="") :
 * c'est ainsi que js/i18n/i18n.js forme la clé d'un paragraphe avec liens.
 */
export function outerHTML(n, browser = false) {
  if (n.type === 3) return escText(n.value);
  if (n.type === 8) return n.raw;
  if (n.name === "#ROOT") return innerHTML(n, browser);
  const tag = n.tag ?? n.name.toLowerCase();
  const attrs = n.attrs.map(([k, v]) => (v === null && !browser ? ` ${k}` : ` ${k}="${escAttr(v ?? "")}"`)).join("");
  if (VOID.has(n.name)) return `<${tag}${attrs}${n.selfClosing && !browser ? n.selfClosing : ""}>`;
  if (n.selfClosing && !browser && !n.children.length) return `<${tag}${attrs}${n.selfClosing}>`;
  return `<${tag}${attrs}>${innerHTML(n, browser)}</${tag}>`;
}
export const innerHTML = (el, browser = false) => el.children.map((c) => outerHTML(c, browser)).join("");
export const serialize = (root) => innerHTML(root);
