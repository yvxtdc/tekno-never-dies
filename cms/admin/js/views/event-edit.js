/**
 * Fiche d'une soirée : informations, horaires, lieu, visuels, line-up, « La soirée », infos
 * pratiques, SEO, traductions ; statut, contrôles, aperçu, programmations et historique dans la
 * colonne latérale. Avec ?at=… (ou ?change=n° pour modifier une programmation), le formulaire montre
 * l'état prévu à cette date et ne sert qu'à programmer des modifications.
 */
import { h, replace, append, clear, uid } from "../lib/dom.js";
import { get, post, put, del, qs } from "../lib/api.js";
import { navigate, setDirtyChecker } from "../lib/router.js";
import {
  icon, toast, errorMessage, field, input, textarea, select, charCounter, showFieldErrors, loadingState, errorState,
  statusBadge, busy, confirm, dialog, copyText, pageHead
} from "../lib/ui.js";
import { tagInput, listEditor, linksEditor, combobox, mediaSlot } from "../lib/widgets.js";
import { formatDate, formatDateTime, relative, toLocalInput } from "../lib/format.js";
import { scheduleChangesDialog, pendingCard, historyCard, predictedBanner, loadPredicted, askDate, formatLocal } from "../lib/schedule.js";
import { can, isAdmin } from "../lib/session.js";
import { nightMinutes, duration } from "/admin/shared/timeutil.mjs";
import { slugify } from "/admin/shared/slug.mjs";
import { sectionFromHash } from "../lib/hash.js";
import { prepublicationDialog, lifecycleCard } from "../lib/supervision.js";

const GENRES = ["Techno", "Hard Techno", "Trance", "Hard Trance", "Groovy", "Bouncy", "Schranz", "Acid", "Hardtechno", "Groove", "Bounce", "Tekno", "House", "Minimal"];
let meta = null;

const blank = () => ({
  id: null, version: 0, status: "draft", title: "", slug: "", date: "", datePrecision: "day", startTime: "21:00", endTime: "04:00", doorsTime: "",
  venueId: null, venue: null, price: "", age: "Dès 16 ans", ticketUrl: "", tickets: [], contest: { email: "", deadline: "", text: "" }, flyerMediaId: null, flyer: null, coverMediaId: null, cover: null,
  genres: [], description: "", practical: [], links: [], aboutKicker: "", aboutTitle: "", aboutText: "", photos: [], galleryAlbumId: null,
  seoTitle: "", seoDescription: "", notes: "", lineup: [], redirects: [], checks: { errors: [], warnings: [] }
});

/**
 * Données envoyées à l'API (sans les objets d'affichage). L'API remplace la fiche entière
 * (services/events.mjs, updateEvent) : un champ de la fiche oublié ici serait vidé à chaque
 * enregistrement. Sert aussi à détecter les modifications non enregistrées (comparaison JSON).
 */
const payload = (m) => ({
  version: m.version,
  title: m.title, slug: m.slug, date: m.date, datePrecision: m.datePrecision, startTime: m.startTime || "", endTime: m.endTime || "", doorsTime: m.doorsTime || "",
  venueId: m.venueId, price: m.price, age: m.age, ticketUrl: m.ticketUrl,
  tickets: m.tickets.map((t) => ({ label: t.label, price: t.price === null || t.price === undefined ? "" : String(t.price), note: t.note, status: t.status, until: t.until, door: Boolean(t.door) })),
  contest: { email: m.contest.email, deadline: m.contest.deadline, text: m.contest.text }, flyerMediaId: m.flyerMediaId, coverMediaId: m.coverMediaId,
  genres: m.genres, description: m.description, practical: m.practical.filter((p) => p.trim()), links: m.links.filter((l) => l.label || l.url),
  aboutKicker: m.aboutKicker, aboutTitle: m.aboutTitle, aboutText: m.aboutText,
  photos: m.photos.map((p) => ({ mediaId: p.mediaId, caption: p.caption })), galleryAlbumId: m.galleryAlbumId,
  seoTitle: m.seoTitle, seoDescription: m.seoDescription, notes: m.notes,
  // uid : identifiant stable du passage (visé par les programmations) ; absent pour un nouveau passage.
  lineup: m.lineup.map((s) => ({ uid: s.uid || null, artistIds: s.artists.map((a) => a.id), label: s.label || "", style: s.style || "", startTime: s.startTime || "", endTime: s.endTime || "", notes: s.notes || "" }))
});

