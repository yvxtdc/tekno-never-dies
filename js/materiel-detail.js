import { CATALOGUE, CATEGORIES } from "./data/catalogue.js";

const params = new URLSearchParams(location.search);
const slug = params.get("m");
const item = CATALOGUE.find((m) => m.slug === slug) || CATALOGUE[0];

document.title = `${item.nom} — Tekno Never Dies`;
document.getElementById("page-title").textContent = document.title;
document.getElementById("crumb-nom").textContent = item.nom;
document.getElementById("item-nom").textContent = item.nom;
document.getElementById("item-court").textContent = item.court;

const devisUrl = `contact.html?sujet=devis&materiel=${encodeURIComponent(item.nom)}`;

document.getElementById("item-content").innerHTML = `
  <div>
    <div class="detail-media"><img src="assets/img/${item.visuel}" alt="${item.nom} en situation" /></div>
    <div style="margin-top:1.5em">
      <h2 style="font-size:1.4rem">Caractéristiques</h2>
      <ul class="specs">${item.caracteristiques.map((c) => `<li>${c}</li>`).join("")}</ul>
      <h2 style="font-size:1.4rem">Inclus dans la location</h2>
      <p>${item.inclus}</p>
      <h2 style="font-size:1.4rem">Transport</h2>
      <p>${item.transport}</p>
    </div>
  </div>
  <aside class="detail-side">
    <span class="tag" style="align-self:flex-start">${CATEGORIES[item.categorie]}</span>
    <dl>
      <div><dt>Tarif à la journée</dt><dd>${item.tarifJournee}</dd></div>
      <div><dt>Tarif week-end</dt><dd>${item.tarifWeekend}</dd></div>
      <div><dt>Caution indicative</dt><dd>${item.caution}</dd></div>
    </dl>
    <a class="btn btn-solid" href="${devisUrl}">Demander un devis pour ce matériel</a>
    <a class="btn btn-line" href="contact.html?sujet=autre&materiel=${encodeURIComponent(item.nom)}">Demander des infos</a>
  </aside>
`;
