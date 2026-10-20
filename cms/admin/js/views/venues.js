/** Lieux : adresse, coordonnées (plans « Y aller »), accès ; partagés par les soirées. */
import { h, replace, append, debounce } from "../lib/dom.js";
import { get, post, put, del, qs } from "../lib/api.js";
import { navigate } from "../lib/router.js";
import { icon, pageHead, loadingState, errorState, emptyState, statusBadge, field, input, textarea, select, checkbox, toast, errorMessage, confirm, busy } from "../lib/ui.js";
import { createEditor } from "../lib/editor.js";
import { formatDate, plural } from "../lib/format.js";
import { isAdmin } from "../lib/session.js";

export async function venuesListView(ctx, main) {
  document.title = "Lieux — Administration TND";
  const state = { q: "", archived: "0", sort: "name" };
  const results = h("div", { "aria-live": "polite" });
  const load = async () => {
    replace(results, loadingState());
    try {
      const venues = await get(`/api/venues${qs(state)}`);
      if (!venues.length) return replace(results, emptyState("Aucun lieu", state.q ? "Aucun lieu ne correspond." : "Ajoutez une salle pour l'utiliser dans les soirées.", h("a", { class: "btn btn--primary", href: "/admin/venues/new" }, icon("plus"), "Nouveau lieu")));
      replace(results, h("div", { class: "table-wrap" }, h("table", { class: "table table--stack" },
        h("caption", { class: "sr-only" }, "Lieux"),
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Lieu"), h("th", { scope: "col" }, "Libellé sur le site"), h("th", { scope: "col" }, "Plan"), h("th", { scope: "col" }, "Soirées"), h("th", { scope: "col" }, h("span", { class: "sr-only" }, "Actions")))),
        h("tbody", {}, venues.map((v) => h("tr", {},
          h("td", { class: "title-col" }, h("div", { class: "title-cell" }, h("div", {}, h("a", { href: `/admin/venues/${v.id}` }, v.name), h("div", { class: "small muted" }, [v.postalCode, v.city].filter(Boolean).join(" ")), v.archived ? statusBadge("archived", "Archivé") : null))),
          h("td", { "data-label": "Site" }, v.place),
          h("td", { "data-label": "Plan" }, v.lat == null ? h("span", { class: "muted" }, "pas de coordonnées") : v.precise ? "village + salle" : "village"),
          h("td", { "data-label": "Soirées" }, String(v.eventCount)),
          h("td", {}, h("a", { class: "btn btn--sm", href: `/admin/venues/${v.id}` }, "Modifier"))))))));
    } catch (error) {
      replace(results, errorState(error, load));
    }
  };
  replace(main,
    pageHead({ title: "Lieux", subtitle: "Salles et lieux des soirées, réutilisables d'une soirée à l'autre.", actions: [h("a", { class: "btn btn--primary", href: "/admin/venues/new" }, icon("plus"), "Nouveau lieu")] }),
    h("div", { class: "toolbar" },
      h("div", { class: "search" }, icon("search"), input({ type: "search", placeholder: "Rechercher un lieu, une ville…", "aria-label": "Rechercher un lieu", oninput: debounce((e) => { state.q = e.target.value.trim(); load(); }, 250) })),
      select([["0", "Actifs"], ["1", "Archivés"], ["all", "Tous"]], { "aria-label": "Archivage", onchange: (e) => { state.archived = e.target.value; load(); } }),
      select([["name", "Nom"], ["city", "Ville"], ["events", "Nombre de soirées"], ["recent", "Dernière modification"]], { "aria-label": "Trier", onchange: (e) => { state.sort = e.target.value; load(); } })),
    results);
  load();
}

