/** Médiathèque : import, recherche, filtres, texte alternatif, usages, remplacement, suppression. */
import { h, replace, debounce } from "../lib/dom.js";
import { get, put, del, upload, qs } from "../lib/api.js";
import { icon, pageHead, loadingState, errorState, emptyState, field, input, select, toast, errorMessage, confirm, dialog, busy } from "../lib/ui.js";
import { dropzone, uploadFiles } from "../lib/widgets.js";
import { fileSize, formatDateTime } from "../lib/format.js";
import { can } from "../lib/session.js";

const USAGE_LINKS = { event: "/admin/events/", artist: "/admin/artists/", team: "/admin/team#", album: "/admin/gallery/" };

export async function mediaView(ctx, main) {
  document.title = "Médiathèque — Administration TND";
  const state = { q: "", usage: ctx.query.get("usage") || "", storage: "", sort: "recent", page: 1 };
  const grid = h("div", { "aria-live": "polite" });
  const uploads = h("div", { class: "uploads" });
  const load = async () => {
    replace(grid, loadingState());
    try {
      const data = await get(`/api/media${qs({ ...state, pageSize: 60 })}`);
      if (!data.items.length) return replace(grid, emptyState("Aucune image", state.q || state.usage ? "Aucune image ne correspond aux filtres." : "Glissez vos affiches et photos dans la zone ci-dessus."));
      const tiles = h("div", { class: "media-grid" }, data.items.map((m) => h("button", { type: "button", class: "media-tile", onclick: () => openDetail(m.id, load), "aria-label": `${m.originalName}${m.alt ? ` — ${m.alt}` : ""}` },
        h("img", { src: m.thumbUrl, alt: "", loading: "lazy" }),
        h("span", { class: "media-tile__flags" }, !m.usageCount ? h("span", {}, "Inutilisée") : null, !m.alt && m.storage === "upload" ? h("span", {}, "Sans alt") : null),
        h("span", { class: "media-tile__meta" }, h("span", { class: "media-tile__name" }, m.originalName), h("span", { class: "muted" }, `${m.width} × ${m.height} · ${fileSize(m.size)}${m.usageCount ? ` · ${m.usageCount} usage(s)` : ""}`)))));
      const pages = Math.ceil(data.total / data.pageSize);
      replace(grid, h("p", { class: "small muted" }, `${data.total} image(s)`), tiles,
        pages > 1 ? h("div", { class: "pagination" }, h("span", {}, `Page ${data.page} / ${pages}`), h("div", { class: "actions" },
          h("button", { type: "button", class: "btn btn--sm", disabled: data.page <= 1, onclick: () => { state.page--; load(); } }, "← Précédent"),
          h("button", { type: "button", class: "btn btn--sm", disabled: data.page >= pages, onclick: () => { state.page++; load(); } }, "Suivant →"))) : null);
    } catch (error) {
      replace(grid, errorState(error, load));
    }
  };
  const zone = can("media.write") ? dropzone({ onFiles: async (files) => { const created = await uploadFiles(files, uploads); if (created.length) { toast(`${created.length} image(s) importée(s).`); state.page = 1; load(); } } }) : null;
  replace(main,
    pageHead({ title: "Médiathèque", subtitle: "Affiches, photos de soirées, portraits : importées une fois, réutilisées partout." }),
    zone, uploads,
    h("div", { class: "toolbar", style: { marginTop: "16px" } },
      h("div", { class: "search" }, icon("search"), input({ type: "search", placeholder: "Rechercher (nom, texte alternatif)…", "aria-label": "Rechercher une image", oninput: debounce((e) => { state.q = e.target.value.trim(); state.page = 1; load(); }, 250) })),
      select([["", "Toutes"], ["used", "Utilisées"], ["unused", "Inutilisées"], ["noalt", "Sans texte alternatif"]], { value: state.usage, "aria-label": "Filtrer", onchange: (e) => { state.usage = e.target.value; state.page = 1; load(); } }),
      select([["", "Toutes origines"], ["upload", "Importées dans le CMS"], ["repo", "Déjà sur le site"]], { "aria-label": "Origine", onchange: (e) => { state.storage = e.target.value; state.page = 1; load(); } }),
      select([["recent", "Plus récentes"], ["oldest", "Plus anciennes"], ["name", "Nom"], ["size", "Taille"]], { "aria-label": "Trier", onchange: (e) => { state.sort = e.target.value; load(); } })),
    grid);
  load();
}

