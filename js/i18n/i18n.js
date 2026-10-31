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
 * Les pages allemandes et anglaises sont des copies déjà traduites, dans de/ et en/ (générées par
 * tools/langues.mjs avec ces mêmes dictionnaires ; leur <base href="../"> garde styles et images).
 * La langue d'une page est donc fixée par son <html lang="…">. Ce script traduit ce que les scripts
 * de pages ajoutent ensuite (événements, galerie, FAQ…) et fait pointer leurs liens vers les pages
 * de la même langue. Le petit script en tête de chaque page mène à la bonne version (?lang=, choix
 * enregistré).
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

/** Adresse de la page courante dans une autre langue : "de/faq.html", "faq.html"… */
export function pageInLang(next) {
  const url = new URL((next === "fr" ? "" : `${next}/`) + location.pathname.split("/").pop(), document.baseURI);
  const params = new URLSearchParams(location.search);
  params.delete("lang");
  url.search = params.toString();
  url.hash = location.hash;
  return url.href;
}

/** Change de langue : choix enregistré, puis ouverture de la même page dans cette langue. */
export function setLang(next) {
  if (!LANGS.includes(next) || next === lang) return;
  // Le français aussi est enregistré : sinon le choix précédent (allemand) ramènerait sur de/.
  try { localStorage.setItem(KEY, next); } catch { /* stockage bloqué : l'adresse suffit */ }
  location.href = pageInLang(next);
}

/** Choix de langue enregistré (boutons FR / DE / EN), ou null. */
export function savedLang() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

/* ---------- Traduction de la page ---------- */

const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "CODE", "TEXTAREA", "TEMPLATE"]);
const INLINE = new Set(["A", "STRONG", "B", "EM", "I", "BR", "SPAN", "SMALL", "ABBR", "TIME", "U", "SUP", "SUB", "MARK"]);
const ATTRS = ["alt", "aria-label", "placeholder", "title"];
const NOT_INLINE = `:not(${[...INLINE].join(",").toLowerCase()})`;

/*
 * Pages de/ et en/ (<base href="../">) : un lien ajouté par un script vers une page du site
 * ("evenements.html", "contact.html?type=…") mène à la page de la même langue, et une ancre "#…"
 * reste sur la page courante (sinon elle mènerait à la page française).
 */
const base = hasDom && lang !== "fr" ? new URL(document.baseURI) : null;
function localizeLink(a) {
  const href = a.getAttribute("href");
  if (!base || !href) return;
  if (href.startsWith("#")) {
    a.setAttribute("href", location.href.split("#")[0] + href);
    return;
  }
  const url = new URL(href, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return;
  const file = url.pathname.slice(base.pathname.length);
  if (!/^([\w-]+\.html)?$/.test(file) || file === "404.html") return;
  a.setAttribute("href", `${lang}/${file}${url.search}${url.hash}`);
}
const localizeLinks = (el) => {
  if (el.nodeName === "A") localizeLink(el);
  el.querySelectorAll?.("a[href]").forEach(localizeLink);
};

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
  if (el.getAttribute("translate") === "no") return;
  // Champ de saisie : seul son placeholder (ou titre) est traduit, jamais ce qui est tapé.
  if (el.nodeName === "TEXTAREA") for (const name of ATTRS) translateAttr(el, name);
  if (SKIP.has(el.nodeName.toUpperCase())) return;
  for (const name of ATTRS) translateAttr(el, name);
  if (isMixed(el)) {
    const key = norm(el.innerHTML);
    if (key in dict) {
      el.innerHTML = dict[key];
      localizeLinks(el);
    } else if (missing) missing.add(key);
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
  localizeLinks(document.body);

  // Tout ce que les scripts ajoutent ou modifient ensuite est traduit au passage.
  const observer = new MutationObserver((records) => {
    // Débranché pendant le traitement : les remplacements faits ici ne doivent pas se redéclencher
    // eux-mêmes (boucle). Rebranché à la fin par observe().
    observer.disconnect();
    for (const r of records) {
      if (r.type === "attributes") {
        if (r.attributeName === "href") localizeLink(r.target);
        else if (!skipped(r.target)) translateAttr(r.target, r.attributeName);
      } else if (r.type === "characterData") {
        if (!skipped(r.target.parentElement)) translateText(r.target);
      } else {
        for (const node of r.addedNodes) {
          if (!node.isConnected) continue;
          if (node.nodeType === 3 && !skipped(node.parentElement)) {
            // Texte remplacé dans un paragraphe mixte : on retraduit le paragraphe entier.
            if (isMixed(node.parentElement)) translateElement(node.parentElement);
            else translateText(node);
          } else if (node.nodeType === 1) {
            localizeLinks(node);
            if (!skipped(node.parentElement)) translateElement(node);
          }
        }
      }
    }
    if (document.title !== tr(document.title)) document.title = tr(document.title);
    observe();
  });
  const observe = () => observer.observe(document.documentElement, {
    subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS, "href"]
  });
  observe();

  // Textes affichés par le CSS (content: …)
  document.documentElement.style.setProperty("--t-live", JSON.stringify(tr("EN DIRECT")));

}

if (hasDom && lang !== "fr") {
  if (document.body) startTranslation();
  else document.addEventListener("DOMContentLoaded", startTranslation, { once: true });
}
