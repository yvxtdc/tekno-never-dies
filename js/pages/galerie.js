import { GALLERY } from "../data/galerie.js";
import { thumb, esc } from "./helpers.js";
import { t } from "../i18n/i18n.js";

const root = document.getElementById("gallery-root");

/* Une photo = un simple chemin "assets/…jpg" OU un objet { src, thumb, alt, w, h, full } */
const norm = (p, title) => (typeof p === "string" ? { src: p, alt: title } : { alt: title, ...p });

const sets = []; // sets[i] = photos de l'événement i (pour naviguer dans le lightbox)

/* Ancre d'un événement (galerie.html#ice-boiler) : son eventSlug, sinon tirée du titre */
const slugify = (s) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const anchorOf = (ev) => ev.eventSlug || slugify(ev.title);

/* Nombre de photos affichées par événement avant le bouton « Voir plus de photos » */
const PAGE_SIZE = 24;

function tile(p, setIdx, i) {
  const size = p.w && p.h ? ` width="${p.w}" height="${p.h}"` : "";
  return `<button class="g-tile" type="button" data-set="${setIdx}" data-i="${i}" aria-label="${esc(t("Agrandir : {title}", { title: p.alt }))}"${i >= PAGE_SIZE ? " hidden" : ""}>
    <img src="${esc(p.thumb || p.src)}" alt="${esc(p.alt)}"${size} loading="lazy" decoding="async" />
  </button>`;
}

function moreButton(left) {
  return `<button class="btn btn-line gallery-more" type="button">${esc(t("Voir plus de photos ({n})", { n: left }))}</button>`;
}

if (!GALLERY.length) {
  root.innerHTML = "<p>La galerie sera alimentée après les prochains événements.</p>";
} else {
  root.innerHTML = [...GALLERY]
    .sort((a, b) => b.year - a.year)
    .map(
      (yearBlock) => `
      <section class="gallery-year">
        <h2>${yearBlock.year}</h2>
        ${yearBlock.events
          .map((ev) => {
            const photos = ev.photos.map((p) => norm(p, ev.title));
            const setIdx = sets.push({ title: ev.title, photos }) - 1;
            return `
          <div class="gallery-event" id="${esc(anchorOf(ev))}">
            <h3>${esc(ev.title)}</h3>
            <div class="gallery-masonry">
              ${photos.length ? photos.map((p, i) => tile(p, setIdx, i)).join("") : thumb(null, ev.title, "Photos à venir")}
            </div>
            ${photos.length > PAGE_SIZE ? moreButton(photos.length - PAGE_SIZE) : ""}
          </div>`;
          })
          .join("")}
      </section>`
    )
    .join("");

  // La galerie est construite après le chargement : on rejoint ensuite l'ancre demandée
  // (lien « Voir la galerie » d'une fiche événement).
  // Une ancre mal encodée (galerie.html#%E0) ferait planter decodeURIComponent, et avec elle la page.
  let anchor = location.hash.slice(1);
  try { anchor = decodeURIComponent(anchor); } catch { /* ancre gardée telle quelle */ }
  const target = anchor && document.getElementById(anchor);
  if (target) requestAnimationFrame(() => target.scrollIntoView());
}

/* ---------- Sous-menu Année / Événement (accordéon) ---------- */
const nav = document.getElementById("gallery-nav");
if (nav && GALLERY.length) {
  nav.innerHTML = [...GALLERY]
    .sort((a, b) => b.year - a.year)
    .map((yearBlock, i) => {
      const items = yearBlock.events
        .map((ev) => {
          return `<li><a href="#${esc(anchorOf(ev))}">${esc(ev.title)}</a></li>`;
        })
        .join("");
      return `
        <div class="gallery-nav__year">
          <button type="button" class="gallery-nav__toggle" aria-expanded="false" aria-controls="gallery-nav-list-${i}">
            <span>${yearBlock.year}</span>
            <i class="gallery-nav__chevron" aria-hidden="true"></i>
          </button>
          <ul class="gallery-nav__list" id="gallery-nav-list-${i}" hidden>${items}</ul>
        </div>`;
    })
    .join("");

  nav.addEventListener("click", (e) => {
    const btn = e.target.closest(".gallery-nav__toggle");
    if (!btn) return;
    const list = document.getElementById(btn.getAttribute("aria-controls"));
    const open = btn.getAttribute("aria-expanded") === "true";

    // Referme les autres années ouvertes (un seul accordéon ouvert à la fois)
    nav.querySelectorAll(".gallery-nav__toggle[aria-expanded='true']").forEach((other) => {
      if (other !== btn) {
        other.setAttribute("aria-expanded", "false");
        document.getElementById(other.getAttribute("aria-controls")).hidden = true;
      }
    });

    btn.setAttribute("aria-expanded", String(!open));
    list.hidden = open;
  });
}

/* ---------- Téléphone : la photo passe en couleur en arrivant au milieu de l'écran ----------
   Sur un écran tactile (pas de survol), même effet que le survol sur ordinateur. Les photos
   masquées derrière « Voir plus » sont observées aussi : elles s'allument une fois affichées. */
