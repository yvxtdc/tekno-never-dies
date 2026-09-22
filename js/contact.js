(function () {
  var form = document.getElementById("contact-form");
  var champsDevis = document.getElementById("champs-devis");
  var champMateriel = document.getElementById("champ-materiel");
  var sujetInputs = form.querySelectorAll('input[name="sujet"]');
  var materielInput = document.getElementById("materiel");
  var successEl = form.querySelector(".form-success");
  var errorEl = form.querySelector(".form-error");

  function updateVisibility() {
    var sujet = form.querySelector('input[name="sujet"]:checked').value;
    var isDevis = sujet === "devis";
    champsDevis.style.display = isDevis ? "" : "none";
    champMateriel.hidden = !(isDevis || sujet === "autre") || !materielInput.value;
  }

  sujetInputs.forEach(function (r) {
    r.addEventListener("change", updateVisibility);
  });

  // ---- Préremplissage depuis l'URL (?sujet=devis&materiel=...) ----
  var params = new URLSearchParams(location.search);
  var sujetParam = params.get("sujet");
  var materielParam = params.get("materiel");

  if (sujetParam) {
    var match = form.querySelector('input[name="sujet"][value="' + sujetParam + '"]');
    if (match) match.checked = true;
  }
  if (materielParam) {
    materielInput.value = materielParam;
    champMateriel.hidden = false;
  }
  updateVisibility();

  // ---- Envoi Formspree en AJAX (avec repli sur soumission classique) ----
  form.addEventListener("submit", function (e) {
    if (form.action.indexOf("YOUR_FORM_ID") !== -1) return; // pas encore configuré : laisse le comportement par défaut (voir README)
    e.preventDefault();
    successEl.style.display = "none";
    errorEl.style.display = "none";

    fetch(form.action, {
      method: "POST",
      body: new FormData(form),
      headers: { Accept: "application/json" },
    })
      .then(function (res) {
        if (res.ok) {
          successEl.style.display = "block";
          form.reset();
          updateVisibility();
        } else {
          errorEl.style.display = "block";
        }
      })
      .catch(function () {
        errorEl.style.display = "block";
      });
  });
})();
