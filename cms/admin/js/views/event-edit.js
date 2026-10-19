/**
 * Fiche d'une soirée : informations, horaires, lieu, visuels, line-up, « La soirée », infos
 * pratiques, SEO, traductions ; statut, contrôles, aperçu et historique dans la colonne latérale.
 */
import { h, replace, append, clear, uid } from "../lib/dom.js";
import { get, post, put, del, qs } from "../lib/api.js";
import { navigate, setDirtyChecker } from "../lib/router.js";
import {
  icon, toast, errorMessage, field, input, textarea, select, charCounter, showFieldErrors, loadingState, errorState,
  statusBadge, busy, confirm, dialog, copyText, pageHead
} from "../lib/ui.js";
import { tagInput, listEditor, linksEditor, combobox, mediaSlot } from "../lib/widgets.js";
import { formatDate, formatDateTime, relative, toLocalInput, fromLocalInput } from "../lib/format.js";
import { can, isAdmin } from "../lib/session.js";
import { nightMinutes, duration } from "/admin/shared/timeutil.mjs";
import { slugify } from "/admin/shared/slug.mjs";

const GENRES = ["Techno", "Hard Techno", "Trance", "Hard Trance", "Groovy", "Bouncy", "Schranz", "Acid", "Hardtechno", "Groove", "Bounce", "Tekno", "House", "Minimal"];
let meta = null;

const blank = () => ({
  id: null, version: 0, status: "draft", title: "", slug: "", date: "", datePrecision: "day", startTime: "21:00", endTime: "04:00", doorsTime: "",
  venueId: null, venue: null, price: "", age: "Dès 16 ans", ticketUrl: "", flyerMediaId: null, flyer: null, coverMediaId: null, cover: null,
  genres: [], description: "", practical: [], links: [], aboutKicker: "", aboutTitle: "", aboutText: "", photos: [], galleryAlbumId: null,
  seoTitle: "", seoDescription: "", notes: "", lineup: [], redirects: [], checks: { errors: [], warnings: [] }
});

/** Données envoyées à l'API (sans les objets d'affichage). */
const payload = (m) => ({
  version: m.version,
  title: m.title, slug: m.slug, date: m.date, datePrecision: m.datePrecision, startTime: m.startTime || "", endTime: m.endTime || "", doorsTime: m.doorsTime || "",
  venueId: m.venueId, price: m.price, age: m.age, ticketUrl: m.ticketUrl, flyerMediaId: m.flyerMediaId, coverMediaId: m.coverMediaId,
  genres: m.genres, description: m.description, practical: m.practical.filter((p) => p.trim()), links: m.links.filter((l) => l.label || l.url),
  aboutKicker: m.aboutKicker, aboutTitle: m.aboutTitle, aboutText: m.aboutText,
  photos: m.photos.map((p) => ({ mediaId: p.mediaId, caption: p.caption })), galleryAlbumId: m.galleryAlbumId,
  seoTitle: m.seoTitle, seoDescription: m.seoDescription, notes: m.notes,
  lineup: m.lineup.map((s) => ({ artistIds: s.artists.map((a) => a.id), label: s.label || "", style: s.style || "", startTime: s.startTime || "", endTime: s.endTime || "", notes: s.notes || "" }))
});

export async function eventEditView(ctx, main) {
  const isNew = ctx.params.id === "new";
  replace(main, loadingState());
  let model;
  try {
    meta ??= await get("/api/meta");
    if (isNew) {
      model = blank();
      const copyDate = ctx.query.get("date");
      if (copyDate) model.date = copyDate;
    } else model = await get(`/api/events/${Number(ctx.params.id)}`);
  } catch (error) {
    return replace(main, errorState(error, () => eventEditView(ctx, main)));
  }
  render(main, model, isNew);
  return { isDirty: () => main.isDirty?.() };
}

