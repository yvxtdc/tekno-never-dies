import { GALLERY } from "../data/galerie.js";
import { thumb } from "./helpers.js";

const root = document.getElementById("gallery-root");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* Une photo = un simple chemin "assets/…jpg" OU un objet { src, alt, w, h, full } */
const norm = (p, title) => (typeof p === "string" ? { src: p, alt: title } : { alt: title, ...p });

const sets = []; // sets[i] = photos de l'événement i (pour naviguer dans le lightbox)

function tile(p, setIdx, i) {
  const size = p.w && p.h ? ` width="${p.w}" height="${p.h}"` : "";
  return `<button class="g-tile" type="button" data-set="${setIdx}" data-i="${i}" aria-label="Agrandir : ${esc(p.alt)}">
    <img src="${esc(p.src)}" alt="${esc(p.alt)}"${size} loading="lazy" decoding="async" />
  </button>`;
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
          <div class="gallery-event" id="${ev.eventSlug || ""}">
            <h3>${ev.title}</h3>
            <div class="gallery-masonry">
              ${photos.length ? photos.map((p, i) => tile(p, setIdx, i)).join("") : thumb(null, ev.title, "Photos à venir")}
            </div>
          </div>`;
          })
          .join("")}
      </section>`
    )
    .join("");
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
      <a class="lb-dl" download>Enregistrer</a>
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
  if (t) open(+t.dataset.set, +t.dataset.i, t);
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