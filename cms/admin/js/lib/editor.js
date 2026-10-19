/**
 * Aide aux formulaires simples (artistes, lieux, équipe…) : liaison champs ↔ modèle, suivi des
 * modifications non enregistrées, barre d'enregistrement, erreurs de validation, conflits de version.
 */
import { h, append } from "./dom.js";
import { setDirtyChecker, navigate } from "./router.js";
import { toast, errorMessage, showFieldErrors, busy, confirm } from "./ui.js";

export function createEditor({ model, toPayload = (m) => m, onSave, savedLabel = "Tout est enregistré", newLabel = "Nouvelle fiche", isNew = false }) {
  let saved = JSON.stringify(toPayload(model));
  const isDirty = () => JSON.stringify(toPayload(model)) !== saved;
  setDirtyChecker(isDirty);
  const errors = h("div", { class: "form-errors", hidden: true, role: "alert" });
  const state = h("span", { class: "savebar__state" });
  const bar = h("div", { class: "savebar" });
  const touch = () => {
    bar.classList.toggle("is-dirty", isDirty());
    state.textContent = isDirty() ? "Modifications non enregistrées" : isNew ? newLabel : savedLabel;
  };
  const saveBtn = h("button", { type: "submit", class: "btn btn--primary", "data-save-shortcut": true }, isNew ? "Créer" : "Enregistrer");
  const form = h("form", { class: "stack", novalidate: true });
  const save = () => busy(saveBtn, async () => {
    try {
      const result = await onSave(toPayload(model));
      saved = JSON.stringify(toPayload(model));
      showFieldErrors(form, {}, errors);
      touch();
      return result;
    } catch (error) {
      if (error.status === 422) showFieldErrors(form, error.fields, errors);
      else if (error.status === 409 && error.data?.stale) {
        if (await confirm({ title: "Fiche modifiée entre-temps", message: "Quelqu'un l'a enregistrée pendant que vous la modifiiez. Recharger sa dernière version ? (Vos modifications non enregistrées seront perdues.)", confirmLabel: "Recharger", danger: true })) {
          navigate(location.pathname, { replace: true, force: true });
        }
      } else toast(errorMessage(error), "error");
      return undefined;
    }
  });
  form.addEventListener("submit", (e) => { e.preventDefault(); save(); });
  const bind = (key, el, transform = (v) => v) => {
    const read = () => (el.type === "checkbox" ? el.checked : transform(el.value));
    el.addEventListener("input", () => { model[key] = read(); touch(); });
    el.addEventListener("change", () => { model[key] = read(); touch(); });
    return el;
  };
  append(bar, [state, h("span", { class: "spacer" }), saveBtn]);
  return { form, errors, bar, bind, touch, isDirty, save, saveBtn, markSaved: () => { saved = JSON.stringify(toPayload(model)); touch(); } };
}