function render(main, ev, isNew) {
  const m = structuredClone(ev);
  let saved = JSON.stringify(payload(m));
  let slugTouched = Boolean(m.slug);
  const isDirty = () => JSON.stringify(payload(m)) !== saved;
  main.isDirty = isDirty;
  setDirtyChecker(isDirty);
  document.title = `${isNew ? "Nouvelle soirée" : m.title} — Administration TND`;

  const form = h("form", { class: "stack", novalidate: true, onsubmit: (e) => { e.preventDefault(); save(); } });
  const errorsBox = h("div", { class: "form-errors", hidden: true, role: "alert" });
  const savebar = h("div", { class: "savebar" });
  const stateText = h("span", { class: "savebar__state" });
  const touch = () => {
    const dirty = isDirty();
    savebar.classList.toggle("is-dirty", dirty);
    stateText.textContent = dirty ? "Modifications non enregistrées" : isNew ? "Nouvelle soirée (brouillon)" : "Tout est enregistré";
    refreshSerp();
    refreshTimeline();
  };
  const bind = (key, el, transform = (v) => v) => {
    el.addEventListener("input", () => { m[key] = transform(el.value); touch(); });
    el.addEventListener("change", () => { m[key] = transform(el.value); touch(); });
    return el;
  };
  const section = (id, title, intro, ...content) =>
    h("section", { class: "card form-section", id, "aria-labelledby": `${id}-t` },
      h("div", { class: "card__head" }, h("h2", { id: `${id}-t` }, title), intro ? h("p", {}, intro) : null),
      ...content);

  /* ---------- L'essentiel ---------- */
  const title = bind("title", input({ value: m.title, required: true, maxlength: 120, placeholder: "ICE BOILER v3" }));
  const slug = input({ value: m.slug, maxlength: 80, placeholder: "ice-boiler-v3-2027", pattern: "[a-z0-9-]+", spellcheck: "false" });
  const slugHint = h("p", { class: "hint" });
  const updateSlugHint = () => {
    const changed = ev.slug && m.slug && m.slug !== ev.slug && ev.firstPublishedAt;
    slugHint.textContent = changed
      ? `L'ancienne adresse (evenement-${ev.slug}.html) restera valable et redirigera vers la nouvelle.`
      : "Lettres minuscules, chiffres et tirets. Laissé vide, il est créé à partir du nom et de l'année.";
  };
  const autoSlug = () => {
    if (slugTouched || ev.firstPublishedAt) return;
    m.slug = slugify(`${m.title} ${(m.date || "").slice(0, 4)}`);
    slug.value = m.slug;
  };
  title.addEventListener("input", autoSlug);
  slug.addEventListener("input", () => { slugTouched = true; m.slug = slug.value.trim().toLowerCase(); updateSlugHint(); touch(); });
  updateSlugHint();
  const description = bind("description", textarea({ value: m.description, maxlength: 400, rows: 3, placeholder: "Rendez-vous le samedi … pour …, une soirée … organisée par Tekno Never Dies." }));
  const genres = tagInput({ values: m.genres, label: "Styles musicaux", placeholder: "Techno, Trance…", suggestions: GENRES, max: 8, onChange: (v) => { m.genres = [...v]; touch(); } });

  /* ---------- Date et horaires ---------- */
  const date = bind("date", input({ type: "date", value: m.date, required: true }));
  date.addEventListener("input", autoSlug);
  const precision = bind("datePrecision", select([["day", "Date exacte"], ["month", "Mois seulement (date à confirmer)"]], { value: m.datePrecision }));
  const start = bind("startTime", input({ type: "time", value: m.startTime || "" }));
  const end = bind("endTime", input({ type: "time", value: m.endTime || "" }));
  const doors = bind("doorsTime", input({ type: "time", value: m.doorsTime || "" }));
  const durationText = h("p", { class: "hint", "aria-live": "polite" });
  const refreshDuration = () => {
    const d = m.startTime && m.endTime ? duration(m.startTime, m.endTime) : null;
    durationText.textContent = d ? `Durée : ${Math.floor(d / 60)} h${d % 60 ? String(d % 60).padStart(2, "0") : ""}${m.endTime < m.startTime ? " (fin le lendemain)" : ""}. Heure de Paris.` : "Heure de Paris. Une fin plus tôt que le début signifie le lendemain matin.";
  };
  [start, end].forEach((el) => el.addEventListener("input", refreshDuration));
  refreshDuration();

  /* ---------- Lieu ---------- */
  const venueBox = h("div", { class: "stack" });
  const renderVenue = () => {
    clear(venueBox);
    if (m.venue) {
      venueBox.append(h("div", { class: "media-slot media-slot--wide", style: { gridTemplateColumns: "1fr auto" } },
        h("div", {}, h("strong", {}, m.venue.name), h("p", { class: "small muted", style: { margin: "2px 0 0" } }, `Affiché : ${m.venue.place}`),
          m.venue.lat == null ? h("p", { class: "small", style: { color: "var(--amber)", margin: "4px 0 0" } }, "Pas de coordonnées GPS : pas de plan « Y aller » sur la fiche.") : h("p", { class: "small muted", style: { margin: "4px 0 0" } }, m.venue.precise ? "Plan du village et zoom sur la salle." : "Plan du village seulement (adresse exacte inconnue).")),
        h("div", { class: "actions" },
          h("a", { class: "btn btn--sm btn--ghost", href: `/admin/venues/${m.venue.id}`, target: "_blank", rel: "noopener" }, "Modifier le lieu"),
          h("button", { type: "button", class: "btn btn--sm btn--ghost", onclick: () => { m.venue = null; m.venueId = null; renderVenue(); touch(); } }, "Retirer"))));
    }
    venueBox.append(h("div", { class: "row" },
      h("div", { style: { flex: "1 1 260px" } }, combobox({
        label: m.venue ? "Choisir un autre lieu" : "Choisir un lieu",
        placeholder: m.venue ? "Changer de lieu…" : "Rechercher un lieu (nom, ville)…",
        search: async (q) => (await get(`/api/venues${qs({ q })}`)).map((v) => ({ id: v.id, label: v.name, sub: v.city, venue: v })),
        onSelect: (opt) => { m.venue = opt.venue; m.venueId = opt.id; renderVenue(); touch(); },
        onCreate: (text) => quickVenue(text),
        createLabel: (t) => `Nouveau lieu « ${t} »…`
      })),
      h("button", { type: "button", class: "btn btn--sm", onclick: () => quickVenue("") }, icon("plus"), "Nouveau lieu")));
  };
  const quickVenue = (name) => {
    const f = { name: input({ value: name }), address: input(), postalCode: input({ inputmode: "numeric" }), city: input(), lat: input({ inputmode: "decimal", placeholder: "48.9193" }), lon: input({ inputmode: "decimal", placeholder: "8.1576" }) };
    const body = h("form", { class: "fields fields--2", novalidate: true },
      field({ label: "Nom", control: f.name, required: true, name: "name", wide: true }),
      field({ label: "Adresse", control: f.address, name: "address", wide: true }),
      field({ label: "Code postal", control: f.postalCode, name: "postalCode" }),
      field({ label: "Ville", control: f.city, name: "city" }),
      field({ label: "Latitude", control: f.lat, name: "lat", hint: "openstreetmap.org : clic droit → Afficher l'adresse." }),
      field({ label: "Longitude", control: f.lon, name: "lon" }));
    const ok = h("button", { type: "button", class: "btn btn--primary" }, "Créer le lieu");
    const d = dialog({ title: "Nouveau lieu", body, actions: [h("button", { type: "button", class: "btn", onclick: () => d.close() }, "Annuler"), ok] });
    ok.addEventListener("click", () => busy(ok, async () => {
      try {
        const v = await post("/api/venues", Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])));
        m.venue = v;
        m.venueId = v.id;
        renderVenue();
        touch();
        d.close();
        toast(`Lieu « ${v.name} » créé.`);
      } catch (error) {
        if (error.status === 422) showFieldErrors(body, error.fields);
        else toast(errorMessage(error), "error");
      }
    }));
    f.name.focus();
  };
  renderVenue();

  /* ---------- Line-up ---------- */
  const lineupBox = h("div", { class: "lineup" });
  const timeline = h("div", { class: "timeline", role: "img" });
  const scale = h("div", { class: "timeline__scale", "aria-hidden": "true" });
  function refreshTimeline() {
    clear(timeline);
    clear(scale);
    const timed = m.lineup.filter((s) => s.startTime);
    if (!m.startTime || !timed.length) {
      timeline.hidden = scale.hidden = true;
      return;
    }
    timeline.hidden = scale.hidden = false;
    const s0 = nightMinutes(m.startTime, m.startTime);
    const e0 = m.endTime ? s0 + duration(m.startTime, m.endTime) : Math.max(...timed.map((s) => nightMinutes(s.endTime || s.startTime, m.startTime))) || s0 + 60;
    const span = Math.max(60, e0 - s0);
    timeline.style.setProperty("--hours", String(Math.round(span / 60)));
    const blocks = timed.map((s) => {
      const a = nightMinutes(s.startTime, m.startTime);
      return { s, a, b: s.endTime ? a + duration(s.startTime, s.endTime) : a + 30 };
    }).sort((x, y) => x.a - y.a);
    blocks.forEach((blk, i) => {
      const overlap = blocks.some((o, j) => j !== i && o.a < blk.b && blk.a < o.b);
      timeline.append(h("span", { class: ["timeline__slot", overlap && "is-overlap"], style: { left: `${Math.max(0, ((blk.a - s0) / span) * 100)}%`, width: `${Math.max(2, ((blk.b - blk.a) / span) * 100)}%` }, title: `${slotLabel(blk.s)} · ${blk.s.startTime}–${blk.s.endTime || "?"}` }, slotLabel(blk.s)));
    });
    timeline.setAttribute("aria-label", `Frise du line-up de ${m.startTime} à ${m.endTime || "?"}`);
    const fmt = (min) => `${Math.floor((min % 1440) / 60)}h${String(min % 60).padStart(2, "0")}`;
    append(scale, [h("span", {}, fmt(s0)), h("span", {}, fmt(s0 + span / 2)), h("span", {}, fmt(s0 + span))]);
  }
  const slotLabel = (s) => s.label || s.artists.map((a) => a.name).join(" B2B ") || "?";
  let dragFrom = null;
  const renderLineup = (focus) => {
    clear(lineupBox);
    m.lineup.forEach((s, i) => {
      const chips = h("div", { class: "artist-chips" });
      s.artists.forEach((a, j) => {
        if (j) chips.append(h("span", { class: "b2b", "aria-hidden": "true" }, "B2B"));
        chips.append(h("span", { class: "artist-chip" },
          a.photo ? h("img", { src: a.photo.thumbUrl, alt: "" }) : h("span", { class: "ph", "aria-hidden": "true" }),
          a.name,
          h("button", { type: "button", "aria-label": `Retirer ${a.name} du passage ${i + 1}`, onclick: () => { s.artists.splice(j, 1); renderLineup(); touch(); } }, "×")));
      });
      const picker = combobox({
        label: s.artists.length ? `Ajouter un artiste en B2B au passage ${i + 1}` : `Choisir l'artiste du passage ${i + 1}`,
        placeholder: s.artists.length ? "+ B2B avec…" : "Rechercher un artiste…",
        search: async (q) => (await get(`/api/artists${qs({ q, pageSize: 20, sort: q ? "name" : "events" })}`)).items
          .filter((a) => !s.artists.some((x) => x.id === a.id))
          .map((a) => ({ id: a.id, label: a.name, sub: a.styles, thumbUrl: a.photo?.thumbUrl, artist: a })),
        onSelect: (opt) => { s.artists.push({ id: opt.id, name: opt.label, photo: opt.artist.photo, styles: opt.artist.styles }); renderLineup(); touch(); },
        onCreate: async (text) => {
          try {
            const similar = await get(`/api/artists/similar${qs({ name: text })}`);
            if (similar.length && !(await confirm({ title: "Artiste déjà existant ?", message: `Fiches au nom proche : ${similar.map((x) => x.name).join(", ")}. Créer quand même « ${text} » ?`, confirmLabel: "Créer une nouvelle fiche" }))) return;
            const a = await post("/api/artists", { name: text });
            s.artists.push({ id: a.id, name: a.name, photo: null });
            renderLineup();
            touch();
            toast(`Fiche artiste « ${a.name} » créée (complétez-la plus tard : photo, Instagram, style).`);
          } catch (error) {
            toast(errorMessage(error), "error");
          }
        },
        createLabel: (t) => `Créer l'artiste « ${t} »`
      });
      const slotTime = (key, label) => {
        const el = input({ type: "time", value: s[key] || "", "aria-label": `${label}, passage ${i + 1}` });
        el.addEventListener("input", () => { s[key] = el.value; touch(); });
        return field({ label, control: el, name: `lineup.${i}.${key}` });
      };
      const labelInput = input({ value: s.label || "", placeholder: slotLabel({ ...s, label: "" }), maxlength: 100 });
      labelInput.addEventListener("input", () => { s.label = labelInput.value; touch(); });
      const styleInput = input({ value: s.style || "", placeholder: s.artists.map((a) => a.styles).filter(Boolean).join(" × ") || "Style affiché", maxlength: 60 });
      styleInput.addEventListener("input", () => { s.style = styleInput.value; touch(); });
      const notesInput = textarea({ value: s.notes || "", rows: 2, maxlength: 500, placeholder: "Infos internes (matériel, contact, closing…), non publiées" });
      notesInput.addEventListener("input", () => { s.notes = notesInput.value; touch(); });
      const move = (to) => {
        if (to < 0 || to >= m.lineup.length) return;
        const [x] = m.lineup.splice(i, 1);
        m.lineup.splice(to, 0, x);
        renderLineup(to);
        touch();
      };
      const row = h("div", { class: "slot", draggable: "true", dataset: { index: String(i) } },
        h("div", { class: "slot__handle" }, h("span", { class: "slot__num" }, String(i + 1)), h("span", { class: "slot__grip", title: "Glisser pour réordonner", "aria-hidden": "true" }, icon("grip"))),
        h("div", { class: "slot__body" },
          h("div", { class: "field", dataset: { field: `lineup.${i}.artistIds` } }, h("span", { class: "label" }, s.artists.length > 1 ? "Artistes (B2B)" : "Artiste"), chips, picker, h("p", { class: "error-text", hidden: true })),
          h("div", { class: "slot__times" }, slotTime("startTime", "Début"), slotTime("endTime", "Fin"),
            h("p", { class: "hint", style: { alignSelf: "center" } }, s.startTime && s.endTime ? `${Math.round(duration(s.startTime, s.endTime) / 6) / 10} h` : "")),
          h("details", { class: "slot__more", open: Boolean(s.label || s.style || s.notes) },
            h("summary", {}, "Options du passage (nom affiché, style, notes)"),
            h("div", { class: "fields fields--2" },
              field({ label: "Nom affiché sur cette soirée", control: labelInput, hint: "Ex. écrit comme sur l'affiche. Vide = noms des fiches artistes (recommandé).", name: `lineup.${i}.label` }),
              field({ label: "Style affiché", control: styleInput, hint: "Vide = style de la fiche artiste.", name: `lineup.${i}.style` }),
              field({ label: "Notes internes", control: notesInput, wide: true, name: `lineup.${i}.notes` })))),
        h("div", { class: "slot__tools" },
          h("button", { type: "button", class: "btn btn--icon btn--sm btn--ghost", "aria-label": `Monter le passage ${i + 1}`, disabled: i === 0, onclick: () => move(i - 1) }, icon("up")),
          h("button", { type: "button", class: "btn btn--icon btn--sm btn--ghost", "aria-label": `Descendre le passage ${i + 1}`, disabled: i === m.lineup.length - 1, onclick: () => move(i + 1) }, icon("down")),
          h("button", { type: "button", class: "btn btn--icon btn--sm btn--ghost", "aria-label": `Supprimer le passage ${i + 1}`, onclick: async () => {
            if ((s.artists.length || s.label) && !(await confirm({ title: "Supprimer ce passage ?", message: `${slotLabel(s)} sera retiré du line-up (la fiche artiste est conservée).`, confirmLabel: "Supprimer le passage", danger: true }))) return;
            m.lineup.splice(i, 1);
            renderLineup();
            touch();
          } }, icon("trash"))));
      row.addEventListener("dragstart", (e) => {
        if (e.target.closest?.("input, textarea, select, button, summary")) return e.preventDefault();
        dragFrom = i;
        row.classList.add("is-dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(i));
      });
      row.addEventListener("dragend", () => { row.classList.remove("is-dragging"); dragFrom = null; });
      row.addEventListener("dragover", (e) => { if (dragFrom !== null) { e.preventDefault(); row.classList.add("is-drop-target"); } });
      row.addEventListener("dragleave", () => row.classList.remove("is-drop-target"));
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        row.classList.remove("is-drop-target");
        if (dragFrom === null || dragFrom === i) return;
        const [x] = m.lineup.splice(dragFrom, 1);
        m.lineup.splice(i, 0, x);
        dragFrom = null;
        renderLineup(i);
        touch();
      });
      lineupBox.append(row);
      if (focus === i) queueMicrotask(() => row.querySelector("input")?.focus());
    });
    if (!m.lineup.length) lineupBox.append(h("p", { class: "muted" }, "Aucun passage pour l'instant."));
    refreshTimeline();
  };
  const addSlot = () => {
    const prev = m.lineup.at(-1);
    m.lineup.push({ artists: [], label: "", style: "", startTime: prev?.endTime || (m.lineup.length ? "" : m.startTime || ""), endTime: "", notes: "" });
    renderLineup(m.lineup.length - 1);
    touch();
  };
  const chainTimes = () => {
    // Chaque passage commence à la fin du précédent ; la durée de chacun est conservée.
    m.lineup.forEach((s, i) => {
      if (!i) return;
      const prev = m.lineup[i - 1];
      if (!prev.endTime) return;
      const d = s.startTime && s.endTime ? duration(s.startTime, s.endTime) : null;
      s.startTime = prev.endTime;
      if (d) {
        const t = (Number(s.startTime.slice(0, 2)) * 60 + Number(s.startTime.slice(3)) + d) % 1440;
        s.endTime = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
      }
    });
    renderLineup();
    touch();
    toast("Horaires enchaînés : chaque passage commence à la fin du précédent.");
  };
  const sortByTime = () => {
    const ref = m.startTime || m.lineup.find((s) => s.startTime)?.startTime || "00:00";
    m.lineup.sort((a, b) => (a.startTime ? nightMinutes(a.startTime, ref) : 1e9) - (b.startTime ? nightMinutes(b.startTime, ref) : 1e9));
    renderLineup();
    touch();
  };
  renderLineup();

  /* ---------- La soirée : photos ---------- */
  const photosBox = h("div", { class: "grid grid--2" });
  const renderPhotos = () => {
    clear(photosBox);
    for (let i = 0; i < 2; i++) {
      const p = m.photos[i];
      const caption = input({ value: p?.caption || "", maxlength: 200, placeholder: "Légende affichée sous la photo", disabled: !p, "aria-label": `Légende de la photo ${i + 1}` });
      caption.addEventListener("input", () => { if (m.photos[i]) { m.photos[i].caption = caption.value; touch(); } });
      photosBox.append(h("div", { class: "stack" },
        mediaSlot({ media: p?.media, label: `Photo ${i + 1}`, onChange: (media) => {
          if (media) m.photos[i] = { mediaId: media.id, media, caption: m.photos[i]?.caption || "" };
          else m.photos.splice(i, 1);
          m.photos = m.photos.filter(Boolean);
          renderPhotos();
          touch();
        } }),
        caption));
    }
  };
  renderPhotos();

  /* ---------- Album, SEO ---------- */
  const album = select([["", "Aucun album"]], { "aria-label": "Album photo" });
  get("/api/albums").then((albums) => {
    for (const a of albums) album.append(h("option", { value: String(a.id) }, `${a.title} (${a.photoCount} photos${a.published ? "" : ", non publié"})`));
    album.value = m.galleryAlbumId ? String(m.galleryAlbumId) : "";
  }).catch(() => {});
  album.addEventListener("change", () => { m.galleryAlbumId = album.value ? Number(album.value) : null; touch(); });
  const seoTitle = bind("seoTitle", input({ value: m.seoTitle, maxlength: 90 }));
  const seoDesc = bind("seoDescription", textarea({ value: m.seoDescription, rows: 3, maxlength: 300 }));
  const serp = h("div", { class: "serp", "aria-label": "Aperçu du résultat Google", role: "img" });
  function refreshSerp() {
    const url = `${(meta?.siteUrl || "").replace(/^https?:\/\//, "").replace(/\/$/, "")} › evenement-${m.slug || "…"}.html`;
    const t = m.seoTitle || `${m.title || "Nom de la soirée"} · ${m.date ? formatDate(m.date) : "date"}`;
    const d = m.seoDescription || m.description || "Description de la soirée…";
    replace(serp, h("div", { class: "serp__url" }, url), h("div", { class: "serp__title" }, t), h("div", { class: "serp__desc" }, d.length > 160 ? `${d.slice(0, 157)}…` : d));
  }

  /* ---------- Traductions de la fiche ---------- */
  const translationsBox = h("div", { class: "stack" });
  const loadTranslations = async () => {
    if (isNew) return replace(translationsBox, h("p", { class: "muted" }, "Enregistrez la soirée pour traduire ses textes."));
    replace(translationsBox, loadingState());
    try {
      const all = await get("/api/translations");
      const mine = all.filter((t) => t.usedIn.includes(`Soirée · ${ev.title}`));
      if (!mine.length) return replace(translationsBox, h("p", { class: "muted" }, "Aucun texte à traduire (résumé, prix, infos pratiques, « La soirée »…)."));
      replace(translationsBox, h("p", { class: "hint" }, "Les textes des pages allemande et anglaise. Sans traduction, le texte français s'affiche. Enregistrement automatique en quittant le champ."),
        ...mine.map((t) => translationRow(t)));
    } catch (error) {
      replace(translationsBox, h("p", { class: "error-text" }, errorMessage(error)));
    }
  };

  /* ---------- Formulaire ---------- */
  const sections = [
    ["essentiel", "L'essentiel"], ["horaires", "Date et horaires"], ["lieu", "Lieu"], ["billetterie", "Billetterie"], ["visuels", "Visuels"],
    ["lineup", "Line-up"], ["soiree", "La soirée"], ["pratique", "Infos pratiques"], ["seo", "Référencement"], ["traductions", "Traductions"], ["notes", "Notes internes"]
  ];
  append(form, [
    errorsBox,
    h("nav", { class: "section-nav", "aria-label": "Sections de la fiche" }, sections.map(([id, label]) => h("a", { href: `#${id}`, onclick: (e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); } }, label))),
    section("essentiel", "L'essentiel", null, h("div", { class: "fields" },
      field({ label: "Nom de la soirée", control: title, required: true, name: "title", counter: charCounter(title, 120) }),
      field({ label: "Adresse de la fiche", control: h("div", { class: "input-group" }, h("span", { class: "prefix", "aria-hidden": "true" }, "evenement-"), slug), name: "slug" }),
      slugHint,
      field({ label: "Résumé", control: description, name: "description", hint: "Une ou deux phrases : affiché en tête de la fiche, dans Google et les partages (WhatsApp, Instagram).", counter: charCounter(description, 400, 200) }),
      field({ label: "Styles musicaux", control: genres, name: "genres", hint: "Entrée ou virgule pour ajouter un style." }))),
    section("horaires", "Date et horaires", null, h("div", { class: "fields fields--4" },
      field({ label: "Date", control: date, required: true, name: "date" }),
      field({ label: "Précision", control: precision, name: "datePrecision" }),
      field({ label: "Début", control: start, name: "startTime" }),
      field({ label: "Fin", control: end, name: "endTime" }),
      field({ label: "Ouverture des portes", control: doors, name: "doorsTime", hint: "Facultatif." }),
      h("div", { class: "field field--wide" }, durationText))),
    section("lieu", "Lieu", "Les lieux sont partagés entre les soirées : une modification du lieu s'applique partout.", h("div", { class: "field", dataset: { field: "venueId" } }, venueBox, h("p", { class: "error-text", hidden: true }))),
    section("billetterie", "Billetterie et entrée", null, h("div", { class: "fields fields--3" },
      field({ label: "Lien de billetterie", control: bind("ticketUrl", input({ type: "url", value: m.ticketUrl, placeholder: "https://www.helloasso.com/…" })), name: "ticketUrl", hint: "Adresse en https://. Bouton « Prendre ma place »." }),
      field({ label: "Prix", control: bind("price", input({ value: m.price, placeholder: "10 € en prévente, 15 € sur place" })), name: "price" }),
      field({ label: "Âge minimum", control: bind("age", input({ value: m.age, placeholder: "Dès 16 ans" })), name: "age" }))),
    section("visuels", "Visuels", "L'affiche est affichée en entier sur la fiche, utilisée pour la liste et l'aperçu des partages (recadrée en 1200 × 630).", h("div", { class: "grid grid--2" },
      h("div", { dataset: { field: "flyerMediaId" }, class: "field" }, mediaSlot({ media: m.flyer, label: "Affiche (flyer)", hint: "Portrait, 1080 × 1350 px idéalement.", onChange: (media) => { m.flyer = media; m.flyerMediaId = media?.id ?? null; touch(); } }), h("p", { class: "error-text", hidden: true })),
      h("div", { dataset: { field: "coverMediaId" }, class: "field" }, mediaSlot({ media: m.cover, label: "Photo de fond", hint: "Facultatif : fond de l'en-tête (sinon l'affiche floutée).", onChange: (media) => { m.cover = media; m.coverMediaId = media?.id ?? null; touch(); } }), h("p", { class: "error-text", hidden: true })))),
    section("lineup", "Line-up", "Un passage = un créneau, avec un ou plusieurs artistes (B2B). Glissez les passages pour les réordonner, ou utilisez les flèches.",
      timeline, scale,
      h("div", { class: "field", dataset: { field: "lineup" } }, h("p", { class: "error-text", hidden: true })),
      lineupBox,
      h("div", { class: "actions", style: { marginTop: "12px" } },
        h("button", { type: "button", class: "btn btn--sm btn--primary", onclick: addSlot }, icon("plus"), "Ajouter un passage"),
        h("button", { type: "button", class: "btn btn--sm", onclick: chainTimes, title: "Chaque passage commence à la fin du précédent" }, icon("chain"), "Enchaîner les horaires"),
        h("button", { type: "button", class: "btn btn--sm", onclick: sortByTime }, icon("sort"), "Trier par horaire"))),
    section("soiree", "La soirée", "Ce qui distingue cette soirée : affiché dans la section « La soirée » de la fiche.", h("div", { class: "fields fields--2" },
      field({ label: "Petite ligne", control: bind("aboutKicker", input({ value: m.aboutKicker, maxlength: 80, placeholder: "2ᵉ édition · L'hiver selon TND" })), name: "aboutKicker" }),
      field({ label: "Accroche", control: bind("aboutTitle", input({ value: m.aboutTitle, maxlength: 120, placeholder: "Froid dehors, brûlant dedans." })), name: "aboutTitle" }),
      field({ label: "Présentation", control: bind("aboutText", textarea({ value: m.aboutText, rows: 5, maxlength: 2000 })), name: "aboutText", wide: true }),
      h("div", { class: "field field--wide", dataset: { field: "photos" } }, h("span", { class: "label" }, "Photos (2 maximum)"), photosBox, h("p", { class: "error-text", hidden: true })),
      field({ label: "Album de la galerie", control: album, name: "galleryAlbumId", hint: "Ajoute « Voir les photos » sur la fiche." }))),
    section("pratique", "Infos pratiques", null, h("div", { class: "fields" },
      field({ label: "Lignes d'informations", control: listEditor({ values: m.practical, label: "Info pratique", placeholder: "Prévente en ligne sur HelloAsso : 10 €", addLabel: "Ajouter une info", onChange: (v) => { m.practical = [...v]; touch(); } }), name: "practical", hint: "« Dès 16 ans » et le nombre de participants (« 250 participant·es ») alimentent aussi les repères de la fiche." }),
      field({ label: "Liens complémentaires", control: linksEditor({ values: m.links, onChange: (v) => { m.links = v.map((l) => ({ ...l })); touch(); } }), name: "links", hint: "Événement Facebook, page d'un partenaire… (affichés à la fin des infos pratiques)." }))),
    section("seo", "Référencement et partage", "Facultatif : par défaut, le nom, la date et le résumé sont utilisés.", h("div", { class: "fields fields--2" },
      h("div", { class: "fields" },
        field({ label: "Titre pour Google et les partages", control: seoTitle, name: "seoTitle", counter: charCounter(seoTitle, 90, 60) }),
        field({ label: "Description pour Google et les partages", control: seoDesc, name: "seoDescription", counter: charCounter(seoDesc, 300, 160) })),
      h("div", {}, h("p", { class: "label small", style: { fontWeight: 700, marginBottom: "6px" } }, "Aperçu dans Google"), serp))),
    section("traductions", "Traductions", null, translationsBox),
    section("notes", "Notes internes", "Jamais publiées.", field({ label: "Notes", control: bind("notes", textarea({ value: m.notes, rows: 4, maxlength: 4000, placeholder: "Contacts, matériel, à faire…" })), name: "notes" }))
  ]);

  /* ---------- Enregistrement ---------- */
  const saveBtn = h("button", { type: "submit", class: "btn btn--primary", "data-save-shortcut": true }, isNew ? "Créer la soirée" : "Enregistrer");
  const save = () => busy(saveBtn, async () => {
    try {
      const data = isNew ? await post("/api/events", payload(m)) : await put(`/api/events/${m.id}`, payload(m));
      saved = JSON.stringify(payload(m));
      showFieldErrors(form, {}, errorsBox);
      toast(isNew ? "Soirée créée (brouillon)." : "Modifications enregistrées.");
      if (isNew) return navigate(`/admin/events/${data.id}`, { replace: true, force: true });
      const scrollY = window.scrollY;
      render(main, data, false);
      window.scrollTo(0, scrollY);
    } catch (error) {
      if (error.status === 422) {
        showFieldErrors(form, error.fields, errorsBox);
      } else if (error.status === 409 && error.data?.stale) {
        const reload = await confirm({ title: "Fiche modifiée entre-temps", message: "Quelqu'un a enregistré cette soirée pendant que vous la modifiiez. Recharger la dernière version ? (Vos modifications non enregistrées seront perdues : copiez d'abord ce que vous voulez garder.)", confirmLabel: "Recharger la dernière version", danger: true });
        if (reload) navigate(`/admin/events/${m.id}`, { replace: true, force: true });
      } else toast(errorMessage(error), "error");
    }
  });
  append(savebar, [stateText, h("span", { class: "spacer" }),
    !isNew ? h("a", { class: "btn btn--ghost", href: `/preview/event-${m.id}/evenement-${ev.slug}.html`, target: "_blank", rel: "noopener" }, icon("eye"), "Aperçu") : null,
    saveBtn]);
  form.append(savebar);

  /* ---------- Colonne latérale ---------- */
  const side = h("div", { class: "split__side" });
  if (!isNew) {
    append(side, [statusCard(m, ev, isDirty, main), checksCard(ev), previewCard(ev, isDirty), historyCard(ev, isDirty, main), metaCard(ev)]);
  } else {
    side.append(h("section", { class: "card" }, h("h2", {}, "Nouvelle soirée"), h("p", { class: "muted", style: { marginTop: "8px" } }, "Elle est créée en brouillon : rien n'apparaît sur le site avant sa publication et la mise en ligne.")));
  }

  replace(main,
    pageHead({
      title: isNew ? "Nouvelle soirée" : m.title,
      breadcrumb: [["Soirées", "/admin/events"], [isNew ? "Nouvelle" : formatDate(m.date)]],
      actions: isNew ? [] : [statusBadge(m.status, m.statusLabel)]
    }),
    h("div", { class: "split" }, form, side));
  touch();
  loadTranslations();
  if (isNew) title.focus();
}

