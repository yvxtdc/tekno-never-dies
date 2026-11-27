/**
 * Composition du bandeau « L'équipe » (page L'association) : mise en page de chaque carte, et contrôle
 * de l'ensemble. Rendu par js/components/team.js, styles dans css/components/team.css, format dans
 * js/components/team-layout.js, objets dans js/components/chrome.js.
 *
 * Source : la mise en page saisie dans le CMS (clé « layout » de chaque membre de js/data/equipe.js).
 * Sans elle, mise en page par défaut (DEFAULT_LAYOUT : tout en bas, aucun objet).
 *
 * TRANSITOIRE — LEGACY_COMPOSITION : réglages faits à la main avant que la mise en page passe dans le CMS.
 * Ils ne servent que tant que js/data/equipe.js n'a pas été réexporté par le CMS migré : la migration 007
 * les recopie dans la base de production (mêmes valeurs, vérifiées par cms/test/team-layout.test.mjs).
 * Une fois equipe.js exporté avec les mises en page, cette table et legacyLayout() seront supprimées.
 * Ne plus la modifier : régler les cartes dans le CMS.
 * Chaque entrée retient la photo pour laquelle elle a été réglée (photo.src) : photo changée = défaut.
 */

import { CHROME_OBJECTS } from "./chrome.js";
import { ALIGN_X, BOTTOM_Y, TOP_Y, defaultLayout, normalizeLayout, parseLayout } from "./team-layout.js";

export const LEGACY_COMPOSITION = {
  yannis: {
    photo: { src: "assets/img/equipe/yannis.webp", position: "50% 30%" },
    // Cheveux jusqu'en haut de la photo : tout le texte en bas
    badges: { align: "start", name: "bottom", role: "bottom", nameColor: "violet", roleColor: "cyan", tagsColor: "cyan" },
    objects: [
      // Grande étincelle sur la jointure avec la carte suivante, à hauteur du mur de briques
      { id: "etincelle-jointure", type: "sparkle", options: { points: 8 }, anchor: "end", x: 0, y: 21, size: 44 }
    ]
  },
  "jonathan-axel": {
    photo: { src: "assets/img/equipe/jonathan-axel.webp", position: "50% 45%" },
    badges: { align: "end", role: "bottom", nameColor: "cyan", roleColor: "violet", tagsColor: "violet" }
  },
  estebane: {
    photo: { src: "assets/img/equipe/estebane.webp", position: "50% 30%" },
    // Cheveux jusqu'en haut de la photo : tout le texte en bas, dans la pénombre
    badges: { align: "start", name: "bottom", role: "bottom", nameColor: "violet", roleColor: "cyan", tagsColor: "cyan" },
    objects: [
      // Éclair violet dans la pénombre à gauche du visage
      { id: "eclair", type: "bolt", options: { tint: "violet" }, x: 22, y: 50, size: 22, rotate: 10 }
    ]
  },
  ricky: {
    photo: { src: "assets/img/equipe/ricky.webp", position: "50% 40%" },
    badges: { align: "end", role: "bottom", tagsAlign: "end", nameColor: "cyan", roleColor: "violet", tagsColor: "violet" },
    objects: [
      // Verres qui trinquent, dans le halo jaune à droite, débordant sur le bord
      { id: "verres", type: "cocktails", x: 80, y: 51, size: 44 }
    ]
  },
  "celeste-yelena": {
    photo: { src: "assets/img/equipe/celeste-yelena.webp", position: "50% 55%" },
    badges: { align: "start", role: "bottom", nameColor: "violet", roleColor: "cyan", tagsColor: "cyan" },
    objects: [
      { id: "planete", type: "planet", options: { tint: "violet" }, x: 85, y: 15, size: 26, rotate: 4 }
    ]
  },
  remi: {
    photo: { src: "assets/img/equipe/remi.webp", position: "50% 45%" },
    badges: { align: "center", role: "top", nameColor: "cyan", roleColor: "violet", tagsColor: "violet" }
  },
  "elena-yanniv": {
    photo: { src: "assets/img/equipe/elena-yanniv.webp", position: "50% 45%" },
    badges: { align: "start", role: "bottom", nameColor: "violet", roleColor: "cyan", tagsColor: "violet" },
    objects: [
      // Dans le noir à droite, au-dessus de l'épaule
      { id: "paire-etoiles", type: "star-pair", x: 86, y: 33, size: 26, rotate: -8 }
    ]
  },
  noah: {
    photo: { src: "assets/img/equipe/noah.webp", position: "50% 40%" },
    // Missions à gauche : le coin bas droit reste libre pour l'épine
    badges: { align: "end", role: "bottom", tagsAlign: "start", nameColor: "cyan", roleColor: "violet", tagsColor: "violet" },
    objects: [
      // Épine qui monte de la jointure avec la carte suivante, en bas, et passe sous elle
      { id: "epine-jointure", type: "thorn", anchor: "end", x: 3, y: 99, size: 42, rotate: 32, layer: "between" }
    ]
  },
  josephine: {
    photo: { src: "assets/img/equipe/josephine.webp", position: "50% 50%" },
    badges: { align: "end", role: "top", nameColor: "cyan", roleColor: "violet", tagsColor: "violet" }
  }
};

