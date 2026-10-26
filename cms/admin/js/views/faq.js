/** FAQ : questions ordonnées, catégories, réponses en texte enrichi sûr avec aperçu. */
import { h, replace, clear } from "../lib/dom.js";
import { get, post, put, del } from "../lib/api.js";
import { icon, pageHead, loadingState, errorState, emptyState, field, input, textarea, select, checkbox, toast, errorMessage, confirm, dialog, busy, sortableList, showFieldErrors, statusBadge } from "../lib/ui.js";
import { richTextToHtml, richTextToPlain, richTextProblems } from "/admin/shared/richtext.mjs";
import { can, isAdmin } from "../lib/session.js";
import { scheduleChangesDialog, scheduledCounts, formatLocal, changeBadge } from "../lib/schedule.js";

/** Champ de texte enrichi : barre (gras, italique, lien) et aperçu du rendu sur le site. */
export function richTextField({ value = "", label, name, rows = 5 }) {
  const area = textarea({ value, rows, maxlength: 2000 });
  const preview = h("div", { class: "rte__preview", "aria-live": "polite" });
  const update = () => {
    // Le convertisseur échappe tout le texte : seules les balises <a>, <strong>, <em>, <br> sont produites.
    const html = richTextToHtml(area.value);
    preview.innerHTML = html || "<em>Aperçu de la réponse…</em>";
    const problems = richTextProblems(area.value);
    if (problems.length) preview.append(Object.assign(document.createElement("p"), { className: "error-text", textContent: problems.join(" ") }));
  };
  const wrap = (before, after = before, placeholder = "texte") => {
    const { selectionStart: s, selectionEnd: e, value: v } = area;
    const selected = v.slice(s, e) || placeholder;
    area.setRangeText(`${before}${selected}${after}`, s, e, "select");
    area.focus();
    update();
    area.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const link = () => {
    const url = prompt("Adresse du lien (https://… ou page du site, ex. contact.html) :", "https://");
    if (url) wrap("[", `](${url.trim()})`, "texte du lien");
  };
  area.addEventListener("input", update);
  update();
  const bar = h("div", { class: "rte__bar", role: "toolbar", "aria-label": "Mise en forme" },
    h("button", { type: "button", class: "btn btn--sm", onclick: () => wrap("**"), title: "Gras" }, h("strong", {}, "G"), h("span", { class: "sr-only" }, "Gras")),
    h("button", { type: "button", class: "btn btn--sm", onclick: () => wrap("*"), title: "Italique" }, h("em", {}, "I"), h("span", { class: "sr-only" }, "Italique")),
    h("button", { type: "button", class: "btn btn--sm", onclick: link }, icon("link"), "Lien"));
  const f = field({ label, control: area, name, hint: "**gras**, *italique*, [texte du lien](adresse). Aucun autre code n'est accepté." });
  f.insertBefore(bar, area);
  f.append(h("p", { class: "label small", style: { fontWeight: 700 } }, "Aperçu"), preview);
  f.area = area;
  return f;
}

export async function faqView(ctx, main) {
  document.title = "FAQ — Administration TND";
  replace(main, loadingState());
  let items, meta;
  let scheduled = new Map();
  try {
    [items, meta, scheduled] = await Promise.all([get("/api/faq"), get("/api/meta"), scheduledCounts("faq")]);
  } catch (error) {
    return replace(main, errorState(error, () => faqView(ctx, main)));
  }
  const listBox = h("div");
  const renderList = () => {
    clear(listBox);
    if (!items.length) return listBox.append(emptyState("Aucune question", "Ajoutez la première question fréquente."));
    listBox.append(sortableList(items, {
      label: "la question",
      onChange: async (next) => {
        const previous = items;
        items = next;
        renderList();
        try {
          items = await post("/api/faq/reorder", { ids: next.map((x) => x.id) });
          toast("Ordre enregistré.");
        } catch (error) {
          items = previous;
          renderList();
          toast(errorMessage(error), "error");
        }
      },
      render: (item, i, c) => [
        h("div", { class: "row", style: { gap: "2px" } }, c.grip, c.up, c.down),
        h("div", { class: "sortable__body" },
          h("div", { class: "sortable__title" }, item.question),
          h("div", { class: "sortable__sub" }, `${item.category} · ${richTextToPlain(item.answer)}`),
          h("div", { class: "row", style: { marginTop: "4px" } }, !item.published ? statusBadge("draft", "Masquée") : null, item.needsValidation ? statusBadge("scheduled", "À faire valider") : null,
            scheduled.get(item.id) ? h("a", { href: "/admin/schedule?type=faq&status=all", title: scheduled.get(item.id).summary }, changeBadge(scheduled.get(item.id))) : null)),
        h("div", { class: "actions" }, h("button", { type: "button", class: "btn btn--sm", onclick: () => edit(item) }, "Modifier"))
      ]
    }));
  };
  /** predicted : état prévu à une date (le dialogue sert alors seulement à programmer). */
  const edit = (item, predicted = null) => {
    const isNew = !item;
    const q = input({ value: item?.question || "", maxlength: 200 });
    const category = select([...new Set([...meta.faqCategories, ...items.map((x) => x.category)])], { value: item?.category || meta.faqCategories[0] });
    const answer = richTextField({ value: item?.answer || "", label: "Réponse", name: "answer" });
    const published = checkbox("Affichée sur le site", { checked: item ? item.published : true });
    const needs = checkbox("À faire valider par l'équipe (signalé par npm run validate)", { checked: item?.needsValidation });
    const form = h("div", { class: "stack" }, field({ label: "Question", control: q, name: "question", required: true }), field({ label: "Catégorie", control: category, name: "category" }), answer, published, needs);
    const ok = h("button", { type: "button", class: "btn btn--primary", hidden: Boolean(predicted) }, isNew ? "Ajouter" : "Enregistrer");
    const formData = () => ({ question: q.value, category: category.value, answer: answer.area.value, published: published.input.checked, needsValidation: needs.input.checked, version: item?.version });
    const reload = async () => {
      [items, scheduled] = await Promise.all([get("/api/faq"), scheduledCounts("faq")]);
      renderList();
    };
    // Programmer : modification d'une question existante, ou affichage d'une nouvelle question (créée masquée).
    const schedule = h("button", { type: "button", class: `btn ${predicted ? "btn--primary" : ""}`, hidden: !can("content.publish"), onclick: () => busy(schedule, async () => {
      let target = item;
      let data = formData();
      if (isNew) {
        try {
          target = await post("/api/faq", { ...data, published: false });
        } catch (error) {
          if (error.status === 422) showFieldErrors(form, error.fields);
          else toast(errorMessage(error), "error");
          return;
        }
        data = { ...data, version: target.version, published: true };
        toast("Question ajoutée, masquée jusqu'à la date programmée.");
        await reload();
      }
      d.close();
      scheduleChangesDialog({
        type: "faq", id: target.id, input: data,
        basis: predicted ? predicted.basis : { mode: "current", version: target.version },
        runAtLocal: predicted ? predicted.atLocal : null,
        title: isNew ? "Programmer l'affichage de la question" : "Programmer la modification de la question",
        onPredict: async (local) => {
          const p = await get(`/api/schedule/predict/faq/${target.id}?at=${encodeURIComponent(local)}`);
          edit(p.entity, p);
        },
        onDone: reload
      });
    }) }, icon("clock"), predicted ? "Programmer ces modifications" : isNew ? "Ajouter masquée et programmer l'affichage…" : "Programmer…");
    const actions = [h("button", { type: "button", class: "btn", onclick: () => d.close() }, "Annuler"), schedule, ok];
    if (!isNew && isAdmin()) actions.unshift(h("button", { type: "button", class: "btn btn--danger", onclick: async () => {
      if (!(await confirm({ title: "Supprimer la question ?", message: item.question, confirmLabel: "Supprimer", danger: true }))) return;
      try {
        await del(`/api/faq/${item.id}`);
        items = items.filter((x) => x.id !== item.id);
        renderList();
        d.close();
        toast("Question supprimée.");
      } catch (error) {
        toast(errorMessage(error), "error");
      }
    } }, "Supprimer"), h("span", { class: "spacer" }));
    if (predicted) form.prepend(h("p", { class: "card card--accent small" }, `État prévu le ${formatLocal(predicted.atLocal)} : modifiez puis « Programmer ces modifications ». Rien n'est enregistré avant.`));
    const initial = JSON.stringify([q.value, category.value, answer.area.value, published.input.checked, needs.input.checked]);
    const d = dialog({
      title: isNew ? "Nouvelle question" : "Modifier la question", wide: true, body: form, actions,
      onClose: () => {}
    });
    d.el.addEventListener("cancel", async (e) => {
      if (JSON.stringify([q.value, category.value, answer.area.value, published.input.checked, needs.input.checked]) !== initial) {
        e.preventDefault();
        if (await confirm({ title: "Fermer sans enregistrer ?", message: "Vos modifications seront perdues.", confirmLabel: "Fermer", danger: true })) d.close();
      }
    });
    ok.addEventListener("click", () => busy(ok, async () => {
      const data = formData();
      try {
        const saved = isNew ? await post("/api/faq", data) : await put(`/api/faq/${item.id}`, data);
        items = isNew ? [...items, saved] : items.map((x) => (x.id === saved.id ? saved : x));
        renderList();
        d.close();
        toast(isNew ? "Question ajoutée." : "Question enregistrée.");
        if (saved.mergedFields?.length) toast(`Modifié entre-temps et conservé : ${saved.mergedFields.join(", ")}.`, "warn", { timeout: 12000 });
      } catch (error) {
        if (error.status === 422) showFieldErrors(form, error.fields);
        else toast(errorMessage(error), "error");
      }
    }));
    q.focus();
  };
  replace(main,
    pageHead({ title: "FAQ", subtitle: "Questions fréquentes de la page FAQ. Glissez-les pour changer l'ordre.", actions: can("content.write") ? [h("button", { type: "button", class: "btn btn--primary", onclick: () => edit(null) }, icon("plus"), "Nouvelle question")] : [] }),
    listBox);
  renderList();
}
