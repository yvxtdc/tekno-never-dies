/** Identifiants d'adresse (slugs) : "ICE BOILER v2 2026" -> "ice-boiler-v2-2026". */
export function slugify(text, max = 80) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[œŒ]/g, "oe")
    .replace(/[æÆ]/g, "ae")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

/** Slug libre dans une table : ajoute -2, -3… si besoin. */
export function uniqueSlug(db, table, base, excludeId = null, extraTaken = () => false) {
  const root = slugify(base) || "element";
  let candidate = root;
  for (let i = 2; ; i++) {
    const row = db.get(`SELECT id FROM ${table} WHERE slug = ? AND id IS NOT ?`, candidate, excludeId);
    if (!row && !extraTaken(candidate)) return candidate;
    candidate = `${root.slice(0, 75)}-${i}`;
  }
}

/** Même règle que js/components/artists.js : "Dann Octa" -> "dannocta". */
export const artistKey = (name) => String(name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Distance d'édition (détection de doublons probables : « Dann Octa » / « Dan Octa »). */
export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}
