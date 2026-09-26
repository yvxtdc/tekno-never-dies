import { CATEGORIES, MATERIEL } from "../data/materiel.js";
import { thumb } from "./helpers.js";

const root = document.getElementById("catalogue");
const search = document.getElementById("material-search");
const filter = document.getElementById("material-filter");
const selected = new Set(JSON.parse(localStorage.getItem("tnd-quote-items") || "[]"));

function matches(item) {
  const query = search.value.trim().toLocaleLowerCase("fr");
  const haystack = [item.name, item.short, item.description, item.category].join(" ").toLocaleLowerCase("fr");
  return (!query || haystack.includes(query)) && (filter.value === "tous" || item.category === filter.value);
}

function card(item) {
  return `
    <li class="material-card">
      ${thumb(item.cover, item.name, "Photo à ajouter")}
      <div class="material-card__body">
        <h3>${item.name}</h3>
        ${item.demo ? '<span class="demo-label">VISUEL / FICHE DEMO</span>' : ""}
        <p>${item.short}</p>
        <div class="material-card__foot">
          <span class="price">${item.price || "Sur devis"}</span>
          <div class="card-actions">
            <a class="btn btn-line btn-sm" href="materiel.html?slug=${item.slug}">Voir la fiche</a>
            <button class="btn btn-cyan btn-sm quote-toggle" type="button" data-slug="${item.slug}" aria-pressed="${selected.has(item.slug)}">${selected.has(item.slug) ? "Retirer" : "Ajouter au devis"}</button>
          </div>
        </div>
      </div>
    </li>`;
}

function updateSummary() {
  const items = MATERIEL.filter((item) => selected.has(item.slug));
  const count = items.length;
  document.getElementById("quote-count").textContent = `${count} équipement${count > 1 ? "s" : ""} sélectionné${count > 1 ? "s" : ""}`;
  document.getElementById("quote-list").textContent = count
    ? items.map((item) => item.name).join(", ")
    : "Ajoutez du matériel pour préparer votre demande.";
  document.getElementById("quote-link").href = `contact.html?type=location&materiel=${encodeURIComponent(items.map((item) => item.name).join(", "))}`;
  localStorage.setItem("tnd-quote-items", JSON.stringify([...selected]));
}

function render() {
  root.innerHTML = CATEGORIES.map((cat) => {
  const items = MATERIEL.filter((m) => m.category === cat.id && matches(m));
  if (!items.length) return "";
  return `
    <section class="catalogue-section" id="${cat.id}">
      <h2>${cat.label}</h2>
      <ul class="material-grid">${items.map(card).join("")}</ul>
    </section>`;
}).join("");

  if (!root.innerHTML) root.innerHTML = '<p class="empty-state">Aucun équipement ne correspond à votre recherche.</p>';
  root.querySelectorAll(".quote-toggle").forEach((button) => button.addEventListener("click", () => {
    selected.has(button.dataset.slug) ? selected.delete(button.dataset.slug) : selected.add(button.dataset.slug);
    render();
    updateSummary();
  }));
}

// Onglets de catégories : simples ancres vers les sections ci-dessus
document.getElementById("catalogue-nav").innerHTML = CATEGORIES
  .filter((cat) => MATERIEL.some((m) => m.category === cat.id))
  .map((cat) => `<a href="#${cat.id}">${cat.label}</a>`)
  .join("");

CATEGORIES.forEach((cat) => filter.insertAdjacentHTML("beforeend", `<option value="${cat.id}">${cat.label}</option>`));
search.addEventListener("input", render);
filter.addEventListener("change", render);
render();
updateSummary();
