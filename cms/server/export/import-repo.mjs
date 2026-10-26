/**
 * Import initial : reprend les contenus existants du dépôt (js/data/*.js, dictionnaires de
 * traduction, galerie) dans la base du CMS, sans rien modifier dans le dépôt.
 *
 * Les images existantes ne sont pas copiées : elles sont enregistrées dans la médiathèque avec
 * leur chemin actuel (storage = 'repo'), de sorte que la première mise en ligne depuis le CMS
 * produit exactement les mêmes données (vérifié par verifyRoundtrip).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";
import { now } from "../db/index.mjs";
import { registerRepoImage } from "../services/media.mjs";
import { artistKey, uniqueSlug, slugify } from "../services/slug.mjs";
import { parseFrenchRange } from "../services/timeutil.mjs";
import { htmlToRichText, richTextToHtml } from "../services/richtext.mjs";
import { venuePlace } from "../services/venues.mjs";
import { newSlotUid } from "../services/events.mjs";
import { buildSiteData } from "./site-data.mjs";
import { MANAGED_MODULES, renderModules } from "./modules.mjs";

const NOT_AN_ARTIST = /^(dj contest|guest|tba|surprise)/i;
const KNOWN_EVENT_FIELDS = new Set(["slug", "title", "date", "datePrecision", "time", "place", "price", "age", "ticketUrl", "tickets", "contest", "flyer", "cover", "genres", "description", "practical", "lineup", "about", "venue", "gallerySlug", "status", "cancelled"]);
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

async function load(siteDir, file) {
  const full = path.join(siteDir, file);
  if (!fs.existsSync(full)) return null;
  return import(`${pathToFileURL(full).href}?t=${Date.now()}`);
}

export const fileHash = (file) => (fs.existsSync(file) ? crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") : null);

export function contentIsEmpty(db) {
  return ["events", "artists", "venues", "faq_items", "team_members", "gallery_albums"].every((t) => db.get(`SELECT COUNT(*) AS n FROM ${t}`).n === 0);
}

export async function importFromRepo(db, config, { log = () => {} } = {}) {
  if (!contentIsEmpty(db)) throw new Error("La base contient déjà des contenus : l'import initial n'est possible que sur une base vide.");
  const siteDir = config.siteDir;
  const { EVENTS = [] } = (await load(siteDir, "js/data/events.js")) || {};
  const { ARTISTS = {}, ARTIST_STYLES = {} } = (await load(siteDir, "js/data/artistes.js")) || {};
  const { ARTIST_PHOTOS = {} } = (await load(siteDir, "js/data/artistes-photos.js")) || {};
  const { FAQ = [] } = (await load(siteDir, "js/data/faq.js")) || {};
  const { TEAM = [] } = (await load(siteDir, "js/data/equipe.js")) || {};
  const { GALLERY = [] } = (await load(siteDir, "js/data/galerie.js")) || {};
  const dicts = {
    de: (await load(siteDir, "js/i18n/de.js"))?.default || {},
    en: (await load(siteDir, "js/i18n/en.js"))?.default || {}
  };
  const warnings = [];
  const t = now();

  // Médias : enregistrement préalable (asynchrone), puis écriture de la base en une transaction.
  const mediaIds = new Map();
  const media = async (repoPath, options) => {
    if (!repoPath) return null;
    if (mediaIds.has(repoPath) && !options) return mediaIds.get(repoPath);
    if (!fs.existsSync(path.join(siteDir, repoPath))) {
      warnings.push(`Image absente du dépôt, ignorée : ${repoPath}`);
      mediaIds.set(repoPath, null);
      return null;
    }
    const row = await registerRepoImage(config, db, repoPath, options);
    mediaIds.set(repoPath, row.id);
    return row.id;
  };
  for (const ev of EVENTS) {
    await media(ev.flyer);
    await media(ev.cover);
    for (const p of ev.about?.photos || []) await media(p.src);
  }
  for (const p of Object.values(ARTIST_PHOTOS)) await media(p);
  for (const m of TEAM) await media(m.photo);
  for (const year of GALLERY) {
    for (const album of year.events) {
      for (const p of album.photos) await media(p.src, { variants: { thumb: p.thumb, ...(p.full ? { full: p.full } : {}) } });
    }
  }

  const counts = db.tx(() => {
    /* ---------- Galerie ---------- */
    const albumIds = new Map();
    let albumPos = 0;
    for (const year of GALLERY) {
      for (const album of year.events) {
        const dir = path.dirname(album.photos[0]?.src || "");
        const metaFile = path.join(siteDir, dir, "evenement.json");
        let date = `${year.year}-01-01`;
        try {
          date = JSON.parse(fs.readFileSync(metaFile, "utf8")).date || date;
        } catch {
          warnings.push(`Album « ${album.title} » : date introuvable (${dir}/evenement.json), 1er janvier utilisé.`);
        }
        const { lastInsertRowid } = db.run(
          "INSERT INTO gallery_albums (slug, title, date, published, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
          uniqueSlug(db, "gallery_albums", album.eventSlug), album.title, date, t, t
        );
        const id = Number(lastInsertRowid);
        albumIds.set(album.eventSlug, id);
        album.photos.forEach((p, i) => {
          const mid = mediaIds.get(p.src);
          if (mid) db.run("INSERT OR IGNORE INTO gallery_photos (album_id, media_id, position) VALUES (?, ?, ?)", id, mid, i);
        });
        albumPos++;
      }
    }

    /* ---------- Artistes ---------- */
    const artists = new Map(); // clé -> { name, instagram, styles, photo }
    const touch = (name) => {
      const key = artistKey(name);
      if (!key) return null;
      if (!artists.has(key)) artists.set(key, { name: name.trim() });
      return artists.get(key);
    };
    for (const [name, url] of Object.entries(ARTISTS)) Object.assign(touch(name), { name, instagram: url });
    for (const [name, style] of Object.entries(ARTIST_STYLES)) {
      const a = touch(name);
      a.styles = style;
      if (!ARTISTS[a.name] && !Object.keys(ARTISTS).some((n) => artistKey(n) === artistKey(name))) a.name = name;
    }
    for (const slot of EVENTS.flatMap((ev) => ev.lineup || [])) {
      const full = slot.name || "";
      // Place du DJ Contest : fiche « artiste mystère » (fenêtre de participation sur le site).
      if (slot.contest && touch(full)) touch(full).mystery = true;
      if (slot.contest || NOT_AN_ARTIST.test(full.trim())) continue;
      for (const part of full.split(/\s+b2b\s+/i)) if (part.trim()) touch(part);
    }
    const artistIds = new Map();
    for (const [key, a] of [...artists.entries()].sort((x, y) => x[1].name.localeCompare(y[1].name, "fr"))) {
      const photo = ARTIST_PHOTOS[key] ? mediaIds.get(ARTIST_PHOTOS[key]) : null;
      const { lastInsertRowid } = db.run(
        "INSERT INTO artists (slug, name, match_key, photo_media_id, styles, instagram_url, mystery, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        uniqueSlug(db, "artists", a.name), a.name, key, photo ?? null, a.styles || "", a.instagram || "", a.mystery ? 1 : 0, t, t
      );
      artistIds.set(key, Number(lastInsertRowid));
    }
    for (const key of Object.keys(ARTIST_PHOTOS)) if (!artists.has(key)) warnings.push(`Photo d'artiste sans artiste correspondant : ${key}`);

    /* ---------- Lieux ---------- */
    const venueIds = new Map();
    const venueFor = (ev) => {
      if (!ev.place) return null;
      const key = `${ev.place}|${ev.venue?.lat ?? ""}|${ev.venue?.lon ?? ""}`;
      if (venueIds.has(key)) return venueIds.get(key);
      const parts = ev.place.split(",").map((s) => s.trim()).filter(Boolean);
      const v = { name: parts[0], address: parts.length > 2 ? parts.slice(1, -1).join(", ") : "", city: parts.length > 1 ? parts.at(-1) : parts[0] };
      const label = venuePlace({ ...v, public_label: "" }) === ev.place ? "" : ev.place;
      const { lastInsertRowid } = db.run(
        `INSERT INTO venues (slug, name, public_label, address, city, lat, lon, precise, map_span_km, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        uniqueSlug(db, "venues", `${v.name} ${v.city === v.name ? "" : v.city}`), v.name, label, v.address, v.city,
        ev.venue?.lat ?? null, ev.venue?.lon ?? null, ev.venue?.precise === false ? 0 : 1, ev.venue?.span ?? null, t, t
      );
      venueIds.set(key, Number(lastInsertRowid));
      return Number(lastInsertRowid);
    };

    /* ---------- Soirées ---------- */
    for (const ev of EVENTS) {
      for (const field of Object.keys(ev)) if (!KNOWN_EVENT_FIELDS.has(field)) warnings.push(`Soirée « ${ev.slug} » : champ « ${field} » non repris par le CMS.`);
      const range = parseFrenchRange(ev.time);
      const notes = [];
      if (!range) {
        notes.push(`Horaires d'origine (non reconnus à l'import) : ${ev.time}`);
        warnings.push(`Soirée « ${ev.slug} » : horaires « ${ev.time} » non reconnus, recopiés dans les notes internes.`);
      }
      const status = ev.cancelled === true || /^(annul|cancel)/i.test(ev.status || "") ? "cancelled" : "published";
      const { lastInsertRowid } = db.run(
        `INSERT INTO events (slug, title, status, date, date_precision, start_time, end_time, venue_id, price, age, ticket_url, tickets, contest, flyer_media_id,
           cover_media_id, genres, description, practical, about_kicker, about_title, about_text, gallery_album_id, notes, first_published_at,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ev.slug, ev.title, status, ev.date, ev.datePrecision === "month" ? "month" : "day", range?.start ?? null, range?.end ?? null,
        venueFor(ev), ev.price || "", ev.age || "", ev.ticketUrl || "", JSON.stringify(ev.tickets || []), JSON.stringify(ev.contest || {}),
        mediaIds.get(ev.flyer) ?? null, mediaIds.get(ev.cover) ?? null,
        JSON.stringify(ev.genres || []), ev.description || "", JSON.stringify(ev.practical || []), ev.about?.kicker || "",
        ev.about?.title || "", ev.about?.text || "", ev.gallerySlug ? albumIds.get(ev.gallerySlug) ?? null : null, notes.join("\n"), t, t, t
      );
      const eventId = Number(lastInsertRowid);
      if (ev.gallerySlug && !albumIds.has(ev.gallerySlug)) warnings.push(`Soirée « ${ev.slug} » : album « ${ev.gallerySlug} » introuvable dans la galerie.`);
      (ev.about?.photos || []).forEach((p, i) => {
        const mid = mediaIds.get(p.src);
        if (mid) db.run("INSERT INTO event_photos (event_id, media_id, caption, position) VALUES (?, ?, ?, ?)", eventId, mid, p.caption || "", i);
      });
      (ev.lineup || []).forEach((slot, i) => {
        const name = (slot.name || "").trim();
        const isArtist = name && (slot.contest || !NOT_AN_ARTIST.test(name));
        const parts = isArtist ? name.split(/\s+b2b\s+/i).map((s) => s.trim()).filter(Boolean) : [];
        const ids = [...new Set(parts.map((p) => artistIds.get(artistKey(p))).filter(Boolean))];
        const canonical = ids.map((id) => db.get("SELECT name FROM artists WHERE id = ?", id).name).join(" B2B ");
        const times = slot.time ? parseFrenchRange(slot.time) : { start: null, end: null };
        if (slot.time && !times) warnings.push(`Soirée « ${ev.slug} », ${name} : horaire « ${slot.time} » non reconnu.`);
        const { lastInsertRowid: slotId } = db.run(
          "INSERT INTO lineup_slots (event_id, position, label, style, start_time, end_time, notes, uid) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          eventId, i, canonical === name ? "" : name, slot.style || "", times?.start ?? null, times?.end ?? null,
          slot.time && !times ? `Horaire d'origine : ${slot.time}` : "", newSlotUid()
        );
        ids.forEach((id, j) => db.run("INSERT INTO lineup_slot_artists (slot_id, artist_id, position) VALUES (?, ?, ?)", Number(slotId), id, j));
      });
    }

    /* ---------- FAQ ---------- */
    FAQ.forEach((f, i) => {
      let answer = htmlToRichText(f.a);
      if (answer === null || richTextToHtml(answer) !== f.a) {
        warnings.push(`FAQ « ${f.q} » : réponse HTML non convertible à l'identique, à vérifier.`);
        answer = answer ?? f.a.replace(/<[^>]+>/g, "");
      }
      db.run(
        "INSERT INTO faq_items (question, answer, category, position, needs_validation, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
        f.q, answer, f.category || "Association", i, f.needsValidation ? 1 : 0, t, t
      );
    });

    /* ---------- Équipe ---------- */
    TEAM.forEach((m, i) => {
      db.run(
        `INSERT INTO team_members (slug, name, role, photo_media_id, tags, extra, bio, position, demo, published, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        uniqueSlug(db, "team_members", m.slug || m.name), m.name, m.role || "", mediaIds.get(m.photo) ?? null, JSON.stringify(m.tags || []),
        JSON.stringify(Object.entries(m.extra || {})), m.bio || "", i, m.demo ? 1 : 0, t, t
      );
    });

    /* ---------- Traductions des contenus ---------- */
    const sources = [
      ...EVENTS.flatMap((e) => [e.description, e.price, e.age, ...(e.tickets || []).flatMap((x) => [x.label, x.note]), ...(e.practical || []), e.contest?.text, e.about?.kicker, e.about?.title, e.about?.text, ...(e.about?.photos || []).map((p) => p.caption)].map((s) => [s, false])),
      ...FAQ.flatMap((f) => [[f.q, false], [f.a, true]]),
      ...TEAM.flatMap((m) => [m.role, m.bio, ...(m.tags || []), ...Object.entries(m.extra || {}).flat()].map((s) => [s, false]))
    ];
    let translated = 0;
    for (const [text, rich] of sources) {
      const key = norm(text);
      if (!key) continue;
      for (const lang of ["de", "en"]) {
        const value = dicts[lang][key];
        if (value === undefined) continue;
        const source = rich ? norm(htmlToRichText(key) ?? key) : key;
        const target = rich ? htmlToRichText(value) ?? value : value;
        db.run("INSERT OR IGNORE INTO translations (source, lang, text, updated_at) VALUES (?, ?, ?, ?)", source, lang, target, t);
        translated++;
      }
    }

    // Empreintes des fichiers au moment de l'import : une modification ultérieure hors du CMS
    // sera détectée avant d'écraser quoi que ce soit (voir publish/publisher.mjs).
    const hashes = Object.fromEntries(MANAGED_MODULES.map((f) => [f, fileHash(path.join(siteDir, f))]));
    db.run("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('export.hashes', ?, ?)", JSON.stringify(hashes), t);
    db.run("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('import.done', ?, ?)", JSON.stringify({ at: t }), t);

    return {
      events: EVENTS.length,
      artists: artists.size,
      venues: venueIds.size,
      faq: FAQ.length,
      team: TEAM.length,
      albums: albumPos,
      media: [...mediaIds.values()].filter(Boolean).length,
      translations: translated
    };
  });
  log(`Import : ${JSON.stringify(counts)}`);
  // Si l'export reproduit exactement le site actuel, ce rendu devient la référence « déjà en ligne » :
  // le tableau de bord n'annonce pas de modification tant que rien n'a été changé dans le CMS.
  const diffs = await verifyRoundtrip(db, config);
  if (!diffs.length) {
    const rendered = renderModules(buildSiteData(db, { mode: "public" }));
    const sums = Object.fromEntries(Object.entries(rendered).map(([f, c]) => [f, crypto.createHash("sha256").update(c).digest("hex")]));
    db.run("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('export.rendered', ?, ?)", JSON.stringify(sums), now());
  }
  return { counts, warnings, diffs };
}

/**
 * Compare les données que produirait le CMS avec les modules actuels du dépôt.
 * Renvoie la liste des différences (vide = mise en ligne sans changement visible).
 */
export async function verifyRoundtrip(db, config) {
  const data = buildSiteData(db, { mode: "public" });
  const siteDir = config.siteDir;
  const diffs = [];
  const { EVENTS = [] } = (await load(siteDir, "js/data/events.js")) || {};
  const bySlug = (list) => Object.fromEntries(list.map((e) => [e.slug, e]));
  const expected = bySlug(EVENTS);
  const actual = bySlug(data.events);
  for (const slug of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    if (!isDeepStrictEqual(expected[slug], actual[slug])) diffs.push({ file: "js/data/events.js", key: slug, expected: expected[slug], actual: actual[slug] });
  }
  const compare = async (file, name, value) => {
    const mod = await load(siteDir, file);
    if (!isDeepStrictEqual(mod?.[name], value)) diffs.push({ file, key: name, expected: mod?.[name], actual: value });
  };
  await compare("js/data/artistes.js", "ARTISTS", data.ARTISTS);
  await compare("js/data/artistes.js", "ARTIST_STYLES", data.ARTIST_STYLES);
  await compare("js/data/artistes-photos.js", "ARTIST_PHOTOS", data.ARTIST_PHOTOS);
  await compare("js/data/faq.js", "FAQ", data.FAQ);
  await compare("js/data/equipe.js", "TEAM", data.TEAM);
  await compare("js/data/galerie.js", "GALLERY", data.GALLERY);
  // Traductions : chaque traduction exportée doit être identique à celle des dictionnaires actuels.
  for (const lang of ["de", "en"]) {
    const dict = (await load(siteDir, `js/i18n/${lang}.js`))?.default || {};
    for (const [key, value] of Object.entries(data.translations[lang])) {
      if (dict[key] !== value) diffs.push({ file: `js/i18n/${lang}.js`, key, expected: dict[key], actual: value });
    }
  }
  return diffs;
}

export { slugify };
