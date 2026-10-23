// Page association : tout ce qui dépend des soirées vient de js/data, pour rester juste quand une soirée
// est ajoutée dans le CMS.
//   - « De l'idée au dancefloor » : les débuts (2023, 2024) sont écrits dans association.html ; ici
//     s'ajoute un chapitre par année de soirées, illustré par leurs affiches.
//   - Qui sommes-nous : les chiffres (équipe, DJ, soirées) et, sur la photo, le public de chaque soirée
//     passée en vumètres.
import { EVENTS } from "../data/events.js";
import { TEAM } from "../data/equipe.js";
import { eventStatus, esc, eventPath } from "./helpers.js";
import { collectArtists } from "../components/artists.js";
import { eventStats } from "../components/event-stats.js";
import { t, tr, locale } from "../i18n/i18n.js";

const events = EVENTS
  .filter((ev) => !ev.cancelled && !ev.demo)
  .sort((a, b) => a.date.localeCompare(b.date));
const isNext = (ev) => eventStatus(ev) === "a-venir";
const town = (ev) => (ev.place || "").split(",").at(-1).trim();
const dayMonth = (ev) => new Intl.DateTimeFormat(locale, ev.datePrecision === "month" ? { month: "long", timeZone: "UTC" } : { day: "numeric", month: "long", timeZone: "UTC" })
  .format(new Date(`${ev.date}T12:00:00Z`));

/* ---------- Un chapitre par année de soirées ---------- */
const chapters = document.getElementById("asso-chapters");
if (chapters) {
  const years = [...new Set(events.map((ev) => ev.date.slice(0, 4)))];
  chapters.insertAdjacentHTML("beforeend", years.map((year, i) => {
    const list = events.filter((ev) => ev.date.startsWith(year));
    const title = i === 0 ? "Les premières soirées" : list.every(isNext) ? "La suite" : "La série continue";
    return `
      <li class="asso-chapter asso-chapter--events">
        <span class="asso-chapter__year" aria-hidden="true">${esc(year)}</span>
        <div class="asso-chapter__visual asso-chapter__visual--flyers" style="--count:${list.length}">
          ${list.map((ev) => `
            <a class="asso-flyer${isNext(ev) ? " is-next" : ""}" href="${esc(eventPath(ev.slug))}" tabindex="-1" aria-hidden="true">
              ${ev.flyer || ev.cover ? `<img src="${esc(ev.flyer || ev.cover)}" alt="" loading="lazy" decoding="async" />` : `<span translate="no">${esc(ev.title)}</span>`}
              ${isNext(ev) ? `<span class="asso-flyer__tag">${esc(tr("À venir"))}</span>` : ""}
            </a>`).join("")}
        </div>
        <div class="asso-chapter__text">
          <h3>${esc(tr(title))}</h3>
          <ul class="asso-chapter__events">${list.map((ev) => `
            <li><a href="${esc(eventPath(ev.slug))}" translate="no">${esc(ev.title)}</a><span>${esc([dayMonth(ev), town(ev)].filter(Boolean).join(" · "))}${isNext(ev) ? ` · <b>${esc(tr("À venir"))}</b>` : ""}</span></li>`).join("")}
          </ul>
        </div>
      </li>`;
  }).join(""));
  chapters.style.setProperty("--chapters", chapters.children.length);
  // Rang de chaque chapitre : son point sur le fil en prend la couleur (association.css)
  [...chapters.children].forEach((chapter, i) => chapter.style.setProperty("--i", i));
}

/* ---------- Le public (vumètres sur la photo) ---------- */
const past = events.filter((ev) => !isNext(ev));
const crowdBox = document.getElementById("asso-crowd");
if (crowdBox) {
  const crowd = past.map((ev) => ({ ev, n: Number(eventStats(ev).crowd) || 0 })).filter((item) => item.n);
  const max = Math.max(0, ...crowd.map((item) => item.n));
  const monthYear = new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit", timeZone: "UTC" });

  // Vumètre par soirée : hauteur = fréquentation / la plus grande (rien d'inventé : sans chiffre, pas de barre)
  document.getElementById("crowd-bars").innerHTML = crowd.map(({ ev, n }) => `
    <li style="--level:${(n / max).toFixed(3)}">
      <b>≈ ${n}<span class="sr-only"> ${esc(tr("personnes"))}</span></b>
      <span class="asso-crowd__meter" aria-hidden="true"></span>
      <a class="asso-crowd__name" href="${esc(eventPath(ev.slug))}" translate="no">${esc(ev.title)}</a>
      <span class="asso-crowd__date">${esc(monthYear.format(new Date(`${ev.date}T12:00:00Z`)))}</span>
    </li>`).join("");
  // « Chaque soirée a réuni plus de monde… » seulement si les chiffres le disent
  if (crowd.length > 1 && crowd.length === past.length && crowd.every((item, i) => i === 0 || item.n > crowd[i - 1].n)) {
    document.getElementById("crowd-sentence").textContent = tr("Chaque soirée a réuni plus de monde que la précédente.");
  }
  crowdBox.hidden = !crowd.length;
}

/* ---------- En chiffres ---------- */
const figuresList = document.getElementById("asso-figures");
if (figuresList) {
  // Les personnes de l'équipe (une fiche peut en présenter deux : « Céleste & Yelena »), les DJ, les soirées
  const people = TEAM.filter((member) => !member.demo).flatMap((member) => member.name.split(/\s+(?:&|et)\s+/)).length;
  const djs = collectArtists(events).length;
  const figures = [
    [people, tr("membres et bénévoles")],
    [djs, tr("DJ à l'affiche")],
    [past.length, t("soirées depuis {year}", { year: past[0]?.date.slice(0, 4) || "" })]
  ].filter(([n]) => n);
  // Le nombre animé est masqué aux lecteurs d'écran, qui lisent directement la valeur finale
  figuresList.innerHTML = figures
    .map(([n, label]) => `<li><b aria-hidden="true" data-count="${n}">${n}</b><span><span class="sr-only">${n} </span>${esc(label)}</span></li>`).join("");
  figuresList.hidden = !figures.length;
  countUp(figuresList.querySelectorAll("[data-count]"));
}

/* Compteurs : de 0 à leur valeur en 1,6 s (ralentit vers la fin), une seule fois au chargement de la page,
   pas à chaque passage à l'écran. Valeur finale directement si le système limite les animations. */
function countUp(numbers, duration = 1600) {
  if (!numbers.length || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const start = performance.now();
  const step = (now) => {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - progress) ** 3;
    numbers.forEach((el) => { el.textContent = Math.round(Number(el.dataset.count) * eased); });
    if (progress < 1) requestAnimationFrame(step);
  };
  numbers.forEach((el) => { el.textContent = "0"; });
  requestAnimationFrame(step);
}
