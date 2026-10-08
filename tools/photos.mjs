// Convertit les photos d'un événement et régénère js/data/galerie.js
//
//   node tools/photos.mjs import/ice-boiler --titre "Soirée Ice Boiler" --date 2026-03-14
//   node tools/photos.mjs            (sans argument : régénère seulement galerie.js)
//
import sharp from "sharp";
import { readdir, readFile, writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* ---------- Réglages ---------- */
const WEBP_MAX = 1800;    // px, côté le plus long (affichage dans la galerie)
const WEBP_QUALITY = 78;
const KEEP_JPEG = true;   // true = crée aussi un .jpg haute qualité pour le bouton « Enregistrer »
const JPEG_MAX = 2800;
const JPEG_QUALITY = 88;
const THUMB_MAX = 720;    // px, vignette de la grille (affichée à ~350 px, nette sur écran Retina)
const THUMB_QUALITY = 72;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GALLERY_DIR = path.join(ROOT, "assets/img/gallery");
const DATA_FILE = path.join(ROOT, "js/data/galerie.js");
const web = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const exists = (p) => access(p).then(() => true, () => false);
const slugify = (s) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/* ---------- Arguments ---------- */
const args = process.argv.slice(2);
let source = null, titre = null, date = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--titre") titre = args[++i];
  else if (args[i] === "--date") date = args[++i];
  else if (!source) source = args[i];
}

/* ---------- 1) Conversion (si un dossier source est donné) ---------- */
if (source) {
  if (!titre || !/^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
    console.error('Il faut --titre "…" et --date AAAA-MM-JJ.\nEx. : node tools/photos.mjs import/ice-boiler --titre "Soirée Ice Boiler" --date 2026-03-14');
    process.exit(1);
  }
  const srcDir = path.resolve(source);
  if (!(await exists(srcDir))) { console.error(`Dossier introuvable : ${srcDir}`); process.exit(1); }

  const slug = slugify(path.basename(srcDir));
  const year = date.slice(0, 4);
  const dest = path.join(GALLERY_DIR, year, slug);
  await mkdir(dest, { recursive: true });

  // continue la numérotation si l'événement existe déjà
  const already = (await readdir(dest)).map((f) => /^photo-(\d+)\.webp$/.exec(f)).filter(Boolean).map((m) => +m[1]);
  let n = already.length ? Math.max(...already) + 1 : 1;

  const files = (await readdir(srcDir))
    .filter((f) => /\.(jpe?g|png|webp|heic|heif)$/i.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!files.length) { console.error("Aucune image dans ce dossier."); process.exit(1); }

  console.log(`\n${files.length} photo(s) → ${web(dest)}`);
  for (const f of files) {
    const base = `photo-${String(n).padStart(2, "0")}`;
    const input = path.join(srcDir, f);
    try {
      await sharp(input).rotate()
        .resize({ width: WEBP_MAX, height: WEBP_MAX, fit: "inside", withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY }).toFile(path.join(dest, `${base}.webp`));
      if (KEEP_JPEG) {
        await sharp(input).rotate()
          .resize({ width: JPEG_MAX, height: JPEG_MAX, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toFile(path.join(dest, `${base}.jpg`));
      }
      console.log(`  ✓ ${f} → ${base}`);
      n++;
    } catch (err) {
      console.warn(`  ✗ ${f} ignorée (${err.message})`);
    }
  }
  await writeFile(path.join(dest, "evenement.json"), JSON.stringify({ title: titre, date }, null, 2) + "\n");
}

/* ---------- 2) Régénération de js/data/galerie.js ---------- */
const byYear = new Map();
if (await exists(GALLERY_DIR)) {
  for (const y of await readdir(GALLERY_DIR)) {
    if (!/^\d{4}$/.test(y)) continue;
    for (const slug of await readdir(path.join(GALLERY_DIR, y))) {
      const dir = path.join(GALLERY_DIR, y, slug);
      const metaFile = path.join(dir, "evenement.json");
      if (!(await exists(metaFile))) continue;
      const meta = JSON.parse(await readFile(metaFile, "utf8"));
      const year = /^\d{4}/.test(meta.date || "") ? meta.date.slice(0, 4) : y;
      const names = (await readdir(dir)).filter((f) => /^photo-\d+\.webp$/.test(f))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const photos = [];
      for (const name of names) {
        const { width, height } = await sharp(path.join(dir, name)).metadata();
        const jpg = name.replace(/\.webp$/, ".jpg");
        const p = { src: web(path.join(dir, name)) };
        // Vignette légère pour la grille (créée une seule fois, à partir du WebP)
        const thumbName = name.replace(/\.webp$/, "-thumb.webp");
        if (!(await exists(path.join(dir, thumbName)))) {
          await sharp(path.join(dir, name))
            .resize({ width: THUMB_MAX, height: THUMB_MAX, fit: "inside", withoutEnlargement: true })
            .webp({ quality: THUMB_QUALITY }).toFile(path.join(dir, thumbName));
        }
        p.thumb = web(path.join(dir, thumbName));
        if (await exists(path.join(dir, jpg))) p.full = web(path.join(dir, jpg));
        p.w = width; p.h = height;
        photos.push(p);
      }
      if (!byYear.has(year)) byYear.set(year, []);
      byYear.get(year).push({ title: meta.title, eventSlug: slug, date: meta.date || `${year}-01-01`, photos });
    }
  }
}
const GALLERY = [...byYear.entries()]
  .sort((a, b) => b[0] - a[0])
  .map(([year, events]) => ({
    year: +year,
    events: events.sort((a, b) => b.date.localeCompare(a.date)).map(({ date, ...ev }) => ev),
  }));

await writeFile(
  DATA_FILE,
  "/* FICHIER GÉNÉRÉ par tools/photos.mjs — ne pas modifier à la main (il serait écrasé). */\n" +
    `export const GALLERY = ${JSON.stringify(GALLERY, null, 2)};\n`
);
const total = GALLERY.reduce((s, y) => s + y.events.reduce((t, e) => t + e.photos.length, 0), 0);
console.log(`\ngalerie.js mis à jour : ${GALLERY.reduce((s, y) => s + y.events.length, 0)} événement(s), ${total} photo(s).`);
