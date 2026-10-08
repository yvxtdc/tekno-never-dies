// « Le prochain rendez-vous » : rempli depuis js/data/events.js pour ne jamais afficher une date passée.
import { EVENTS } from "../data/events.js";
import { eventStatus, formatDate, esc } from "./helpers.js";

const text = document.getElementById("next-event-text");
const link = document.getElementById("next-event-link");
const next = EVENTS
  .filter((ev) => eventStatus(ev) === "a-venir")
  .sort((a, b) => a.date.localeCompare(b.date))[0];

if (text && link) {
  if (next) {
    const start = next.time?.match(/\d{1,2}h\d{2}/)?.[0];
    const details = [next.price && `Entrée ${next.price}`, next.age && next.age.toLocaleLowerCase("fr")].filter(Boolean).join(", ");
    text.innerHTML = `La prochaine date annoncée est <strong>${esc(next.title)}</strong>, le ${formatDate(next.date, next.datePrecision)}${start ? ` à ${esc(start)}` : ""}${next.place ? `, ${esc(next.place)}` : ""}.${details ? ` ${esc(details.charAt(0).toUpperCase() + details.slice(1))}.` : ""}`;
    link.href = `evenement.html?slug=${encodeURIComponent(next.slug)}`;
    link.textContent = "Voir la soirée";
  } else {
    text.textContent = "La prochaine date sera annoncée ici et sur Instagram @tnd6tem dès qu'elle sera confirmée.";
    link.href = "evenements.html";
    link.textContent = "Voir les événements";
  }
}
