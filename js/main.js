import { startStars } from "./stars/stars.js";
import { STARS_CONFIG } from "./stars/config.js";

// Calque 3D fixe au-dessus de la page (voir #stage dans css/style.css)
const canvas = document.getElementById("stage");

if (canvas && STARS_CONFIG.enabled) {
  const stars = startStars(canvas, STARS_CONFIG);
  if (stars) {
    window.TND = { stars };   // pratique pour bidouiller depuis la console du navigateur
  } else {
    canvas.remove();
  }
}