export async function venueEditView(ctx, main) {
  const isNew = ctx.params.id === "new";
  replace(main, loadingState());
  let venue;
  try {
    venue = isNew ? { name: "", publicLabel: "", address: "", postalCode: "", city: "", country: "FR", lat: null, lon: null, precise: true, mapSpanKm: null, description: "", websiteUrl: "", accessInfo: "", capacity: null, notes: "", archived: false, events: [] } : await get(`/api/venues/${Number(ctx.params.id)}`);
  } catch (error) {
    return replace(main, errorState(error, () => venueEditView(ctx, main)));
  }
  const m = structuredClone(venue);
  m.lat = m.lat ?? "";
  m.lon = m.lon ?? "";
  m.mapSpanKm = m.mapSpanKm ?? "";
  m.capacity = m.capacity ?? "";
  document.title = `${isNew ? "Nouveau lieu" : m.name} — Administration TND`;
  const toPayload = (x) => ({ version: x.version, name: x.name, publicLabel: x.publicLabel, address: x.address, postalCode: x.postalCode, city: x.city, country: x.country, lat: x.lat, lon: x.lon, precise: x.precise, mapSpanKm: x.mapSpanKm, description: x.description, websiteUrl: x.websiteUrl, accessInfo: x.accessInfo, capacity: x.capacity, notes: x.notes, archived: x.archived });
  const placePreview = h("p", { class: "hint", "aria-live": "polite" });
  const updatePlace = () => { placePreview.textContent = `Affiché sur le site : « ${m.publicLabel || [m.name, m.address, m.city].filter(Boolean).join(", ") || "…"} »`; };
  const ed = createEditor({
    model: m, toPayload, isNew, newLabel: "Nouveau lieu",
    onSave: async (data) => {
      let saved;
      try {
        saved = isNew ? await post("/api/venues", data) : await put(`/api/venues/${m.id}`, data);
      } catch (error) {
        if (error.status === 409 && error.data?.duplicateId && await confirm({ title: "Lieu en double ?", message: `${error.message} Enregistrer quand même ?`, confirmLabel: "Enregistrer quand même" })) {
          saved = isNew ? await post("/api/venues", { ...data, allowDuplicate: true }) : await put(`/api/venues/${m.id}`, { ...data, allowDuplicate: true });
        } else throw error;
      }
      toast(isNew ? `Lieu « ${saved.name} » créé.` : "Lieu enregistré. Les soirées concernées seront mises à jour à la prochaine mise en ligne.");
      if (isNew) navigate(`/admin/venues/${saved.id}`, { replace: true, force: true });
      else m.version = saved.version;
      return saved;
    }
  });
  const coords = input({ placeholder: "48.9193643, 8.1576719", "aria-label": "Coller des coordonnées « latitude, longitude »" });
  const lat = ed.bind("lat", input({ value: String(m.lat), inputmode: "decimal" }));
  const lon = ed.bind("lon", input({ value: String(m.lon), inputmode: "decimal" }));
  coords.addEventListener("change", () => {
    const match = coords.value.match(/(-?\d+(?:[.,]\d+)?)\s*[,; ]\s*(-?\d+(?:[.,]\d+)?)/);
    if (!match) return toast("Format attendu : « 48.9193, 8.1576 ».", "warn");
    lat.value = m.lat = match[1].replace(",", ".");
    lon.value = m.lon = match[2].replace(",", ".");
    coords.value = "";
    ed.touch();
  });
  const osm = h("a", { target: "_blank", rel: "noopener noreferrer", class: "small" }, "Vérifier sur OpenStreetMap ↗");
  const refreshOsm = () => {
    osm.hidden = !(m.lat && m.lon);
    osm.href = `https://www.openstreetmap.org/?mlat=${encodeURIComponent(m.lat)}&mlon=${encodeURIComponent(m.lon)}#map=17/${encodeURIComponent(m.lat)}/${encodeURIComponent(m.lon)}`;
  };
  [lat, lon].forEach((el) => el.addEventListener("input", refreshOsm));
  refreshOsm();
  const nameInput = ed.bind("name", input({ value: m.name, maxlength: 120, required: true }));
  const precise = checkbox("Adresse exacte connue (plan zoomé sur la salle avec repère)", { checked: m.precise });
  ed.bind("precise", precise.input);
  const archived = checkbox("Lieu archivé (n'est plus proposé pour les nouvelles soirées)", { checked: m.archived });
  ed.bind("archived", archived.input);
  append(ed.form, [
    ed.errors,
    h("section", { class: "card" }, h("div", { class: "card__head" }, h("h2", {}, "Adresse")),
      h("div", { class: "fields fields--2" },
        field({ label: "Nom du lieu", control: nameInput, required: true, name: "name", hint: "Ex. « Salle polyvalente »." }),
        field({ label: "Libellé sur le site (facultatif)", control: ed.bind("publicLabel", input({ value: m.publicLabel, maxlength: 200 })), name: "publicLabel", hint: "Vide = « nom, adresse, ville ». La partie après la dernière virgule est lue comme la ville." }),
        field({ label: "Adresse", control: ed.bind("address", input({ value: m.address, maxlength: 200, placeholder: "81 rue du Rhin" })), name: "address" }),
        h("div", { class: "fields fields--2" },
          field({ label: "Code postal", control: ed.bind("postalCode", input({ value: m.postalCode, maxlength: 12, inputmode: "numeric" })), name: "postalCode" }),
          field({ label: "Ville", control: ed.bind("city", input({ value: m.city, maxlength: 100 })), name: "city" })),
        h("div", { class: "field--wide" }, placePreview))),
    h("section", { class: "card" }, h("div", { class: "card__head" }, h("h2", {}, "Plan « Y aller »"), h("p", {}, "Les coordonnées GPS servent à dessiner les plans de la fiche (OpenStreetMap). Sur openstreetmap.org : clic droit sur la salle → « Afficher l'adresse », puis copiez les coordonnées.")),
      h("div", { class: "fields fields--3" },
        field({ label: "Coller « latitude, longitude »", control: coords, wide: true }),
        field({ label: "Latitude", control: lat, name: "lat" }),
        field({ label: "Longitude", control: lon, name: "lon" }),
        field({ label: "Largeur du plan du village (km)", control: ed.bind("mapSpanKm", input({ value: String(m.mapSpanKm), inputmode: "decimal", placeholder: "2.5" })), name: "mapSpanKm", hint: "Plus grand pour une ville." }),
        h("div", { class: "field--wide stack" }, precise, osm))),
    h("section", { class: "card" }, h("div", { class: "card__head" }, h("h2", {}, "Informations"), h("p", {}, "Pour l'équipe ; la description et l'accès pourront être affichés sur le site plus tard.")),
      h("div", { class: "fields fields--2" },
        field({ label: "Site officiel", control: ed.bind("websiteUrl", input({ type: "url", value: m.websiteUrl })), name: "websiteUrl" }),
        field({ label: "Capacité", control: ed.bind("capacity", input({ type: "number", min: 1, value: String(m.capacity) })), name: "capacity" }),
        field({ label: "Description", control: ed.bind("description", textarea({ value: m.description, rows: 3, maxlength: 2000 })), name: "description" }),
        field({ label: "Accès (parking, transports…)", control: ed.bind("accessInfo", textarea({ value: m.accessInfo, rows: 3, maxlength: 2000 })), name: "accessInfo" }),
        field({ label: "Notes internes (contacts, clés, horaires de montage…)", control: ed.bind("notes", textarea({ value: m.notes, rows: 3, maxlength: 2000 })), name: "notes", wide: true }),
        h("div", { class: "field--wide" }, archived))),
    ed.bar
  ]);
  ed.form.addEventListener("input", updatePlace);
  updatePlace();
  const side = h("div", { class: "split__side" });
  if (!isNew) {
    side.append(h("section", { class: "card" }, h("div", { class: "card__head" }, h("h2", {}, "Soirées dans ce lieu"), h("p", {}, plural(venue.events.length, "soirée", "soirées"))),
      venue.events.length ? h("ul", { class: "activity" }, venue.events.map((e) => h("li", {}, h("a", { href: `/admin/events/${e.id}` }, e.title), h("span", { class: "small muted" }, formatDate(e.date))))) : h("p", { class: "muted" }, "Aucune soirée.")));
    if (isAdmin()) side.append(h("section", { class: "card card--danger" }, h("h2", {}, "Supprimer le lieu"),
      h("p", { class: "small muted", style: { margin: "8px 0" } }, venue.events.length ? "Impossible : le lieu est utilisé. Archivez-le pour ne plus le proposer." : "Le lieu n'est utilisé par aucune soirée."),
      h("button", { type: "button", class: "btn btn--sm btn--danger", disabled: venue.events.length > 0, onclick: async (e) => {
        const btn = e.currentTarget;
        if (!(await confirm({ title: `Supprimer « ${venue.name} » ?`, message: "Suppression définitive.", confirmLabel: "Supprimer", danger: true }))) return;
        await busy(btn, async () => {
          try {
            await del(`/api/venues/${venue.id}`);
            toast("Lieu supprimé.");
            navigate("/admin/venues", { force: true });
          } catch (error) {
            toast(errorMessage(error), "error");
          }
        });
      } }, "Supprimer")));
  }
  replace(main, pageHead({ title: isNew ? "Nouveau lieu" : m.name, breadcrumb: [["Lieux", "/admin/venues"], [isNew ? "Nouveau" : m.name]] }), h("div", { class: "split" }, ed.form, side));
  ed.touch();
  if (isNew) nameInput.focus();
  return { isDirty: ed.isDirty };
}
