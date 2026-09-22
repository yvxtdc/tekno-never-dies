import { EVENTS } from "../data/events.js";
import { formatDate, thumb } from "./helpers.js";

const upcoming = EVENTS.filter((e) => e.status === "a-venir").sort((a, b) => a.date.localeCompare(b.date));
const past = EVENTS.filter((e) => e.status === "passe").sort((a, b) => b.date.localeCompare(a.date));

function card(ev) {
  const ticket = ev.ticketUrl
    ? `<a class="btn btn-cyan btn-sm" href="${ev.ticketUrl}" target="_blank" rel="noopener">Billetterie</a>`
    : "";
  return `
    <li class="event-card">
      ${thumb(ev.cover, ev.title, "Photo à venir")}
      <div class="event-card__body">
        <span class="event-card__date">${formatDate(ev.date)}</span>
        <h3>${ev.title}</h3>
        <p>${ev.place}</p>
        <div class="event-card__actions">
          <a class="btn btn-line btn-sm" href="evenement.html?slug=${ev.slug}">Voir la fiche</a>
          ${ticket}
        </div>
      </div>
    </li>`;
}

document.getElementById("upcoming-events").innerHTML =
  upcoming.length ? upcoming.map(card).join("") : "<p>Aucun événement à venir pour le moment — revenez bientôt.</p>";

document.getElementById("past-events").innerHTML =
  past.length ? past.map(card).join("") : "<p>Pas encore d'événement passé référencé.</p>";
