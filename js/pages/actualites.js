import { ACTUALITES } from "../data/actualites.js";
import { esc } from "./helpers.js";

const dateFr = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });

document.querySelector("#news").innerHTML = [...ACTUALITES]
  .sort((a, b) => b.date.localeCompare(a.date))
  .map(
    (a) => `<article class="article-card"><div class="date">${dateFr.format(new Date(a.date + "T12:00:00"))}</div><h2>${esc(a.title)}</h2><p><strong>${esc(a.excerpt)}</strong></p><p>${esc(a.content)}</p></article>`
  )
  .join("");
