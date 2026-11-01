import { EVENTS } from "../data/events.js";
import { eventStatus, esc, eventPath } from "./helpers.js";
import { t, tr, plural } from "../i18n/i18n.js";
import { collectArtists, artistUrl, artistPhoto, artistStyle, artistKey, instagramHandle } from "../components/artists.js";

/* ---------- Page Artistes : un « roster » de label, mis en page comme un magazine ----------
   Rien à saisir ici : la liste est construite à partir des line-ups de js/data/events.js.
   Photos, liens Instagram et styles : fiches Artistes du CMS (exportées dans js/data/artistes.js et
   artistes-photos.js), retrouvées par le nom (artistKey, js/components/artists.js).
   Ce fichier ne décide que de la mise en page : composition de chaque fiche et rendu de sa photo.
   Styles : css/components/artistes.css. */

const list = collectArtists(EVENTS);

/* Rendu photo choisi pour chaque portrait (clé : artistKey). Un artiste absent de cette liste
   (nouvelle fiche du CMS) reçoit un rendu par défaut, en alternant couleur et noir et blanc.
   mono : noir et blanc éditorial · cold : couleurs froides désaturées · color : couleur d'origine
   maîtrisée · magenta : bichromie noir / magenta · logo : visuel graphique, affiché entier. */
const LOOKS = {
  dannocta: "mono", leander: "cold", blackchills: "color", meinos: "magenta", mogli: "mono",
  redfox: "mono", svengerber: "color", tnb: "color", valk: "mono", d0molly: "logo",
  jakobee: "mono", kscmd: "color", rayy: "color", vs: "color", tbr: "cold"
};
const lookOf = (name, i) => LOOKS[artistKey(name)] || (i % 2 ? "mono" : "color");

/* Le roster est une suite de pages imprimées, comme les faces d'un disque (Face A, Face B…) :
   chaque page est une feuille sombre bordée, avec son en-tête (kicker, titre, plage de numéros), sur le
   modèle de la planche contact. Deux mises en page :
   - « lead » : un artiste principal (grande pochette, disque, bras de platine, annotation) et les
     suivants en liste à côté (petite pochette, nom, légende) ; une page « lead » sur deux en miroir ;
   - « trio » : deux ou trois artistes à égalité, côte à côte.
   Le découpage s'adapte au nombre d'artistes (plan()) : un artiste n'est jamais seul sur une page.
   La planche contact s'insère après la deuxième page. Styles : css/components/artistes.css. */
const SHEET_AFTER = 2; // nombre de pages avant la planche contact

const year = (ev) => ev.date.slice(0, 4);
const pad = (n) => String(n).padStart(2, "0");
const anchor = (name) => `artiste-${artistKey(name)}`;
const styleList = (name) => (artistStyle(name) || "").split("/").map((s) => s.trim()).filter(Boolean);
const isUpcoming = (ev) => eventStatus(ev) === "a-venir" && !ev.cancelled;

/**
 * Tailles des pages pour n artistes : [{ kind, size }].
 * - les deux premières pages sont des « lead » de 4 (5 s'il ne restait ensuite qu'un artiste seul) ;
 * - la suite : des « trio » de 3 ; un reste de 4 devient un « lead » de 4, un reste de 2 un trio de 2.
 * Exemples : 14 → 4, 4, 3, 3 · 15 → 4, 4, 3, 4 · 16 → 4, 4, 3, 3, 2 · 9 → 4, 5 · 6 → 4, 2.
 */
function plan(n) {
  const out = [];
  let left = n;
  for (let k = 0; k < 2 && left > 0; k++) {
    let size = Math.min(4, left);
    if (left - size === 1) size++;
    out.push({ kind: "lead", size });
    left -= size;
  }
  while (left > 0) {
    if (left === 4) { out.push({ kind: "lead", size: 4 }); left = 0; }
    else { const size = Math.min(3, left); out.push({ kind: "trio", size }); left -= size; }
  }
  return out;
}

