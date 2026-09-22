import { CATALOGUE, CATEGORIES } from "./data/catalogue.js";

const grid = document.getElementById("cat-grid");
const chipsEl = document.getElementById("cat-chips");
const searchEl = document.getElementById("cat-search");

let activeCat = "tous";
let query = "";

// ---- Chips de catégories ----
const cats = ["tous", ...Object.keys(CATEGORIES)];
chipsEl.innerHTML = cats
  .map(
    (c) =>
      `<button class="chip" data-cat="${c}" aria-pressed="${c === "tous"}">${c === "tous" ? "Tout voir" : CATEGORIES[c]}</button>`
  )
  .join("");

chipsEl.addEventListener("click", (ev) => {
  const btn = ev.target.closest(".chip");
  if (!btn) return;
  activeCat = btn.dataset.cat;
  [...chipsEl.querySelectorAll(".chip")].forEach((c) => c.setAttribute("aria-pressed", String(c === btn)));
  render();
});

searchEl.addEventListener("input", () => {
  query = searchEl.value.trim().toLowerCase();
  render();
});

function render() {
  const items = CATALOGUE.filter((m) => {
    const matchCat = activeCat === "tous" || m.categorie === activeCat;
    const matchQuery = !query || m.nom.toLowerCase().includes(query) || m.court.toLowerCase().includes(query);
    return matchCat && matchQuery;
  });

  grid.innerHTML = items.length
    ? items
        .map(
          (m) => `
    <a class="card" href="materiel.html?m=${encodeURIComponent(m.slug)}">
      <div class="card-media" style="background-image:url('assets/img/${m.visuel}')"></div>
      <div class="card-body">
        <span class="tag">${CATEGORIES[m.categorie]}</span>
        <h3>${m.nom}</h3>
        <p>${m.court}</p>
        <div class="card-foot"><span class="price">${m.tarifJournee} / jour</span><span>Voir la fiche →</span></div>
      </div>
    </a>`
        )
        .join("")
    : "<p>Aucun résultat pour cette recherche.</p>";
}

render();
