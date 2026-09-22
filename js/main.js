import { startStars } from "./stars/stars.js";
import { STARS_CONFIG } from "./stars/config.js";

const canvas = document.getElementById("stage");
const hero = document.querySelector(".hero");

if (canvas && hero && STARS_CONFIG.enabled) {

  const stars = startStars(canvas, STARS_CONFIG);

  if (stars) {

    window.TND = { stars };

    const observer = new IntersectionObserver(
      (entries) => {

        const visible = entries[0].isIntersecting;

        if (visible) {

          canvas.style.visibility = "visible";
          stars.startAnimation();

        } else {

          canvas.style.visibility = "hidden";
          stars.stopAnimation();

        }

      },
      {
        threshold: 0.1
      }
    );

    observer.observe(hero);

  } else {

    canvas.remove();

  }

} else if (canvas) {

  canvas.remove();

}