/** Découpe le roster en pages : [{ kind, mirror, face, artists: [[artiste, rang]] }]. */
function paginate(artists) {
  let i = 0, leads = 0;
  return plan(artists.length).map(({ kind, size }, p) => {
    const items = artists.slice(i, i + size).map((a, k) => [a, i + k]);
    i += size;
    const mirror = kind === "lead" && leads++ % 2 === 1;
    return { kind, mirror, face: String.fromCharCode(65 + p), artists: items };
  });
}

/* ---------- Vocabulaire graphique : la pochette de disque annotée ----------
   Le portrait (carré) devient une pochette d'où sort un vinyle dessiné ; une pastille numérotée et une
   étiquette rose « au crayon » reprennent les annotations de la page Sound System (« Platines »), mais
   appliquées au disque de l'artiste. Tout est décoratif (aria-hidden) : le nom, le style et les liens
   restent dans la légende. */
const VINYL = { lead: "diag", "lead~": "diag-left", side: "diag", trio: "top" };
const ANNOTATED = new Set(["lead", "lead~"]); // étiquette + flèche au crayon, bras de platine

function vinyl(artist, i, side, withArm) {
  const id = `ar-vl-${artistKey(artist.name)}`;
  const grooves = [92, 86, 80, 73, 66, 58, 50, 43].map((r) => `<circle cx="100" cy="100" r="${r}"/>`).join("");
  return `
    <svg class="ar-vinyl ar-vinyl--${side}" viewBox="0 0 200 200" aria-hidden="true" focusable="false" translate="no">
      <defs><path id="${id}" d="M100 100m-25 0a25 25 0 1 1 50 0a25 25 0 1 1-50 0"/></defs>
      <circle class="ar-vinyl__disc" cx="100" cy="100" r="98"/>
      <g class="ar-vinyl__grooves">${grooves}</g>
      <path class="ar-vinyl__sheen" d="M38 52A80 80 0 0 1 96 21"/>
      <circle class="ar-vinyl__label" cx="100" cy="100" r="34"/>
      <text class="ar-vinyl__text"><textPath href="#${id}" textLength="150">${esc(artist.name.toUpperCase())} · N°${pad(i + 1)}</textPath></text>
      <circle class="ar-vinyl__hole" cx="100" cy="100" r="3.2"/>
      ${withArm ? `<g class="ar-vinyl__arm"><circle cx="186" cy="18" r="9"/><path pathLength="1" d="M186 18L150 92L128 104"/><path pathLength="1" d="M122 98l12 12-6 6-12-12z"/></g>` : ""}
    </svg>`;
}

