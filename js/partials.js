// Comportements communs à toutes les pages. Le header et le footer sont déjà dans le HTML
// (insérés par tools/sync-partials.mjs) : ce script ne fait qu'activer le menu, le lien de la
// page courante, l'en-tête au défilement et les données de référencement.
import { SITE } from "./data/site.js";

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
  // og:title, og:description, theme-color… sont écrits en dur dans chaque page (les robots des
  // réseaux sociaux n'exécutent pas de JavaScript). Ici : uniquement ce qui dépend du domaine.
  if (SITE.url && !SITE.url.includes("example.org")) {
    const url = new URL(location.pathname, SITE.url).href;
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
    address: {
      "@type": "PostalAddress",
      streetAddress: address.street,
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
  const links = [...nav.querySelectorAll(".tnd-links a")];
  const isOpen = () => button.getAttribute("aria-expanded") === "true";

  const setOpen = (open) => {
    button.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("is-open", open);
    document.body.classList.toggle("tnd-lock", open);
    if (label) label.textContent = open ? "Fermer" : "Menu";
    if (open) links[0]?.focus({ preventScroll: true });
  };

  button.addEventListener("click", () => setOpen(!isOpen()));
  links.forEach((a) => a.addEventListener("click", () => setOpen(false)));

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

// Header opaque dès qu'on a défilé
function initScrolledHeader() {
  const header = document.querySelector(".top");
  if (!header) return;
  const update = () => header.classList.toggle("is-scrolled", window.scrollY > 24);
  update();
  window.addEventListener("scroll", update, { passive: true });
}

markActiveLink();
initMenu();
initScrolledHeader();
initSeo();