function translationRow(t) {
  const row = h("div", { class: "card", style: { padding: "12px", background: "var(--card-2)" } },
    h("p", { class: "small", style: { fontWeight: 600 } }, "FR · ", t.source));
  const grid = h("div", { class: "fields fields--2" });
  for (const lang of ["de", "en"]) {
    const el = (t.source.length > 80 ? textarea : input)({ value: t[lang], rows: 3, "aria-label": `${lang === "de" ? "Allemand" : "Anglais"} : ${t.source.slice(0, 60)}` });
    const status = h("p", { class: "hint", "aria-live": "polite" }, t[lang] ? "" : "Pas encore traduit.");
    let last = t[lang];
    el.addEventListener("blur", async () => {
      if (el.value === last) return;
      try {
        await put("/api/translations", { source: t.source, lang, text: el.value });
        last = el.value;
        status.textContent = "Enregistré ✓";
      } catch (error) {
        status.textContent = errorMessage(error);
      }
    });
    const f = field({ label: lang === "de" ? "Allemand (DE)" : "Anglais (EN)", control: el });
    f.append(status);
    grid.append(f);
  }
  row.append(grid);
  return row;
}

/* ---------- Statut et publication ---------- */
function statusCard(m, ev, isDirty, main) {
  const card = h("section", { class: "card card--accent", "aria-labelledby": "status-t" });
  const run = (action, extra = {}) => async (e) => {
    const btn = e.currentTarget;
    if (isDirty() && !(await confirm({ title: "Modifications non enregistrées", message: "Enregistrez d'abord vos modifications (sinon elles ne seront pas prises en compte).", confirmLabel: "Continuer sans enregistrer" }))) return;
    await busy(btn, async () => {
      try {
        const updated = await post(`/api/events/${ev.id}/status`, { action, ...extra });
        const messages = {
          publish: "Soirée publiée dans le CMS.", schedule: "Mise en ligne programmée.", unpublish: "Soirée repassée en brouillon.",
          cancel: "Soirée marquée annulée.", archive: "Soirée archivée.", restore: "Soirée restaurée en brouillon."
        };
        const t = toast(messages[action], "success", { timeout: 8000 });
        if (["publish", "unpublish", "cancel", "archive"].includes(action) && can("site.publish")) {
          t.querySelector(".toast__text").append(" ", h("a", { href: "/admin/publish" }, "Mettre le site à jour maintenant →"));
        }
        render(main, updated, false);
      } catch (error) {
        if (error.status === 422) toast(`${error.message} ${Object.values(error.fields).join(" ")}`, "error");
        else toast(errorMessage(error), "error");
      }
    });
  };
  const schedule = async () => {
    const field_ = input({ type: "datetime-local", value: toLocalInput(ev.publishAt || new Date(Date.now() + 86400e3).toISOString()) });
    const ok = h("button", { type: "button", class: "btn btn--primary" }, "Programmer");
    const d = dialog({ title: "Programmer la mise en ligne", body: h("div", { class: "stack" }, field({ label: "Date et heure (heure de Paris)", control: field_ }), h("p", { class: "hint" }, "À l'heure dite, la soirée est publiée et le site est mis à jour automatiquement.")), actions: [h("button", { type: "button", class: "btn", onclick: () => d.close() }, "Annuler"), ok] });
    ok.addEventListener("click", async (e) => {
      if (!field_.value) return;
      d.close();
      await run("schedule", { publishAt: fromLocalInput(field_.value) })({ currentTarget: e.currentTarget });
    });
  };
  const btn = (label, onclick, cls = "") => h("button", { type: "button", class: `btn btn--sm ${cls}`, onclick }, label);
  const canPublish = can("content.publish");
  const actions = [];
  if (canPublish) {
    if (["draft", "scheduled", "cancelled", "archived"].includes(ev.status)) actions.push(btn(ev.status === "scheduled" ? "Publier maintenant" : ev.status === "cancelled" ? "Rétablir (publiée)" : "Publier", run("publish"), "btn--primary"));
    if (["draft", "scheduled"].includes(ev.status)) actions.push(btn(ev.status === "scheduled" ? "Changer la date de mise en ligne" : "Programmer…", schedule));
    if (["published", "scheduled"].includes(ev.status)) actions.push(btn("Annuler la soirée", async (e) => {
      if (await confirm({ title: "Annuler la soirée ?", message: "Elle restera visible sur le site avec la mention « Soirée annulée », sans billetterie. L'agenda des abonnés sera mis à jour.", confirmLabel: "Marquer annulée", danger: true })) run("cancel")({ currentTarget: e.target });
    }, "btn--danger"));
    if (["published", "scheduled", "cancelled"].includes(ev.status)) actions.push(btn("Dépublier (brouillon)", async (e) => {
      if (await confirm({ title: "Dépublier la soirée ?", message: "Elle disparaîtra du site à la prochaine mise en ligne (sa fiche ne sera plus accessible).", confirmLabel: "Dépublier" })) run("unpublish")({ currentTarget: e.target });
    }));
    if (ev.status !== "archived") actions.push(btn("Archiver", async (e) => {
      if (await confirm({ title: "Archiver la soirée ?", message: "Elle sera retirée du site et rangée dans les archives du CMS (restaurable).", confirmLabel: "Archiver" })) run("archive")({ currentTarget: e.target });
    }, "btn--ghost"));
    if (ev.status === "archived") actions.push(btn("Restaurer en brouillon", run("restore")));
  }
  if (isAdmin() && ["draft", "archived"].includes(ev.status)) {
    actions.push(btn("Supprimer définitivement", async (e) => {
      if (!(await confirm({ title: "Supprimer définitivement ?", message: "La soirée, son line-up et son historique seront supprimés. Cette action est irréversible (les fiches artistes, lieux et images sont conservés).", confirmLabel: "Supprimer", danger: true, typeToConfirm: ev.title }))) return;
      await busy(e.target, async () => {
        try {
          await del(`/api/events/${ev.id}`);
          toast("Soirée supprimée.");
          navigate("/admin/events", { force: true });
        } catch (error) {
          toast(errorMessage(error), "error");
        }
      });
    }, "btn--danger"));
  }
  append(card, [
    h("div", { class: "card__head" }, h("h2", { id: "status-t" }, "Publication"), statusBadge(ev.status, ev.statusLabel)),
    h("p", { class: "small muted" }, {
      draft: "Brouillon : invisible sur le site.",
      scheduled: `Sera publiée le ${ev.publishAt ? formatDateTime(ev.publishAt) : "?"}, puis le site sera mis à jour automatiquement.`,
      published: "Publiée : visible sur le site (après la mise en ligne).",
      cancelled: "Annulée : visible avec la mention « Soirée annulée ».",
      archived: "Archivée : retirée du site, conservée dans le CMS."
    }[ev.status]),
    h("div", { class: "actions" }, actions),
    duplicateButton(ev)
  ]);
  return card;
}

