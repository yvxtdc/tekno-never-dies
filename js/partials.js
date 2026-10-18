// Comportements communs à toutes les pages. Le header et le footer sont déjà dans le HTML
// (insérés par tools/sync-partials.mjs) : ce script ne fait qu'activer le menu, le lien de la
// page courante, l'en-tête au défilement et les données de référencement.
import { SITE } from "./data/site.js";
import { EVENTS } from "./data/events.js";
import { eventStatus, formatDate, formatTime, esc, safeUrl, track, eventPath } from "./pages/helpers.js";
import { lang, setLang, savedLang, pageInLang } from "./i18n/i18n.js";

function markActiveLink() {
  const page = document.body.dataset.page;
  if (!page) return;
  document.querySelectorAll(`[data-nav="${page}"]`).forEach((a) => {
    a.classList.add("active");
    a.setAttribute("aria-current", "page");
    // Petit égaliseur animé à côté du lien de la page en cours (menu plein écran)
    if (a.closest(".tnd-links") && !a.querySelector(".tnd-eq")) {
      a.insertAdjacentHTML(
        "beforeend",
        '<span class="tnd-eq" aria-hidden="true"><span></span><span></span><span></span><span></span></span>'
      );
    }
  });
}

function addMeta(name, content, attribute = "name") {
  if (!content || document.head.querySelector(`meta[${attribute}="${name}"]`)) return;
  const meta = document.createElement("meta");
  meta.setAttribute(attribute, name);
  meta.content = content;
  document.head.append(meta);
}

function initSeo() {
  // og:title, og:description, og:url, canonical… sont écrits en dur dans chaque page (les robots des
  // réseaux sociaux n'exécutent pas de JavaScript), fiches événement comprises (tools/event-pages.mjs).
  // Ici : uniquement une page qui n'en aurait pas.
  if (SITE.url && !document.head.querySelector('link[rel="canonical"]') && !document.querySelector('meta[name="robots"][content*="noindex"]')) {
    const url = new URL(location.pathname.split("/").pop(), SITE.url).href;
    addMeta("og:url", url, "property");
    const canonical = document.createElement("link");
    canonical.rel = "canonical";
    canonical.href = url;
    document.head.append(canonical);
  }

  const description = document.querySelector('meta[name="description"]')?.content || SITE.description;
  const { address, legalName, siren, siret } = SITE.official;
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: legalName,
    alternateName: SITE.shortName,
    description,
    url: SITE.url,
    logo: new URL("assets/img/badge-white.webp", SITE.url).href,
    email: SITE.email,
    sameAs: ["https://www.instagram.com/tnd6tem/"],
    address: {
      "@type": "PostalAddress",
      ...(address.street ? { streetAddress: address.street } : {}),
      postalCode: address.postalCode,
      addressLocality: address.city,
      addressCountry: "FR"
    },
    identifier: [siren, siret]
  };
  const script = document.createElement("script");
  script.type = "application/ld+json";
  script.textContent = JSON.stringify(structuredData);
  document.head.append(script);
}

// Menu plein écran (styles : css/style.css, section « menu plein écran »)
function initMenu() {
  const button = document.querySelector(".tnd-toggle");
  const nav = document.querySelector("#main-navigation");
  if (!button || !nav) return;

  const label = button.querySelector(".tnd-toggle-label");
  const links = [...nav.querySelectorAll("a, button")];
  const isOpen = () => button.getAttribute("aria-expanded") === "true";

  const setOpen = (open) => {
    button.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("is-open", open);
    document.body.classList.toggle("tnd-lock", open);
    if (label) label.textContent = open ? "Fermer" : "Menu";
    if (open) links[0]?.focus({ preventScroll: true });
  };

  button.addEventListener("click", () => setOpen(!isOpen()));
  links.filter((a) => a.matches("a")).forEach((a) => a.addEventListener("click", () => setOpen(false)));

  document.addEventListener("keydown", (e) => {
    if (!isOpen()) return;
    if (e.key === "Escape") {
      setOpen(false);
      button.focus();
      return;
    }
    // Le focus reste dans le menu tant qu'il est ouvert (bouton + liens)
    if (e.key === "Tab") {
      const items = [button, ...links];
      const i = items.indexOf(document.activeElement);
      if (i === -1 || (e.shiftKey && i === 0) || (!e.shiftKey && i === items.length - 1)) {
        e.preventDefault();
        items[e.shiftKey ? items.length - 1 : 0].focus();
      }
    }
  });
}

// Menu (ordinateur) : la prochaine soirée de js/data/events.js dans la colonne de droite
function initMenuNext() {
  const box = document.querySelector(".tnd-next");
  const next = EVENTS
    .filter((ev) => eventStatus(ev) === "a-venir")
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!box || !next) return;
  const ficheUrl = eventPath(next.slug);
  const visual = next.flyer || next.cover;
  const ticketUrl = safeUrl(next.ticketUrl);
  box.innerHTML = `
    <p class="tnd-next__eyebrow">Prochaine soirée</p>
    <a class="tnd-next__card" href="${ficheUrl}">
      ${visual ? `<img src="${esc(visual)}" alt="" loading="lazy" decoding="async" />` : ""}
      <span class="tnd-next__title">${esc(next.title)}</span>
      <span class="tnd-next__when">${esc([formatDate(next.date, next.datePrecision), formatTime(next.time)].filter(Boolean).join(" · "))}</span>
    </a>
    ${ticketUrl ? `<a class="tnd-next__ticket" href="${esc(ticketUrl)}" target="_blank" rel="noopener">Prendre ma place ↗</a>` : ""}`;
  box.hidden = false;
}

