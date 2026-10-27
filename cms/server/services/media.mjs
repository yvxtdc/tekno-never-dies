/**
 * Médiathèque : import sécurisé des images, variantes optimisées, usages et suppression protégée.
 *
 * Sécurité des imports :
 *  - type réel détecté sur les premiers octets (signature), pas sur l'extension déclarée ;
 *  - extension du nom cohérente avec le contenu ; SVG, HTML, PDF, exécutables… refusés ;
 *  - taille maximale (CMS_MAX_UPLOAD_MB), dimensions entre 200 et 12 000 px, 60 mégapixels max ;
 *  - décodage complet par sharp (une image corrompue ou piégée est refusée) ;
 *  - le fichier est stocké sous un nom aléatoire (uid), jamais sous le nom fourni ;
 *  - les variantes publiées sont réencodées : métadonnées EXIF (dont position GPS) retirées.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { now, fromJson } from "../db/index.mjs";
import { HttpError, badRequest, conflict, notFound } from "../http/errors.mjs";
import { cleanText } from "./validation.mjs";
import { slugify } from "./slug.mjs";
import { like } from "./audit.mjs";

sharp.cache(false);

const TYPES = [
  { mime: "image/jpeg", exts: [".jpg", ".jpeg"], test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png", exts: [".png"], test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/webp", exts: [".webp"], test: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
  { mime: "image/gif", exts: [".gif"], test: (b) => /^GIF8[79]a$/.test(b.subarray(0, 6).toString("latin1")) },
  { mime: "image/avif", exts: [".avif"], test: (b) => b.subarray(4, 8).toString("latin1") === "ftyp" && /^(avif|avis)$/.test(b.subarray(8, 12).toString("latin1")) }
];

export const ACCEPTED_EXTENSIONS = TYPES.flatMap((t) => t.exts);
const MIN_SIDE = 200, MAX_SIDE = 12000, MAX_PIXELS = 60e6;

/** Variantes produites pour le site (format, taille, qualité). */
export const VARIANTS = {
  thumb_admin: { ext: "webp", resize: { width: 480, height: 480, fit: "inside" }, quality: 70 },
  flyer: { ext: "webp", resize: { width: 1600, height: 1600, fit: "inside" }, quality: 82 },
  web: { ext: "webp", resize: { width: 1800, height: 1800, fit: "inside" }, quality: 78 },
  square: { ext: "webp", resize: { width: 320, height: 320, fit: "cover", position: "attention" }, quality: 80 },
  portrait: { ext: "webp", resize: { width: 720, height: 900, fit: "cover", position: "attention" }, quality: 80 },
  gallery_thumb: { ext: "webp", resize: { width: 720, height: 720, fit: "inside" }, quality: 72 },
  gallery_full: { ext: "jpg", resize: { width: 2800, height: 2800, fit: "inside" }, quality: 88 }
};

export function sniffType(buffer) {
  return TYPES.find((t) => buffer.length > 12 && t.test(buffer)) || null;
}