function duplicateButton(ev) {
  return h("div", { style: { marginTop: "12px" } }, h("button", { type: "button", class: "btn btn--sm btn--ghost", onclick: async (e) => {
    await busy(e.currentTarget, async () => {
      try {
        const copy = await post(`/api/events/${ev.id}/duplicate`);
        toast("Copie créée en brouillon : changez la date et le nom.");
        navigate(`/admin/events/${copy.id}`);
      } catch (error) {
        toast(errorMessage(error), "error");
      }
    });
  } }, icon("copy"), "Dupliquer (prochaine édition)"));
}

function checksCard(ev) {
  const { errors, warnings } = ev.checks || { errors: [], warnings: [] };
  return h("section", { class: `card ${errors.length ? "card--danger" : warnings.length ? "card--warn" : ""}`, "aria-labelledby": "checks-t" },
    h("div", { class: "card__head" }, h("h2", { id: "checks-t" }, "Contrôles avant publication"), h("p", {}, "Mis à jour à chaque enregistrement.")),
    h("ul", { class: "checklist" },
      errors.map((e) => h("li", { class: "is-error" }, e)),
      warnings.map((w) => h("li", {}, w)),
      !errors.length && !warnings.length ? h("li", { class: "is-ok" }, "Tout est prêt.") : null));
}

