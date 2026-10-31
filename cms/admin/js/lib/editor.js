/**
 * Aide aux formulaires simples (artistes, lieux, équipe…) : liaison champs ↔ modèle, suivi des
 * modifications non enregistrées, barre d'enregistrement, erreurs de validation, conflits de version.
 */
import { h, append } from "./dom.js";
import { setDirtyChecker, navigate } from "./router.js";
import { toast, errorMessage, showFieldErrors, busy, confirm } from "./ui.js";

/**
 * Formulaire lié à un modèle. `model` est modifié en place par bind() ; l'état « modifié » compare
 * toPayload(model) à la dernière version enregistrée (sérialisée en JSON).
 * @param {object} options
 * @param {object} options.model copie de travail de la fiche (structuredClone de la réponse de l'API)
 * @param {(model: object) => object} [options.toPayload] corps envoyé à l'API ; seul ce qu'il contient compte comme modification
 * @param {(payload: object) => Promise<object>} options.onSave enregistre et renvoie la fiche ; `mergedFields`
 *   non vide (fusion avec une modification concurrente, réponse du serveur) recharge la page
 * @param {Function|null} [options.onSubmit] action de la touche Entrée / Ctrl+S à la place de l'enregistrement
 *   (mode préparation d'une programmation)
 * @returns {{ form, errors, bar, bind, touch, isDirty, save, saveBtn, markSaved }} la vue place `errors` et
 *   `bar` dans `form` ; bind(clé, champ, transformation?) relie un champ au modèle ; touch() met à jour la barre
 *   après une modification faite hors d'un champ lié (média, liste…) ; la vue renvoie `{ isDirty }` au routeur.
 */
export function createEditor({ model, toPayload = (m) => m, onSave, onSubmit = null, savedLabel = "Tout est enregistré", newLabel = "Nouvelle fiche", isNew = false }) {
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
      // Fusion avec une modification faite entre-temps : le formulaire est rechargé pour l'afficher.
      if (result?.mergedFields?.length) {
        toast(`Modifié entre-temps (par une programmation ou une autre personne) et conservé : ${result.mergedFields.join(", ")}.`, "warn", { timeout: 12000 });
        navigate(location.pathname, { replace: true, force: true });
      }
      return result;
    } catch (error) {
      if (error.status === 422) showFieldErrors(form, error.fields, errors);
      else if (error.status === 409 && error.data?.stale) {
        const fields = error.data.conflicts?.length ? ` Champs modifiés des deux côtés : ${error.data.conflicts.map((c) => c.label).join(", ")}.` : "";
        if (await confirm({ title: "Fiche modifiée entre-temps", message: `Quelqu'un (ou une programmation) l'a modifiée pendant que vous la modifiiez.${fields} Recharger sa dernière version ? (Vos modifications non enregistrées seront perdues.)`, confirmLabel: "Recharger", danger: true })) {
          navigate(location.pathname, { replace: true, force: true });
        }
      } else toast(errorMessage(error), "error");
      return undefined;
    }
  });
  form.addEventListener("submit", (e) => { e.preventDefault(); (onSubmit || save)(); });
  const bind = (key, el, transform = (v) => v) => {
    const read = () => (el.type === "checkbox" ? el.checked : transform(el.value));
    el.addEventListener("input", () => { model[key] = read(); touch(); });
    el.addEventListener("change", () => { model[key] = read(); touch(); });
    return el;
  };
  append(bar, [state, h("span", { class: "spacer" }), saveBtn]);
  return { form, errors, bar, bind, touch, isDirty, save, saveBtn, markSaved: () => { saved = JSON.stringify(toPayload(model)); touch(); } };
}
