// Convertit les photos de profil des artistes et régénère js/data/artistes-photos.js
//
//   npm run artistes
//
// 1. Dépose les photos dans import/artistes/, nommées comme l'artiste dans
//    js/data/artistes.js : "Mogli.jpg", "Dann Octa.png", "KSCMD.webp"…
//    (majuscules, espaces et ponctuation ne comptent pas).
// 2. Lance la commande : chaque photo devient un carré WebP dans assets/img/artistes/
//    et s'affiche dans le cercle du line-up, sur toutes les fiches où l'artiste joue.
//
import sharp from "sharp";
import { readdir, writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ARTISTS } from "../js/data/artistes.js";

/* ---------- Réglages ---------- */
const SIZE = 320;         // px, carré (affiché dans un cercle d'environ 100 px)
const QUALITY = 80;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIR = path.join(ROOT, "import/artistes");
const DEST_DIR = path.join(ROOT, "assets/img/artistes");
const DATA_FILE = path.join(ROOT, "js/data/artistes-photos.js");
const web = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const exists = (p) => access(p).then(() => true, () => false);
// Même règle que js/pages/evenement.js : "Dann Octa" -> "dannocta"
const artistKey = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
const known = new Map(Object.keys(ARTISTS).map((name) => [artistKey(name), name]));

await mkdir(DEST_DIR, { recursive: true });

/* ---------- 1) Conversion des photos déposées ---------- */
if (await exists(SOURCE_DIR)) {
  const files = (await readdir(SOURCE_DIR)).filter((f) => /\.(jpe?g|png|webp|heic|heif)$/i.test(f));
  for (const f of files) {
    const key = artistKey(path.parse(f).name);
    if (!known.has(key)) {
      console.warn(`! ${f} : aucun artiste de ce nom dans js/data/artistes.js (ignorée)`);
      continue;
    }
    const out = path.join(DEST_DIR, `${key}.webp`);
    await sharp(path.join(SOURCE_DIR, f))
      .rotate()
      .resize(SIZE, SIZE, { fit: "cover", position: "attention" })
      .webp({ quality: QUALITY })
      .toFile(out);
    console.log(`✓ ${known.get(key)} → ${web(out)}`);
  }
}

/* ---------- 2) Liste des photos disponibles ---------- */
const photos = Object.fromEntries(
  (await readdir(DEST_DIR))
    .filter((f) => f.endsWith(".webp") && known.has(f.slice(0, -5)))
    .sort()
    .map((f) => [f.slice(0, -5), web(path.join(DEST_DIR, f))])
);

await writeFile(
  DATA_FILE,
  `/* FICHIER GÉNÉRÉ par tools/artistes.mjs — ne pas modifier à la main (il serait écrasé). */\n` +
    `export const ARTIST_PHOTOS = ${JSON.stringify(photos, null, 2)};\n`
);

const missing = [...known].filter(([key]) => !photos[key]).map(([, name]) => name);
console.log(`\n${Object.keys(photos).length} photo(s) d'artiste → ${web(DATA_FILE)}`);
if (missing.length) console.log(`Sans photo : ${missing.join(", ")}`);
