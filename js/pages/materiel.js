import { CATEGORIES, MATERIEL } from "../data/materiel.js";
import { thumb, readParam } from "./helpers.js";

const root = document.getElementById("material-detail");
const item = MATERIEL.find((m) => m.slug === readParam("slug"));

if (!item) {
  root.innerHTML = `
    <p>Équipement introuvable.</p>
    <p><a class="btn btn-line" href="location.html">Retour au catalogue</a></p>`;
} else {
  document.title = `${item.name} — Tekno Never Dies`;
  const catLabel = CATEGORIES.find((c) => c.id === item.category)?.label || item.category;
  const specs = (item.specs || []).map((s) => `<li>${s}</li>`).join("");
  const accessories = (item.accessories || []).map((a) => `<li>${a}</li>`).join("");

  root.innerHTML = `
    <a class="back-link" href="location.html#${item.category}">← Retour au catalogue</a>
    ${thumb(item.cover, item.name, "Photo à ajouter")}
    <span class="pill">${catLabel}</span>
    <h1>${item.name}</h1>
    <p>${item.description}</p>
    ${specs ? `<h2>Caractéristiques</h2><ul>${specs}</ul>` : ""}
    ${accessories ? `<h2>Accessoires inclus</h2><ul>${accessories}</ul>` : ""}
    <dl class="material-facts">
      <div><dt>Quantité disponible</dt><dd>${item.quantity ?? "—"}</dd></div>
      <div><dt>Tarif</dt><dd>${item.price || "Sur devis"}</dd></div>
      ${item.conditions ? `<div><dt>Conditions</dt><dd>${item.conditions}</dd></div>` : ""}
    </dl>
    <div class="actions">
      <a class="btn btn-solid" href="contact.html?type=location&materiel=${encodeURIComponent(item.name)}">Demander un devis</a>
    </div>
  `;
}
