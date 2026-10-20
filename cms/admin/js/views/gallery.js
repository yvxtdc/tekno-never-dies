/** Galerie : albums de photos (souvent un par soirée), ajout groupé, ordre, publication. */
import { h, replace, append, clear } from "../lib/dom.js";
import { get, post, put, del } from "../lib/api.js";
import { navigate } from "../lib/router.js";
import { icon, pageHead, loadingState, errorState, emptyState, field, input, checkbox, toast, errorMessage, confirm, busy, dialog, statusBadge } from "../lib/ui.js";
import { pickMedia, dropzone, uploadFiles } from "../lib/widgets.js";
import { createEditor } from "../lib/editor.js";
import { formatDate } from "../lib/format.js";
import { isAdmin } from "../lib/session.js";

export async function galleryListView(ctx, main) {
  document.title = "Galerie photo — Administration TND";
  replace(main, loadingState());
  let albums;
  try {
    albums = await get("/api/albums");
  } catch (error) {
    return replace(main, errorState(error, () => galleryListView(ctx, main)));
  }
  const create = () => {
    const title = input({ placeholder: "ICE BOILER v2" });
    const date = input({ type: "date" });
    const ok = h("button", { type: "button", class: "btn btn--primary" }, "Créer l'album");
    const form = h("div", { class: "fields fields--2" }, field({ label: "Titre", control: title, name: "title", required: true }), field({ label: "Date de la soirée", control: date, name: "date", required: true }));
    const d = dialog({ title: "Nouvel album", body: form, actions: [h("button", { type: "button", class: "btn", onclick: () => d.close() }, "Annuler"), ok] });
    ok.addEventListener("click", () => busy(ok, async () => {
      try {
        const album = await post("/api/albums", { title: title.value, date: date.value });
        d.close();
        navigate(`/admin/gallery/${album.id}`);
      } catch (error) {
        if (error.status === 422) Object.entries(error.fields).forEach(([k, v]) => form.querySelector(`[data-field="${k}"]`)?.setError(v));
        else toast(errorMessage(error), "error");
      }
    }));
    title.focus();
  };
  replace(main,
    pageHead({ title: "Galerie photo", subtitle: "Les albums publiés apparaissent sur la page Galerie, classés par année.", actions: [h("button", { type: "button", class: "btn btn--primary", onclick: create }, icon("plus"), "Nouvel album")] }),
    albums.length
      ? h("div", { class: "cards" }, albums.map((a) => h("a", { class: "entity-card", href: `/admin/gallery/${a.id}` },
          a.coverUrl ? h("img", { class: "entity-card__img", src: a.coverUrl, alt: "", loading: "lazy" }) : h("div", { class: "entity-card__img", "aria-hidden": "true" }),
          h("div", { class: "entity-card__body" }, h("span", { class: "entity-card__title" }, a.title), h("span", { class: "small muted" }, `${formatDate(a.date)} · ${a.photoCount} photo(s)`), a.published ? statusBadge("published", "Publié") : statusBadge("draft", "Non publié")))))
      : emptyState("Aucun album", "Créez un album pour la dernière soirée et ajoutez-y les photos.", h("button", { type: "button", class: "btn btn--primary", onclick: create }, icon("plus"), "Nouvel album")));
}

