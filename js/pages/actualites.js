import { ACTUALITES } from "../data/actualites.js";
import { esc } from "./helpers.js";

const dateFr = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });

// Les actualités marquées demo: true ne sont jamais affichées au public (npm run validate les signale).
const news = ACTUALITES.filter((a) => !a.demo).sort((a, b) => b.date.localeCompare(a.date));

document.querySelector("#news").innerHTML = news.length
  ? news
      .map(
        (a) => `<article class="article-card"><div class="date"><time datetime="${esc(a.date)}">${dateFr.format(new Date(a.date + "T12:00:00"))}</time></div><h2>${esc(a.title)}</h2><p><strong>${esc(a.excerpt)}</strong></p><p>${esc(a.content)}</p></article>`
      )
      .join("")
  : `<p class="empty-state">Les premières actualités arrivent bientôt. En attendant, retrouve nos prochaines dates sur la page <a href="evenements.html">Événements</a> et sur <a href="https://www.instagram.com/tnd6tem/" target="_blank" rel="noopener noreferrer">Instagram @tnd6tem</a>.</p>`;
