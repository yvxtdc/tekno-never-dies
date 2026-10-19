import { EVENTS } from "../data/events.js";
import { SITE } from "../data/site.js";
import { formatDate, formatTime, esc, eventStatus, safeUrl, track, eventPath } from "./helpers.js";
import { collectArtists, artistPhoto } from "../components/artists.js";
import { eventStats } from "../components/event-stats.js";
import { eventRange } from "./ics.js";
import { t, tr, plural, locale } from "../i18n/i18n.js";

const upcomingRoot = document.getElementById("upcoming-events");
const pastRoot = document.getElementById("past-events");

const flyerOf = (ev) => ev.flyer || ev.cover;
const genresList = (ev) => ev.genres?.length
  ? `<ul class="event-genres" aria-label="Styles musicaux" translate="no">${ev.genres.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>`
  : "";

/* ---------- À venir : chaque soirée en grand (flyer incliné, compte à rebours en jours, infos, boutons) ---------- */
function featured(ev) {
  const ticketUrl = safeUrl(ev.ticketUrl);
  const range = eventRange(ev);
  const days = range ? Math.ceil((range.start.getTime() - Date.now()) / 864e5) : null;
  const visual = flyerOf(ev);
  const when = [formatDate(ev.date, ev.datePrecision), formatTime(ev.time)].filter(Boolean).join(" · ");
  return `
    <article class="events-feature">
      ${visual ? `<a class="events-feature__flyer" href="${eventPath(ev.slug)}" tabindex="-1" aria-hidden="true"><img src="${esc(visual)}" alt="" decoding="async" /></a>` : ""}
      <div class="events-feature__body">
        <p class="event-status is-upcoming"><span class="event-status__dot" aria-hidden="true"></span><span>Prochaine soirée</span>${days > 1 ? `<span class="event-status__count">${esc(t("J-{n}", { n: days }))}</span>` : ""}</p>
        <h3><a href="${eventPath(ev.slug)}" translate="no">${esc(ev.title)}</a></h3>
        ${ev.about?.title ? `<p class="events-feature__tagline">${esc(tr(ev.about.title))}</p>` : ""}
        <p class="events-feature__when">${esc(when)}</p>
        ${ev.place ? `<p class="events-feature__place">${esc(ev.place)}</p>` : ""}
        ${genresList(ev)}
        <div class="events-feature__actions">
          ${ticketUrl ? `<a class="btn btn-solid" href="${esc(ticketUrl)}" target="_blank" rel="noopener">Prendre ma place ↗</a>` : ""}
          <a class="btn btn-hero-line" href="${eventPath(ev.slug)}">Découvrir la soirée →</a>
        </div>
      </div>
    </article>`;
}

/* ---------- Soirées passées : frise par année, affiches qui alternent à gauche et à droite ---------- */
function pastItem(ev, i) {
  const { djs, crowd } = eventStats(ev);
  const visual = flyerOf(ev);
  const chips = [
    crowd ? t("≈ {n} personnes", { n: crowd }) : "",
    djs ? `${djs} ${plural(djs, "DJ", "DJ")}` : "",
    ev.gallerySlug ? tr("Photos en ligne") : ""
  ].filter(Boolean);
  return `
    <li class="events-past${i % 2 ? " is-right" : ""}">
      <a class="events-past__flyer" href="${eventPath(ev.slug)}" tabindex="-1" aria-hidden="true">
        ${visual ? `<img src="${esc(visual)}" alt="" loading="lazy" decoding="async" />` : ""}
      </a>
      <div class="events-past__body">
        <p class="events-past__date">${esc(formatDate(ev.date, ev.datePrecision))}</p>
        <h3><a href="${eventPath(ev.slug)}" translate="no">${esc(ev.title)}</a></h3>
        ${ev.about?.title ? `<p class="events-past__tagline">${esc(tr(ev.about.title))}</p>` : ""}
        ${ev.place ? `<p class="events-past__place">${esc(ev.place)}</p>` : ""}
        ${chips.length ? `<ul class="events-past__chips">${chips.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
        <a class="events-past__link" href="${eventPath(ev.slug)}">Revoir la soirée <span aria-hidden="true">→</span></a>
      </div>
    </li>`;
}

const upcoming = EVENTS.filter((ev) => eventStatus(ev) === "a-venir").sort((a, b) => a.date.localeCompare(b.date));
const past = EVENTS.filter((ev) => eventStatus(ev) === "passe").sort((a, b) => b.date.localeCompare(a.date));

upcomingRoot.innerHTML = upcoming.length
  ? upcoming.map(featured).join("")
  : `<p class="empty-state">Pas de soirée annoncée pour le moment : la prochaine date arrive bientôt. Abonne-toi à l'agenda pour être prévenu·e.</p>`;

// Icône calendrier de l'en-tête : la date de la prochaine soirée (« NOV » / « 28 »)
const cal = document.querySelector(".events-agenda__cal");
if (cal && upcoming[0] && upcoming[0].datePrecision !== "month") {
  const [y, m, d] = upcoming[0].date.split("-").map(Number);
  const month = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d))).replace(".", "");
  cal.querySelector(".events-agenda__cal-month").textContent = month.toUpperCase();
  cal.querySelector(".events-agenda__cal-day").textContent = String(d);
  cal.classList.add("has-date");
}

