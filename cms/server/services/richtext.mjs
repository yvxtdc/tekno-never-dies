/**
 * Texte enrichi limité des réponses de FAQ : **gras**, *italique*, [texte du lien](adresse) et
 * retours à la ligne. Tout le reste est échappé : impossible d'injecter du HTML ou un script.
 *
 * Adresses de lien acceptées : https://…, http://…, mailto:…, tel:…, une page du site
 * (« contact.html?type=rejoindre », « evenements.html#agenda ») ou une ancre (« #faq »).
 * Les liens externes s'ouvrent dans un nouvel onglet (rel="noopener noreferrer"), comme avant.
 */
const escText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => escText(s).replace(/"/g, "&quot;");

const LOCAL_PAGE = /^(?:[a-z0-9-]+\.html)?(?:\?[\w=&%.+-]*)?(?:#[\w-]*)?$/i;

export function safeHref(href) {
  const value = String(href || "").trim();
  if (!value) return null;
  if (/^https?:\/\/[^\s"<>]+$/i.test(value)) {
    try {
      new URL(value);
      return { href: value, external: true };
    } catch {
      return null;
    }
  }
  if (/^mailto:[^\s"<>@]+@[^\s"<>]+$/i.test(value) || /^tel:\+?[\d .-]{4,20}$/i.test(value)) return { href: value, external: false };
  if (LOCAL_PAGE.test(value) && value !== "") return { href: value, external: false };
  return null;
}

/** Problèmes du texte (liens invalides) : liste de messages. */
export function richTextProblems(markup) {
  const problems = [];
  for (const m of String(markup || "").matchAll(/\[([^\]]*)\]\(([^)\s]*)\)/g)) {
    if (!m[1].trim()) problems.push(`Lien sans texte : (${m[2]})`);
    if (!safeHref(m[2])) problems.push(`Adresse de lien non autorisée : ${m[2] || "(vide)"}`);
  }
  return problems;
}

function inline(text) {
  // Gras puis italique, sur du texte déjà échappé ; \* garde une étoile.
  return text
    .replace(/\\\*/g, "\u0001")
    .replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/\u0001/g, "*");
}

export function richTextToHtml(markup) {
  const source = String(markup || "").replace(/\r\n?/g, "\n").trim();
  let out = "";
  let last = 0;
  for (const m of source.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) {
    out += inline(escText(source.slice(last, m.index)));
    const link = safeHref(m[2]);
    const label = inline(escText(m[1]));
    out += link
      ? `<a href="${escAttr(link.href)}"${link.external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${label}</a>`
      : label;
    last = m.index + m[0].length;
  }
  out += inline(escText(source.slice(last)));
  return out.replace(/\n/g, "<br />");
}

const unescape = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

/**
 * HTML existant (js/data/faq.js) -> texte enrichi. Renvoie null si le HTML contient autre chose
 * que des liens, du gras, de l'italique ou des retours à la ligne (import à vérifier à la main).
 */
export function htmlToRichText(html) {
  let text = String(html || "")
    .replace(/\*/g, "\\*")
    .replace(/<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => `[${label}](${unescape(href)})`)
    .replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, "**$2**")
    .replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, "*$2*")
    .replace(/<br\s*\/?>/gi, "\n");
  if (/<[a-z/!]/i.test(text)) return null;
  text = unescape(text);
  return text;
}

/** Texte brut (aperçus, recherche) : sans balises de mise en forme. */
export function richTextToPlain(markup) {
  return String(markup || "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*?([^*]+)\*\*?/g, "$1");
}