function previewCard(ev, isDirty) {
  const url = `/preview/event-${ev.id}/evenement-${ev.slug}.html`;
  const share = h("div", { class: "stack", style: { marginTop: "10px" } });
  const open = () => {
    const frame = h("iframe", { class: "preview-frame", src: url, title: `Aperçu de ${ev.title}`, "data-device": "desktop" });
    const device = (name, label) => h("button", { type: "button", class: "chip", "aria-pressed": String(name === "desktop"), onclick: (e) => {
      frame.dataset.device = name;
      e.currentTarget.parentElement.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c === e.currentTarget)));
    } }, label);
    dialog({ title: "Aperçu de la fiche", wide: true, body: h("div", { class: "stack" }, h("div", { class: "chips", role: "group", "aria-label": "Taille d'écran" }, device("mobile", "Mobile"), device("tablet", "Tablette"), device("desktop", "Ordinateur")), frame) });
  };
  return h("section", { class: "card", "aria-labelledby": "preview-t" },
    h("div", { class: "card__head" }, h("h2", { id: "preview-t" }, "Aperçu"), h("p", {}, isDirty() ? "Enregistrez pour voir vos dernières modifications." : "Exactement la page du site, même si la soirée n'est pas publiée.")),
    h("div", { class: "actions" },
      h("button", { type: "button", class: "btn btn--sm", onclick: open }, icon("eye"), "Aperçu intégré"),
      h("a", { class: "btn btn--sm btn--ghost", href: url, target: "_blank", rel: "noopener" }, icon("external"), "Nouvel onglet")),
    h("details", { style: { marginTop: "12px" } },
      h("summary", { class: "small", style: { cursor: "pointer", fontWeight: 600 } }, "Partager l'aperçu (sans compte)"),
      h("p", { class: "hint", style: { marginTop: "8px" } }, "Lien valable 7 jours, pour faire relire la fiche par un artiste ou un partenaire. Il ne montre que cette soirée."),
      h("div", { class: "actions" },
        h("button", { type: "button", class: "btn btn--sm", onclick: async (e) => {
          await busy(e.currentTarget, async () => {
            try {
              const { url: link, expiresAt } = await post(`/api/events/${ev.id}/preview-link`);
              replace(share, h("div", { class: "secret small" }, h("span", { style: { flex: 1 } }, link), h("button", { type: "button", class: "btn btn--icon btn--sm", "aria-label": "Copier le lien", onclick: () => copyText(link) }, icon("copy"))), h("p", { class: "hint" }, `Expire ${relative(expiresAt)}.`));
            } catch (error) {
              toast(errorMessage(error), "error");
            }
          });
        } }, icon("link"), "Créer un lien"),
        h("button", { type: "button", class: "btn btn--sm btn--ghost", onclick: async () => {
          if (!(await confirm({ title: "Révoquer les liens d'aperçu ?", message: "Tous les liens partagés pour cette soirée cesseront de fonctionner.", confirmLabel: "Révoquer" }))) return;
          await del(`/api/events/${ev.id}/preview-links`);
          clear(share);
          toast("Liens d'aperçu révoqués.");
        } }, "Révoquer")),
      share));
}

