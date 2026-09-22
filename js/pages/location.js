import { CATEGORIES, MATERIEL } from "../data/materiel.js";
import { thumb } from "./helpers.js";

function card(item) {
  return `
    <li class="material-card">
      ${thumb(item.cover, item.name, "Photo à ajouter")}
      <div class="material-card__body">
        <h3>${item.name}</h3>
        <p>${item.short}</p>
        <div class="material-card__foot">
          <span class="price">${item.price || "Sur devis"}</span>
          <a class="btn btn-line btn-sm" href="materiel.html?slug=${item.slug}">Voir la fiche</a>
        </div>
      </div>
    </li>`;
}

const root = document.getElementById("catalogue");
root.innerHTML = CATEGORIES.map((cat) => {
  const items = MATERIEL.filter((m) => m.category === cat.id);
  if (!items.length) return "";
  return `
    <section class="catalogue-section" id="${cat.id}">
      <h2>${cat.label}</h2>
      <ul class="material-grid">${items.map(card).join("")}</ul>
    </section>`;
}).join("");

// Onglets de catégories : simples ancres vers les sections ci-dessus
document.getElementById("catalogue-nav").innerHTML = CATEGORIES
  .filter((cat) => MATERIEL.some((m) => m.category === cat.id))
  .map((cat) => `<a href="#${cat.id}">${cat.label}</a>`)
  .join("");