// Pas de souris = téléphone/tablette. Certains Android (Samsung…) annoncent « hover: hover »
// alors qu'ils n'ont pas de souris : on teste donc l'inverse (souris précise), plus fiable.
if ("IntersectionObserver" in window && !matchMedia("(hover: hover) and (pointer: fine)").matches) {
  const tileObserver = new IntersectionObserver(
    (entries) => entries.forEach((entry) => entry.target.classList.toggle("is-active", entry.isIntersecting)),
    { rootMargin: "-35% 0px -35% 0px" } // bande centrale (30 % de la hauteur de l'écran)
  );
  root.querySelectorAll(".g-tile").forEach((tile) => tileObserver.observe(tile));
}

/* ---------- Lightbox (agrandissement + enregistrement) ---------- */
const lb = document.createElement("div");
lb.className = "lightbox";
lb.hidden = true;
lb.setAttribute("role", "dialog");
lb.setAttribute("aria-modal", "true");
lb.setAttribute("aria-label", "Photo agrandie");
lb.innerHTML = `
  <button class="lb-btn lb-close" type="button" data-act="close" aria-label="Fermer">✕</button>
  <button class="lb-btn lb-prev" type="button" data-act="prev" aria-label="Photo précédente">‹</button>
  <figure class="lb-fig">
    <img class="lb-img" alt="" />
    <figcaption class="lb-cap">
      <span><span class="lb-title"></span> · <span class="lb-count"></span></span>
      <a class="lb-dl" href="galerie.html" download>Enregistrer</a>
    </figcaption>
  </figure>
  <button class="lb-btn lb-next" type="button" data-act="next" aria-label="Photo suivante">›</button>`;
document.body.appendChild(lb);

const $ = (s) => lb.querySelector(s);
let cur = { set: 0, i: 0 };
let opener = null;

function show(setIdx, i) {
  const s = sets[setIdx];
  const n = s.photos.length;
  cur = { set: setIdx, i: (i + n) % n };
  const p = s.photos[cur.i];
  $(".lb-img").src = p.src;
  $(".lb-img").alt = p.alt;
  $(".lb-title").textContent = s.title;
  $(".lb-count").textContent = `${cur.i + 1} / ${n}`;
  const file = p.full || p.src; // JPEG haute qualité si dispo, sinon le WebP
  const dl = $(".lb-dl");
  dl.href = file;
  dl.setAttribute("download", file.split("/").pop().split("?")[0]);
  lb.classList.toggle("lb--single", n < 2);
}

function open(setIdx, i, from) {
  opener = from;
  show(setIdx, i);
  lb.hidden = false;
  document.body.style.overflow = "hidden";
  $(".lb-close").focus();
}

function close() {
  lb.hidden = true;
  document.body.style.overflow = "";
  $(".lb-img").removeAttribute("src");
  if (opener) opener.focus();
}

root.addEventListener("click", (e) => {
  const t = e.target.closest(".g-tile");
  if (t) return open(+t.dataset.set, +t.dataset.i, t);

  // « Voir plus de photos » : affiche le lot suivant de l'événement
  const more = e.target.closest(".gallery-more");
  if (!more) return;
  const hidden = [...more.closest(".gallery-event").querySelectorAll(".g-tile[hidden]")];
  hidden.slice(0, PAGE_SIZE).forEach((el) => (el.hidden = false));
  hidden[0]?.focus();
  const left = hidden.length - PAGE_SIZE;
  if (left > 0) more.outerHTML = moreButton(left);
  else more.remove();
});

lb.addEventListener("click", (e) => {
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "close" || e.target === lb || e.target.classList.contains("lb-fig")) close();
  else if (act === "prev") show(cur.set, cur.i - 1);
  else if (act === "next") show(cur.set, cur.i + 1);
});

document.addEventListener("keydown", (e) => {
  if (lb.hidden) return;
  if (e.key === "Escape") close();
  else if (e.key === "ArrowLeft") show(cur.set, cur.i - 1);
  else if (e.key === "ArrowRight") show(cur.set, cur.i + 1);
  else if (e.key === "Tab") {
    // Le focus reste dans la photo agrandie tant qu'elle est ouverte
    const items = [...lb.querySelectorAll("button, a[href]")].filter((el) => el.offsetParent !== null);
    const i = items.indexOf(document.activeElement);
    if (i === -1 || (e.shiftKey && i === 0) || (!e.shiftKey && i === items.length - 1)) {
      e.preventDefault();
      items.at(e.shiftKey ? -1 : 0)?.focus();
    }
  }
});

/* Swipe tactile */
let x0 = null;
lb.addEventListener("touchstart", (e) => (x0 = e.touches[0].clientX), { passive: true });
lb.addEventListener("touchend", (e) => {
  if (x0 === null) return;
  const dx = e.changedTouches[0].clientX - x0;
  x0 = null;
  if (Math.abs(dx) > 50) show(cur.set, cur.i + (dx < 0 ? 1 : -1));
});