function historyCard(ev, isDirty, main) {
  const list = h("div", { class: "stack" }, h("p", { class: "muted small" }, "Chargement…"));
  const details = h("details", {}, h("summary", { class: "small", style: { cursor: "pointer", fontWeight: 600 } }, "Voir les versions"), list);
  details.addEventListener("toggle", async () => {
    if (!details.open || details.dataset.loaded) return;
    details.dataset.loaded = "1";
    try {
      const revisions = await get(`/api/revisions/event/${ev.id}`);
      replace(list, revisions.length ? h("ul", { class: "activity" }, revisions.map((r, i) => h("li", {},
        h("span", {}, h("strong", {}, `Version ${r.version}`), i === 0 ? h("span", { class: "pill", style: { marginLeft: "6px" } }, "actuelle") : null, r.user_name ? ` · ${r.user_name}` : ""),
        h("span", { class: "row" }, h("time", { datetime: r.created_at }, formatDateTime(r.created_at)),
          i > 0 && can("content.write") ? h("button", { type: "button", class: "link-btn small", onclick: async () => {
            if (isDirty() && !(await confirm({ title: "Modifications non enregistrées", message: "Elles seront perdues.", confirmLabel: "Continuer", danger: true }))) return;
            if (!(await confirm({ title: `Restaurer la version ${r.version} ?`, message: "Le contenu (textes, horaires, line-up, visuels) revient à cette version. Le statut et l'adresse actuels sont conservés. La version actuelle reste dans l'historique.", confirmLabel: "Restaurer" }))) return;
            try {
              const restored = await post(`/api/events/${ev.id}/revisions/${r.id}/restore`);
              toast(`Version ${r.version} restaurée.`);
              render(main, restored, false);
            } catch (error) {
              toast(errorMessage(error), "error");
            }
          } }, "Restaurer") : null)))) : h("p", { class: "muted" }, "Aucune version."));
    } catch (error) {
      replace(list, h("p", { class: "error-text" }, errorMessage(error)));
    }
  });
  return h("section", { class: "card", "aria-labelledby": "hist-t" }, h("div", { class: "card__head" }, h("h2", { id: "hist-t" }, "Historique"), h("p", {}, "Chaque enregistrement crée une version restaurable.")), details);
}

