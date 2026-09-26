import { SITE } from "./data/site.js";

async function include(el) {
  const url = el.getAttribute("data-include");
  try {
    const res = await fetch(`${url}?v=20260923`, { cache: "no-store" });
    if (!res.ok) throw new Error(res.status);
    el.outerHTML = await res.text();
  } catch (err) {
    console.error(`Impossible de charger ${url}`, err);
  }
}

function markActiveLink() {
  const page = document.body.dataset.page;
  if (!page) return;
  document.querySelectorAll(`[data-nav="${page}"]`).forEach(a => {
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
  const description = document.querySelector('meta[name="description"]')?.content || SITE.description;
  addMeta("theme-color", "#4226b6");
  addMeta("og:type", "website", "property");
  addMeta("og:title", document.title, "property");
  addMeta("og:description", description, "property");
  if (SITE.url && !SITE.url.includes("example.org")) {
    addMeta("og:url", new URL(location.pathname, SITE.url).href, "property");
    const canonical = document.createElement("link");
    canonical.rel = "canonical";
    canonical.href = new URL(location.pathname, SITE.url).href;
    document.head.append(canonical);
  }

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE.official.legalName,
    alternateName: SITE.shortName,
    description,
    address: {
      "@type": "PostalAddress",
      // TODO à vérifier avec l'autre dev : tekno-never-dies_2 indique "5 avenue" (voir js/data/site.js)
      streetAddress: "51 avenue Georges Clemenceau",
      postalCode: "67630",
      addressLocality: "Lauterbourg",
      addressCountry: "FR"
    },
    identifier: [SITE.official.siren, SITE.official.siret]
  };
  const script = document.createElement("script");
  script.type = "application/ld+json";
  script.textContent = JSON.stringify(structuredData);
  document.head.append(script);
}

// Menu plein écran (design repris de tekno-never-dies_2, voir css/style.css section 9)
function initMenu() {
  const button = document.querySelector(".tnd-toggle");
  const nav = document.querySelector("#main-navigation");
  if (!button || !nav) return;

  const label = button.querySelector(".tnd-toggle-label");

  const setOpen = (open) => {
    button.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("is-open", open);
    document.body.classList.toggle("tnd-lock", open);
    if (label) label.textContent = open ? "Fermer" : "Menu";
    if (open) nav.querySelector(".tnd-links a")?.focus({ preventScroll: true });
  };

  button.addEventListener("click", () => {
    setOpen(button.getAttribute("aria-expanded") !== "true");
  });

  nav.querySelectorAll(".tnd-links a").forEach(a => a.addEventListener("click", () => setOpen(false)));

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && button.getAttribute("aria-expanded") === "true") {
      setOpen(false);
      button.focus();
    }
  });
}

const nodes = [...document.querySelectorAll("[data-include]")];
Promise.all(nodes.map(include)).then(() => {
  markActiveLink();
  initMenu();
  initSeo();
});
