/** Artistes : fiches réutilisables (photo, styles, liens), soirées où ils jouent, doublons, fusion. */
import { h, replace, append, debounce } from "../lib/dom.js";
import { get, post, put, del, qs } from "../lib/api.js";
import { navigate } from "../lib/router.js";
import { icon, pageHead, loadingState, errorState, emptyState, statusBadge, pagination, field, input, textarea, select, checkbox, toast, errorMessage, confirm, dialog, busy } from "../lib/ui.js";
import { mediaSlot, linksEditor, combobox } from "../lib/widgets.js";
import { createEditor } from "../lib/editor.js";
import { formatDate, plural } from "../lib/format.js";
import { isAdmin } from "../lib/session.js";

export async function artistsListView(ctx, main) {
  document.title = "Artistes — Administration TND";
  const state = { q: ctx.query.get("q") || "", sort: ctx.query.get("sort") || "name", archived: ctx.query.get("archived") || "0", missing: ctx.query.get("missing") || "", page: 1 };
  const results = h("div", { "aria-live": "polite" });
  const load = async () => {
    history.replaceState(null, "", `/admin/artists${qs({ q: state.q, sort: state.sort === "name" ? "" : state.sort, archived: state.archived === "0" ? "" : state.archived, missing: state.missing })}`);
    replace(results, loadingState());
    try {
      const data = await get(`/api/artists${qs({ ...state, pageSize: 48 })}`);
      if (!data.items.length) return replace(results, emptyState("Aucun artiste", state.q ? "Aucune fiche ne correspond à cette recherche." : "Les artistes s'ajoutent ici ou directement depuis le line-up d'une soirée."));
      replace(results,
        h("div", { class: "table-wrap" }, h("table", { class: "table table--stack" },
          h("caption", { class: "sr-only" }, "Artistes"),
          h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Artiste"), h("th", { scope: "col" }, "Styles"), h("th", { scope: "col" }, "Soirées"), h("th", { scope: "col" }, "Liens"), h("th", { scope: "col" }, h("span", { class: "sr-only" }, "Actions")))),
          h("tbody", {}, data.items.map((a) => h("tr", {},
            h("td", { class: "title-col" }, h("div", { class: "title-cell" },
              a.photo ? h("img", { class: "thumb thumb--round", src: a.photo.thumbUrl, alt: "", loading: "lazy" }) : h("span", { class: "thumb thumb--round", "aria-hidden": "true" }),
              h("div", {}, h("a", { href: `/admin/artists/${a.id}` }, a.name), a.archived ? h("div", {}, statusBadge("archived", "Archivé")) : null))),
            h("td", { "data-label": "Styles" }, a.styles || h("span", { class: "muted" }, "—")),
            h("td", { "data-label": "Soirées" }, a.eventCount ? `${a.eventCount}${a.lastDate ? ` (dernière : ${formatDate(a.lastDate, { month: "short" })})` : ""}` : h("span", { class: "muted" }, "aucune")),
            h("td", { "data-label": "Liens" }, a.instagramUrl ? h("a", { href: a.instagramUrl, target: "_blank", rel: "noopener noreferrer" }, "Instagram") : h("span", { class: "muted" }, "—")),
            h("td", {}, h("a", { class: "btn btn--sm", href: `/admin/artists/${a.id}` }, "Modifier"))))))),
        pagination({ page: data.page, pageSize: data.pageSize, total: data.total, onChange: (p) => { state.page = p; load(); } }));
    } catch (error) {
      replace(results, errorState(error, load));
    }
  };
  const search = input({ type: "search", value: state.q, placeholder: "Rechercher un artiste ou un style…", "aria-label": "Rechercher un artiste", oninput: debounce((e) => { state.q = e.target.value.trim(); state.page = 1; load(); }, 250) });
  replace(main,
    pageHead({ title: "Artistes", subtitle: "Une fiche par artiste, réutilisée dans tous les line-ups : renommer ou changer la photo met à jour toutes ses soirées.", actions: [h("a", { class: "btn btn--primary", href: "/admin/artists/new" }, icon("plus"), "Nouvel artiste")] }),
    h("div", { class: "toolbar" },
      h("div", { class: "search" }, icon("search"), search),
      select([["", "Toutes les fiches"], ["photo", "Sans photo"], ["instagram", "Sans Instagram"], ["styles", "Sans style"]], { value: state.missing, "aria-label": "Fiches incomplètes", onchange: (e) => { state.missing = e.target.value; state.page = 1; load(); } }),
      select([["0", "Actifs"], ["1", "Archivés"], ["all", "Tous"]], { value: state.archived, "aria-label": "Archivage", onchange: (e) => { state.archived = e.target.value; state.page = 1; load(); } }),
      select([["name", "Nom (A → Z)"], ["events", "Nombre de soirées"], ["last", "Dernière soirée"], ["recent", "Dernière modification"]], { value: state.sort, "aria-label": "Trier", onchange: (e) => { state.sort = e.target.value; load(); } })),
    results);
  load();
}

