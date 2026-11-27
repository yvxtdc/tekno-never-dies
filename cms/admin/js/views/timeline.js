/**
 * « Notre histoire » (page L'association) : étapes clés de l'association, triées par date. Sur le site,
 * elles s'intercalent par année avec les chapitres des soirées, ajoutés automatiquement
 * (js/pages/association.js). Service : server/services/timeline.mjs.
 */
import { h, replace, clear } from "../lib/dom.js";
import { get, post, put, del } from "../lib/api.js";
import { icon, pageHead, loadingState, errorState, emptyState, field, input, textarea, select, checkbox, toast, errorMessage, confirm, dialog, busy, showFieldErrors, statusBadge } from "../lib/ui.js";
import { mediaSlot } from "../lib/widgets.js";
import { can } from "../lib/session.js";

const PRECISIONS = [["day", "Jour précis (4 décembre 2024)"], ["month", "Mois (juin 2023)"], ["year", "Année (2023)"]];
const VISUALS = [["decor", "Étincelles"], ["badge", "Logo de l'association"], ["photo", "Photo de la médiathèque"]];
const FORMATS = { day: { day: "numeric", month: "long", year: "numeric" }, month: { month: "long", year: "numeric" }, year: { year: "numeric" } };
/** Date telle qu'affichée sur le site. */
const dateLabel = (it) => new Intl.DateTimeFormat("fr-FR", { ...FORMATS[it.datePrecision] || FORMATS.day, timeZone: "UTC" }).format(new Date(`${it.date}T12:00:00Z`));

export async function timelineView(ctx, main) {
  document.title = "Notre histoire — Administration TND";
  replace(main, loadingState());
  let items;
  try {
    items = await get("/api/timeline");
  } catch (error) {
    return replace(main, errorState(error, () => timelineView(ctx, main)));
  }
  const listBox = h("div");
  const renderList = () => {
    clear(listBox);
    if (!items.length) return listBox.append(emptyState("Aucune étape", "Ajoutez les grandes étapes de l'association (création, premier sound system…)."));
    listBox.append(h("ul", { class: "sortable" }, items.map((it) => h("li", { class: "sortable__item", id: String(it.id) },
      it.media ? h("img", { class: "thumb", src: it.media.thumbUrl, alt: "" }) : h("span", { class: "thumb", "aria-hidden": "true" }),
      h("div", { class: "sortable__body" },
        h("div", { class: "sortable__title" }, it.title),
        h("div", { class: "sortable__sub" }, `${dateLabel(it)} · ${VISUALS.find(([v]) => v === it.visual)?.[1] || it.visual}${it.text ? ` · ${it.text}` : ""}`),
        !it.published ? h("div", { class: "row", style: { marginTop: "4px" } }, statusBadge("draft", "Masquée")) : null),
      h("button", { type: "button", class: "btn btn--sm", onclick: () => edit(it) }, "Modifier")))));
  };
  const reload = async () => {
    items = await get("/api/timeline");
    renderList();
  };

  const edit = (item) => {
    const isNew = !item;
    const it = item ? structuredClone(item) : { date: "", datePrecision: "day", title: "", text: "", visual: "decor", mediaId: null, media: null, published: true };
    const date = input({ type: "date", value: it.date, required: true });
    const precision = select(PRECISIONS, { value: it.datePrecision });
    const title = input({ value: it.title, maxlength: 80, required: true });
    const text = textarea({ value: it.text, rows: 3, maxlength: 300 });
    const visual = select(VISUALS, { value: it.visual });
    const published = checkbox("Affichée sur la page « L'association »", { checked: it.published });
    const photo = h("div", { class: "field", dataset: { field: "mediaId" } },
      mediaSlot({ media: it.media, label: "Photo", hint: "Portrait de préférence (cadrée en 4:5 comme les affiches).", onChange: (media) => { it.media = media; it.mediaId = media?.id ?? null; } }),
      h("p", { class: "error-text", hidden: true }));
    const syncPhoto = () => { photo.hidden = visual.value !== "photo"; };
    visual.addEventListener("change", syncPhoto);
    syncPhoto();
    const form = h("div", { class: "fields fields--2" },
      field({ label: "Date", control: date, name: "date", required: true }),
      field({ label: "Afficher", control: precision, name: "datePrecision", hint: "Mois ou année : seule cette partie de la date s'affiche." }),
      field({ label: "Titre", control: title, name: "title", required: true, wide: true, hint: "Court : « L'association est créée »." }),
      field({ label: "Texte", control: text, name: "text", wide: true, hint: "Une ou deux phrases. Titre et texte se traduisent dans Traductions." }),
      field({ label: "Illustration", control: visual, name: "visual" }),
      photo,
      h("div", { class: "field--wide" }, published));
    const ok = h("button", { type: "button", class: "btn btn--primary" }, isNew ? "Ajouter" : "Enregistrer");
    const actions = [h("button", { type: "button", class: "btn", onclick: () => d.close() }, "Annuler"), ok];
    if (!isNew && can("content.delete")) actions.unshift(h("button", { type: "button", class: "btn btn--danger", onclick: async () => {
      if (!(await confirm({ title: `Supprimer « ${it.title} » ?`, message: "L'étape disparaîtra de la page à la prochaine mise en ligne. Pour la masquer seulement, décochez plutôt « Affichée ».", confirmLabel: "Supprimer", danger: true }))) return;
      try {
        await del(`/api/timeline/${it.id}`);
        d.close();
        toast("Étape supprimée.");
        await reload();
      } catch (error) {
        toast(errorMessage(error), "error");
      }
    } }, "Supprimer"), h("span", { class: "spacer" }));
    const d = dialog({ title: isNew ? "Nouvelle étape" : it.title, wide: true, body: form, actions });
    ok.addEventListener("click", () => busy(ok, async () => {
      const data = { version: it.version, date: date.value, datePrecision: precision.value, title: title.value, text: text.value, visual: visual.value, mediaId: visual.value === "photo" ? it.mediaId : null, published: published.input.checked };
      try {
        if (isNew) await post("/api/timeline", data);
        else await put(`/api/timeline/${it.id}`, data);
        d.close();
        toast(isNew ? "Étape ajoutée." : "Étape enregistrée.");
        await reload();
      } catch (error) {
        if (error.status === 422) showFieldErrors(form, error.fields);
        else toast(errorMessage(error), "error");
      }
    }));
    date.focus();
  };

  replace(main,
    pageHead({ title: "Notre histoire", subtitle: "Étapes clés de l'association, page « L'association ». Les années de soirées s'ajoutent toutes seules, avec leurs affiches.", actions: [h("button", { type: "button", class: "btn btn--primary", onclick: () => edit(null) }, icon("plus"), "Nouvelle étape")] }),
    listBox);
  renderList();
}
