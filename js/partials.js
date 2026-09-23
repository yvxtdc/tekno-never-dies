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
  if (page) document.querySelectorAll(`[data-nav="${page}"]`).forEach(a => a.classList.add("active"));
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

function initMenu() {
  const button = document.querySelector(".menu-toggle");
  const nav = document.querySelector("#main-navigation");
  if (!button || !nav) return;

  const close = () => {
    button.setAttribute("aria-expanded", "false");
    nav.classList.remove("is-open");
    button.querySelector(".sr-only").textContent = "Ouvrir le menu";
  };

  button.addEventListener("click", () => {
    const open = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!open));
    nav.classList.toggle("is-open", !open);
    button.querySelector(".sr-only").textContent = open ? "Ouvrir le menu" : "Fermer le menu";
  });

  nav.querySelectorAll("a").forEach(a => a.addEventListener("click", close));

document.addEventListener("keydown", e => {
  if (e.key === "Escape") close();
});

document.addEventListener("click", e => {
  const open = button.getAttribute("aria-expanded") === "true";

  if (open && !nav.contains(e.target) && !button.contains(e.target)) {
    close();
  }
});

}

const nodes = [...document.querySelectorAll("[data-include]")];
Promise.all(nodes.map(include)).then(() => {
  markActiveLink();
  initMenu();
  initSeo();
});
