/**
 * Traductions allemandes et anglaises des textes des contenus (soirées, FAQ, équipe).
 * Exportées dans js/i18n/contenus-de.js et contenus-en.js, fusionnées par js/i18n/de.js et en.js.
 */
import { now } from "../db/index.mjs";
import { badRequest } from "../http/errors.mjs";
import { cleanText } from "./validation.mjs";
import { translatableTexts } from "./events.mjs";
import { richTextProblems } from "./richtext.mjs";

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/** Textes à traduire de tous les contenus non archivés : [{ source, rich, usedIn: [libellés] }]. */
export function translatableSources(db) {
  const map = new Map();
  const add = (text, usedIn, rich = false) => {
    const source = norm(text);
    if (!source || !/\p{L}{2}/u.test(source)) return;
    const entry = map.get(source) || { source, rich, usedIn: [] };
    if (!entry.usedIn.includes(usedIn)) entry.usedIn.push(usedIn);
    map.set(source, entry);
  };
  for (const e of db.all("SELECT * FROM events WHERE status <> 'archived' ORDER BY date DESC")) {
    const ev = {
      description: e.description, price: e.price, age: e.age, practical: JSON.parse(e.practical || "[]"),
      aboutKicker: e.about_kicker, aboutTitle: e.about_title, aboutText: e.about_text, seoDescription: e.seo_description,
      photos: db.all("SELECT caption FROM event_photos WHERE event_id = ?", e.id)
    };
    for (const text of translatableTexts(ev)) add(text, `Soirée · ${e.title}`);
  }
  for (const f of db.all("SELECT * FROM faq_items ORDER BY position")) {
    add(f.question, "FAQ");
    add(f.answer, "FAQ", true);
  }
  for (const m of db.all("SELECT * FROM team_members ORDER BY position")) {
    for (const text of [m.role, m.bio, ...JSON.parse(m.tags || "[]"), ...JSON.parse(m.extra || "[]").flat()]) add(text, `Équipe · ${m.name}`);
  }
  return [...map.values()];
}

export function listTranslations(db, { missing = "", q = "" } = {}) {
  const rows = db.all("SELECT source, lang, text, updated_at FROM translations");
  const byKey = new Map(rows.map((r) => [`${r.lang}\u0000${r.source}`, r]));
  let items = translatableSources(db).map((s) => ({
    ...s,
    de: byKey.get(`de\u0000${s.source}`)?.text ?? "",
    en: byKey.get(`en\u0000${s.source}`)?.text ?? ""
  }));
  if (missing === "de" || missing === "en") items = items.filter((i) => !i[missing]);
  if (missing === "any") items = items.filter((i) => !i.de || !i.en);
  if (q) {
    const needle = q.toLowerCase();
    items = items.filter((i) => [i.source, i.de, i.en, ...i.usedIn].some((t) => t.toLowerCase().includes(needle)));
  }
  return items;
}

export function setTranslation(db, { source, lang, text }, user) {
  if (!["de", "en"].includes(lang)) throw badRequest("Langue inconnue.");
  const key = norm(source);
  if (!key) throw badRequest("Texte source manquant.");
  const value = cleanText(text, { multiline: true });
  if (value.length > 3000) throw badRequest("Traduction trop longue.");
  const problems = richTextProblems(value);
  if (problems.length) throw badRequest(problems.join(" "));
  if (!value) {
    db.run("DELETE FROM translations WHERE source = ? AND lang = ?", key, lang);
    return null;
  }
  db.run(
    `INSERT INTO translations (source, lang, text, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (source, lang) DO UPDATE SET text = excluded.text, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    key, lang, value, user?.id ?? null, now()
  );
  return value;
}
