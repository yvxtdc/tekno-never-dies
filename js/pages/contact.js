const form = document.querySelector("#contact-form");
const type = document.querySelector("#type");
const dateField = document.querySelector("#field-date");
const eventField = document.querySelector("#field-evenement");
const materialField = document.querySelector("#field-materiel");

function updateFields() {
  const value = type?.value;
  dateField?.toggleAttribute("hidden", !["location", "evenement"].includes(value));
  eventField?.toggleAttribute("hidden", !["evenement", "info-soiree"].includes(value));
  materialField?.toggleAttribute("hidden", value !== "location");
}

type?.addEventListener("change", updateFields);
const params = new URLSearchParams(location.search);
if (params.get("type") === "location" && type) type.value = "location";
const eventParam = params.get("evenement");
const materialParam = params.get("materiel");
const eventInput = document.querySelector("#evenement-nom");
const materialInput = document.querySelector("#materiel");
if (eventParam && eventInput) eventInput.value = eventParam;
if (materialParam && materialInput) materialInput.value = materialParam;
updateFields();

form?.addEventListener("submit", () => {
  form.querySelector('button[type="submit"]')?.setAttribute("disabled", "disabled");
});
