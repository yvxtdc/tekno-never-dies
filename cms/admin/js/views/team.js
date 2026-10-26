/** Équipe (page « L'association ») : membres ordonnés, photo, rôle, missions, détails. */
import { h, replace, clear } from "../lib/dom.js";
import { get, post, put, del } from "../lib/api.js";
import { icon, pageHead, loadingState, errorState, emptyState, field, input, textarea, checkbox, toast, errorMessage, confirm, dialog, busy, sortableList, showFieldErrors, statusBadge } from "../lib/ui.js";
import { tagInput, linksEditor, mediaSlot } from "../lib/widgets.js";
import { isAdmin, can } from "../lib/session.js";
import { scheduleChangesDialog, scheduledCounts, formatLocal, changeBadge } from "../lib/schedule.js";
import { missionIconNode, catalogMissions, openMissionCatalog } from "../lib/mission-badges.js";

const MAX_MISSIONS = 6;

export async function teamView(ctx, main) {
  document.title = "Équipe — Administration TND";
  replace(main, loadingState());
  let members;
  let scheduled = new Map();
  try {
    [members, scheduled] = await Promise.all([get("/api/team"), scheduledCounts("team")]);
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
        h("div", { class: "sortable__body" }, h("div", { class: "sortable__title" }, m.name), h("div", { class: "sortable__sub" }, `${m.role}${m.tags.length ? ` · ${m.tags.join(", ")}` : ""}`),
          h("div", { class: "row", style: { marginTop: "4px" } }, !m.published ? statusBadge("draft", "Masqué") : null, scheduled.get(m.id) ? h("a", { href: "/admin/schedule?type=team&status=all", title: scheduled.get(m.id).summary }, changeBadge(scheduled.get(m.id))) : null)),
        h("button", { type: "button", class: "btn btn--sm", onclick: () => edit(m) }, "Modifier")
      ]
    }));
  };
  /** predicted : état prévu à une date (le dialogue sert alors seulement à programmer). */
  const edit = (member, predicted = null) => {
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
    const ok = h("button", { type: "button", class: "btn btn--primary", hidden: Boolean(predicted) }, isNew ? "Ajouter" : "Enregistrer");
    const formData = () => ({ version: m.version, name: name.value, role: role.value, photoMediaId: m.photoMediaId, tags: m.tags, extra: m.extra, bio: bio.value, published: published.input.checked });
    const reload = async () => {
      [members, scheduled] = await Promise.all([get("/api/team"), scheduledCounts("team")]);
      renderList();
    };
    // Programmer : modification d'un membre existant, ou affichage d'un nouveau membre (créé masqué).
    const schedule = h("button", { type: "button", class: `btn ${predicted ? "btn--primary" : ""}`, hidden: !can("content.publish"), onclick: () => busy(schedule, async () => {
      let target = m;
      let data = formData();
      if (isNew) {
        try {
          target = await post("/api/team", { ...data, published: false });
        } catch (error) {
          if (error.status === 422) showFieldErrors(form, error.fields);
          else toast(errorMessage(error), "error");
          return;
        }
        data = { ...data, version: target.version, published: true };
        toast("Membre ajouté, masqué jusqu'à la date programmée.");
        await reload();
      }
      d.close();
      scheduleChangesDialog({
        type: "team", id: target.id, input: data,
        basis: predicted ? predicted.basis : { mode: "current", version: target.version },
        runAtLocal: predicted ? predicted.atLocal : null,
        title: isNew ? `Programmer l'affichage de ${target.name}` : `Programmer : ${target.name}`,
        onPredict: async (local) => {
          const p = await get(`/api/schedule/predict/team/${target.id}?at=${encodeURIComponent(local)}`);
          edit(p.entity, p);
        },
        onDone: reload
      });
    }) }, icon("clock"), predicted ? "Programmer ces modifications" : isNew ? "Ajouter masqué et programmer l'affichage…" : "Programmer…");
    const actions = [h("button", { type: "button", class: "btn", onclick: () => d.close() }, "Annuler"), schedule, ok];
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
    if (predicted) form.prepend(h("p", { class: "card card--accent small", style: { gridColumn: "1 / -1" } }, `État prévu le ${formatLocal(predicted.atLocal)} : modifiez puis « Programmer ces modifications ». Rien n'est enregistré avant.`));
    const d = dialog({ title: isNew ? "Nouveau membre" : m.name, wide: true, body: form, actions });
    ok.addEventListener("click", () => busy(ok, async () => {
      const data = formData();
      try {
        const saved = isNew ? await post("/api/team", data) : await put(`/api/team/${m.id}`, data);
        members = isNew ? [...members, saved] : members.map((x) => (x.id === saved.id ? saved : x));
        renderList();
        d.close();
        toast(isNew ? "Membre ajouté." : "Fiche enregistrée.");
        if (saved.mergedFields?.length) toast(`Modifié entre-temps et conservé : ${saved.mergedFields.join(", ")}.`, "warn", { timeout: 12000 });
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
