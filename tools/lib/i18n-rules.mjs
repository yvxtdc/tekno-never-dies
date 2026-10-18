// Règles de js/i18n/i18n.js (ce qui se traduit, et sous quelle clé), pour les outils Node :
// tools/i18n-pages.mjs (textes sans traduction) et tools/langues.mjs (pages de/ et en/).
// Si i18n.js change ces règles, les changer ici aussi.
import { attr, textContent, find } from "./html.mjs";

export const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "CODE", "TEXTAREA", "TEMPLATE"]);
export const INLINE = new Set(["A", "STRONG", "B", "EM", "I", "BR", "SPAN", "SMALL", "ABBR", "TIME", "U", "SUP", "SUB", "MARK"]);
export const ATTRS = ["alt", "aria-label", "placeholder", "title"];
export const HEAD_META = [["name", "description"], ["property", "og:title"], ["property", "og:description"],
  ["property", "og:image:alt"], ["name", "twitter:title"], ["name", "twitter:description"]];
export const norm = (s) => s.replace(/\s+/g, " ").trim();
export const hasLetters = (s) => /\p{L}{2}/u.test(s);
export const isHeadMeta = (meta) => HEAD_META.some(([k, v]) => attr(meta, k) === v);

/* Paragraphe « mixte » : du texte et des balises de mise en forme (lien, gras, saut de ligne). */
export function isMixed(el) {
  let ownText = false;
  let inlineText = false;
  for (const child of el.children) {
    if (child.type === 3) ownText ||= Boolean(child.value.trim());
    else if (child.type === 1) {
      if (!INLINE.has(child.name)) return false;
      inlineText ||= child.name === "BR" || Boolean(textContent(child).trim());
    }
  }
  return ownText && inlineText && !find(el, (d) => attr(d, "id") !== undefined || !INLINE.has(d.name));
}
