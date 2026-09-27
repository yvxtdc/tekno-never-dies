import { EVENTS } from "../data/events.js";
import { formatDate, thumb, readParam } from "./helpers.js";
import { downloadICS, parisOffset } from "./ics.js";

const root = document.getElementById("event-detail");
const ev = EVENTS.find((e) => e.slug === readParam("slug"));

if (!ev) {
  root.innerHTML = `
    <p>Événement introuvable.</p>
    <p><a class="btn btn-line" href="evenements.html">Retour aux événements</a></p>`;
} else {
  document.title = `${ev.title} — Tekno Never Dies`;
  const startTime = (ev.time?.match(/\d{1,2}h\d{2}/)?.[0] || "20h00").replace("h", ":");
  const eventSchema = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: ev.title,
    description: ev.description,
    // Décalage horaire calculé selon la date (+01:00 en hiver, +02:00 en été)
    startDate: `${ev.date}T${startTime}:00${parisOffset(ev.date, Number(startTime.split(":")[0]))}`,
    location: { "@type": "Place", name: ev.place },
    organizer: { "@type": "Organization", name: "TEKNO NEVER DIES" }
  };
  const schema = document.createElement("script");
  schema.type = "application/ld+json";
  schema.textContent = JSON.stringify(eventSchema);
  document.head.append(schema);

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
    ${ev.demo ? '<p class="demo-label">DEMO À REMPLACER PAR LES INFORMATIONS RÉELLES</p>' : ""}
    <p class="event-detail__meta">${formatDate(ev.date)}${ev.time ? " · " + ev.time : ""} · ${ev.place}</p>
    <p>${ev.description}</p>
    ${practical ? `<h2>Informations pratiques</h2><ul>${practical}</ul>` : ""}
    <div class="actions">
      ${ticket}
      ${ev.status === "a-venir" ? '<button class="btn btn-line" type="button" id="add-to-calendar">Ajouter à mon agenda</button>' : ""}
      <a class="btn btn-line" href="contact.html?type=evenement&evenement=${encodeURIComponent(ev.title)}">Une question sur cet événement ?</a>
    </div>
    ${galleryLink}
  `;

  // Bouton "Ajouter à mon agenda" : télécharge un fichier .ics pour cet événement
  document.getElementById("add-to-calendar")?.addEventListener("click", () => {
    downloadICS([ev], `tnd-${ev.slug}.ics`);
  });
}