/** Nom de fichier affichable : sans chemin, sans caractères de contrôle, 120 caractères max. */
export function cleanFileName(name) {
  const base = String(name || "").split(/[\\/]/).pop();
  const cleaned = cleanText(base).replace(/[<>:"|?*]/g, "").slice(0, 120);
  return cleaned || "image";
}

/** Contrôle complet d'un fichier importé ; renvoie { type, meta }. */
export async function inspectUpload(buffer, originalName) {
  if (!buffer.length) throw badRequest("Le fichier est vide.");
  const type = sniffType(buffer);
  if (!type) throw new HttpError(415, "Format non accepté : seules les images JPEG, PNG, WebP, AVIF et GIF sont autorisées.");
  const ext = path.extname(originalName || "").toLowerCase();
  if (ext && !type.exts.includes(ext)) {
    throw new HttpError(415, `L'extension « ${ext} » ne correspond pas au contenu du fichier (${type.mime}).`);
  }
  let meta;
  try {
    meta = await sharp(buffer, { limitInputPixels: MAX_PIXELS, failOn: "error" }).metadata();
    // Décodage complet : détecte les fichiers tronqués ou malformés.
    await sharp(buffer, { limitInputPixels: MAX_PIXELS, failOn: "error" }).resize(8, 8).raw().toBuffer();
  } catch {
    throw new HttpError(415, "Ce fichier n'est pas une image lisible (fichier corrompu ou trop grand).");
  }
  const width = meta.autoOrient?.width ?? meta.width;
  const height = meta.autoOrient?.height ?? meta.height;
  if (!width || !height) throw new HttpError(415, "Dimensions de l'image illisibles.");
  if (Math.min(width, height) < MIN_SIDE) throw badRequest(`Image trop petite (${width} × ${height} px) : ${MIN_SIDE} px minimum de côté.`);
  if (Math.max(width, height) > MAX_SIDE) throw badRequest(`Image trop grande (${width} × ${height} px) : ${MAX_SIDE} px maximum de côté.`);
  if ((meta.pages || 1) > 1) throw badRequest("Les images animées ne sont pas acceptées.");
  return { type, width, height };
}

const originalPath = (config, media) => path.join(config.mediaDir, "originals", media.file_name);
const cacheDir = (config) => path.join(config.mediaDir, "cache");

/** Fichier source d'un média (import ou image du dépôt). */
export function sourceFile(config, media) {
  if (media.storage === "repo") {
    const file = path.resolve(config.siteDir, media.repo_path);
    if (!file.startsWith(path.resolve(config.siteDir) + path.sep)) throw new Error("Chemin de média invalide");
    return file;
  }
  return originalPath(config, media);
}

/** Crée (si besoin) et renvoie le chemin d'une variante, en cache dans CMS_DATA_DIR/media/cache. */
export async function variantFile(config, media, variant) {
  const spec = VARIANTS[variant];
  if (!spec) throw new Error(`Variante inconnue : ${variant}`);
  const file = path.join(cacheDir(config), `${media.uid}-v${media.version}-${variant}.${spec.ext}`);
  if (fs.existsSync(file)) return file;
  fs.mkdirSync(cacheDir(config), { recursive: true });
  const src = sourceFile(config, media);
  if (!fs.existsSync(src)) throw notFound("Fichier du média introuvable.");
  let pipeline = sharp(src, { limitInputPixels: MAX_PIXELS }).rotate().resize({ ...spec.resize, withoutEnlargement: true });
  pipeline = spec.ext === "jpg" ? pipeline.jpeg({ quality: spec.quality, mozjpeg: true }) : pipeline.webp({ quality: spec.quality });
  const tmp = `${file}.${process.pid}.tmp`;
  await pipeline.toFile(tmp);
  fs.renameSync(tmp, file);
  return file;
}

export function serializeMedia(row) {
  if (!row) return null;
  return {
    id: row.id,
    uid: row.uid,
    storage: row.storage,
    repoPath: row.repo_path,
    originalName: row.original_name,
    mime: row.mime,
    size: row.size,
    width: row.width,
    height: row.height,
    alt: row.alt,
    credit: row.credit,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    thumbUrl: `/api/media/${row.id}/thumb?v=${row.version}`,
    previewUrl: `/api/media/${row.id}/preview?v=${row.version}`,
    usageCount: row.usage_count
  };
}

export function getMediaRow(db, id) {
  return db.get("SELECT * FROM media WHERE id = ?", id);
}

function newUid() {
  return crypto.randomBytes(6).toString("hex");
}

/** Importe une image (fichier déjà lu, taille limitée par l'API). */
export async function createUpload(config, db, buffer, originalName, user, { alt = "", credit = "" } = {}) {
  const name = cleanFileName(originalName);
  const { type, width, height } = await inspectUpload(buffer, name);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const existing = db.get("SELECT * FROM media WHERE sha256 = ?", sha256);
  if (existing) return { media: existing, duplicate: true };
  const uid = newUid();
  const fileName = `${uid}${type.exts[0]}`;
  const dir = path.join(config.mediaDir, "originals");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, fileName);
  fs.writeFileSync(`${file}.tmp`, buffer, { mode: 0o640 });
  fs.renameSync(`${file}.tmp`, file);
  const t = now();
  try {
    const { lastInsertRowid } = db.run(
      `INSERT INTO media (uid, storage, file_name, original_name, mime, size, width, height, sha256, alt, credit, created_by, created_at, updated_at)
       VALUES (?, 'upload', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      uid, fileName, name, type.mime, buffer.length, width, height, sha256, cleanText(alt).slice(0, 300), cleanText(credit).slice(0, 120), user?.id ?? null, t, t
    );
    const media = getMediaRow(db, Number(lastInsertRowid));
    await variantFile(config, media, "thumb_admin");
    return { media, duplicate: false };
  } catch (error) {
    fs.rmSync(file, { force: true });
    db.run("DELETE FROM media WHERE uid = ?", uid);
    throw error;
  }
}

/** Remplace le fichier d'un média : toutes les fiches qui l'utilisent reçoivent la nouvelle image. */
export async function replaceUpload(config, db, id, buffer, originalName) {
  const media = getMediaRow(db, id);
  if (!media) throw notFound("Média introuvable.");
  const name = cleanFileName(originalName);
  const { type, width, height } = await inspectUpload(buffer, name);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const other = db.get("SELECT id FROM media WHERE sha256 = ? AND id <> ?", sha256, id);
  if (other) throw conflict("Cette image existe déjà dans la médiathèque.", { mediaId: other.id });
  const fileName = `${media.uid}-v${media.version + 1}${type.exts[0]}`;
  const dir = path.join(config.mediaDir, "originals");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), buffer, { mode: 0o640 });
  const previous = media.storage === "upload" ? originalPath(config, media) : null;
  db.run(
    `UPDATE media SET storage = 'upload', repo_path = NULL, variants = '{}', file_name = ?, original_name = ?, mime = ?, size = ?,
       width = ?, height = ?, sha256 = ?, version = version + 1, updated_at = ? WHERE id = ?`,
    fileName, name, type.mime, buffer.length, width, height, sha256, now(), id
  );
  if (previous) fs.rmSync(previous, { force: true });
  purgeCache(config, media.uid);
  const updated = getMediaRow(db, id);
  await variantFile(config, updated, "thumb_admin");
  return updated;
}

function purgeCache(config, uid) {
  const dir = cacheDir(config);
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) if (f.startsWith(`${uid}-`)) fs.rmSync(path.join(dir, f), { force: true });
}

/** Image déjà présente dans le dépôt (import initial) : enregistrée sans copie. */
export async function registerRepoImage(config, db, repoPath, { alt = "", variants = {} } = {}) {
  const existing = db.get("SELECT * FROM media WHERE repo_path = ?", repoPath);
  if (existing) {
    // Image déjà connue (ex. photo de soirée aussi présente dans la galerie) : variantes complétées.
    const merged = { ...mediaVariants(existing), ...variants };
    if (JSON.stringify(merged) !== existing.variants) db.run("UPDATE media SET variants = ? WHERE id = ?", JSON.stringify(merged), existing.id);
    return getMediaRow(db, existing.id);
  }
  const file = path.join(config.siteDir, repoPath);
  if (!fs.existsSync(file)) throw new Error(`Image introuvable dans le dépôt : ${repoPath}`);
  const buffer = fs.readFileSync(file);
  const type = sniffType(buffer);
  const meta = await sharp(buffer).metadata();
  const t = now();
  const { lastInsertRowid } = db.run(
    `INSERT INTO media (uid, storage, repo_path, original_name, mime, size, width, height, sha256, alt, variants, created_at, updated_at)
     VALUES (?, 'repo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newUid(), repoPath, path.basename(repoPath), type?.mime || "image/webp", buffer.length, meta.width, meta.height,
    crypto.createHash("sha256").update(buffer).digest("hex"), alt, JSON.stringify(variants), t, t
  );
  return getMediaRow(db, Number(lastInsertRowid));
}

/**
 * Images du dépôt modifiées dans Git après leur enregistrement (réencodage, recadrage…) : la base garde
 * sinon l'ancienne empreinte, la taille, le format et les dimensions (exportées pour la galerie). Remet
 * ces métadonnées à jour depuis le fichier réel ; la version augmente (nouvelles miniatures de
 * l'administration, cache purgé). Ne touche jamais aux médias importés (storage = 'upload'), ni à une fiche
 * dont le fichier est absent, hors du site ou illisible (listée, laissée telle quelle). Lancée au démarrage
 * du CMS et à chaque mise en ligne ; sans effet si rien n'a changé.
 */
export async function syncRepoMedia(config, db) {
  const result = { checked: 0, updated: [], problems: [] };
  for (const media of db.all("SELECT * FROM media WHERE storage = 'repo' ORDER BY id")) {
    result.checked++;
    let buffer;
    try {
      const file = sourceFile(config, media);
      if (!fs.lstatSync(file).isFile()) throw new Error("pas un fichier");
      buffer = fs.readFileSync(file);
    } catch {
      result.problems.push({ id: media.id, repoPath: media.repo_path, problem: "fichier absent, hors du site ou illisible" });
      continue;
    }
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    if (sha256 === media.sha256) continue;
    let meta;
    try {
      meta = await sharp(buffer, { limitInputPixels: MAX_PIXELS }).metadata();
      if (!meta.width || !meta.height) throw new Error("dimensions illisibles");
    } catch {
      result.problems.push({ id: media.id, repoPath: media.repo_path, problem: "image illisible" });
      continue;
    }
    const after = { size: buffer.length, width: meta.width, height: meta.height, mime: sniffType(buffer)?.mime || media.mime };
    // Garde : la fiche n'a pas changé entre la lecture et l'écriture.
    const { changes } = db.run(
      "UPDATE media SET size = ?, width = ?, height = ?, mime = ?, sha256 = ?, version = version + 1, updated_at = ? WHERE id = ? AND sha256 IS ?",
      after.size, after.width, after.height, after.mime, sha256, now(), media.id, media.sha256
    );
    if (!changes) continue;
    purgeCache(config, media.uid);
    result.updated.push({
      id: media.id,
      repoPath: media.repo_path,
      before: { size: media.size, width: media.width, height: media.height, mime: media.mime },
      after
    });
  }
  return result;
}

/** Résumé lisible d'une resynchronisation (journal d'activité, journal de mise en ligne). */
export function describeRepoMediaSync({ updated }) {
  return updated.map((u) => {
    const dims = u.before.width !== u.after.width || u.before.height !== u.after.height ? `, ${u.before.width}×${u.before.height} → ${u.after.width}×${u.after.height}` : "";
    const mime = u.before.mime !== u.after.mime ? `, ${u.before.mime} → ${u.after.mime}` : "";
    return `${u.repoPath} (${u.before.size} → ${u.after.size} octets${dims}${mime})`;
  }).join(" ; ");
}

export const mediaVariants = (media) => fromJson(media.variants, {});

/** Où ce média est-il utilisé ? [{ type, id, label, role }] */
export function mediaUsage(db, id) {
  const rows = [
    ...db.all("SELECT id, title AS label, 'event' AS type, 'Affiche' AS role FROM events WHERE flyer_media_id = ?", id),
    ...db.all("SELECT id, title AS label, 'event' AS type, 'Photo de fond' AS role FROM events WHERE cover_media_id = ?", id),
    ...db.all("SELECT e.id, e.title AS label, 'event' AS type, 'Photo « La soirée »' AS role FROM event_photos p JOIN events e ON e.id = p.event_id WHERE p.media_id = ?", id),
    ...db.all("SELECT id, name AS label, 'artist' AS type, 'Photo' AS role FROM artists WHERE photo_media_id = ?", id),
    ...db.all("SELECT id, name AS label, 'team' AS type, 'Photo' AS role FROM team_members WHERE photo_media_id = ?", id),
    ...db.all("SELECT a.id, a.title AS label, 'album' AS type, 'Photo de galerie' AS role FROM gallery_photos p JOIN gallery_albums a ON a.id = p.album_id WHERE p.media_id = ?", id)
  ];
  return rows;
}

const USAGE_SQL = `(
  (SELECT COUNT(*) FROM events WHERE flyer_media_id = m.id OR cover_media_id = m.id) +
  (SELECT COUNT(*) FROM event_photos WHERE media_id = m.id) +
  (SELECT COUNT(*) FROM artists WHERE photo_media_id = m.id) +
  (SELECT COUNT(*) FROM team_members WHERE photo_media_id = m.id) +
  (SELECT COUNT(*) FROM gallery_photos WHERE media_id = m.id))`;

export function listMedia(db, { q = "", usage = "", storage = "", sort = "recent", page = 1, pageSize = 40 } = {}) {
  const where = [];
  const params = [];
  if (q) {
    where.push("(m.original_name LIKE ? ESCAPE '\\' OR m.alt LIKE ? ESCAPE '\\' OR m.repo_path LIKE ? ESCAPE '\\')");
    params.push(like(q), like(q), like(q));
  }
  if (storage === "upload" || storage === "repo") { where.push("m.storage = ?"); params.push(storage); }
  if (usage === "unused") where.push(`${USAGE_SQL} = 0`);
  if (usage === "used") where.push(`${USAGE_SQL} > 0`);
  if (usage === "noalt") where.push("m.alt = ''");
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const order = { recent: "m.id DESC", oldest: "m.id ASC", name: "m.original_name COLLATE NOCASE ASC", size: "m.size DESC" }[sort] || "m.id DESC";
  const total = db.get(`SELECT COUNT(*) AS n FROM media m ${clause}`, ...params).n;
  const items = db.all(`SELECT m.*, ${USAGE_SQL} AS usage_count FROM media m ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, pageSize, (page - 1) * pageSize);
  return { items: items.map(serializeMedia), total, page, pageSize };
}

export function updateMediaMeta(db, id, { alt, credit, originalName }) {
  const media = getMediaRow(db, id);
  if (!media) throw notFound("Média introuvable.");
  db.run(
    "UPDATE media SET alt = ?, credit = ?, original_name = ?, updated_at = ? WHERE id = ?",
    alt === undefined ? media.alt : cleanText(alt).slice(0, 300),
    credit === undefined ? media.credit : cleanText(credit).slice(0, 120),
    originalName === undefined ? media.original_name : cleanFileName(originalName),
    now(), id
  );
  return getMediaRow(db, id);
}

/** Suppression : refusée tant que le média est utilisé (la liste des usages est renvoyée). */
export function deleteMedia(config, db, id) {
  const media = getMediaRow(db, id);
  if (!media) throw notFound("Média introuvable.");
  const usage = mediaUsage(db, id);
  if (usage.length) {
    throw conflict("Ce média est encore utilisé : retirez-le des fiches concernées ou remplacez-le avant de le supprimer.", { usage });
  }
  db.run("DELETE FROM media WHERE id = ?", id);
  if (media.storage === "upload") fs.rmSync(originalPath(config, media), { force: true });
  purgeCache(config, media.uid);
  return media;
}

/**
 * Chemin public d'une variante dans le site exporté : assets/img/cms/<nom>-<uid>-v<version>[-variante].<ext>.
 * La version dans le nom évite qu'un navigateur ou un CDN garde l'ancienne image après un remplacement.
 */
export function exportPath(media, variant) {
  const spec = VARIANTS[variant];
  const base = slugify(path.parse(media.original_name).name, 40) || "image";
  const suffix = ["web", "flyer"].includes(variant) ? "" : `-${variant.replace("gallery_", "")}`;
  return `assets/img/cms/${base}-${media.uid}-v${media.version}${suffix}.${spec.ext}`;
}
