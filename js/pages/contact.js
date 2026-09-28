const form = document.querySelector("#contact-form");
const type = document.querySelector("#type");
const dateField = document.querySelector("#field-date");
const eventField = document.querySelector("#field-evenement");
const materialField = document.querySelector("#field-materiel");
const locationField = document.querySelector("#field-lieu");
const participantsField = document.querySelector("#field-participants");

function updateFields() {
  const value = type?.value;
  dateField?.toggleAttribute("hidden", !["location", "evenement"].includes(value));
  eventField?.toggleAttribute("hidden", !["evenement", "info-soiree"].includes(value));
  materialField?.toggleAttribute("hidden", value !== "location");
  locationField?.toggleAttribute("hidden", !["location", "evenement", "projet"].includes(value));
  participantsField?.toggleAttribute("hidden", !["location", "evenement", "projet"].includes(value));
}

type?.addEventListener("change", updateFields);
const params = new URLSearchParams(location.search);
const typeParam = params.get("type");
if (typeParam && type && [...type.options].some((option) => option.value === typeParam)) type.value = typeParam;
const eventParam = params.get("evenement");
const materialParam = params.get("materiel");
const eventInput = document.querySelector("#evenement-nom");
const materialInput = document.querySelector("#materiel");
const locationInput = document.querySelector("#lieu");
if (eventParam && eventInput) eventInput.value = eventParam;
if (materialParam && materialInput) materialInput.value = materialParam;
if (params.get("lieu") && locationInput) locationInput.value = params.get("lieu");
updateFields();

form?.addEventListener("submit", () => {
  form.querySelector('button[type="submit"]')?.setAttribute("disabled", "disabled");
  const status = document.querySelector("#contact-status");
  if (status) status.textContent = "Envoi en cours…";
});