async function openDetail(id, onChange) {
  let m;
  try {
    m = await get(`/api/media/${id}`);
  } catch (error) {
    return toast(errorMessage(error), "error");
  }
  const alt = input({ value: m.alt, maxlength: 300, placeholder: "Ce que montre l'image (pour les lecteurs d'écran et le référencement)" });
  const credit = input({ value: m.credit, maxlength: 120, placeholder: "Photo : …" });
  const name = input({ value: m.originalName, maxlength: 120 });
  const img = h("img", { class: "media-detail__img", src: m.previewUrl, alt: m.alt || "" });
  const usage = h("div");
  const renderUsage = () => replace(usage, m.usage.length
    ? h("ul", { class: "activity" }, m.usage.map((u) => h("li", {}, h("a", { href: `${USAGE_LINKS[u.type] || "#"}${u.id}` }, u.label), h("span", { class: "small muted" }, u.role))))
    : h("p", { class: "muted" }, "Utilisée nulle part."));
  renderUsage();
  const save = h("button", { type: "button", class: "btn btn--primary" }, "Enregistrer");
  save.addEventListener("click", () => busy(save, async () => {
    try {
      m = await put(`/api/media/${m.id}`, { alt: alt.value, credit: credit.value, originalName: name.value });
      toast("Informations de l'image enregistrées.");
      onChange();
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }));
  const replaceInput = h("input", { type: "file", accept: "image/*", class: "sr-only" });
  replaceInput.addEventListener("change", async () => {
    const file = replaceInput.files[0];
    replaceInput.value = "";
    if (!file) return;
    if (m.usage.length && !(await confirm({ title: "Remplacer l'image ?", message: `La nouvelle image remplacera celle-ci partout où elle est utilisée (${m.usage.length} usage(s)), à la prochaine mise en ligne.`, confirmLabel: "Remplacer" }))) return;
    try {
      m = await upload(`/api/media/${m.id}/file`, file, { method: "PUT" });
      img.src = m.previewUrl;
      renderUsage();
      toast("Image remplacée.");
      onChange();
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  });
  const remove = h("button", { type: "button", class: "btn btn--danger", disabled: m.usage.length > 0, title: m.usage.length ? "Retirez-la d'abord des fiches qui l'utilisent" : "" }, icon("trash"), "Supprimer");
  remove.addEventListener("click", async () => {
    if (!(await confirm({ title: "Supprimer l'image ?", message: "Elle sera retirée de la médiathèque et du site à la prochaine mise en ligne. Action irréversible.", confirmLabel: "Supprimer", danger: true }))) return;
    try {
      await del(`/api/media/${m.id}`);
      d.close();
      toast("Image supprimée.");
      onChange();
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  });
  const d = dialog({
    title: m.originalName,
    wide: true,
    body: h("div", { class: "media-detail" },
      h("div", {}, img, h("p", { class: "small muted", style: { marginTop: "8px" } }, `${m.width} × ${m.height} px · ${fileSize(m.size)} · ${m.mime} · ${m.storage === "repo" ? `déjà sur le site (${m.repoPath})` : "importée dans le CMS"} · ajoutée le ${formatDateTime(m.createdAt)}`)),
      h("div", { class: "stack" },
        field({ label: "Texte alternatif", control: alt, hint: "Décrivez l'image en une phrase. Laissez vide pour une image décorative." }),
        field({ label: "Crédit", control: credit }),
        field({ label: "Nom", control: name }),
        h("h3", {}, "Utilisée dans"), usage,
        m.usage.length ? h("p", { class: "hint" }, "Une image utilisée ne peut pas être supprimée : remplacez-la ou retirez-la des fiches.") : null)),
    actions: [
      can("media.delete") ? remove : null,
      can("media.write") ? h("button", { type: "button", class: "btn", onclick: () => replaceInput.click() }, "Remplacer le fichier…") : null,
      replaceInput,
      h("span", { class: "spacer" }),
      h("button", { type: "button", class: "btn", onclick: () => d.close() }, "Fermer"),
      can("media.write") ? save : null
    ].filter(Boolean)
  });
}
