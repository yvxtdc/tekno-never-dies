/**
 * Construit les données du site public à partir de la base, au format exact des modules
 * js/data/*.js que lisent les pages et les outils existants (aucun changement de rendu).
 *
 *  mode "public"  : contenus publiés (soirées publiées ou annulées, albums et membres publiés) ;
 *  mode "preview" : idem + soirées programmées (sauf includeScheduled: false) + soirées demandées
 *                   (brouillons en prévisualisation).
 */
import { fromJson } from "../db/index.mjs";
import { artistKey } from "../services/slug.mjs";
import { frenchRange, frenchTime } from "../services/timeutil.mjs";
import { venuePlace } from "../services/venues.mjs";
import { exportPath, mediaVariants, VARIANTS } from "../services/media.mjs";
import { richTextToHtml } from "../services/richtext.mjs";
import { translatableTexts } from "../services/events.mjs";
import { translatableSources } from "../services/translations.mjs";
import { exportTicket, exportContest, normalizeTicket, sortTickets } from "../services/tickets.mjs";

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

export function buildSiteData(db, { mode = "public", includeEventIds = [], includeScheduled = true } = {}) {
  const files = new Map(); // chemin publié -> { media, variant }
  const mediaById = new Map();
  const mediaRow = (id) => {
    if (!id) return null;
    if (!mediaById.has(id)) mediaById.set(id, db.get("SELECT * FROM media WHERE id = ?", id));
    return mediaById.get(id);
  };
  /** Chemin publié d'un média : image du dépôt telle quelle, sinon variante optimisée. */
  const ref = (id, variant) => {
    const media = mediaRow(id);
    if (!media) return "";
    if (media.storage === "repo") {
      if (variant === "gallery_thumb") return mediaVariants(media).thumb || media.repo_path;
      if (variant === "gallery_full") return mediaVariants(media).full || "";
      return media.repo_path;
    }
    const p = exportPath(media, variant);
    files.set(p, { media, variant });
    return p;
  };

  /* ---------- Soirées ---------- */
  const statuses = mode === "preview" && includeScheduled ? ["published", "cancelled", "scheduled"] : ["published", "cancelled"];
  const include = new Set(includeEventIds.map(Number));
  const rows = db
    .all(`SELECT * FROM events WHERE status IN (${statuses.map(() => "?").join(",")}) OR id IN (${[...include].map(() => "?").join(",") || "NULL"}) ORDER BY date DESC, id DESC`, ...statuses, ...include);
  const albums = new Map(db.all("SELECT * FROM gallery_albums").map((a) => [a.id, a]));
  const usedArtistIds = new Set();
  const events = rows.map((e) => {
    const venue = e.venue_id ? db.get("SELECT * FROM venues WHERE id = ?", e.venue_id) : null;
    const slots = db.all("SELECT * FROM lineup_slots WHERE event_id = ? ORDER BY position", e.id);
    const lineup = slots.map((s) => {
      const artists = db.all("SELECT a.id, a.name, a.mystery FROM lineup_slot_artists la JOIN artists a ON a.id = la.artist_id WHERE la.slot_id = ? ORDER BY la.position", s.id);
      artists.forEach((a) => usedArtistIds.add(a.id));
      const slot = { name: s.label || artists.map((a) => a.name).join(" B2B ") };
      if (s.style) slot.style = s.style;
      if (s.start_time) slot.time = frenchRange(s.start_time, s.end_time);
      // Artiste mystère : place à gagner (DJ Contest), le nom ouvre la fenêtre de participation.
      if (artists.some((a) => a.mystery)) slot.contest = true;
      return slot;
    });
    const photos = db.all("SELECT * FROM event_photos WHERE event_id = ? ORDER BY position", e.id).map((p) => {
      const media = mediaRow(p.media_id);
      const photo = { src: ref(p.media_id, "web") };
      if (p.caption) photo.caption = p.caption;
      if (media?.alt) photo.alt = media.alt;
      return photo;
    });
    const ev = {
      slug: e.slug,
      title: e.title,
      date: e.date,
      ...(e.date_precision === "month" ? { datePrecision: "month" } : {}),
      time: frenchRange(e.start_time, e.end_time),
      place: venuePlace(venue),
      ...(e.price ? { price: e.price } : {}),
      ...(e.age ? { age: e.age } : {}),
      ticketUrl: e.ticket_url,
      ...(() => {
        const tickets = sortTickets(fromJson(e.tickets, []).map(normalizeTicket));
        return tickets.length ? { tickets: tickets.map(exportTicket) } : {};
      })(),
      flyer: ref(e.flyer_media_id, "flyer"),
      cover: ref(e.cover_media_id, "web"),
      genres: fromJson(e.genres, []),
      description: e.description,
      practical: fromJson(e.practical, []),
      lineup
    };
    if (lineup.some((s) => s.contest)) {
      const contest = exportContest(fromJson(e.contest, {}));
      if (Object.keys(contest).length) ev.contest = contest;
    }
    if (e.about_kicker || e.about_title || e.about_text || photos.length) {
      ev.about = {};
      if (e.about_kicker) ev.about.kicker = e.about_kicker;
      if (e.about_title) ev.about.title = e.about_title;
      if (e.about_text) ev.about.text = e.about_text;
      if (photos.length) ev.about.photos = photos;
    }
    if (venue && venue.lat != null && venue.lon != null) {
      ev.venue = { lat: venue.lat, lon: venue.lon };
      if (!venue.precise) ev.venue.precise = false;
      if (venue.map_span_km) ev.venue.span = venue.map_span_km;
    }
    const album = e.gallery_album_id ? albums.get(e.gallery_album_id) : null;
    if (album && (album.published || mode === "preview")) ev.gallerySlug = album.slug;
    if (e.status === "cancelled") ev.cancelled = true;
    if (e.doors_time) ev.doors = frenchTime(e.doors_time);
    const links = fromJson(e.links, []);
    if (links.length) ev.links = links;
    if (e.seo_title || e.seo_description) {
      ev.seo = {};
      if (e.seo_title) ev.seo.title = e.seo_title;
      if (e.seo_description) ev.seo.description = e.seo_description;
    }
    if (mode === "preview" && !["published", "cancelled"].includes(e.status)) ev.previewStatus = e.status;
    return ev;
  });
  const exportedIds = new Set(rows.map((r) => r.id));
  const eventRedirects = {};
  for (const r of db.all("SELECT r.old_slug, e.slug, e.id FROM event_redirects r JOIN events e ON e.id = r.event_id ORDER BY r.old_slug")) {
    if (exportedIds.has(r.id)) eventRedirects[r.old_slug] = r.slug;
  }

  /* ---------- Artistes ---------- */
  const ARTISTS = {};
  const ARTIST_STYLES = {};
  const ARTIST_PHOTOS = {};
  const artistRows = db.all("SELECT * FROM artists ORDER BY name COLLATE NOCASE").filter((a) => !a.archived || usedArtistIds.has(a.id));
  for (const a of artistRows) {
    // Artiste mystère (DJ Contest) : pas de lien Instagram, le site ouvre la fenêtre de participation.
    if (a.instagram_url && !a.mystery) ARTISTS[a.name] = a.instagram_url;
    if (a.styles) ARTIST_STYLES[a.name] = a.styles;
    if (a.photo_media_id) ARTIST_PHOTOS[artistKey(a.name)] = ref(a.photo_media_id, "square");
  }

  /* ---------- FAQ ---------- */
  const FAQ = db.all("SELECT * FROM faq_items WHERE published = 1 ORDER BY position, id").map((f) => ({
    q: f.question,
    a: richTextToHtml(f.answer),
    category: f.category,
    ...(f.needs_validation ? { needsValidation: true } : {})
  }));

  /* ---------- Équipe ---------- */
  const TEAM = db.all("SELECT * FROM team_members WHERE published = 1 ORDER BY position, id").map((m) => ({
    slug: m.slug,
    demo: Boolean(m.demo),
    name: m.name,
    role: m.role,
    photo: ref(m.photo_media_id, "portrait"),
    tags: fromJson(m.tags, []),
    extra: Object.fromEntries(fromJson(m.extra, [])),
    bio: m.bio
  }));

  /* ---------- Galerie ---------- */
  const byYear = new Map();
  for (const album of db.all(`SELECT * FROM gallery_albums ${mode === "preview" ? "" : "WHERE published = 1"} ORDER BY date DESC, id DESC`)) {
    const photos = db.all("SELECT media_id FROM gallery_photos WHERE album_id = ? ORDER BY position", album.id).map(({ media_id }) => {
      const media = mediaRow(media_id);
      const photo = { src: ref(media_id, "web"), thumb: ref(media_id, "gallery_thumb") };
      const full = ref(media_id, "gallery_full");
      if (full) photo.full = full;
      const { w, h } = media.storage === "repo" ? { w: media.width, h: media.height } : fitted(media, VARIANTS.web.resize.width);
      photo.w = w;
      photo.h = h;
      return photo;
    });
    if (!photos.length) continue;
    const year = Number(album.date.slice(0, 4));
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push({ title: album.title, eventSlug: album.slug, photos });
  }
  const GALLERY = [...byYear.entries()].sort((a, b) => b[0] - a[0]).map(([year, list]) => ({ year, events: list }));

  /* ---------- Traductions des contenus ---------- */
  const exportedTexts = new Set([
    ...rows.flatMap((e) =>
      translatableTexts({
        description: e.description, price: e.price, age: e.age, practical: fromJson(e.practical, []),
        tickets: fromJson(e.tickets, []), contest: fromJson(e.contest, {}),
        aboutKicker: e.about_kicker, aboutTitle: e.about_title, aboutText: e.about_text, seoDescription: e.seo_description,
        photos: db.all("SELECT caption FROM event_photos WHERE event_id = ?", e.id)
      })
    ),
    ...FAQ.map((f) => norm(f.q)),
    ...db.all("SELECT answer FROM faq_items WHERE published = 1").map((f) => norm(f.answer)),
    ...TEAM.flatMap((m) => [m.role, m.bio, ...m.tags, ...Object.entries(m.extra).flat()].map(norm))
  ]);
  const rich = new Set(translatableSources(db).filter((s) => s.rich).map((s) => s.source));
  const translations = { de: {}, en: {} };
  for (const t of db.all("SELECT source, lang, text FROM translations ORDER BY source")) {
    if (!exportedTexts.has(t.source)) continue;
    if (rich.has(t.source)) translations[t.lang][norm(richTextToHtml(t.source))] = richTextToHtml(t.text);
    else translations[t.lang][t.source] = t.text;
  }

  return { events, eventRedirects, ARTISTS, ARTIST_STYLES, ARTIST_PHOTOS, FAQ, TEAM, GALLERY, translations, files };
}

/** Dimensions d'une image réduite pour tenir dans max × max (sans agrandissement), comme sharp. */
function fitted(media, max) {
  const scale = Math.min(1, max / Math.max(media.width, media.height));
  return { w: Math.round(media.width * scale), h: Math.round(media.height * scale) };
}
