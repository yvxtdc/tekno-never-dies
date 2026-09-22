import { EVENTS } from "../data/events.js";
import { formatDate, thumb, readParam } from "./helpers.js";

const root = document.getElementById("event-detail");
const ev = EVENTS.find((e) => e.slug === readParam("slug"));

if (!ev) {
  root.innerHTML = `
    <p>Événement introuvable.</p>
    <p><a class="btn btn-line" href="evenements.html">Retour aux événements</a></p>`;
} else {
  document.title = `${ev.title} — Tekno Never Dies`;

  const ticket = ev.ticketUrl
    ? `<a class="btn btn-solid" href="${ev.ticketUrl}" target="_blank" rel="noopener">Accéder à la billetterie</a>`
    : "";
  const practical = (ev.practical || []).map((p) => `<li>${p}</li>`).join("");
  const galleryLink = ev.gallerySlug
    ? `<p><a href="galerie.html#${ev.gallerySlug}">Voir les photos de cet événement →</a></p>`
    : "";

  root.innerHTML = `
    <a class="back-link" href="evenements.html">← Tous les événements</a>
    ${thumb(ev.cover, ev.title, "Photo à venir")}
    <h1>${ev.title}</h1>
    <p class="event-detail__meta">${formatDate(ev.date)}${ev.time ? " · " + ev.time : ""} · ${ev.place}</p>
    <p>${ev.description}</p>
    ${practical ? `<h2>Informations pratiques</h2><ul>${practical}</ul>` : ""}
    <div class="actions">
      ${ticket}
      <a class="btn btn-line" href="contact.html?sujet=evenement&evenement=${encodeURIComponent(ev.title)}">Une question sur cet événement ?</a>
    </div>
    ${galleryLink}
  `;
}
