import { EVENTS } from "../data/events.js";
import { eventStatus, esc } from "./helpers.js";
import { eventRange } from "./ics.js";

/* ---------- Prochaine soirée (sous le hero) ----------
   Prend la première date à venir de js/data/events.js ; le bloc reste masqué s'il n'y en a aucune. */
const nextBlock = document.getElementById("home-next");
const next = EVENTS
  .filter((ev) => eventStatus(ev) === "a-venir")
  .sort((a, b) => a.date.localeCompare(b.date))[0];

if (nextBlock && next) {
  const ficheUrl = `evenement.html?slug=${encodeURIComponent(next.slug)}`;
  nextBlock.querySelector("h2").innerHTML = `<a href="${ficheUrl}">${esc(next.title)}</a>`;
  nextBlock.querySelector(".home-next__price").textContent = [next.price, next.age].filter(Boolean).join(" · ");
  nextBlock.querySelector(".home-next__actions").innerHTML = `
    ${next.ticketUrl ? `<a class="btn btn-solid" href="${esc(next.ticketUrl)}" target="_blank" rel="noopener">Prendre ma place ↗</a>` : ""}
    <a class="btn btn-hero-line" href="${ficheUrl}">Voir la soirée</a>`;
  nextBlock.hidden = false;
  startCountdown(next);
}

/* ---------- Compte à rebours jusqu'à la prochaine soirée ----------
   Pendant la soirée, il laisse place à « C'est en ce moment » ; après, il disparaît. */
function startCountdown(ev) {
  const box = nextBlock.querySelector(".countdown");
  const range = eventRange(ev);
  if (!box || !range) return;
  const units = Object.fromEntries([...box.querySelectorAll("[data-unit]")].map((el) => [el.dataset.unit, el]));
  const pad = (n) => String(n).padStart(2, "0");
  const tick = () => {
    const now = Date.now();
    const left = range.start.getTime() - now;
    if (now >= range.end.getTime()) {
      box.hidden = true;
      clearInterval(timer);
      return;
    }
    box.classList.toggle("is-live", left <= 0);
    if (left > 0) {
      const s = Math.floor(left / 1000);
      units.j.textContent = pad(Math.floor(s / 86400));
      units.h.textContent = pad(Math.floor(s / 3600) % 24);
      units.m.textContent = pad(Math.floor(s / 60) % 60);
      units.s.textContent = pad(s % 60);
      box.querySelector(".countdown__units").setAttribute("aria-label",
        `Plus que ${Math.floor(s / 86400)} jours et ${Math.floor(s / 3600) % 24} heures avant ${ev.title}`);
    }
    box.hidden = false;
  };
  const timer = setInterval(tick, 1000);
  tick();
}

// Accueil : étoiles 3D chromées derrière le hero (Three.js, chargé seulement ici).
// Le rendu attend que le navigateur soit au repos pour ne pas retarder l'affichage du texte et
// de la photo ; il est mis en pause dès que le hero sort de l'écran.
const canvas = document.getElementById("stage");
const hero = document.querySelector(".hero");

async function startHeroStars() {
  const [{ startStars }, { STARS_CONFIG }] = await Promise.all([
    import("../stars/stars.js"),
    import("../stars/config.js")
  ]);

  if (!STARS_CONFIG.enabled) return canvas.remove();

  const stars = startStars(canvas, STARS_CONFIG);
  if (!stars) return canvas.remove();

  window.TND = { stars };

  new IntersectionObserver(
    (entries) => {
      const visible = entries[0].isIntersecting;
      canvas.style.visibility = visible ? "visible" : "hidden";
      if (visible) stars.startAnimation();
      else stars.stopAnimation();
    },
    { threshold: 0.1 }
  ).observe(hero);
}

if (canvas && hero) {
  if ("requestIdleCallback" in window) requestIdleCallback(startHeroStars, { timeout: 1500 });
  else setTimeout(startHeroStars, 200);
} else {
  canvas?.remove();
}

/* ---------- Les 4 blocs : photo au défilement sur téléphone ----------
   Sur un écran tactile (pas de souris), le bloc qui traverse la zone de déclenchement
   s'allume tout seul pendant qu'on fait défiler la page (styles : css/components/home-cards-mobile.css).
   Sur ordinateur, rien ne change : la photo apparaît au survol. */
const homeCards = document.querySelectorAll(".home-card");

if (homeCards.length && "IntersectionObserver" in window && matchMedia("(hover: none)").matches) {
  const cardObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => entry.target.classList.toggle("is-active", entry.isIntersecting));
    },
    // Zone de déclenchement placée aux 2/3 de l'écran (entre 65 % et 75 % depuis le haut) :
    // un bloc s'allume dès qu'il monte dans l'écran. Plus le 1er chiffre est grand, plus c'est tôt.
    { rootMargin: "-65% 0px -25% 0px" }
  );
  homeCards.forEach((card) => cardObserver.observe(card));
}