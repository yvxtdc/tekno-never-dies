import { EVENTS } from "./data/events.js";
import { CATALOGUE, CATEGORIES } from "./data/catalogue.js";

function formatDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

// ---- Agenda : 3 prochains événements ----
const agendaEl = document.getElementById("home-agenda");
if (agendaEl) {
  const avenir = EVENTS.filter((e) => e.statut === "avenir")
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 3);

  agendaEl.innerHTML = avenir.length
    ? avenir
        .map(
          (e, i) => `
      <li>
        <span class="when">${formatDate(e.date)}</span>
        <span class="what"><strong>${e.nom}</strong><span>${e.lieu}</span></span>
        <a class="pill" href="evenement.html?e=${encodeURIComponent(e.slug)}">Voir la fiche</a>
      </li>`
        )
        .join("")
    : `<li><span class="what"><strong>Prochaine date à annoncer</strong><span>Suis nos réseaux pour rester informé·e</span></span></li>`;
}

// ---- Catalogue : 3 packs mis en avant ----
const catEl = document.getElementById("home-catalogue");
if (catEl) {
  const packs = CATALOGUE.filter((m) => m.categorie === "pack").slice(0, 3);
  const items = packs.length ? packs : CATALOGUE.slice(0, 3);

  catEl.innerHTML = items
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
    .join("");
}