/* Ancien format : nom en haut (align) ou en bas ; rôle sous le nom ou en bas ; missions en bas (tagsAlign). */
const LEGACY_BADGES = { align: "start", name: "top", role: "bottom", tagsAlign: "center", nameColor: "violet", roleColor: "cyan", tagsColor: "violet" };

/** Réglage de l'ancien format converti dans le format du CMS (rendu identique). */
export function legacyLayout(card) {
  const badges = { ...LEGACY_BADGES, ...card.badges };
  const head = [], foot = [];
  (badges.name === "bottom" ? foot : head).push("name");
  (badges.role === "top" && badges.name !== "bottom" ? head : foot).push("role");
  foot.push("missions");
  const group = (items, align, valign) => ({ items, x: ALIGN_X[align], y: valign === "top" ? TOP_Y : BOTTOM_Y, align, valign });
  return normalizeLayout({
    photo: { position: card.photo.position },
    groups: [...(head.length ? [group(head, badges.align, "top")] : []), group(foot, badges.tagsAlign, "bottom")],
    colors: { name: badges.nameColor, role: badges.roleColor, missions: badges.tagsColor },
    objects: card.objects || []
  });
}

/**
 * Mise en page d'une carte (membre de js/data/equipe.js), toujours complète.
 * source : "cms" (saisie dans le CMS), "legacy" (ancien réglage, transitoire) ou "default".
 */
export function cardComposition(member) {
  if (member.layout) return { source: "cms", ...normalizeLayout(member.layout) };
  const card = LEGACY_COMPOSITION[member.slug];
  if (card && card.photo.src === member.photo) return { source: "legacy", ...legacyLayout(card) };
  return { source: "default", ...defaultLayout() };
}

/**
 * Contrôle de la composition pour les membres de js/data/equipe.js (dans l'ordre du CMS ; le bandeau
 * boucle) : mises en page invalides, cartes par défaut, types inconnus, et familles d'objets répétées
 * sur une carte ou sur deux cartes voisines.
 * Renvoie une liste de messages (vide si tout va bien). Sans DOM : utilisé par tools/validate.mjs.
 */
export function compositionIssues(members) {
  const issues = [];
  const order = members.map((member) => member.slug);
  const n = order.length;
  for (const member of members) {
    if (member.layout) {
      const { errors } = parseLayout(member.layout);
      if (errors.length) issues.push(`${member.slug} : mise en page invalide, remplacée par la mise en page par défaut (${errors.join(" ; ")})`);
    } else if (cardComposition(member).source === "default") {
      issues.push(`${member.slug} : mise en page par défaut (aucune mise en page réglée pour cette carte)`);
    }
  }
  // Objets touchant chaque carte : les siens, et ceux « end » de la carte précédente
  const touching = order.map(() => []);
  members.forEach((member, i) => {
    const slug = member.slug;
    for (const object of cardComposition(member).objects) {
      const entry = CHROME_OBJECTS[object.type];
      if (!entry) { issues.push(`${slug} : objet « ${object.id || object.type} » de type inconnu (${object.type})`); continue; }
      const item = { key: `${slug}/${object.id || object.type}`, family: entry.family };
      touching[i].push(item);
      if (object.anchor === "end" && n > 1) touching[(i + 1) % n].push(item);
    }
  });
  const clash = (a, b) => a.family === b.family && a.key !== b.key;
  order.forEach((slug, i) => {
    const here = touching[i];
    here.forEach((a, k) => here.slice(k + 1).forEach((b) => {
      if (clash(a, b)) issues.push(`${slug} : deux objets de la famille « ${a.family} » sur la même carte (${a.key}, ${b.key})`);
    }));
    if (n < 2) return;
    const nextSlug = order[(i + 1) % n];
    for (const a of here) for (const b of touching[(i + 1) % n]) {
      if (clash(a, b) && !here.includes(b) && !touching[(i + 1) % n].includes(a)) {
        issues.push(`${slug} / ${nextSlug} : même famille « ${a.family} » sur deux cartes voisines (${a.key}, ${b.key})`);
      }
    }
  });
  return issues;
}