export async function albumView(ctx, main) {
  replace(main, loadingState());
  let album;
  try {
    album = await get(`/api/albums/${Number(ctx.params.id)}`);
  } catch (error) {
    return replace(main, errorState(error, () => albumView(ctx, main)));
  }
  document.title = `${album.title} — Galerie — Administration TND`;
  const m = { version: album.version, title: album.title, slug: album.slug, date: album.date, published: album.published };
  const ed = createEditor({
    model: m,
    onSave: async (data) => {
      const saved = await put(`/api/albums/${album.id}`, data);
      m.version = saved.version;
      toast("Album enregistré.");
      return saved;
    }
  });
  let photos = album.photos.map((p) => p.media);
  const grid = h("div");
  const uploads = h("div", { class: "uploads" });
  const savePhotos = async (next, message) => {
    try {
      const saved = await put(`/api/albums/${album.id}/photos`, { mediaIds: next.map((p) => p.id) });
      photos = saved.photos.map((p) => p.media);
      m.version = saved.version;
      ed.markSaved();
      renderGrid();
      if (message) toast(message);
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  };
  let dragFrom = null;
  const renderGrid = () => {
    clear(grid);
    if (!photos.length) return grid.append(emptyState("Album vide", "Importez des photos ou choisissez-les dans la médiathèque."));
    const list = h("ul", { class: "photo-grid", style: { listStyle: "none", padding: 0, margin: 0 } });
    photos.forEach((p, i) => {
      const li = h("li", { class: "photo-tile", draggable: "true" },
        h("img", { src: p.thumbUrl, alt: p.alt || `Photo ${i + 1}`, loading: "lazy" }),
        h("div", { class: "photo-tile__tools" },
          h("button", { type: "button", class: "btn btn--icon btn--sm", "aria-label": `Avancer la photo ${i + 1}`, disabled: i === 0, onclick: () => { const n = [...photos]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; savePhotos(n); } }, icon("up")),
          h("button", { type: "button", class: "btn btn--icon btn--sm", "aria-label": `Retirer la photo ${i + 1} de l'album`, onclick: async () => { if (await confirm({ title: "Retirer la photo ?", message: "Elle reste dans la médiathèque.", confirmLabel: "Retirer" })) savePhotos(photos.filter((_, j) => j !== i), "Photo retirée de l'album."); } }, icon("trash")),
          h("button", { type: "button", class: "btn btn--icon btn--sm", "aria-label": `Reculer la photo ${i + 1}`, disabled: i === photos.length - 1, onclick: () => { const n = [...photos]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; savePhotos(n); } }, icon("down"))));
      li.addEventListener("dragstart", (e) => { dragFrom = i; li.classList.add("is-dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); });
      li.addEventListener("dragend", () => li.classList.remove("is-dragging"));
      li.addEventListener("dragover", (e) => { if (dragFrom !== null) { e.preventDefault(); li.classList.add("is-drop-target"); } });
      li.addEventListener("dragleave", () => li.classList.remove("is-drop-target"));
      li.addEventListener("drop", (e) => {
        e.preventDefault();
        li.classList.remove("is-drop-target");
        if (dragFrom === null || dragFrom === i) return;
        const n = [...photos];
        const [x] = n.splice(dragFrom, 1);
        n.splice(i, 0, x);
        dragFrom = null;
        savePhotos(n);
      });
      list.append(li);
    });
    grid.append(h("p", { class: "small muted" }, `${photos.length} photo(s). Glissez les photos pour changer l'ordre (ou utilisez les flèches).`), list);
  };
  const addPhotos = (media) => {
    const known = new Set(photos.map((p) => p.id));
    const fresh = media.filter((x) => !known.has(x.id));
    if (fresh.length) savePhotos([...photos, ...fresh], `${fresh.length} photo(s) ajoutée(s).`);
  };
  const published = checkbox("Album publié (visible sur la page Galerie après la mise en ligne)", { checked: m.published });
  ed.bind("published", published.input);
  append(ed.form, [ed.errors,
    h("section", { class: "card" }, h("div", { class: "fields fields--3" },
      field({ label: "Titre", control: ed.bind("title", input({ value: m.title, maxlength: 120 })), name: "title", required: true }),
      field({ label: "Date", control: ed.bind("date", input({ type: "date", value: m.date })), name: "date", required: true }),
      field({ label: "Identifiant (ancre galerie.html#…)", control: ed.bind("slug", input({ value: m.slug, maxlength: 80 })), name: "slug" }),
      h("div", { class: "field--wide" }, published),
      album.events.length ? h("p", { class: "hint field--wide" }, "Lié aux soirées : ", album.events.map((e, i) => [i ? ", " : "", h("a", { href: `/admin/events/${e.id}` }, e.title)])) : h("p", { class: "hint field--wide" }, "Pour afficher « Voir les photos » sur une fiche, choisissez cet album dans la soirée."))),
    ed.bar]);
  replace(main,
    pageHead({ title: album.title, breadcrumb: [["Galerie photo", "/admin/gallery"], [album.title]],
      actions: [
        h("button", { type: "button", class: "btn", onclick: async () => { const picked = await pickMedia({ title: "Ajouter des photos", multiple: true }); if (picked?.length) addPhotos(picked); } }, icon("image"), "Depuis la médiathèque"),
        isAdmin() ? h("button", { type: "button", class: "btn btn--danger", onclick: async () => {
          if (!(await confirm({ title: "Supprimer l'album ?", message: "Les photos restent dans la médiathèque. L'album disparaîtra de la galerie à la prochaine mise en ligne.", confirmLabel: "Supprimer l'album", danger: true }))) return;
          try { await del(`/api/albums/${album.id}`); toast("Album supprimé."); navigate("/admin/gallery", { force: true }); } catch (error) { toast(errorMessage(error), "error"); }
        } }, icon("trash"), "Supprimer") : null
      ].filter(Boolean) }),
    ed.form,
    h("section", { class: "card", style: { marginTop: "16px" } }, h("div", { class: "card__head" }, h("h2", {}, "Photos")),
      dropzone({ onFiles: async (files) => addPhotos(await uploadFiles(files, uploads)), label: "Glissez les photos de la soirée ici ou" }), uploads,
      h("div", { style: { marginTop: "16px" } }, grid)));
  renderGrid();
  ed.touch();
  return { isDirty: ed.isDirty };
}
