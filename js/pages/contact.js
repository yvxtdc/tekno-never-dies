const form = document.querySelector("#contact-form");
const type = document.querySelector("#type");
const status = document.querySelector("#contact-status");
const dateField = document.querySelector("#field-date");
const eventField = document.querySelector("#field-evenement");
const locationField = document.querySelector("#field-lieu");
const participantsField = document.querySelector("#field-participants");

// Champs supplémentaires selon le type de demande
function updateFields() {
  const value = type?.value;
  dateField?.toggleAttribute("hidden", value !== "evenement");
  eventField?.toggleAttribute("hidden", !["evenement", "info-soiree"].includes(value));
  locationField?.toggleAttribute("hidden", !["evenement", "projet"].includes(value));
  participantsField?.toggleAttribute("hidden", !["evenement", "projet"].includes(value));
}

type?.addEventListener("change", updateFields);

// Pré-remplissage depuis l'adresse : contact.html?type=partenariat&evenement=…&lieu=…
const params = new URLSearchParams(location.search);
const typeParam = params.get("type");
if (typeParam && type && [...type.options].some((option) => option.value === typeParam)) type.value = typeParam;
const eventInput = document.querySelector("#evenement-nom");
const locationInput = document.querySelector("#lieu");
if (params.get("evenement") && eventInput) eventInput.value = params.get("evenement");
if (params.get("lieu") && locationInput) locationInput.value = params.get("lieu");
updateFields();

// Envoi en arrière-plan : le visiteur reste sur la page et voit le résultat.
form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
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
