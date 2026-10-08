/** Artistes : noms, liens Instagram et photos, partagés par la fiche soirée et la page Artistes. */
import { ARTISTS, ARTIST_STYLES } from "../data/artistes.js";
import { ARTIST_PHOTOS } from "../data/artistes-photos.js";
import { safeUrl } from "./helpers.js";

/** "Dann Octa" -> "dannocta" : majuscules, espaces et ponctuation ne comptent pas. */
export const artistKey = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

const byKey = new Map(Object.entries(ARTISTS).map(([name, url]) => [artistKey(name), { name, url }]));

/** "Leander B2B Sven Gerber" -> ["Leander", " B2B ", "Sven Gerber"] (séparateurs aux indices impairs). */
export const splitB2B = (name) => name.split(/(\s+b2b\s+)/i);

/** Les artistes d'une ligne du line-up : ["Leander", "Sven Gerber"]. */
export const artistsOf = (name = "") => splitB2B(name).filter((_, i) => i % 2 === 0).map((part) => part.trim()).filter(Boolean);

export const artistUrl = (name) => safeUrl(byKey.get(artistKey(name))?.url) || undefined;
export const artistPhoto = (name) => ARTIST_PHOTOS[artistKey(name)];
const styleByKey = new Map(Object.entries(ARTIST_STYLES).map(([name, style]) => [artistKey(name), style]));
export const artistStyle = (name) => styleByKey.get(artistKey(name));
/** Style d'une ligne du line-up : "Valk b2b Redfox" -> "Bouncy" (styles en double fusionnés). */
export const slotStyle = (name = "") => [...new Set(artistsOf(name).map(artistStyle).filter(Boolean))].join(" × ");
/** Nom tel qu'écrit dans js/data/artistes.js ("DANN OCTA" -> "Dann Octa"), sinon tel quel. */
export const artistDisplayName = (name) => byKey.get(artistKey(name))?.name || name.trim();
/** "https://www.instagram.com/dann_octa.watt/" -> "@dann_octa.watt" */
export const instagramHandle = (url = "") => {
  const handle = url.match(/instagram\.com\/([^/?#]+)/)?.[1];
  return handle ? `@${handle}` : "";
};

// Lignes du line-up qui ne sont pas un artiste.
const NOT_AN_ARTIST = /^(dj contest|guest|tba|surprise)/i;

/**
 * Tous les artistes des line-ups : [{ name, sets: [{ ev, with: [partenaires b2b] }] }],
 * les plus fidèles d'abord puis par ordre alphabétique. Soirées les plus récentes en premier.
 */
export function collectArtists(events) {
  const artists = new Map();
  for (const ev of [...events].sort((a, b) => b.date.localeCompare(a.date))) {
    for (const slot of ev.lineup || []) {
      if (!slot.name || slot.demo || NOT_AN_ARTIST.test(slot.name.trim())) continue;
      const names = artistsOf(slot.name);
      for (const name of names) {
        const key = artistKey(name);
        if (!key) continue;
        const artist = artists.get(key) || { name: artistDisplayName(name), sets: [] };
        if (!artist.sets.some((set) => set.ev === ev)) {
          artist.sets.push({ ev, with: names.filter((other) => artistKey(other) !== key).map(artistDisplayName) });
        }
        artists.set(key, artist);
      }
    }
  }
  return [...artists.values()].sort((a, b) => b.sets.length - a.sets.length || a.name.localeCompare(b.name, "fr"));
}
