import { GALLERY } from "../data/galerie.js";
import { thumb } from "./helpers.js";

const root = document.getElementById("gallery-root");

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
          .map(
            (ev) => `
          <div class="gallery-event" id="${ev.eventSlug || ""}">
            <h3>${ev.title}</h3>
            <div class="gallery-grid">
              ${
                ev.photos.length
                  ? ev.photos.map((src) => thumb(src, ev.title)).join("")
                  : thumb(null, ev.title, "Photos à venir")
              }
            </div>
          </div>`
          )
          .join("")}
      </section>`
    )
    .join("");
}
