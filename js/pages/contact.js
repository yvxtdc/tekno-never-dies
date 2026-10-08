import { lang } from "../i18n/i18n.js";

const form = document.querySelector("#contact-form");
const type = document.querySelector("#type");
const status = document.querySelector("#contact-status");
const dateField = document.querySelector("#field-date");
const eventField = document.querySelector("#field-evenement");
const locationField = document.querySelector("#field-lieu");
const participantsField = document.querySelector("#field-participants");

// Champs supplémentaires selon le type de demande. Un champ masqué est aussi désactivé :
// sa valeur (même pré-remplie depuis l'adresse) n'est alors pas envoyée.
function showField(field, visible) {
  if (!field) return;
  field.hidden = !visible;
  field.querySelectorAll("input, select, textarea").forEach((input) => { input.disabled = !visible; });
}

function updateFields() {
  const value = type?.value;
  showField(dateField, value === "evenement");
  showField(eventField, ["evenement", "info-soiree"].includes(value));
  showField(locationField, ["evenement", "projet"].includes(value));
  showField(participantsField, ["evenement", "projet"].includes(value));
}

type?.addEventListener("change", updateFields);

// Pré-remplissage depuis l'adresse : contact.html?type=partenariat&evenement=…&lieu=…
const params = new URLSearchParams(location.search);
const typeParam = params.get("type");
if (typeParam && type && [...type.options].some((option) => option.value === typeParam)) type.value = typeParam;
const eventInput = document.querySelector("#evenement-nom");
const locationInput = document.querySelector("#lieu");
// Texte venu d'un lien : coupé à la longueur maximale du champ (maxlength ne s'applique qu'à la saisie).
const prefill = (input, value) => { if (value && input) input.value = value.slice(0, input.maxLength > 0 ? input.maxLength : 120); };
prefill(eventInput, params.get("evenement"));
prefill(locationInput, params.get("lieu"));
updateFields();

// Envoi en arrière-plan : le visiteur reste sur la page et voit le résultat.
form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  if (button.disabled) return;
  // Objet de l'e-mail reçu : « [Site TND] Bénévolat — Prénom Nom »
  const subject = document.querySelector("#contact-subject");
  const name = form.elements.nom?.value.trim();
  // Visiteur en allemand ou en anglais : la langue est signalée dans l'objet pour répondre dans la bonne langue.
  const langTag = lang === "fr" ? "" : ` [${lang.toUpperCase()}]`;
  if (subject && type?.value) subject.value = `[Site TND]${langTag} ${type.selectedOptions[0].text}${name ? ` — ${name}` : ""}`;
  button.disabled = true;
  status.textContent = "Envoi en cours…";
  try {
    const response = await fetch(form.action, {
      method: "POST",
      body: new FormData(form),
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    form.reset();
    updateFields();
    status.textContent = "Merci ! Ton message a bien été envoyé. Nous te répondons dès que possible.";
  } catch {
    status.textContent = "L'envoi a échoué. Réessaie dans un instant ou écris-nous directement à tnd6tem@gmail.com.";
  } finally {
    button.disabled = false;
  }
});
