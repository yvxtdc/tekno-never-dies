/**
 * Traduction du site (FR / DE / EN), sans toucher aux pages HTML.
 *
 * Le français est la langue d'origine : les pages et js/data/ restent écrits en français.
 * Pour l'allemand et l'anglais, js/i18n/de.js et en.js associent chaque texte français à sa
 * traduction. Ce script parcourt la page (et tout ce que les scripts ajoutent ensuite) et remplace
 * les textes, les alt, aria-label, placeholder et title, ainsi que le titre et la description.
 *
 * - Un texte simple a pour clé le texte français, espaces regroupés : "Voir la galerie".
 * - Un paragraphe qui contient des liens ou du gras a pour clé son HTML :
 *   'Présente-toi dans le <a href="contact.html?type=rejoindre">formulaire</a> …'.
 * - Un texte absent du dictionnaire reste en français (rien ne casse).
 * - Un élément (ou ses enfants) marqué translate="no" n'est jamais traduit.
 * - Dans les scripts : t("Voir plus de photos ({n})", { n: 12 }) pour un texte avec des valeurs.
 *
 * La langue est choisie par le petit script en tête de chaque page (adresse ?lang=, choix
 * enregistré, sinon langue du navigateur) et écrite dans <html lang="…">.
 */

export const LANGS = ["fr", "de", "en"];
const KEY = "tnd-lang";
const hasDom = typeof document !== "undefined";

export const lang = hasDom && LANGS.includes(document.documentElement.lang) ? document.documentElement.lang : "fr";

// Dictionnaire chargé seulement si besoin (les modules qui importent ce fichier l'attendent).
const dict = lang === "fr" ? {} : (await import(`./${lang}.js`)).default;

// Mode contrôle (outil de traduction) : les textes sans traduction sont listés ici.
const missing = hasDom && globalThis.__i18nMissing instanceof Set ? globalThis.__i18nMissing : null;

const norm = (s) => s.replace(/\s+/g, " ").trim();
const hasLetters = (s) => /\p{L}{2}/u.test(s);

/** Traduction d'un texte français (ou le texte tel quel). */
export function tr(text) {
  if (lang === "fr" || text == null) return text;
  const key = norm(String(text));
  if (!key) return text;
  if (key in dict) return dict[key];
  if (missing && hasLetters(key)) missing.add(key);
  return text;
}

/** Texte avec valeurs : t("{n} soirées chez TND", { n: 3 }). */
export function t(template, vars = {}) {
  return tr(template).replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? "");
}

/** Mots à accorder : plural(n, "soirée", "soirées"). La forme française sert de clé. */
export function plural(n, one, many) {
  return tr(n > 1 ? many : one);
}

/** Dates dans la langue du visiteur. */
export const locale = { fr: "fr-FR", de: "de-DE", en: "en-GB" }[lang];

/** Change de langue : choix enregistré, puis rechargement de la page. */
export function setLang(next) {
  if (!LANGS.includes(next) || next === lang) return;
  let saved = false;
  try {
    // Le français aussi est enregistré : sinon un navigateur réglé en allemand repasserait en allemand.
    localStorage.setItem(KEY, next);
    saved = true;
  } catch { /* stockage bloqué : la langue passe par l'adresse */ }
  const url = new URL(location.href);
  if (saved) url.searchParams.delete("lang");
  else url.searchParams.set("lang", next);
  location.replace(url.href);
}

/* ---------- Traduction de la page ---------- */

const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "CODE", "TEXTAREA", "TEMPLATE"]);
const INLINE = new Set(["A", "STRONG", "B", "EM", "I", "BR", "SPAN", "SMALL", "ABBR", "TIME", "U", "SUP", "SUB", "MARK"]);
const ATTRS = ["alt", "aria-label", "placeholder", "title"];
const NOT_INLINE = `:not(${[...INLINE].join(",").toLowerCase()})`;

const skipped = (el) => !el || SKIP.has(el.nodeName.toUpperCase()) || el.closest('[translate="no"]');