export async function artistEditView(ctx, main) {
  const isNew = ctx.params.id === "new";
  replace(main, loadingState());
  let artist;
  try {
    artist = isNew ? { name: "", slug: "", styles: "", bio: "", origin: "", instagramUrl: "", soundcloudUrl: "", links: [], contact: "", notes: "", archived: false, photo: null, photoMediaId: null, events: [] } : await get(`/api/artists/${Number(ctx.params.id)}`);
  } catch (error) {
    return replace(main, errorState(error, () => artistEditView(ctx, main)));
  }
  const m = structuredClone(artist);
  document.title = `${isNew ? "Nouvel artiste" : m.name} — Administration TND`;
  const toPayload = (x) => ({ version: x.version, name: x.name, slug: x.slug, photoMediaId: x.photoMediaId, styles: x.styles, bio: x.bio, origin: x.origin, instagramUrl: x.instagramUrl, soundcloudUrl: x.soundcloudUrl, links: x.links.filter((l) => l.label || l.url), contact: x.contact, notes: x.notes, archived: x.archived });
  const ed = createEditor({
    model: m, toPayload, isNew, newLabel: "Nouvel artiste",
    onSave: async (data) => {
      const saved = isNew ? await post("/api/artists", data) : await put(`/api/artists/${m.id}`, data);
      toast(isNew ? `Artiste « ${saved.name} » créé.` : "Fiche enregistrée. Les soirées où joue l'artiste seront mises à jour à la prochaine mise en ligne.");
      if (isNew) navigate(`/admin/artists/${saved.id}`, { replace: true, force: true });
      else Object.assign(m, { version: saved.version });
      return saved;
    }
  });
  const name = ed.bind("name", input({ value: m.name, maxlength: 80, required: true }));
  const similarBox = h("p", { class: "hint", "aria-live": "polite" });
  name.addEventListener("input", debounce(async () => {
    if (!name.value.trim()) return replace(similarBox);
    const similar = await get(`/api/artists/similar${qs({ name: name.value, exclude: m.id || "" })}`).catch(() => []);
    replace(similarBox, similar.length ? ["⚠ Fiche(s) au nom proche : ", ...similar.flatMap((s, i) => [i ? ", " : "", h("a", { href: `/admin/artists/${s.id}` }, s.name)]), ". Évitez les doublons."] : []);
  }, 350));
  append(ed.form, [
    ed.errors,
    h("section", { class: "card" }, h("div", { class: "card__head" }, h("h2", {}, "Fiche artiste")),
      h("div", { class: "fields fields--2" },
        h("div", { class: "fields" },
          field({ label: "Nom d'artiste", control: name, required: true, name: "name", hint: "Tel qu'il doit apparaître sur le site (ex. « Dann Octa »)." }),
          similarBox,
          field({ label: "Styles", control: ed.bind("styles", input({ value: m.styles, maxlength: 120, placeholder: "Trance / Groovy" })), name: "styles", hint: "Affiché sous le nom dans le line-up et sur la page Artistes." }),
          field({ label: "Origine", control: ed.bind("origin", input({ value: m.origin, maxlength: 100, placeholder: "Strasbourg" })), name: "origin" })),
        h("div", { class: "field", dataset: { field: "photoMediaId" } }, mediaSlot({ media: m.photo, label: "Photo de profil", hint: "Recadrée en carré (cercle du line-up).", onChange: (media) => { m.photo = media; m.photoMediaId = media?.id ?? null; ed.touch(); } }), h("p", { class: "error-text", hidden: true })))),
    h("section", { class: "card" }, h("div", { class: "card__head" }, h("h2", {}, "Liens")),
      h("div", { class: "fields fields--2" },
        field({ label: "Instagram", control: ed.bind("instagramUrl", input({ type: "url", value: m.instagramUrl, placeholder: "https://www.instagram.com/compte/" })), name: "instagramUrl", hint: "Le nom devient un lien dans le line-up." }),
        field({ label: "SoundCloud", control: ed.bind("soundcloudUrl", input({ type: "url", value: m.soundcloudUrl, placeholder: "https://soundcloud.com/…" })), name: "soundcloudUrl" }),
        field({ label: "Autres liens", control: linksEditor({ values: m.links, labelPlaceholder: "Libellé (ex. Beatport)", onChange: (v) => { m.links = v.map((l) => ({ ...l })); ed.touch(); } }), name: "links", wide: true }))),
    h("section", { class: "card" }, h("div", { class: "card__head" }, h("h2", {}, "Présentation et suivi"), h("p", {}, "La biographie est conservée pour une future page artiste ; le contact et les notes ne sont jamais publiés.")),
      h("div", { class: "fields" },
        field({ label: "Biographie", control: ed.bind("bio", textarea({ value: m.bio, rows: 5, maxlength: 3000 })), name: "bio" }),
        h("div", { class: "fields fields--2" },
          field({ label: "Contact (interne)", control: ed.bind("contact", textarea({ value: m.contact, rows: 3, maxlength: 300, placeholder: "Téléphone, e-mail, booker…" })), name: "contact" }),
          field({ label: "Notes internes", control: ed.bind("notes", textarea({ value: m.notes, rows: 3, maxlength: 2000 })), name: "notes" })),
        (() => { const c = checkbox("Fiche archivée (n'est plus proposée dans les line-ups)", { checked: m.archived }); ed.bind("archived", c.input); return c; })())),
    ed.bar
  ]);

  const side = h("div", { class: "split__side" });
  if (!isNew) {
    side.append(h("section", { class: "card" },
      h("div", { class: "card__head" }, h("h2", {}, "Soirées"), h("p", {}, plural(artist.events.length, "passage", "passages"))),
      artist.events.length ? h("ul", { class: "activity" }, artist.events.map((e) => h("li", {},
        h("a", { href: `/admin/events/${e.id}` }, e.title),
        h("span", { class: "small muted" }, [formatDate(e.date), e.label ? `affiché « ${e.label} »` : "", e.start_time ? `${e.start_time}–${e.end_time || "?"}` : ""].filter(Boolean).join(" · "))))) : h("p", { class: "muted" }, "Pas encore programmé.")));
    if (isAdmin()) side.append(h("section", { class: "card card--danger" },
      h("div", { class: "card__head" }, h("h2", {}, "Doublon, suppression")),
      h("p", { class: "small muted" }, "Fusionner réunit deux fiches du même artiste : ses passages sont transférés sur l'autre fiche, puis cette fiche est supprimée."),
      h("div", { class: "actions" },
        h("button", { type: "button", class: "btn btn--sm", onclick: () => mergeDialog(artist) }, "Fusionner avec…"),
        h("button", { type: "button", class: "btn btn--sm btn--danger", disabled: artist.events.length > 0, title: artist.events.length ? "Utilisé dans des line-ups : archivez ou fusionnez" : "", onclick: async (e) => {
          const btn = e.currentTarget;
          if (!(await confirm({ title: `Supprimer « ${artist.name} » ?`, message: "La fiche sera supprimée définitivement.", confirmLabel: "Supprimer", danger: true }))) return;
          await busy(btn, async () => {
            try {
              await del(`/api/artists/${artist.id}`);
              toast("Artiste supprimé.");
              navigate("/admin/artists", { force: true });
            } catch (error) {
              toast(errorMessage(error), "error");
            }
          });
        } }, "Supprimer")),
      artist.events.length ? h("p", { class: "hint", style: { marginTop: "8px" } }, "Suppression impossible tant que l'artiste figure dans un line-up.") : null));
  }
  replace(main,
    pageHead({ title: isNew ? "Nouvel artiste" : m.name, breadcrumb: [["Artistes", "/admin/artists"], [isNew ? "Nouveau" : m.name]] }),
    h("div", { class: "split" }, ed.form, side));
  ed.touch();
  if (isNew) name.focus();
  return { isDirty: ed.isDirty };
}

