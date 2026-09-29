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
  const url = "https://yvxtdc.github.io/tekno-never-dies/calendar/events.ics";
  const ok = await copyToClipboard(url);
  button.textContent = ok ? "Lien copié" : "Copie indisponible";
  setTimeout(() => { button.textContent = "Partager l'agenda"; }, 1800);
});

async function copyToClipboard(text) {
  // Méthode moderne (nécessite https:// ou localhost)
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // on retente avec la méthode de repli ci-dessous
    }
  }
  // Méthode de repli : fonctionne aussi en file:// et sur d'anciens navigateurs
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  textarea.remove();
  return ok;
}

// Bouton "Ajouter à mon agenda" : un fichier .ics avec tous les événements à venir
document.getElementById("copy-events-link")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  try {
    await navigator.clipboard.writeText("https://yvxtdc.github.io/tekno-never-dies/calendar/events.ics");
    button.textContent = "Lien copié";
  } catch {
    button.textContent = "Copie indisponible";
  }
  setTimeout(() => { button.textContent = "Partager l'agenda"; }, 1800);
});

render();



/* Bouton "S'abonner à l'agenda" : sur mobile, le lien webcal:// suffit tel quel
   (l'app Calendrier s'ouvre directement). Sur ordinateur, on affiche un QR code
   à scanner avec le téléphone, plutôt que de laisser le lien webcal:// échouer. */
const AGENDA_WEBCAL = "webcal://yvxtdc.github.io/tekno-never-dies/calendar/events.ics";
const subscribeLink = document.getElementById("download-agenda");
const isDesktop = matchMedia("(pointer: fine)").matches;

if (subscribeLink && isDesktop) {
  subscribeLink.textContent = "S'abonner (QR code)";
  subscribeLink.addEventListener("click", (event) => {
    event.preventDefault();
    openAgendaQrModal();
  });
}

function openAgendaQrModal() {
  const modal = document.createElement("div");
  modal.className = "agenda-qr-modal";
  modal.innerHTML = `
    <div class="agenda-qr-modal__box" role="dialog" aria-modal="true" aria-label="S'abonner à l'agenda depuis un téléphone">
      <button type="button" class="agenda-qr-modal__close" aria-label="Fermer">✕</button>
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(AGENDA_WEBCAL)}" alt="QR code d'abonnement à l'agenda TND" width="260" height="260" />
      <p>Scanne ce code avec l'appareil photo de ton téléphone pour t'abonner directement à l'agenda.</p>
    </div>`;
  document.body.appendChild(modal);

  const close = () => {
    modal.remove();
    document.removeEventListener("keydown", onKey);
  };
  function onKey(event) {
    if (event.key === "Escape") close();
  }
  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.closest(".agenda-qr-modal__close")) close();
  });
  document.addEventListener("keydown", onKey);
}



