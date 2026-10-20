/** Composants d'interface partagés. */
import { h, append, clear, svg, uid } from "./dom.js";
import { ICONS } from "./icons.js";

export const icon = (name, opts) => svg(ICONS[name] || [], opts);

/* ---------- Notifications ---------- */
export function toast(message, type = "success", { timeout = type === "error" ? 9000 : 4500 } = {}) {
  const root = document.getElementById("toasts");
  const el = h("div", { class: `toast toast--${type}`, role: type === "error" ? "alert" : "status" },
    h("div", { class: "toast__text" }, message),
    h("button", { type: "button", "aria-label": "Fermer la notification", onclick: () => el.remove() }, "×"));
  root.append(el);
  if (timeout) setTimeout(() => el.remove(), timeout);
  return el;
}

/** Message d'erreur d'API lisible. */
export function errorMessage(error) {
  if (error?.status === 409 && error.data?.usage?.length) {
    return `${error.message} (${error.data.usage.map((u) => u.label || u.title).slice(0, 4).join(", ")}${error.data.usage.length > 4 ? "…" : ""})`;
  }
  return error?.message || "Une erreur est survenue.";
}

/* ---------- Dialogues ---------- */
export function dialog({ title, body, actions = [], wide = false, onClose } = {}) {
  const titleId = uid("dlg");
  const el = h("dialog", { class: `dialog${wide ? " dialog--wide" : ""}`, "aria-labelledby": titleId });
  const close = (value) => {
    el.close(value ?? "");
  };
  const foot = actions.length ? h("div", { class: "dialog__foot" }, actions) : null;
  append(el, [
    h("div", { class: "dialog__head" },
      h("h2", { id: titleId }, title),
      h("button", { type: "button", class: "btn btn--icon btn--ghost", "aria-label": "Fermer", onclick: () => close("cancel") }, icon("close"))),
    h("div", { class: "dialog__body" }, body),
    foot
  ]);
  el.addEventListener("close", () => {
    onClose?.(el.returnValue);
    el.remove();
  });
  document.body.append(el);
  el.showModal();
  return { el, close };
}

/** Confirmation (Promise<boolean>). danger : bouton rouge ; confirmText : texte à retaper. */
export function confirm({ title, message, confirmLabel = "Confirmer", danger = false, typeToConfirm = null }) {
  return new Promise((resolve) => {
    let input = null;
    const ok = h("button", { type: "button", class: `btn ${danger ? "btn--danger" : "btn--primary"}`, disabled: Boolean(typeToConfirm) }, confirmLabel);
    const body = h("div", { class: "stack" }, typeof message === "string" ? h("p", {}, message) : message);
    if (typeToConfirm) {
      const id = uid("confirm");
      input = h("input", { id, class: "input", autocomplete: "off", oninput: () => { ok.disabled = input.value.trim() !== typeToConfirm; } });
      append(body, [h("div", { class: "field" }, h("label", { for: id }, `Pour confirmer, tapez « ${typeToConfirm} »`), input)]);
    }
    let result = false;
    const d = dialog({
      title,
      body,
      actions: [h("button", { type: "button", class: "btn", onclick: () => d.close() }, "Annuler"), ok],
      onClose: () => resolve(result)
    });
    ok.addEventListener("click", () => {
      result = true;
      d.close("ok");
    });
    (input || ok).focus();
  });
}

/* ---------- Champs de formulaire ---------- */
/**
 * Champ avec libellé, aide et zone d'erreur. control : élément de saisie (input, select…).
 * Renvoie l'élément .field (field.setError(message) affiche l'erreur).
 */