function metaCard(ev) {
  const publicUrl = meta?.siteUrl ? new URL(`evenement-${ev.slug}.html`, meta.siteUrl).href : null;
  const id = uid("meta");
  return h("section", { class: "card", "aria-labelledby": id },
    h("h2", { id, style: { marginBottom: "10px" } }, "Informations"),
    h("dl", { class: "small", style: { display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px", margin: 0 } },
      h("dt", { class: "muted" }, "Créée"), h("dd", { style: { margin: 0 } }, `${formatDateTime(ev.createdAt)}${ev.createdBy ? ` par ${ev.createdBy}` : ""}`),
      h("dt", { class: "muted" }, "Modifiée"), h("dd", { style: { margin: 0 } }, `${relative(ev.updatedAt)}${ev.updatedBy ? ` par ${ev.updatedBy}` : ""}`),
      ev.firstPublishedAt ? [h("dt", { class: "muted" }, "1ʳᵉ publication"), h("dd", { style: { margin: 0 } }, formatDateTime(ev.firstPublishedAt))] : null,
      publicUrl && ["published", "cancelled"].includes(ev.status) ? [h("dt", { class: "muted" }, "Sur le site"), h("dd", { style: { margin: 0, wordBreak: "break-all" } }, h("a", { href: publicUrl, target: "_blank", rel: "noopener" }, publicUrl.replace(/^https?:\/\//, "")))] : null,
      ev.redirects.length ? [h("dt", { class: "muted" }, "Anciennes adresses"), h("dd", { style: { margin: 0 } }, ev.redirects.map((r) => `evenement-${r}.html`).join(", "))] : null));
}
