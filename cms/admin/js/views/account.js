/** Mon compte : mot de passe, sessions. */
import { h, replace } from "../lib/dom.js";
import { post } from "../lib/api.js";
import { pageHead, field, input, toast, errorMessage, busy, showFieldErrors, confirm } from "../lib/ui.js";
import { session } from "../lib/session.js";

export function accountView(ctx, main) {
  document.title = "Mon compte — Administration TND";
  const current = input({ type: "password", autocomplete: "current-password" });
  const next = input({ type: "password", autocomplete: "new-password" });
  const again = input({ type: "password", autocomplete: "new-password" });
  const save = h("button", { type: "submit", class: "btn btn--primary" }, "Changer le mot de passe");
  const form = h("form", { class: "fields", novalidate: true },
    field({ label: "Mot de passe actuel", control: current, name: "currentPassword" }),
    field({ label: "Nouveau mot de passe", control: next, name: "newPassword", hint: "12 caractères minimum ; une phrase de plusieurs mots est idéale." }),
    field({ label: "Confirmer", control: again, name: "confirm" }),
    h("div", {}, save));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (next.value !== again.value) return showFieldErrors(form, { confirm: "Les deux mots de passe ne correspondent pas." });
    busy(save, async () => {
      try {
        await post("/api/auth/password", { currentPassword: current.value, newPassword: next.value });
        form.reset();
        showFieldErrors(form, {});
        toast("Mot de passe changé. Vos autres sessions ont été fermées.");
      } catch (error) {
        if (error.status === 422) showFieldErrors(form, error.fields);
        else toast(errorMessage(error), "error");
      }
    });
  });
  replace(main,
    pageHead({ title: "Mon compte", subtitle: `${session.user.name} · ${session.user.email} · ${session.user.roleLabel}` }),
    h("div", { class: "grid grid--2" },
      h("section", { class: "card" }, h("div", { class: "card__head" }, h("h2", {}, "Mot de passe")), form),
      h("section", { class: "card" }, h("div", { class: "card__head" }, h("h2", {}, "Sessions")),
        h("p", { class: "muted" }, `Vous êtes déconnecté·e après ${session.idleMinutes} minutes d'inactivité. Si vous avez oublié de vous déconnecter sur un autre appareil :`),
        h("button", { type: "button", class: "btn", onclick: async (e) => {
          const btn = e.currentTarget;
          if (!(await confirm({ title: "Fermer mes autres sessions ?", message: "Vous resterez connecté·e ici uniquement.", confirmLabel: "Fermer les autres sessions" }))) return;
          busy(btn, async () => {
            try {
              await post("/api/auth/logout-others");
              toast("Autres sessions fermées.");
            } catch (error) {
              toast(errorMessage(error), "error");
            }
          });
        } }, "Déconnecter mes autres appareils"))));
}