export function field({ label, control, hint, required = false, wide = false, counter = null, name }) {
  const id = control.id || uid("f");
  control.id = id;
  const hintId = hint ? `${id}-hint` : null;
  const errorId = `${id}-error`;
  const errorEl = h("p", { class: "error-text", id: errorId, hidden: true });
  const describedBy = [hintId, errorId].filter(Boolean).join(" ");
  if (control.matches("input, select, textarea")) control.setAttribute("aria-describedby", describedBy);
  const el = h("div", { class: ["field", wide && "field--wide"], dataset: name ? { field: name } : {} },
    h(control.matches("input, select, textarea") ? "label" : "span", { class: "label", ...(control.matches("input, select, textarea") ? { for: id } : { id: `${id}-label` }) }, label, required ? h("span", { class: "req", "aria-hidden": "true" }, " *") : null),
    control,
    counter,
    hint ? h("p", { class: "hint", id: hintId }, hint) : null,
    errorEl);
  el.setError = (message) => {
    errorEl.textContent = message || "";
    errorEl.hidden = !message;
    el.classList.toggle("has-error", Boolean(message));
    if (control.matches("input, select, textarea")) control.setAttribute("aria-invalid", message ? "true" : "false");
  };
  return el;
}

export const input = (attrs = {}) => h("input", { class: "input", type: "text", ...attrs });
export const textarea = (attrs = {}) => h("textarea", { class: "textarea", ...attrs });
export function select(options, attrs = {}) {
  const el = h("select", { class: "select", ...attrs });
  for (const opt of options) {
    const [value, label] = Array.isArray(opt) ? opt : [opt, opt];
    el.append(h("option", { value }, label));
  }
  if (attrs.value !== undefined) el.value = attrs.value;
  return el;
}
export function checkbox(label, attrs = {}) {
  const id = uid("c");
  const box = h("input", { type: "checkbox", id, ...attrs });
  const el = h("label", { class: "check", for: id }, box, h("span", {}, label));
  el.input = box;
  return el;
}

/** Compteur de caractères sous un champ. */
export function charCounter(control, max, soft = max) {
  const el = h("p", { class: "counter", "aria-live": "polite" });
  const update = () => {
    const n = control.value.length;
    el.textContent = `${n} / ${soft}`;
    el.classList.toggle("is-over", n > soft);
  };
  control.addEventListener("input", update);
  update();
  el.update = update;
  return el;
}

/** Affiche les erreurs de champs { champ: message } dans un formulaire (data-field). */
export function showFieldErrors(root, fields = {}, summaryEl) {
  root.querySelectorAll(".field").forEach((f) => f.setError?.(""));
  const messages = [];
  for (const [name, message] of Object.entries(fields)) {
    if (!message) continue;
    const el = root.querySelector(`[data-field="${CSS.escape(name)}"]`);
    if (el?.setError) el.setError(message);
    messages.push(message);
  }
  if (summaryEl) {
    clear(summaryEl);
    summaryEl.hidden = !messages.length;
    if (messages.length) {
      append(summaryEl, [h("strong", {}, "Enregistrement impossible :"), h("ul", {}, messages.map((m) => h("li", {}, m)))]);
      summaryEl.setAttribute("tabindex", "-1");
      summaryEl.focus();
    }
  }
  const first = Object.keys(fields).map((n) => root.querySelector(`[data-field="${CSS.escape(n)}"]`)).find(Boolean);
  if (first && !summaryEl) first.querySelector("input, select, textarea, button")?.focus();
}

/* ---------- États ---------- */
export const loadingState = (text = "Chargement…") => h("div", { class: "state", role: "status" }, h("div", { class: "skeleton", style: { maxWidth: "320px", margin: "0 auto 12px" } }), text);
export const emptyState = (title, text, action) => h("div", { class: "state" }, h("h2", {}, title), text ? h("p", {}, text) : null, action || null);
export const errorState = (error, retry) => h("div", { class: "state state--error", role: "alert" },
  h("h2", {}, "Chargement impossible"), h("p", {}, errorMessage(error)),
  retry ? h("button", { type: "button", class: "btn", onclick: retry }, "Réessayer") : null);

export function statusBadge(status, label) {
  return h("span", { class: `badge badge--${status}` }, label || status);
}

