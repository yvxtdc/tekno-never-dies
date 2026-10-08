import { PARTENAIRES } from "../data/partenaires.js";
import { esc } from "./helpers.js";

// Les partenaires marqués demo: true ne sont jamais affichés au public (npm run validate les signale).
const partners = PARTENAIRES.filter((p) => !p.demo);

document.querySelector("#partners").innerHTML = partners.length ? partners.map(
  (p) => `<article class="info-card"><h2>${esc(p.name)}</h2><p><strong>${esc(p.type)}</strong></p><p>${esc(p.description)}</p>${
    p.url ? `<a class="btn btn-line btn-sm" href="${esc(p.url)}" target="_blank" rel="noopener">Voir le partenaire</a>` : ""
  }</article>`
).join("") : `<p class="empty-state">Nos partenaires seront présentés ici. Un lieu, un collectif ou un projet à nous proposer ? Écris-nous.</p>`;
