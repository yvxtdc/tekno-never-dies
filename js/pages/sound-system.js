import { EVENTS } from "../data/events.js";
import { eventStatus, esc, eventPath, formatDate } from "./helpers.js";
import { t, tr, plural } from "../i18n/i18n.js";
import { collectArtists, artistUrl, artistPhoto, artistStyle, instagramHandle } from "../components/artists.js";

/* ---------- Page Sound System (nos-actions.html) ----------
   Tout le contenu est dans le HTML et reste lisible sans ce script : il ajoute les animations
   (révélations, dessins qui se tracent), le curseur du comparateur photo / dessin, les DJs et la
   prochaine soirée. */

const page = document.querySelector("main.ss");
const motion = matchMedia("(prefers-reduced-motion: no-preference)").matches;

/* ---------- Animations au défilement ----------
   .ss-anim n'est posée que si le visiteur accepte les animations : sinon (ou sans JavaScript),
   blocs et dessins sont affichés d'emblée (css/components/sound-system.css). */
if (page && motion && "IntersectionObserver" in window) {
  page.classList.add("ss-anim");
  const reveal = (el) => {
    if (el.classList.contains("is-in")) return;
    el.classList.add("is-in");
    if (el.classList.contains("ss-draw")) draw(el);
  };
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      reveal(entry.target);
      observer.unobserve(entry.target);
    }
  }, { rootMargin: "0px 0px -12% 0px", threshold: 0.12 });
  page.querySelectorAll("[data-reveal], .ss-draw, .ss-frame--drop").forEach((el) => observer.observe(el));
  // Dessin du hero : tracé dès l'affichage, sans attendre le défilement.
  const heroTrace = page.querySelector(".ss-hero .ss-trace");
  if (heroTrace) requestAnimationFrame(() => reveal(heroTrace));
}

/** Trace les traits d'un dessin (pathLength="1" : pointillé 1/1 décalé de 1 = invisible, puis 0 = plein). */
function draw(svg) {
  for (const path of svg.querySelectorAll("[pathLength]")) {
    const delay = (parseFloat(getComputedStyle(path).getPropertyValue("--d")) || 0) * 1000;
    const animation = path.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
      duration: 2100, delay, easing: "cubic-bezier(.6,.05,.25,1)", fill: "forwards"
    });
    // Une fois tracé : trait plein, sans pointillé (même pour un navigateur qui ignorerait pathLength)
    animation.finished.then(() => {
      path.style.strokeDasharray = "none";
      path.style.strokeDashoffset = "0";
      animation.cancel();
    }).catch(() => {});
  }
}

/* ---------- Hero : léger effet de profondeur au défilement (souris et écran large seulement) ---------- */
const hero = page?.querySelector(".ss-hero");
if (hero && motion && matchMedia("(hover: hover) and (pointer: fine) and (min-width: 901px)").matches) {
  let ticking = false;
  addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const progress = Math.min(1, scrollY / Math.max(1, hero.offsetHeight));
      hero.style.setProperty("--ss-depth", progress.toFixed(3));
      ticking = false;
    });
  }, { passive: true });
}

/* ---------- Comparateur photo / dessin : la photo occupe la partie gauche jusqu'au curseur ---------- */
const compare = page?.querySelector(".ss-compare");
const control = compare?.querySelector(".ss-compare__control");
const range = control?.querySelector("input");
if (compare && range) {
  const update = () => compare.style.setProperty("--cut", `${range.value}%`);
  range.addEventListener("input", update);
  update();
  control.hidden = false;

  // À la souris, on peut aussi faire glisser directement sur l'image (au doigt, le défilement de la
  // page reste prioritaire : le curseur sous l'image suffit).
  const stage = compare.querySelector(".ss-compare__stage");
  let dragging = false;
  const moveTo = (event) => {
    const box = stage.getBoundingClientRect();
    range.value = Math.round(Math.min(100, Math.max(0, ((event.clientX - box.left) / box.width) * 100)));
    update();
  };
  stage.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    dragging = true;
    stage.setPointerCapture(event.pointerId);
    moveTo(event);
  });
  stage.addEventListener("pointermove", (event) => dragging && moveTo(event));
  stage.addEventListener("pointerup", () => { dragging = false; });
  stage.addEventListener("lostpointercapture", () => { dragging = false; });
}

/* ---------- Les DJs les plus présents sur nos line-ups ----------
   Même liste que la page Artistes (js/components/artists.js), mais seulement les plus fidèles. */
const roster = document.getElementById("ss-roster");
if (roster) {
  const artists = collectArtists(EVENTS).slice(0, 8);
  roster.innerHTML = artists.map((artist, i) => {
    const url = artistUrl(artist.name);
    const photo = artistPhoto(artist.name);
    const style = artistStyle(artist.name);
    const count = artist.sets.length;
    const name = url
      ? `<a class="ss-roster__name" href="${esc(url)}" target="_blank" rel="noopener noreferrer" translate="no">${esc(artist.name)}<span class="sr-only"> ${esc(instagramHandle(url))}</span></a>`
      : `<span class="ss-roster__name" translate="no">${esc(artist.name)}</span>`;
    return `
      <li class="ss-roster__item">
        <span class="ss-roster__num" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span>
        <span class="ss-roster__photo" aria-hidden="true">${photo ? `<img src="${esc(photo)}" alt="" loading="lazy" decoding="async" />` : ""}</span>
        ${name}
        <span class="ss-roster__meta">
          ${style ? `<span translate="no">${esc(style)}</span>` : ""}
          <span>${esc(t("{n} {nights} chez TND", { n: count, nights: plural(count, "soirée", "soirées") }))}</span>
        </span>
      </li>`;
  }).join("");
}

/* ---------- Prochaine soirée (hors soirées annulées), comme sur l'accueil ---------- */
const nextLine = document.getElementById("ss-next");
const next = EVENTS
  .filter((ev) => eventStatus(ev) === "a-venir" && !ev.cancelled)
  .sort((a, b) => a.date.localeCompare(b.date))[0];
if (nextLine && next) {
  nextLine.innerHTML = `
    <span class="ss-next__label">${esc(tr("Prochaine soirée"))}</span>
    <a class="ss-next__link" href="${eventPath(next.slug)}" translate="no">${esc(next.title)}</a>
    <span class="ss-next__date">${esc(formatDate(next.date, next.datePrecision))}</span>`;
  nextLine.hidden = false;
}