/** Bouton occupé pendant une action asynchrone (évite les doubles clics). */
export async function busy(button, fn) {
  if (button.classList.contains("is-busy")) return undefined;
  button.classList.add("is-busy");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    return await fn();
  } finally {
    button.classList.remove("is-busy");
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

export function pagination({ page, pageSize, total, onChange }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return h("nav", { class: "pagination", "aria-label": "Pagination" },
    h("span", {}, total ? `${from}–${to} sur ${total}` : "Aucun résultat"),
    h("div", { class: "actions" },
      h("button", { type: "button", class: "btn btn--sm", disabled: page <= 1, onclick: () => onChange(page - 1) }, "← Précédent"),
      h("span", { class: "small" }, `Page ${page} / ${pages}`),
      h("button", { type: "button", class: "btn btn--sm", disabled: page >= pages, onclick: () => onChange(page + 1) }, "Suivant →")));
}

/**
 * Liste réordonnable : glisser-déposer à la souris et boutons ↑ ↓ au clavier.
 * items : tableau ; render(item, index, controls) -> élément ; onChange(nouveauTableau).
 */
export function sortableList(items, { render, onChange, className = "sortable", itemClass = "sortable__item", label = "élément" }) {
  const list = h("ul", { class: className });
  let dragIndex = null;
  const move = (from, to) => {
    if (to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next, { from, to });
  };
  items.forEach((item, index) => {
    const controls = {
      up: h("button", { type: "button", class: "btn btn--icon btn--sm btn--ghost", "aria-label": `Monter ${label} ${index + 1}`, disabled: index === 0, onclick: () => move(index, index - 1) }, icon("up")),
      down: h("button", { type: "button", class: "btn btn--icon btn--sm btn--ghost", "aria-label": `Descendre ${label} ${index + 1}`, disabled: index === items.length - 1, onclick: () => move(index, index + 1) }, icon("down")),
      grip: h("span", { class: "slot__grip", title: "Glisser pour déplacer", "aria-hidden": "true" }, icon("grip"))
    };
    const li = h("li", { class: itemClass, draggable: "true" }, render(item, index, controls));
    li.addEventListener("dragstart", (e) => {
      // Pas de glisser depuis un champ de saisie
      if (e.target.closest?.("input, textarea, select")) return e.preventDefault();
      dragIndex = index;
      li.classList.add("is-dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(index));
    });
    li.addEventListener("dragend", () => li.classList.remove("is-dragging"));
    li.addEventListener("dragover", (e) => {
      if (dragIndex === null) return;
      e.preventDefault();
      li.classList.add("is-drop-target");
    });
    li.addEventListener("dragleave", () => li.classList.remove("is-drop-target"));
    li.addEventListener("drop", (e) => {
      e.preventDefault();
      li.classList.remove("is-drop-target");
      if (dragIndex !== null) move(dragIndex, index);
      dragIndex = null;
    });
    list.append(li);
  });
  return list;
}

/** Copie dans le presse-papiers avec retour visuel. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copié dans le presse-papiers.");
  } catch {
    toast("Copie impossible : sélectionnez le texte et copiez-le à la main.", "warn");
  }
}

export function pageHead({ title, subtitle, eyebrow, breadcrumb, actions = [] }) {
  return h("header", { class: "page-head" },
    h("div", { class: "page-head__titles" },
      breadcrumb ? h("nav", { class: "breadcrumb", "aria-label": "Fil d'Ariane" }, breadcrumb.flatMap(([label, href], i) => [i ? " / " : "", href ? h("a", { href }, label) : h("span", {}, label)])) : null,
      eyebrow ? h("p", { class: "eyebrow" }, eyebrow) : null,
      h("h1", { tabindex: "-1" }, title),
      subtitle ? h("p", {}, subtitle) : null),
    actions.length ? h("div", { class: "actions" }, actions) : null);
}