// Choix de la langue en bas du menu : FR / DE / EN
function initLangSwitch() {
  document.querySelectorAll(".tnd-lang [data-lang]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.lang === lang));
    button.addEventListener("click", () => setLang(button.dataset.lang));
  });
}

// Première visite d'un navigateur réglé en allemand ou en anglais : proposition de changer de langue.
// Pas de redirection automatique : les moteurs de recherche (réglés en anglais) doivent pouvoir lire
// les pages françaises ; ils trouvent les versions de/ et en/ par le sitemap.
const SUGGEST = {
  de: { text: "Diese Seite gibt es auch auf Deutsch.", link: "Auf Deutsch lesen", close: "Schließen" },
  en: { text: "This page is also available in English.", link: "Read in English", close: "Close" }
};
function initLangSuggestion() {
  const wanted = (navigator.language || "").slice(0, 2);
  const offer = SUGGEST[wanted];
  if (lang !== "fr" || !offer || savedLang() || document.documentElement.hasAttribute("data-no-lang-redirect")) return;
  const bar = document.createElement("aside");
  bar.className = "lang-suggest";
  bar.lang = wanted;
  bar.setAttribute("translate", "no");
  bar.innerHTML = `<p>${offer.text}</p>
    <a href="${esc(pageInLang(wanted))}">${offer.link}</a>
    <button type="button" aria-label="${offer.close}">×</button>`;
  bar.querySelector("a").addEventListener("click", (event) => {
    event.preventDefault();
    setLang(wanted);
  });
  bar.querySelector("button").addEventListener("click", () => {
    // Refus enregistré comme un choix du français : la proposition ne revient pas.
    try { localStorage.setItem("tnd-lang", "fr"); } catch { /* stockage bloqué */ }
    bar.remove();
  });
  document.body.append(bar);
}

// Header opaque dès qu'on a défilé
function initScrolledHeader() {
  const header = document.querySelector(".top");
  if (!header) return;
  const update = () => header.classList.toggle("is-scrolled", window.scrollY > 24);
  update();
  window.addEventListener("scroll", update, { passive: true });
}

// Page 404 (balise <base>) : les ancres "#main" doivent rester sur la page courante.
function fixAnchorsWithBase() {
  if (!document.querySelector("base")) return;
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.href = location.href.split("#")[0] + a.getAttribute("href");
  });
}

// Statistiques de visite (GoatCounter, sans cookie ; voir confidentialite.html). Pas de comptage en local.
function initAnalytics() {
  if (!SITE.goatcounter) return;
  // Page comptée depuis la racine du site (« /evenements.html ») : les statistiques continuent
  // sans coupure le jour où le site change d'adresse (domaine en .fr). Sans de/ ni en/ : une page
  // reste une seule ligne, quelle que soit la langue.
  const root = new URL("../", import.meta.url).pathname;
  window.goatcounter = {
    path() {
      const { pathname } = location;
      let page = pathname.startsWith(root) ? pathname.slice(root.length) : pathname.replace(/^\//, "");
      page = page.replace(/^(de|en)\//, "");
      if (page === "index.html") page = "";
      return `/${page}`;
    }
  };
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://gc.zgo.at/count.js";
  script.dataset.goatcounter = SITE.goatcounter;
  document.head.append(script);
}

// Clics sur les liens qui quittent la page sans être une page du site (comptés par GoatCounter).
function trackLinkClicks() {
  document.addEventListener("click", (event) => {
    const link = event.target.closest?.("a[href]");
    if (!link) return;
    const url = new URL(link.href, location.href);
    if (url.protocol === "mailto:") return track("E-mail");
    if (url.protocol === "tel:") return track("Téléphone");
    if (url.protocol === "webcal:") return track("Agenda · abonnement");
    if (url.origin === location.origin) return; // page du site : déjà comptée à son ouverture
    const host = url.hostname.replace(/^www\./, "");
    const ticketFor = EVENTS.find((ev) => ev.ticketUrl && safeUrl(ev.ticketUrl) === url.href);
    const current = EVENTS.find((ev) => ev.slug === document.body.dataset.slug);
    if (ticketFor) track(`Billetterie · ${ticketFor.title}`);
    else if (host === "instagram.com") track(`Instagram · @${url.pathname.split("/")[1] || "tnd6tem"}`);
    else if (/google\.[a-z.]+$/.test(host) && url.pathname.startsWith("/maps") || host === "waze.com" || host === "maps.apple.com") {
      track(`Itinéraire · ${current?.title || "?"}`);
    } else track(`Lien externe · ${host}`);
  }, { capture: true });
}

fixAnchorsWithBase();
markActiveLink();
initMenuNext();
initMenu();
initLangSwitch();
initLangSuggestion();
initScrolledHeader();
initSeo();
initAnalytics();
trackLinkClicks();
