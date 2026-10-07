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