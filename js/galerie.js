import { EVENTS } from "./data/events.js";

// CONTENU D'EXEMPLE — à remplacer par les vraies photos/vidéos.
// `evenement` doit correspondre à un slug de events.js (ou "" si générique).
const MEDIA = [
  { visuel: "decor/star-outline.webp", legende: "Solstice Warehouse — ambiance de piste", evenement: "solstice-warehouse-2026" },
  { visuel: "decor/burst.webp", legende: "Release Party TND6TEM — premier déploiement", evenement: "release-party-tnd6tem" },
  { visuel: "decor/sparkle-blue.webp", legende: "Montage son — coulisses", evenement: "" },
  { visuel: "decor/sparkles-lavender.webp", legende: "Éclairage de scène", evenement: "" },
  { visuel: "decor/star-pair.webp", legende: "Warm-up d'hiver — configuration lumière", evenement: "warmup-hiver-2025" },
  { visuel: "decor/thorn.webp", legende: "Câblage et régie", evenement: "" },
  { visuel: "decor/star-lavender.webp", legende: "Installation barnum", evenement: "" },
  { visuel: "decor/squiggle.webp", legende: "Espace bar associatif", evenement: "" },
];

const grid = document.getElementById("gal-grid");
const chipsEl = document.getElementById("gal-chips");

const eventNames = Object.fromEntries(EVENTS.map((e) => [e.slug, e.nom]));
const usedSlugs = [...new Set(MEDIA.map((m) => m.evenement).filter(Boolean))];

chipsEl.innerHTML = ["tous", ...usedSlugs]
  .map((s) => `<button class="chip" data-ev="${s}" aria-pressed="${s === "tous"}">${s === "tous" ? "Tout voir" : eventNames[s] || s}</button>`)
  .join("");

let active = "tous";
chipsEl.addEventListener("click", (ev) => {
  const btn = ev.target.closest(".chip");
  if (!btn) return;
  active = btn.dataset.ev;
  [...chipsEl.querySelectorAll(".chip")].forEach((c) => c.setAttribute("aria-pressed", String(c === btn)));
  render();
});

function render() {
  const items = active === "tous" ? MEDIA : MEDIA.filter((m) => m.evenement === active);
  grid.innerHTML = items
    .map((m) => `<figure style="background-image:url('assets/img/${m.visuel}')"><figcaption>${m.legende}</figcaption></figure>`)
    .join("");
}
render();