function entry(artist, i, role) {
  const url = artistUrl(artist.name);
  const photo = artistPhoto(artist.name);
  const styles = styleList(artist.name);
  const count = artist.sets.length;
  const next = artist.sets.find(({ ev }) => isUpcoming(ev));
  const side = photo && VINYL[role];
  const tag = photo && ANNOTATED.has(role) && styles[0];
  const layout = role.replace("~", "");
  return `
    <article class="ar-entry ar-entry--${layout} ar-look--${lookOf(artist.name, i)}${photo ? "" : " ar-entry--nophoto"}" id="${anchor(artist.name)}"
        aria-labelledby="${anchor(artist.name)}-nom" style="--len:${Math.max(artist.name.length, 3)}">
      ${photo ? `<figure class="ar-entry__photo ar-marks${side ? " has-vinyl" : ""}">
        ${side ? vinyl(artist, i, side, ANNOTATED.has(role)) : ""}
        <span class="ar-entry__frame"><img src="${esc(photo)}" alt="${esc(t("Portrait de {name}", { name: artist.name }))}" width="320" height="320" loading="lazy" decoding="async" /></span>
        <span class="ar-entry__dot" aria-hidden="true">${pad(i + 1)}</span>
        ${tag ? `<span class="ar-entry__tag" aria-hidden="true" translate="no">${esc(tag)}</span>
        <svg class="ar-entry__arrow" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><path pathLength="1" d="M8 10C30 6 52 18 62 40C68 54 70 66 72 80M72 80L62 72M72 80L78 68"/></svg>` : ""}
      </figure>` : ""}
      <h4 class="ar-entry__name" id="${anchor(artist.name)}-nom" translate="no">${esc(artist.name)}</h4>
      <div class="ar-entry__cap">
        <p class="ar-entry__no" aria-hidden="true">N°${pad(i + 1)}</p>
        ${styles.length ? `<ul class="ar-entry__styles" role="list" translate="no">${styles.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
        ${next ? `<p class="ar-entry__next"><a href="${eventPath(next.ev.slug)}"><span>${esc(tr("À l'affiche"))}</span> <span translate="no">${esc(next.ev.title)}</span></a></p>` : ""}
        <p class="ar-entry__count">${esc(t("{n} {nights} chez TND", { n: count, nights: plural(count, "soirée", "soirées") }))}</p>
        <ol class="ar-entry__sets" role="list">
          ${artist.sets.map(({ ev, with: partners }) => `
            <li><a href="${eventPath(ev.slug)}" translate="no"><span class="ar-entry__year">${isUpcoming(ev) ? esc(tr("À venir")) : year(ev)}</span> <span>${esc(ev.title)}${partners.length ? ` <small>b2b ${esc(partners.join(", "))}</small>` : ""}</span></a></li>`).join("")}
        </ol>
        ${url ? `<a class="ar-entry__link" href="${esc(url)}" target="_blank" rel="noopener noreferrer"><span class="ar-entry__platform">Instagram</span> <span translate="no">${esc(instagramHandle(url))}</span> <span aria-hidden="true">↗</span><span class="sr-only"> ${esc(tr("(nouvel onglet)"))}</span></a>` : ""}
      </div>
    </article>`;
}

/* ---------- Roster : les pages avant la planche contact, puis après ---------- */
function page({ kind, mirror, face, artists }) {
  const first = artists[0][1] + 1, last = artists[artists.length - 1][1] + 1;
  const roleOf = (k) => (kind === "trio" ? "trio" : k === 0 ? (mirror ? "lead~" : "lead") : "side");
  const items = artists.map(([a, i], k) => entry(a, i, roleOf(k)));
  // La page est la pochette : son disque en sort d'un côté, en alternance (A, C à droite ; B, D à gauche).
  const out = (face.charCodeAt(0) - 65) % 2 ? "left" : "right";
  return `
    <div class="ar-face ar-face--${out}">
    <div class="ar-face__disc" aria-hidden="true"></div>
    <section class="ar-page ar-page--${kind}${mirror ? " is-mirror" : ""}" aria-labelledby="ar-face-${face.toLowerCase()}" style="--n:${artists.length}">
      <header class="ar-page__head">
        <p class="ar-page__kicker"><span class="ar-chap" aria-hidden="true">02</span> <span>${esc(tr("Le roster"))}</span></p>
        <h3 class="ar-page__title" id="ar-face-${face.toLowerCase()}">${esc(t("Face {x}", { x: face }))}</h3>
        <p class="ar-page__meta" aria-hidden="true">N°${pad(first)}${last > first ? ` — N°${pad(last)}` : ""}</p>
      </header>
      <div class="ar-page__body">
        ${kind === "lead" ? `${items[0]}<div class="ar-page__list">${items.slice(1).join("")}</div>` : items.join("")}
      </div>
    </section>
    </div>`;
}

const pages = list.length ? paginate(list) : [];
const first = document.getElementById("artists");
const more = document.getElementById("artists-more");
if (first) {
  if (!list.length) {
    first.innerHTML = `<p class="ar-empty">${esc(tr("Les artistes s'afficheront ici dès qu'un line-up sera publié."))}</p>`;
  } else {
    first.innerHTML = pages.slice(0, SHEET_AFTER).map(page).join("");
    const rest = pages.slice(SHEET_AFTER);
    if (more && rest.length) {
      more.innerHTML = rest.map(page).join("");
      more.closest(".ar-roster--suite")?.removeAttribute("hidden");
    }
  }
}

/* ---------- Couverture : sommaire, présenté comme la tracklist du disque ----------
   Mêmes faces que le roster (Face A, B…) : chaque face mène à sa page, chaque nom à sa fiche. */
const index = document.getElementById("ar-index");
if (index) {
  const disc = `<svg class="ar-index__disc" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="9.2"/><circle cx="10" cy="10" r="6"/><circle class="ar-index__label" cx="10" cy="10" r="3.2"/></svg>`;
  index.innerHTML = pages.map(({ face, artists }) => `
    <div class="ar-index__face">
      <p class="ar-index__side"><a href="#ar-face-${face.toLowerCase()}">${disc}<span>${esc(t("Face {x}", { x: face }))}</span></a></p>
      <ol class="ar-index__list" role="list">${artists.map(([a, i]) => `
        <li><a href="#${anchor(a.name)}"><span class="ar-index__no" aria-hidden="true">${pad(i + 1)}</span> <span class="ar-index__name" translate="no">${esc(a.name)}</span></a></li>`).join("")}
      </ol>
    </div>`).join("");
}

/* ---------- Apparitions au défilement (une seule fois, jamais si le visiteur réduit les animations) ----------
   - déclenchées un peu avant l'arrivée à l'écran (rootMargin positif) ;
   - tout ce qui est déjà au-dessus de l'élément révélé est révélé aussi (saut par le sommaire,
     défilement rapide qui « enjambe » une fiche) ;
   - défilement rapide : affichage immédiat, sans transition. */
const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const root = document.querySelector(".ar");
if (root && !reduce && "IntersectionObserver" in window) {
  root.classList.add("ar-anim");
  const pending = new Set(root.querySelectorAll(".ar-face, .ar-entry, .ar-sheet__frame, .ar-outro__inner"));
  let lastY = window.scrollY, lastT = performance.now(), fast = false;
  window.addEventListener("scroll", () => {
    const now = performance.now();
    fast = Math.abs(window.scrollY - lastY) / Math.max(now - lastT, 1) > 2; // plus de 2 px/ms
    lastY = window.scrollY;
    lastT = now;
  }, { passive: true });
  const show = (el, instant) => {
    if (!pending.delete(el)) return;
    if (instant) el.classList.add("is-instant");
    el.classList.add("is-in");
    io.unobserve(el);
  };
  const io = new IntersectionObserver((items) => {
    for (const item of items) {
      if (!item.isIntersecting) continue;
      show(item.target, fast);
      // Ce qui a été dépassé sans être vu s'affiche d'un coup.
      const bottom = item.boundingClientRect.top;
      for (const el of [...pending]) if (el.getBoundingClientRect().bottom < bottom) show(el, true);
    }
  }, { rootMargin: "0px 0px 15% 0px" });
  pending.forEach((el) => io.observe(el));
}

/* Lien du sommaire : l'artiste visé est signalé un instant (le focus suit pour le clavier). */
document.addEventListener("click", (e) => {
  const link = e.target.closest('a[href*="#artiste-"]');
  const target = link && document.getElementById(decodeURIComponent(link.hash.slice(1)));
  if (!target) return;
  target.classList.remove("is-target");
  void target.offsetWidth;
  target.classList.add("is-target");
});

// Arrivée directe sur artistes.html#artiste-… : la fiche n'existait pas encore quand le navigateur a cherché l'ancre.
if (location.hash.startsWith("#artiste-")) {
  let target = null;
  try { target = document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch {}
  target?.scrollIntoView({ block: "start" });
}