function mergeDialog(artist) {
  let target = null;
  const chosen = h("p", { class: "muted" }, "Aucune fiche choisie.");
  const ok = h("button", { type: "button", class: "btn btn--danger", disabled: true }, "Fusionner");
  const d = dialog({
    title: `Fusionner « ${artist.name} »`,
    body: h("div", { class: "stack" },
      h("p", {}, "Choisissez la fiche à conserver. Les passages de « ", artist.name, " » y seront transférés, ses champs vides complétés, puis cette fiche sera supprimée."),
      combobox({ label: "Fiche à conserver", search: async (q) => (await get(`/api/artists${qs({ q, pageSize: 20 })}`)).items.filter((a) => a.id !== artist.id).map((a) => ({ id: a.id, label: a.name, sub: a.styles, thumbUrl: a.photo?.thumbUrl })), onSelect: (opt) => { target = opt; replace(chosen, "Fiche conservée : ", h("strong", {}, opt.label)); ok.disabled = false; } }),
      chosen),
    actions: [h("button", { type: "button", class: "btn", onclick: () => d.close() }, "Annuler"), ok]
  });
  ok.addEventListener("click", () => busy(ok, async () => {
    try {
      await post(`/api/artists/${artist.id}/merge`, { targetId: target.id });
      d.close();
      toast(`« ${artist.name} » fusionné dans « ${target.label} ».`);
      navigate(`/admin/artists/${target.id}`, { force: true });
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }));
}
