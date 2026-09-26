import { EVENTS } from "../data/events.js";
import { MATERIEL } from "../data/materiel.js";
import { formatDate, thumb } from "./helpers.js";

// --- Aperçu des 3 prochains événements ------------------------------------
const upcoming = EVENTS.filter((e) => e.status === "a-venir")
  .sort((a, b) => a.date.localeCompare(b.date))
  .slice(0, 3);

const eventsRoot = document.getElementById("home-events");
if (eventsRoot) {
  eventsRoot.innerHTML = upcoming.length
    ? upcoming
        .map(
          (ev) => `
        <li class="event-card">
          ${thumb(ev.cover, ev.title, "Photo à venir")}
          <div class="event-card__body">
            <span class="event-card__date">${formatDate(ev.date)}</span>
            ${ev.demo ? '<span class="demo-label">DEMO À REMPLACER</span>' : ""}
            <h3>${ev.title}</h3>
            <p>${ev.place}</p>
            <a class="btn btn-line btn-sm" href="evenement.html?slug=${ev.slug}">Voir la fiche</a>
          </div>
        </li>`
        )
        .join("")
    : "<p>Prochaine date en préparation — revenez bientôt.</p>";
}

// --- Aperçu de 3 équipements du catalogue ----------------------------------
const materielRoot = document.getElementById("home-materiel");
if (materielRoot) {
  materielRoot.innerHTML = MATERIEL.slice(0, 3)
    .map(
      (item) => `
      <li class="material-card">
        ${thumb(item.cover, item.name, "Photo à ajouter")}
        <div class="material-card__body">
          <h3>${item.name}</h3>
          ${item.demo ? '<span class="demo-label">VISUEL DEMO</span>' : ""}
          <p>${item.short}</p>
          <span class="price">${item.price || "Sur devis"}</span>
        </div>
      </li>`
    )
    .join("");
}

const newsletterForm = document.getElementById("newsletter-form");
newsletterForm?.addEventListener("submit", (event) => {
  document.getElementById("newsletter-status").textContent =
    "Le formulaire Brevo s'ouvre dans un nouvel onglet. Confirme ton adresse par e-mail si Brevo te le demande.";
});
