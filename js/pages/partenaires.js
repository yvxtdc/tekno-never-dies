import { PARTENAIRES } from "../data/partenaires.js";
import { esc } from "./helpers.js";

document.querySelector("#partners").innerHTML = PARTENAIRES.map(
  (p) => `<article class="info-card"><h2>${esc(p.name)}</h2><p><strong>${esc(p.type)}</strong></p><p>${esc(p.description)}</p>${
    p.url ? `<a class="btn btn-line btn-sm" href="${esc(p.url)}" target="_blank" rel="noopener">Voir le partenaire</a>` : ""
  }</article>`
).join("");
