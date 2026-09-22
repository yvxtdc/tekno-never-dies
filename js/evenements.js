import { EVENTS } from "./data/events.js";

function formatDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

function card(e) {
  const archive = e.statut === "archive";
  return `
  <a class="card${archive ? " card--archive" : ""}" href="evenement.html?e=${encodeURIComponent(e.slug)}">
    <div class="card-media" style="background-image:url('assets/img/${e.visuel}')"></div>
    <div class="card-body">
      <span class="tag">${archive ? "Passé" : "À venir"}</span>
      <h3>${e.nom}</h3>
      <p>${e.lieu}${e.horaires ? " — " + e.horaires : ""}</p>
      <div class="card-foot"><span>${formatDate(e.date)}</span><span>Voir la fiche →</span></div>
    </div>
  </a>`;
}

const avenirEl = document.getElementById("events-avenir");
const archiveEl = document.getElementById("events-archive");

const avenir = EVENTS.filter((e) => e.statut === "avenir").sort((a, b) => a.date.localeCompare(b.date));
const archive = EVENTS.filter((e) => e.statut === "archive").sort((a, b) => b.date.localeCompare(a.date));

avenirEl.innerHTML = avenir.length ? avenir.map(card).join("") : "<p>Aucun événement annoncé pour le moment — revenez bientôt.</p>";
archiveEl.innerHTML = archive.length ? archive.map(card).join("") : "<p>Pas encore d'archives.</p>";

// ---- Onglets ----
const tabAvenir = document.getElementById("tab-avenir");
const tabArchive = document.getElementById("tab-archive");
const panelAvenir = document.getElementById("panel-avenir");
const panelArchive = document.getElementById("panel-archive");

function selectTab(which) {
  const onAvenir = which === "avenir";
  tabAvenir.setAttribute("aria-selected", String(onAvenir));
  tabArchive.setAttribute("aria-selected", String(!onAvenir));
  panelAvenir.hidden = !onAvenir;
  panelArchive.hidden = onAvenir;
}
tabAvenir.addEventListener("click", () => selectTab("avenir"));
tabArchive.addEventListener("click", () => selectTab("archive"));
