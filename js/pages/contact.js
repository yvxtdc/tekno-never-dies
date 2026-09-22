import { readParam } from "./helpers.js";

const form = document.getElementById("contact-form");
const typeSelect = form.querySelector("#type");
const fieldEvenement = form.querySelector("#field-evenement");
const fieldDate = form.querySelector("#field-date");
const fieldMateriel = form.querySelector("#field-materiel");

function syncFields() {
  const type = typeSelect.value;
  fieldDate.hidden = !["evenement", "location"].includes(type);
  fieldMateriel.hidden = type !== "location";
  fieldEvenement.hidden = type !== "evenement";
}
typeSelect.addEventListener("change", syncFields);

// Pré-remplit le formulaire si on arrive depuis une fiche événement/matériel
// (ex : contact.html?sujet=location&materiel=Enceinte%20active)
const sujet = readParam("sujet");
if (sujet) typeSelect.value = sujet;
const materiel = readParam("materiel");
if (materiel) form.querySelector("#materiel").value = materiel;
const evenement = readParam("evenement");
if (evenement) form.querySelector("#evenement-nom").value = evenement;

syncFields();
