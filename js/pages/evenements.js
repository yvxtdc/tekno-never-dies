import { EVENTS } from "../data/events.js";
import { formatDate, thumb } from "./helpers.js";

const upcomingRoot = document.getElementById("upcoming-events");
const pastRoot = document.getElementById("past-events");
const pastBlock = document.getElementById("past-events-block");
const search = document.getElementById("event-search");
const filter = document.getElementById("event-filter");
const status = document.getElementById("events-status");

function matches(ev, query) {
  return [ev.title, ev.place, ev.description, ...(ev.practical || [])]
    .join(" ")
    .toLocaleLowerCase("fr")
    .includes(query);
}

function card(ev) {
  const ticket = ev.ticketUrl
    ? `<a class="btn btn-cyan btn-sm" href="${ev.ticketUrl}" target="_blank" rel="noopener">Billetterie</a>`
    : "";
  return `
    <li class="event-card">
      ${thumb(ev.cover, ev.title, "Photo à venir")}
      <div class="event-card__body">
        <span class="event-card__date">${formatDate(ev.date)}</span>
        ${ev.demo ? '<span class="demo-label">DEMO À REMPLACER</span>' : ""}
        <h3>${ev.title}</h3>
        <p>${ev.place}</p>
        <div class="event-card__actions">
          <a class="btn btn-line btn-sm" href="evenement.html?slug=${ev.slug}">Voir la fiche</a>
          ${ticket}
        </div>
      </div>
    </li>`;
}

function render() {
  const query = search.value.trim().toLocaleLowerCase("fr");
  const selected = filter.value;
  const filtered = EVENTS.filter((ev) =>
    (selected === "tous" || ev.status === selected) && matches(ev, query)
  );
  const upcoming = filtered.filter((ev) => ev.status === "a-venir").sort((a, b) => a.date.localeCompare(b.date));
  const past = filtered.filter((ev) => ev.status === "passe").sort((a, b) => b.date.localeCompare(a.date));

  upcomingRoot.innerHTML = upcoming.length
    ? upcoming.map(card).join("")
    : "<li class=\"empty-state\">Aucun événement à venir ne correspond à cette recherche.</li>";
  pastRoot.innerHTML = past.length
    ? past.map(card).join("")
    : "<li class=\"empty-state\">Aucun événement passé ne correspond à cette recherche.</li>";
  pastBlock.hidden = selected === "a-venir";
  status.textContent = `${filtered.length} événement${filtered.length > 1 ? "s" : ""} affiché${filtered.length > 1 ? "s" : ""}.`;
}

search.addEventListener("input", render);
filter.addEventListener("change", render);
document.getElementById("copy-events-link")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  try {
    await navigator.clipboard.writeText(location.href);
    button.textContent = "Lien copié";
  } catch {
    button.textContent = "Copie indisponible";
  }
  setTimeout(() => { button.textContent = "Partager l'agenda"; }, 1800);
});

render();