function translateText(node) {
  const value = node.nodeValue;
  const key = norm(value);
  if (!key || !hasLetters(key)) return;
  if (key in dict) {
    const [, before, after] = value.match(/^(\s*)[\s\S]*?(\s*)$/);
    if (dict[key] !== key) node.nodeValue = before + dict[key] + after;
  } else if (missing) missing.add(key);
}

function translateAttr(el, name) {
  const value = el.getAttribute(name);
  if (!value) return;
  const result = tr(value);
  if (result !== value) el.setAttribute(name, result);
}

/* Paragraphe « mixte » : du texte et des balises de mise en forme (lien, gras, saut de ligne). */
function isMixed(el) {
  let ownText = false;
  let inlineText = false;
  for (const child of el.childNodes) {
    if (child.nodeType === 3) ownText ||= Boolean(child.nodeValue.trim());
    else if (child.nodeType === 1) {
      if (!INLINE.has(child.nodeName)) return false;
      inlineText ||= child.nodeName === "BR" || Boolean(child.textContent.trim());
    }
  }
  return ownText && inlineText && !el.querySelector(`[id], ${NOT_INLINE}`);
}

function translateElement(el) {
  if (el.getAttribute("translate") === "no" || SKIP.has(el.nodeName.toUpperCase())) return;
  for (const name of ATTRS) translateAttr(el, name);
  if (isMixed(el)) {
    const key = norm(el.innerHTML);
    if (key in dict) el.innerHTML = dict[key];
    else if (missing) missing.add(key);
    for (const child of el.querySelectorAll("[aria-label], [title]")) for (const name of ATTRS) translateAttr(child, name);
    return;
  }
  for (const child of [...el.childNodes]) {
    if (child.nodeType === 3) translateText(child);
    else if (child.nodeType === 1) translateElement(child);
  }
}

function translateHead() {
  document.title = tr(document.title);
  const selectors = ['meta[name="description"]', 'meta[property="og:title"]', 'meta[property="og:description"]',
    'meta[property="og:image:alt"]', 'meta[name="twitter:title"]', 'meta[name="twitter:description"]'];
  for (const meta of document.head.querySelectorAll(selectors.join(","))) translateAttr(meta, "content");
  document.head.querySelector('meta[property="og:locale"]')?.setAttribute("content", { de: "de_DE", en: "en_GB" }[lang]);
}

function startTranslation() {
  // Pages légales : la version française fait foi (note traduite avec le reste de la page).
  if (document.body.dataset.legal !== undefined) {
    const note = document.createElement("p");
    note.className = "legal-lang-note";
    note.textContent = "Cette traduction est fournie à titre indicatif : seule la version française fait foi.";
    document.querySelector("main .page-head")?.append(note);
  }

  translateHead();
  translateElement(document.body);

  // Tout ce que les scripts ajoutent ou modifient ensuite est traduit au passage.
  const observer = new MutationObserver((records) => {
    observer.disconnect();
    for (const r of records) {
      if (r.type === "attributes") {
        if (!skipped(r.target)) translateAttr(r.target, r.attributeName);
      } else if (r.type === "characterData") {
        if (!skipped(r.target.parentElement)) translateText(r.target);
      } else {
        for (const node of r.addedNodes) {
          if (!node.isConnected) continue;
          if (node.nodeType === 3 && !skipped(node.parentElement)) {
            // Texte remplacé dans un paragraphe mixte : on retraduit le paragraphe entier.
            if (isMixed(node.parentElement)) translateElement(node.parentElement);
            else translateText(node);
          } else if (node.nodeType === 1 && !skipped(node.parentElement)) translateElement(node);
        }
      }
    }
    if (document.title !== tr(document.title)) document.title = tr(document.title);
    observe();
  });
  const observe = () => observer.observe(document.documentElement, {
    subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS
  });
  observe();

  // Textes affichés par le CSS (content: …)
  document.documentElement.style.setProperty("--t-live", JSON.stringify(tr("EN DIRECT")));

}

if (hasDom && lang !== "fr") {
  if (document.body) startTranslation();
  else document.addEventListener("DOMContentLoaded", startTranslation, { once: true });
}

// Page affichée : le masque posé par le script de tête pendant la traduction est retiré.
if (hasDom) document.documentElement.classList.remove("i18n-pending");
