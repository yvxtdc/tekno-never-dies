/** Équipe de l'association (page « L'association ») : fiches membres ordonnées. */
import { now, fromJson } from "../db/index.mjs";
import { notFound, conflict } from "../http/errors.mjs";
import { Validator, cleanText } from "./validation.mjs";
import { uniqueSlug } from "./slug.mjs";
import { saveRevision } from "./audit.mjs";
import { serializeMedia } from "./media.mjs";

const serialize = (db, r) => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  role: r.role,
  photoMediaId: r.photo_media_id,
  photo: r.photo_media_id ? serializeMedia(db.get("SELECT * FROM media WHERE id = ?", r.photo_media_id)) : null,
  tags: fromJson(r.tags, []),
  extra: fromJson(r.extra, []).map(([label, value]) => ({ label, value })),
  bio: r.bio,
  position: r.position,
  demo: Boolean(r.demo),
  published: Boolean(r.published),
  version: r.version,
  updatedAt: r.updated_at
});

export const listTeam = (db) => db.all("SELECT * FROM team_members ORDER BY position, id").map((r) => serialize(db, r));

export function getMember(db, id) {
  const row = db.get("SELECT * FROM team_members WHERE id = ?", id);
  if (!row) throw notFound("Membre introuvable.");
  return serialize(db, row);
}

function validate(db, input) {
  const v = new Validator(input);
  const data = {
    name: v.text("name", { required: true, max: 80, label: "Le nom" }),
    slug: v.slug("slug"),
    role: v.text("role", { required: true, max: 100, label: "Le rôle" }),
    photo_media_id: v.id("photoMediaId", { label: "La photo" }),
    tags: v.list("tags", { maxItems: 6, maxLength: 40, label: "Les missions" }),
    bio: v.text("bio", { max: 600, multiline: true, label: "La présentation" }),
    published: v.bool("published", true) ? 1 : 0
  };
  const extra = [];
  if (Array.isArray(input.extra)) {
    for (const item of input.extra) {
      const label = cleanText(item?.label), value = cleanText(item?.value);
      if (!label && !value) continue;
      if (!label || !value || label.length > 40 || value.length > 200) { v.error("extra", "Chaque détail doit avoir un intitulé (40 caractères max) et une valeur (200 max)."); break; }
      extra.push([label, value]);
    }
    if (extra.length > 6) v.error("extra", "6 détails maximum.");
  }
  if (data.photo_media_id && !db.get("SELECT id FROM media WHERE id = ?", data.photo_media_id)) v.error("photoMediaId", "Photo introuvable.");
  v.throwIfErrors();
  data.extra = extra;
  return data;
}

export function createMember(db, input, user) {
  const data = validate(db, input);
  const t = now();
  const position = (db.get("SELECT MAX(position) AS p FROM team_members").p ?? -1) + 1;
  const { lastInsertRowid } = db.run(
    "INSERT INTO team_members (slug, name, role, photo_media_id, tags, extra, bio, position, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    uniqueSlug(db, "team_members", data.slug || data.name), data.name, data.role, data.photo_media_id, JSON.stringify(data.tags),
    JSON.stringify(data.extra), data.bio, position, data.published, t, t
  );
  const member = getMember(db, Number(lastInsertRowid));
  saveRevision(db, "team", member.id, 1, member, user?.id);
  return member;
}

export function updateMember(db, id, input, user, { origin = "manual", changeId = null } = {}) {
  const current = db.get("SELECT * FROM team_members WHERE id = ?", id);
  if (!current) throw notFound("Membre introuvable.");
  if (input.version !== undefined && Number(input.version) !== current.version) throw conflict("Cette fiche a été modifiée entre-temps. Rechargez la page.", { stale: true });
  const data = validate(db, input);
  const slug = data.slug && data.slug !== current.slug ? uniqueSlug(db, "team_members", data.slug, id) : current.slug;
  db.run(
    "UPDATE team_members SET slug = ?, name = ?, role = ?, photo_media_id = ?, tags = ?, extra = ?, bio = ?, published = ?, version = version + 1, updated_at = ? WHERE id = ?",
    slug, data.name, data.role, data.photo_media_id, JSON.stringify(data.tags), JSON.stringify(data.extra), data.bio, data.published, now(), id
  );
  const member = getMember(db, id);
  saveRevision(db, "team", id, member.version, member, user?.id, { origin, changeId });
  return member;
}

export function deleteMember(db, id) {
  const member = getMember(db, id);
  db.run("DELETE FROM team_members WHERE id = ?", id);
  return member;
}