const years = [...new Set(past.map((ev) => ev.date.slice(0, 4)))];
let index = 0;
pastRoot.innerHTML = past.length
  ? years.map((year) => `
      <section class="events-year" aria-label="${esc(year)}">
        <p class="events-year__label" aria-hidden="true">${esc(year)}</p>
        <ol class="events-year__list">${past.filter((ev) => ev.date.startsWith(year)).map((ev) => pastItem(ev, index++)).join("")}</ol>
      </section>`).join("")
  : `<p class="empty-state">Les soirées passées apparaîtront ici.</p>`;

/* ---------- Bandeau « Les artistes » : les photos rondes qui se chevauchent ---------- */
const teaser = document.querySelector(".artists-teaser");
if (teaser) {
  const artists = collectArtists(EVENTS);
  const photos = artists.map((artist) => artistPhoto(artist.name)).filter(Boolean).slice(0, 7);
  teaser.querySelector(".artists-teaser__photos").innerHTML =
    photos.map((src) => `<img src="${esc(src)}" alt="" decoding="async" />`).join("") +
    (artists.length > photos.length ? `<span>+${artists.length - photos.length}</span>` : "");
  teaser.querySelector(".artists-teaser__sub").textContent = t("{n} DJ passés chez TND", { n: artists.length });
}

/* ---------- Abonnement à l'agenda ---------- */
const subscribeLink = document.getElementById("download-agenda");
if (subscribeLink) subscribeLink.href = SITE.agenda.webcal;

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

document.getElementById("copy-events-link")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const ok = await copyToClipboard(SITE.agenda.https);
  track("Agenda · lien copié");
  button.textContent = ok ? "Lien copié" : "Copie indisponible";
  setTimeout(() => { button.textContent = "Partager l'agenda"; }, 1800);
});

/* Sur mobile, le lien webcal:// suffit (l'app Calendrier s'ouvre directement). Sur ordinateur,
   on affiche un QR code à scanner avec le téléphone plutôt que de laisser le lien échouer.
   Le QR code est un fichier local (assets/img/agenda-qr.svg) : aucune requête vers un service tiers. */
if (subscribeLink && matchMedia("(pointer: fine)").matches) {
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
      <img src="assets/img/agenda-qr.svg" alt="QR code d'abonnement à l'agenda TND" width="260" height="260" />
      <p>Scanne ce code avec l'appareil photo de ton téléphone pour t'abonner directement à l'agenda.</p>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector(".agenda-qr-modal__close").focus();

  const close = () => {
    modal.remove();
    document.removeEventListener("keydown", onKey);
    subscribeLink.focus();
  };
  function onKey(event) {
    if (event.key === "Escape") close();
    // Un seul élément interactif dans la fenêtre : le focus reste sur le bouton Fermer
    if (event.key === "Tab") {
      event.preventDefault();
      modal.querySelector(".agenda-qr-modal__close").focus();
    }
  }
  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.closest(".agenda-qr-modal__close")) close();
  });
  document.addEventListener("keydown", onKey);
}