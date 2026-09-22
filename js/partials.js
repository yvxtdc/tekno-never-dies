/**
 * Charge l'en-tête et le pied de page depuis partials/, pour ne les écrire
 * qu'une seule fois et les avoir identiques sur toutes les pages.
 *
 * Utilisation dans une page : mets deux éléments vides dans le HTML,
 *   <div data-include="partials/header.html"></div>
 *   <div data-include="partials/footer.html"></div>
 * et charge ce script en <script type="module" src="js/partials.js"></script>.
 *
 * Le lien du menu correspondant à la page actuelle reçoit la classe
 * "active" automatiquement (via l'attribut data-nav de header.html).
 */
async function include(el) {
  const url = el.getAttribute("data-include");
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    el.outerHTML = await res.text();
  } catch (err) {
    console.error(`Impossible de charger ${url}`, err);
  }
}

function markActiveLink() {
  const page = document.body.dataset.page;
  if (!page) return;
  document.querySelectorAll(`[data-nav="${page}"]`).forEach((a) => a.classList.add("active"));
}

const nodes = [...document.querySelectorAll("[data-include]")];
Promise.all(nodes.map(include)).then(markActiveLink);