export async function eventEditView(ctx, main) {
  const isNew = ctx.params.id === "new";
  replace(main, loadingState());
  let model;
  let predicted = null;
  try {
    meta ??= await get("/api/meta");
    if (isNew) {
      model = blank();
      const copyDate = ctx.query.get("date");
      if (copyDate) model.date = copyDate;
    } else {
      predicted = await loadPredicted("event", Number(ctx.params.id), ctx.query);
      model = predicted ? { ...predicted.entity, checks: { errors: [], warnings: [] } } : await get(`/api/events/${Number(ctx.params.id)}`);
    }
  } catch (error) {
    return replace(main, errorState(error, () => eventEditView(ctx, main)));
  }
  render(main, model, isNew, predicted);
  return { isDirty: () => main.isDirty?.() };
}

function render(main, ev, isNew, predicted = null) {
  const m = structuredClone(ev);
  let saved = JSON.stringify(payload(m));
  let slugTouched = Boolean(m.slug);
  const isDirty = () => JSON.stringify(payload(m)) !== saved;
  main.isDirty = isDirty;
  setDirtyChecker(isDirty);
  document.title = `${isNew ? "Nouvelle soirée" : m.title} — Administration TND`;

  const form = h("form", { class: "stack", novalidate: true, onsubmit: (e) => { e.preventDefault(); if (predicted) scheduleForm(); else save(); } });
  const errorsBox = h("div", { class: "form-errors", hidden: true, role: "alert" });
  const savebar = h("div", { class: "savebar" });
  const stateText = h("span", { class: "savebar__state" });
  const touch = () => {
    const dirty = isDirty();
    savebar.classList.toggle("is-dirty", dirty);
    stateText.textContent = predicted ? (dirty ? "Modifications à programmer" : "État prévu (rien à programmer)") : dirty ? "Modifications non enregistrées" : isNew ? "Nouvelle soirée (brouillon)" : "Tout est enregistré";
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
          a.mystery ? h("span", { class: "pill", title: "Artiste mystère : place à gagner (voir la section DJ Contest)" }, "DJ Contest") : null,
          h("button", { type: "button", "aria-label": `Retirer ${a.name} du passage ${i + 1}`, onclick: () => { s.artists.splice(j, 1); renderLineup(); touch(); } }, "×")));
      });
      const picker = combobox({
        label: s.artists.length ? `Ajouter un artiste en B2B au passage ${i + 1}` : `Choisir l'artiste du passage ${i + 1}`,
        placeholder: s.artists.length ? "+ B2B avec…" : "Rechercher un artiste…",
        search: async (q) => (await get(`/api/artists${qs({ q, pageSize: 20, sort: q ? "name" : "events" })}`)).items
          .filter((a) => !s.artists.some((x) => x.id === a.id))
          .map((a) => ({ id: a.id, label: a.name, sub: a.styles, thumbUrl: a.photo?.thumbUrl, artist: a })),
        onSelect: (opt) => { s.artists.push({ id: opt.id, name: opt.label, photo: opt.artist.photo, styles: opt.artist.styles, mystery: opt.artist.mystery }); renderLineup(); touch(); },
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

  /* ---------- Billets : tarifs successifs, puis la caisse du soir ---------- */
  const ticketsBox = h("div", { class: "tickets-editor" });
  const ticketsPreview = h("div", { class: "tickets-preview", "aria-hidden": "true" });
  const euro = (p) => (p === "" || p === null || p === undefined ? "?" : Number(p) === 0 ? "Gratuit" : `${String(p).replace(".", ",")} €`);
  const refreshTicketsPreview = () => {
    clear(ticketsPreview);
    if (!m.tickets.length) return ticketsPreview.append(h("p", { class: "muted small" }, "Aperçu : ajoutez un tarif."));
    m.tickets.forEach((t) => ticketsPreview.append(h("span", { class: ["tickets-preview__item", `is-${t.status}`, t.door && "is-door"] },
      h("small", {}, t.label || "Tarif"), h("b", {}, euro(t.price)), t.status !== "available" ? h("em", {}, TICKET_STATES[t.status]) : null)));
  };
  const TICKET_STATES = { available: "En vente", soldout: "Épuisé", soon: "Bientôt", closed: "Terminé" };
  const sortDoor = () => { m.tickets = [...m.tickets.filter((t) => !t.door), ...m.tickets.filter((t) => t.door)]; };
  const renderTickets = (focus) => {
    clear(ticketsBox);
    m.tickets.forEach((t, i) => {
      const set = (key) => (e) => { t[key] = e.target.type === "checkbox" ? e.target.checked : e.target.value; touch(); refreshTicketsPreview(); };
      const label = input({ value: t.label, maxlength: 40, placeholder: t.door ? "Caisse du soir" : "Early, Regular, Late…", "aria-label": `Nom du tarif ${i + 1}`, oninput: set("label") });
      const price = input({ value: t.price === null || t.price === undefined ? "" : String(t.price).replace(".", ","), inputmode: "decimal", placeholder: "10", "aria-label": `Prix du tarif ${i + 1} en euros`, oninput: (e) => { t.price = e.target.value.replace(",", ".").trim(); touch(); refreshTicketsPreview(); } });
      const status = select(Object.entries(TICKET_STATES), { value: t.status || "available", "aria-label": `État du tarif ${i + 1}`, onchange: set("status") });
      const note = input({ value: t.note, maxlength: 120, placeholder: t.door ? "Sur place, dans la limite des places" : "Ex. Les 50 premières places", "aria-label": `Précision du tarif ${i + 1}`, oninput: set("note") });
      const until = input({ type: "date", value: t.until || "", "aria-label": `Fin de vente du tarif ${i + 1}`, oninput: set("until") });
      const sameKind = (j) => m.tickets[j] && Boolean(m.tickets[j].door) === Boolean(t.door);
      const move = (to) => { [m.tickets[i], m.tickets[to]] = [m.tickets[to], m.tickets[i]]; renderTickets(to); touch(); refreshTicketsPreview(); };
      const row = h("div", { class: ["ticket-row", t.door && "ticket-row--door", t.status !== "available" && "is-off"] },
        h("span", { class: "ticket-row__num", "aria-hidden": "true" }, t.door ? "€" : String(i + 1)),
        h("div", { class: "ticket-row__fields" },
          field({ label: t.door ? "Caisse du soir" : "Nom du tarif", control: label, name: `tickets.${i}.label` }),
          field({ label: "Prix (€)", control: h("div", { class: "input-group" }, price, h("span", { class: "suffix", "aria-hidden": "true" }, "€")), name: `tickets.${i}.price`, hint: "0 = gratuit." }),
          field({ label: "État", control: status, name: `tickets.${i}.status`, hint: "« Épuisé » : grisé et barré sur le site." }),
          field({ label: "Précision (facultatif)", control: note, name: `tickets.${i}.note` }),
          t.door ? null : field({ label: "Fin de vente (facultatif)", control: until, name: `tickets.${i}.until`, hint: "Passé ce jour : « Terminé »." })),
        h("div", { class: "ticket-row__tools" },
          t.door ? null : h("button", { type: "button", class: "btn btn--icon btn--sm btn--ghost", "aria-label": `Monter le tarif ${i + 1}`, disabled: !sameKind(i - 1), onclick: () => move(i - 1) }, icon("up")),
          t.door ? null : h("button", { type: "button", class: "btn btn--icon btn--sm btn--ghost", "aria-label": `Descendre le tarif ${i + 1}`, disabled: !sameKind(i + 1), onclick: () => move(i + 1) }, icon("down")),
          h("button", { type: "button", class: "btn btn--icon btn--sm btn--ghost", "aria-label": `Supprimer le tarif ${i + 1}`, onclick: () => { m.tickets.splice(i, 1); renderTickets(); touch(); refreshTicketsPreview(); } }, icon("trash"))));
      ticketsBox.append(row);
      if (focus === i) queueMicrotask(() => label.focus());
    });
    if (!m.tickets.length) ticketsBox.append(h("p", { class: "muted" }, "Aucun tarif : la section « Billets » n'apparaît pas sur la fiche."));
    const hasDoor = m.tickets.some((t) => t.door);
    const presets = [["Early", "Les premières places, au meilleur prix"], ["Regular", ""], ["Late", "Dernières places en prévente"]];
    ticketsBox.append(h("div", { class: "actions" },
      h("button", { type: "button", class: "btn btn--sm btn--primary", disabled: m.tickets.length >= 8, onclick: () => {
        const presale = m.tickets.filter((t) => !t.door);
        const [label, note] = presets[presale.length] || ["", ""];
        m.tickets.splice(presale.length, 0, { label, price: "", note, status: "available", until: "", door: false });
        renderTickets(presale.length); touch(); refreshTicketsPreview();
      } }, icon("plus"), "Ajouter un tarif en prévente"),
      h("button", { type: "button", class: "btn btn--sm", disabled: hasDoor || m.tickets.length >= 8, title: hasDoor ? "Déjà ajoutée" : "", onclick: () => {
        m.tickets.push({ label: "Caisse du soir", price: "", note: "Sur place, dans la limite des places disponibles", status: "available", until: "", door: true });
        sortDoor(); renderTickets(m.tickets.length - 1); touch(); refreshTicketsPreview();
      } }, icon("plus"), "Ajouter la caisse du soir")));
  };
  sortDoor();
  renderTickets();
  refreshTicketsPreview();

  /* ---------- DJ Contest ---------- */
  const contestEmail = input({ type: "email", value: m.contest.email, placeholder: meta?.contactEmail || "tnd6tem@gmail.com", oninput: (e) => { m.contest.email = e.target.value; touch(); } });
  const contestDeadline = input({ type: "date", value: m.contest.deadline, oninput: (e) => { m.contest.deadline = e.target.value; touch(); } });
  const contestText = textarea({ value: m.contest.text, rows: 3, maxlength: 600, placeholder: "Facultatif : remplace le texte d'introduction de la fenêtre (règles particulières, durée du set…)", oninput: (e) => { m.contest.text = e.target.value; touch(); } });
  const hasContestSlot = () => m.lineup.some((s) => s.artists.some((a) => a.mystery));

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
    ["lineup", "Line-up"], ["contest", "DJ Contest"], ["soiree", "La soirée"], ["pratique", "Infos pratiques"], ["seo", "Référencement"], ["traductions", "Traductions"], ["notes", "Notes internes"]
  ];
  append(form, [
    predicted ? predictedBanner({ predicted, replaceId: predicted.replaceId, exitHref: `/admin/events/${m.id}` }) : null,
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
    section("billetterie", "Billetterie et entrée", "Les tarifs s'affichent dans la section « Billets » de la fiche, sur une ligne, juste avant les infos pratiques. La caisse du soir est toujours la dernière.",
      h("div", { class: "fields fields--3" },
        field({ label: "Lien de billetterie", control: bind("ticketUrl", input({ type: "url", value: m.ticketUrl, placeholder: "https://www.helloasso.com/…" })), name: "ticketUrl", hint: "Adresse en https://. Bouton « Prendre ma place », actif seulement pour une soirée à venir." }),
        field({ label: "Résumé du prix", control: bind("price", input({ value: m.price, placeholder: "10 à 16 € en prévente, 18 € sur place" })), name: "price", hint: "Affiché en haut de la fiche et sur l'accueil. Vide = « Dès … € », calculé depuis les tarifs." }),
        field({ label: "Âge minimum", control: bind("age", input({ value: m.age, placeholder: "Dès 16 ans" })), name: "age" })),
      h("div", { class: "field", dataset: { field: "tickets" } }, h("span", { class: "label" }, "Tarifs"),
        h("ol", { class: "hint tickets-howto" },
          h("li", {}, "« Ajouter un tarif en prévente » pour chaque catégorie (Early, Regular, Late…) : nom et prix ; flèches ↑ ↓ pour l'ordre."),
          h("li", {}, "« Ajouter la caisse du soir » : elle s'affiche toujours en dernier."),
          h("li", {}, "Tarif épuisé : choisir « Épuisé » dans « État » (grisé et prix barré sur le site). « Bientôt » / « Terminé » pour une vente pas encore ouverte ou finie."),
          h("li", {}, "Enregistrer, vérifier avec « Aperçu », puis « Mise en ligne » pour mettre le site à jour.")),
        ticketsPreview, ticketsBox, h("p", { class: "error-text", hidden: true }))),
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
    section("contest", "DJ Contest", "Seulement pour une soirée qui organise un DJ Contest : les DJ envoient un set par mail avant la date limite, le meilleur set gagne sa place au line-up. Ajoutez au line-up la fiche « DJ Contest » (artiste mystère) ; sur le site, son nom ouvre une fenêtre qui explique comment participer.",
      h("details", { class: "contest-details", open: hasContestSlot() || Boolean(m.contest.deadline || m.contest.email || m.contest.text) },
      h("summary", {}, hasContestSlot() ? "Réglages du DJ Contest" : "Cette soirée a un DJ Contest : renseigner la date limite et l'adresse"),
      h("div", { class: "fields fields--2" },
        field({ label: "Adresse où envoyer les sets", control: contestEmail, name: "contest.email", hint: `Vide = ${meta?.contactEmail || "adresse de contact du site"}.` }),
        field({ label: "Date limite d'envoi", control: contestDeadline, name: "contest.deadline", hint: "Passée cette date, la fenêtre indique que les inscriptions sont closes." }),
        field({ label: "Texte d'introduction (facultatif)", control: contestText, name: "contest.text", wide: true, counter: charCounter(contestText, 600) }),
        hasContestSlot() ? null : h("p", { class: "hint field--wide" }, "Aucun artiste mystère dans le line-up pour l'instant : ces informations ne s'affichent pas.")))),
    section("soiree", "La soirée", "Ce qui distingue cette soirée : affiché dans la section « La soirée » de la fiche.", h("div", { class: "fields fields--2" },
      field({ label: "Petite ligne", control: bind("aboutKicker", input({ value: m.aboutKicker, maxlength: 80, placeholder: "2ᵉ édition · L'hiver selon TND" })), name: "aboutKicker" }),
      field({ label: "Accroche", control: bind("aboutTitle", input({ value: m.aboutTitle, maxlength: 120, placeholder: "Froid dehors, brûlant dedans." })), name: "aboutTitle" }),
      field({ label: "Présentation", control: bind("aboutText", textarea({ value: m.aboutText, rows: 5, maxlength: 2000 })), name: "aboutText", wide: true }),
      h("div", { class: "field field--wide", dataset: { field: "photos" } }, h("span", { class: "label" }, "Photos (2 maximum)"), photosBox, h("p", { class: "error-text", hidden: true })),
      field({ label: "Album de la galerie", control: album, name: "galleryAlbumId", hint: "Ajoute « Voir les photos » sur la fiche." }))),
    section("pratique", "Infos pratiques", null, h("div", { class: "fields" },
      field({ label: "Lignes d'informations", control: listEditor({ values: m.practical, label: "Info pratique", placeholder: "Le son est fort : des bouchons d'oreilles sont offerts à l'entrée", addLabel: "Ajouter une info", onChange: (v) => { m.practical = [...v]; touch(); } }), name: "practical", hint: "Conseils et règles du soir (bouchons, hydratation, parking…). Les prix vont dans « Billetterie et entrée ». « Dès 16 ans » et le nombre de participants (« 250 participant·es ») alimentent aussi les repères de la fiche." }),
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
      if (data.mergedFields?.length) toast(`Modifié entre-temps (par une programmation ou une autre personne) et conservé : ${data.mergedFields.join(", ")}.`, "warn", { timeout: 12000 });
      if (isNew) return navigate(`/admin/events/${data.id}`, { replace: true, force: true });
      const scrollY = window.scrollY;
      render(main, data, false);
      window.scrollTo(0, scrollY);
    } catch (error) {
      if (error.status === 422) {
        showFieldErrors(form, error.fields, errorsBox);
      } else if (error.status === 409 && error.data?.stale) {
        const fields = error.data.conflicts?.length ? ` Champs modifiés des deux côtés : ${error.data.conflicts.map((c) => c.label).join(", ")}.` : "";
        const reload = await confirm({ title: "Fiche modifiée entre-temps", message: `Quelqu'un (ou une programmation) a modifié cette soirée pendant que vous la modifiiez.${fields} Recharger la dernière version ? (Vos modifications non enregistrées seront perdues : copiez d'abord ce que vous voulez garder.)`, confirmLabel: "Recharger la dernière version", danger: true });
        if (reload) navigate(`/admin/events/${m.id}`, { replace: true, force: true });
      } else toast(errorMessage(error), "error");
    }
  });
  const reloadCurrent = async () => {
    try {
      render(main, await get(`/api/events/${m.id}`), false);
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  };
  /** Programmer les modifications du formulaire (état actuel, ou état prévu en mode préparation). */
  const scheduleForm = async () => {
    if (!predicted && !isDirty()) {
      const local = await askDate({ title: "Préparer une modification programmée", hint: "Le formulaire affichera l'état prévu à cette date (programmations déjà prévues incluses) : modifiez-le, puis « Programmer ces modifications »." });
      if (local) navigate(`/admin/events/${m.id}?at=${encodeURIComponent(local)}`);
      return;
    }
    scheduleChangesDialog({
      type: "event", id: m.id, input: payload(m),
      basis: predicted ? predicted.basis : { mode: "current", version: m.version },
      replaceId: predicted?.replaceId || null,
      runAtLocal: predicted ? predicted.atLocal : null,
      title: predicted?.replaceId ? `Modifier la programmation n° ${predicted.replaceId}` : "Programmer ces modifications",
      onPredict: (local) => navigate(`/admin/events/${m.id}?at=${encodeURIComponent(local)}`, { force: true }),
      onDone: () => {
        saved = JSON.stringify(payload(m));
        if (predicted) navigate(`/admin/events/${m.id}`, { force: true });
        else reloadCurrent();
      }
    });
  };
  const scheduleBtn = h("button", { type: "button", class: `btn ${predicted ? "btn--primary" : ""}`, onclick: scheduleForm, title: "Appliquer ces modifications automatiquement à une date (rien n'est visible avant)" }, icon("clock"), predicted ? "Programmer ces modifications" : "Programmer…");
  append(savebar, [stateText, h("span", { class: "spacer" }),
    !isNew && !predicted ? h("a", { class: "btn btn--ghost", href: `/preview/event-${m.id}/evenement-${ev.slug}.html`, target: "_blank", rel: "noopener" }, icon("eye"), "Aperçu") : null,
    !isNew && can("content.publish") ? scheduleBtn : null,
    predicted ? null : saveBtn]);
  form.append(savebar);

  /* ---------- Colonne latérale ---------- */
  const side = h("div", { class: "split__side" });
  const prepare = (local) => navigate(`/admin/events/${ev.id}?at=${encodeURIComponent(local)}`);
  if (predicted) {
    side.append(pendingCard({ type: "event", id: ev.id, onPrepare: prepare }));
  } else if (!isNew) {
    append(side, [statusCard(m, ev, isDirty, main), lifecycleCard(ev.id, { onCheck: () => prepublicationDialog(ev.id, { isDirty }) }), pendingCard({ type: "event", id: ev.id, onPrepare: prepare, onChanged: reloadCurrent }), checksCard(ev), previewCard(ev, isDirty),
      historyCard({ type: "event", id: ev.id, isDirty, onRestored: (restored) => render(main, restored, false) }), metaCard(ev)]);
  } else {
    side.append(h("section", { class: "card" }, h("h2", {}, "Nouvelle soirée"), h("p", { class: "muted", style: { marginTop: "8px" } }, "Elle est créée en brouillon : rien n'apparaît sur le site avant sa publication et la mise en ligne.")));
  }

  replace(main,
    pageHead({
      title: isNew ? "Nouvelle soirée" : m.title,
      eyebrow: predicted ? `État prévu le ${formatLocal(predicted.atLocal)}` : null,
      breadcrumb: [["Soirées", "/admin/events"], [isNew ? "Nouvelle" : formatDate(m.date)]],
      actions: isNew ? [] : [statusBadge(m.status, m.statusLabel)]
    }),
    h("div", { class: "split" }, form, side));
  touch();
  loadTranslations();
  if (isNew) title.focus();
  // Lien direct vers une section (ex. « Gérer les billets » depuis l'aperçu : #billetterie).
  const target = sectionFromHash(location.hash, (id) => document.getElementById(id));
  if (target) requestAnimationFrame(() => target.scrollIntoView({ block: "start" }));
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
    // Vérification avant publication : bloquante en cas d'erreur, confirmation explicite si avertissements.
    if (action === "publish" && !(await prepublicationDialog(ev.id, { confirmLabel: "Publier", isDirty }))) return;
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
    if (!(await prepublicationDialog(ev.id, { confirmLabel: "Programmer la mise en ligne", isDirty }))) return;
    const field_ = input({ type: "datetime-local", value: toLocalInput(ev.publishAt || new Date(Date.now() + 86400e3).toISOString()), step: 60 });
    const ok = h("button", { type: "button", class: "btn btn--primary" }, "Programmer");
    const d = dialog({ title: "Programmer la mise en ligne", body: h("div", { class: "stack" }, field({ label: "Date et heure (heure de Paris)", control: field_ }), h("p", { class: "hint" }, "D'ici là, la soirée reste invisible. À l'heure dite, elle est publiée et le site est mis à jour automatiquement, même si personne n'est connecté. Les modifications programmées après cette heure (line-up…) attendront cette mise en ligne.")), actions: [h("button", { type: "button", class: "btn", onclick: () => d.close() }, "Annuler"), ok] });
    ok.addEventListener("click", async (e) => {
      if (!field_.value) return;
      d.close();
      // Heure de Paris envoyée telle quelle : le serveur la convertit (heure d'été / d'hiver).
      await run("schedule", { runAt: field_.value })({ currentTarget: e.currentTarget });
    });
  };
  /** Annulation, retrait du site ou archivage à une date (programmation de statut). */
  const scheduleStatus = async (e) => {
    const btn = e.currentTarget;
    const choices = { cancel: "Annuler la soirée (reste visible avec la mention « annulée »)", unpublish: "Retirer du site (repasse en brouillon)", archive: "Archiver (retirée du site)", publish: "Publier (rétablir sur le site)" };
    const allowed = Object.keys(choices).filter((a) => (a === "publish" ? ["cancelled", "archived"].includes(ev.status) : ev.status !== "archived" && !(a === "cancel" && ev.status === "cancelled")));
    if (!allowed.length) return;
    const action = select(allowed.map((a) => [a, choices[a]]), { value: allowed[0] });
    const when = input({ type: "datetime-local", value: toLocalInput(new Date(Date.now() + 86400e3).toISOString()), step: 60 });
    const ok = h("button", { type: "button", class: "btn btn--primary" }, "Programmer");
    const d = dialog({ title: "Programmer un changement de statut", body: h("div", { class: "stack" }, field({ label: "Changement", control: action }), field({ label: "Date et heure (heure de Paris)", control: when })), actions: [h("button", { type: "button", class: "btn", onclick: () => d.close() }, "Annuler"), ok] });
    ok.addEventListener("click", () => busy(ok, async () => {
      try {
        const res = await post("/api/schedule/status", { entityType: "event", entityId: ev.id, action: action.value, runAt: when.value });
        d.close();
        toast(`Programmé pour le ${formatLocal(res.change.runAtLocal)} (n° ${res.change.id}).`);
        render(main, await get(`/api/events/${ev.id}`), false);
      } catch (error) {
        toast(error.status === 422 ? `${error.message} ${Object.values(error.fields).join(" ")}` : errorMessage(error), "error");
      }
    }));
    btn.blur();
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
    if (["published", "cancelled"].includes(ev.status)) actions.push(btn("Programmer un changement de statut…", scheduleStatus, "btn--ghost"));
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
      scheduled: `Invisible jusqu'au ${ev.publishAt ? formatDateTime(ev.publishAt) : "?"} : elle sera alors publiée et le site mis à jour automatiquement.`,
      published: "Publiée : visible sur le site (après la mise en ligne).",
      cancelled: "Annulée : visible avec la mention « Soirée annulée ».",
      archived: "Archivée : retirée du site, conservée dans le CMS."
    }[ev.status]),
    h("div", { class: "actions" }, actions),
    h("div", { style: { marginTop: "10px" } }, h("button", { type: "button", class: "btn btn--sm", onclick: () => prepublicationDialog(ev.id, { isDirty }) }, icon("check"), "Vérifier avant publication")),
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
      ev.redirects.length ? [h("dt", { class: "muted" }, "Anciennes adresses"), h("dd", { style: { margin: 0 } }, ev.redirects.map((r) => `evenement-${r}.html`).join(", "))] : null,
      ev.firstPublishedAt ? [h("dt", { class: "muted" }, "Statistiques"), h("dd", { style: { margin: 0 } }, h("a", { href: `/admin/stats?event=${ev.id}#soirees` }, "Visites et clics de la soirée"))] : null));
}
