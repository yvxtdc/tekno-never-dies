/** Équipe (page « L'association ») : membres ordonnés, photo, rôle, missions, détails. */
import { h, replace, clear } from "../lib/dom.js";
import { get, post, put, del } from "../lib/api.js";
import { icon, pageHead, loadingState, errorState, emptyState, field, input, textarea, checkbox, toast, errorMessage, confirm, dialog, busy, sortableList, showFieldErrors, statusBadge } from "../lib/ui.js";
import { tagInput, linksEditor, mediaSlot } from "../lib/widgets.js";
import { isAdmin } from "../lib/session.js";
import { missionIconNode, catalogMissions, openMissionCatalog } from "../lib/mission-badges.js";

const MAX_MISSIONS = 6;

export async function teamView(ctx, main) {
  document.title = "Équipe — Administration TND";
  replace(main, loadingState());
  let members;
  try {
    members = await get("/api/team");
  } catch (error) {
    return replace(main, errorState(error, () => teamView(ctx, main)));
  }
  const listBox = h("div");
  const renderList = () => {
    clear(listBox);
    if (!members.length) return listBox.append(emptyState("Aucun membre", "Ajoutez les membres de l'équipe."));
    listBox.append(sortableList(members, {
      label: "le membre",
      onChange: async (next) => {
        const previous = members;
        members = next;
        renderList();
        try {
          members = await post("/api/team/reorder", { ids: next.map((x) => x.id) });
          toast("Ordre enregistré.");
        } catch (error) {
          members = previous;
          renderList();
          toast(errorMessage(error), "error");
        }
      },
      render: (m, i, c) => [
        h("div", { class: "row", style: { gap: "6px" } }, h("div", { class: "row", style: { gap: "2px" } }, c.grip, c.up, c.down),
          m.photo ? h("img", { class: "thumb thumb--round", src: m.photo.thumbUrl, alt: "" }) : h("span", { class: "thumb thumb--round", "aria-hidden": "true" })),
        h("div", { class: "sortable__body" }, h("div", { class: "sortable__title" }, m.name), h("div", { class: "sortable__sub" }, `${m.role}${m.tags.length ? ` · ${m.tags.join(", ")}` : ""}`), !m.published ? statusBadge("draft", "Masqué") : null),
        h("button", { type: "button", class: "btn btn--sm", onclick: () => edit(m) }, "Modifier")
      ]
    }));
  };
  const edit = (member) => {
    const isNew = !member;
    const m = member ? structuredClone(member) : { name: "", role: "", photo: null, photoMediaId: null, tags: [], extra: [{ label: "Pôle", value: "" }], bio: "", published: true };
    const name = input({ value: m.name, maxlength: 80 });
    const role = input({ value: m.role, maxlength: 100 });
    const bio = textarea({ value: m.bio, rows: 3, maxlength: 600 });
    const published = checkbox("Affiché sur la page « L'association »", { checked: m.published });
    const missions = tagInput({ values: m.tags, label: "Missions", max: MAX_MISSIONS, suggestions: catalogMissions,
      decorate: (tag) => h("span", { class: "mission-badge mission-badge--sm" }, missionIconNode(tag)),
      onChange: (v) => { m.tags = [...v]; } });
    const form = h("div", { class: "fields fields--2" },
      h("div", { class: "fields" },
        field({ label: "Nom", control: name, name: "name", required: true, hint: "Prénom(s), comme sur le site." }),
        field({ label: "Rôle", control: role, name: "role", required: true }),
        field({ label: "Missions", control: missions, name: "tags", hint: "Chaque mission devient un badge sur la carte du membre. Choisissez-les dans le catalogue, ou écrivez-en une (pictogramme choisi d'après ses mots)." }),
        h("div", {}, h("button", { type: "button", class: "btn btn--sm", onclick: () => openMissionCatalog({ selected: m.tags, max: MAX_MISSIONS, onChange: (v) => missions.setValues(v) }) }, icon("plus"), "Catalogue des badges"))),
      h("div", { class: "field", dataset: { field: "photoMediaId" } }, mediaSlot({ media: m.photo, label: "Photo", hint: "Portrait, recadré en 720 × 900.", onChange: (media) => { m.photo = media; m.photoMediaId = media?.id ?? null; } }), h("p", { class: "error-text", hidden: true })),
      field({ label: "Présentation", control: bio, name: "bio", wide: true }),
      field({ label: "Détails de la carte", control: linksEditor({ values: m.extra.map((e) => ({ label: e.label, url: e.value })), labelPlaceholder: "Intitulé (ex. Pôle)", onChange: (v) => { m.extra = v.map((x) => ({ label: x.label, value: x.url })); } }), name: "extra", wide: true, hint: "Paires « intitulé : valeur » (ex. Pôle : Technique)." }),
      h("div", { class: "field--wide" }, published));
    // Les détails ne sont pas des adresses web : champ « valeur » en texte libre.
    form.querySelectorAll('input[type="url"]').forEach((el) => { el.type = "text"; el.placeholder = "Valeur"; });
    const ok = h("button", { type: "button", class: "btn btn--primary" }, isNew ? "Ajouter" : "Enregistrer");
    const actions = [h("button", { type: "button", class: "btn", onclick: () => d.close() }, "Annuler"), ok];
    if (!isNew && isAdmin()) actions.unshift(h("button", { type: "button", class: "btn btn--danger", onclick: async () => {
      if (!(await confirm({ title: `Retirer ${m.name} de l'équipe ?`, message: "La fiche sera supprimée (la photo reste dans la médiathèque). Pour la masquer temporairement, décochez plutôt « Affiché ».", confirmLabel: "Supprimer", danger: true }))) return;
      try {
        await del(`/api/team/${m.id}`);
        members = members.filter((x) => x.id !== m.id);
        renderList();
        d.close();
        toast("Membre supprimé.");
      } catch (error) {
        toast(errorMessage(error), "error");
      }
    } }, "Supprimer"), h("span", { class: "spacer" }));
    const d = dialog({ title: isNew ? "Nouveau membre" : m.name, wide: true, body: form, actions });
    ok.addEventListener("click", () => busy(ok, async () => {
      const data = { version: m.version, name: name.value, role: role.value, photoMediaId: m.photoMediaId, tags: m.tags, extra: m.extra, bio: bio.value, published: published.input.checked };
      try {
        const saved = isNew ? await post("/api/team", data) : await put(`/api/team/${m.id}`, data);
        members = isNew ? [...members, saved] : members.map((x) => (x.id === saved.id ? saved : x));
        renderList();
        d.close();
        toast(isNew ? "Membre ajouté." : "Fiche enregistrée.");
      } catch (error) {
        if (error.status === 422) showFieldErrors(form, error.fields);
        else toast(errorMessage(error), "error");
      }
    }));
    name.focus();
  };
  replace(main,
    pageHead({ title: "Équipe", subtitle: "Membres affichés sur la page « L'association », dans cet ordre.", actions: [h("button", { type: "button", class: "btn btn--primary", onclick: () => edit(null) }, icon("plus"), "Nouveau membre")] }),
    listBox);
  renderList();
}
