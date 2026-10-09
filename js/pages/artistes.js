import { EVENTS } from "../data/events.js";
import { eventStatus, esc } from "./helpers.js";
import { t, tr, plural } from "../i18n/i18n.js";
import { collectArtists, artistUrl, artistPhoto, artistStyle, instagramHandle } from "./artists.js";

/* ---------- Tous les artistes passés par une soirée TND ----------
   Rien à saisir : la liste est construite à partir des line-ups de js/data/events.js.
   Photos et liens Instagram : js/data/artistes.js et npm run artistes. */

const list = collectArtists(EVENTS);

const year = (ev) => ev.date.slice(0, 4);

const card = (artist) => {
  const url = artistUrl(artist.name);
  const photo = artistPhoto(artist.name);
  const style = artistStyle(artist.name);
  const upcoming = artist.sets.some(({ ev }) => eventStatus(ev) === "a-venir");
  const count = artist.sets.length;
  return `
    <li class="artist-card${upcoming ? " is-upcoming" : ""}">
      <span class="artist-card__photo">${photo ? `<img src="${esc(photo)}" alt="" loading="lazy" decoding="async" />` : ""}</span>
      <h2 class="artist-card__name" translate="no">${url
        ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(artist.name)}</a>`
        : esc(artist.name)}</h2>
      ${style ? `<p class="artist-card__style" translate="no">${esc(style)}</p>` : ""}
      ${url ? `<p class="artist-card__handle">${esc(instagramHandle(url))}</p>` : ""}
      <p class="artist-card__count">${esc(t("{n} {nights} chez TND", { n: count, nights: plural(count, "soirée", "soirées") }))}</p>
      <ul class="artist-card__sets" role="list">
        ${artist.sets.map(({ ev, with: partners }) => `
          <li>
            <a href="evenement.html?slug=${encodeURIComponent(ev.slug)}"${eventStatus(ev) === "a-venir" ? ' class="is-next"' : ""} translate="no">
              ${eventStatus(ev) === "a-venir" ? `<span class="artist-card__tag">${esc(tr("À venir"))}</span>` : `<span class="artist-card__year">${year(ev)}</span>`}
              ${esc(ev.title)}${partners.length ? `<small> · b2b ${esc(partners.join(", "))}</small>` : ""}
            </a>
          </li>`).join("")}
      </ul>
    </li>`;
};

const grid = document.getElementById("artists");
if (grid) {
  grid.innerHTML = list.length
    ? list.map(card).join("")
    : `<li class="empty-state">Les artistes s'afficheront ici dès qu'un line-up sera publié.</li>`;
}
