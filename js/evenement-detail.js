import { EVENTS } from "./data/events.js";

function formatDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}

const params = new URLSearchParams(location.search);
const slug = params.get("e");
const event = EVENTS.find((e) => e.slug === slug) || EVENTS.find((e) => e.statut === "avenir") || EVENTS[0];

document.title = `${event.nom} — Tekno Never Dies`;
document.getElementById("page-title").textContent = document.title;
document.getElementById("crumb-nom").textContent = event.nom;
document.getElementById("event-nom").textContent = event.nom;
document.getElementById("event-souschapo").textContent = `${formatDate(event.date)} · ${event.lieu}`;

const isArchive = event.statut === "archive";

const infosPratiques = !isArchive
  ? `
  <dl>
    <div><dt>Horaires</dt><dd>${event.horaires || "À venir"}</dd></div>
    <div><dt>Lieu</dt><dd>${event.lieu}${event.adresse ? "<br>" + event.adresse : ""}</dd></div>
    <div><dt>Tarif</dt><dd>${event.prix || "Communiqué prochainement"}</dd></div>
    <div><dt>Âge minimum</dt><dd>${event.ageMin || "—"}</dd></div>
    <div><dt>Dress code</dt><dd>${event.dressCode || "Libre"}</dd></div>
    <div><dt>Accès</dt><dd>${event.acces || "—"}</dd></div>
  </dl>
  ${event.billetterie ? `<a class="btn btn-solid" href="${event.billetterie}" target="_blank" rel="noopener">Billetterie</a>` : ""}
  <a class="btn btn-line" href="contact.html?sujet=evenement">Une question sur cette soirée</a>
`
  : `
  <dl>
    <div><dt>Date</dt><dd>${formatDate(event.date)}</dd></div>
    <div><dt>Lieu</dt><dd>${event.lieu}</dd></div>
  </dl>
  <a class="btn btn-line" href="galerie.html">Voir les photos</a>
`;

document.getElementById("event-content").innerHTML = `
  <div>
    <div class="detail-media"><img src="assets/img/${event.visuel}" alt="Visuel ${event.nom}" /></div>
    <div style="margin-top:1.5em">
      <h2 style="font-size:1.4rem">Description</h2>
      <p>${event.description || ""}</p>
      ${
        event.lineup && event.lineup.length
          ? `<h2 style="font-size:1.4rem">${isArchive ? "Ont joué" : "Programmation"}</h2><ul class="lineup-list">${event.lineup.map((a) => `<li>${a}</li>`).join("")}</ul>`
          : ""
      }
      ${event.retour ? `<h2 style="font-size:1.4rem">Retour sur la soirée</h2><p>${event.retour}</p>` : ""}
    </div>
  </div>
  <aside class="detail-side">
    <h2 style="font-size:1.2rem;margin:0">Infos pratiques</h2>
    ${infosPratiques}
  </aside>
`;
