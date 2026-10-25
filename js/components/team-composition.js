/**
 * Composition du bandeau « L'équipe » (page L'association) : tout ce qui est posé par-dessus les photos.
 *
 * Les photos, noms, rôles et missions viennent du CMS (js/data/equipe.js) : ici, seulement la mise en
 * scène, réglable sans toucher aux photos. Rendu par js/components/team.js, styles dans
 * css/components/team.css, catalogue des objets dans js/components/chrome.js, pictogrammes des
 * missions dans js/components/mission-icons.js. Une entrée dont la fiche n'existe plus est ignorée.
 *
 * Réglages liés à UNE photo : zones protégées et objets dépendent de ce que montre la photo. Chaque fiche
 * retient donc la photo pour laquelle elle a été réglée (photo.src). Nouveau membre (pas d'entrée ici) ou
 * photo changée dans le CMS (src différent) : mise en page sûre, sans rien poser sur la photo (texte en
 * bas, aucun objet, couleurs gardées), et npm run validate le signale (aussi dans le journal de mise en
 * ligne du CMS) jusqu'à ce que la fiche soit réglée ici pour la nouvelle photo.
 *
 * Par fiche (clé = slug du membre, fixé à la création dans le CMS) :
 *   photo   : { src, position } — photo de référence (chemin de js/data/equipe.js) et cadrage CSS
 *             (object-position) de la photo dans la carte.
 *   protect : zones à laisser dégagées (visages, gestes, éléments forts de la photo), chacune
 *             [x, y, largeur, hauteur] en % DE LA PHOTO (pas de la carte) : elles restent justes
 *             quel que soit le recadrage. Ni pastille ni objet ne doit les recouvrir. Contrôle visuel :
 *             ouvrir association.html?composition (zones en vert, chevauchements en rouge et listés
 *             dans la console), à vérifier en mobile comme en desktop.
 *   badges  : { align: "start" | "center" | "end",   alignement du nom quand il est en haut
 *               name: "top" | "bottom",              nom en haut de la carte, ou en bas (au-dessus du rôle
 *                                                    et des missions) quand une tête occupe le haut
 *               role: "top" | "bottom",              rôle sous le nom (en haut), ou en bas avec les missions
 *               tagsAlign: idem align, pour le bas (rôle et pictogrammes des missions),
 *               couleurs : nameColor / roleColor / tagsColor (pictogrammes) : "violet" | "cyan" }
 *   objects : objets chromés (au plus un ou deux, beaucoup de cartes n'en ont pas), chacun :
 *     id       nom lisible (data-decor dans la page)
 *     type     objet du catalogue CHROME_OBJECTS (chrome.js) : "sparkle", "bolt", "planet",
 *              "cocktails", "star-pair", "thorn"…
 *     options  réglages du dessin (tint: "silver" | "violet" ; sparkle : points: 4 | 8)
 *     anchor   "card" : x mesuré depuis le bord gauche de la carte ;
 *              "end"  : x mesuré depuis le milieu de l'espace qui suit la carte (objet à cheval sur
 *                       deux photos : x = 0 le centre exactement entre les deux).
 *     x, y     position du CENTRE de l'objet, en % de la largeur (x) et de la hauteur (y) de la carte
 *     size     largeur de l'objet, en % de la largeur de la carte (hauteur proportionnelle)
 *     rotate   rotation en degrés ; flip: true pour le miroir
 *     layer    "front" : devant toutes les cartes (par défaut) ;
 *              "between" : devant sa carte, mais derrière la carte suivante (passe sous elle) ;
 *              "back" : derrière toutes les cartes (visible seulement dans les espaces).
 *     mobile   mêmes clés (x, y, size, rotate) pour les écrans ≤ 700 px, ou false pour masquer l'objet
 *
 * Variété : deux objets distincts de la même famille de silhouette (CHROME_OBJECTS[type].family) ne
 * doivent pas se trouver sur une même carte ni sur deux cartes voisines (un objet à cheval compte pour
 * les deux cartes qu'il touche). compositionIssues() le vérifie selon l'ordre des fiches du CMS ;
 * npm run validate le signale.
 *
 * Les objets sont statiques : le défilement du bandeau est déjà le mouvement de la section.
 */

import { CHROME_OBJECTS } from "./chrome.js";

export const DEFAULT_CARD = {
  photo: { position: "50% 40%" },
  protect: [],
  badges: { align: "start", name: "top", role: "bottom", tagsAlign: "center", nameColor: "violet", roleColor: "cyan", tagsColor: "violet" },
  objects: []
};

/* Mise en page sûre (nouveau membre, photo changée) : rien en haut de la photo, où sont souvent les têtes */
export const SAFE_BADGES = { name: "bottom", role: "bottom", tagsAlign: "center" };

export const TEAM_COMPOSITION = {
  yannis: {
    photo: { src: "assets/img/equipe/yannis.webp", position: "50% 30%" },
    // Tête : cheveux (haut arrondi) puis visage
    protect: [[41, 3, 31, 8], [37, 10, 38, 34]],
    // Cheveux jusqu'en haut de la photo : tout le texte en bas
    badges: { align: "start", name: "bottom", role: "bottom", nameColor: "violet", roleColor: "cyan", tagsColor: "cyan" },
    objects: [
      // Grande étincelle sur la jointure avec la carte suivante, à hauteur du mur de briques
      { id: "etincelle-jointure", type: "sparkle", options: { points: 8 }, anchor: "end", x: 0, y: 21, size: 44,
        mobile: { size: 42 } }
    ]
  },
  "jonathan-axel": {
    photo: { src: "assets/img/equipe/jonathan-axel.webp", position: "50% 45%" },
    // Visages, du haut des cheveux au menton
    protect: [[17, 29, 26, 26], [54, 24, 24, 28]],
    badges: { align: "end", role: "bottom", nameColor: "cyan", roleColor: "violet", tagsColor: "violet" }
  },
  estebane: {
    photo: { src: "assets/img/equipe/estebane.webp", position: "50% 30%" },
    protect: [[45, 1, 40, 44]],
    // Cheveux jusqu'en haut de la photo : tout le texte en bas, dans la pénombre
    badges: { align: "start", name: "bottom", role: "bottom", nameColor: "violet", roleColor: "cyan", tagsColor: "cyan" },
    objects: [
      // Éclair violet dans la pénombre à gauche du visage
      { id: "eclair", type: "bolt", options: { tint: "violet" }, x: 22, y: 50, size: 22, rotate: 10 }
    ]
  },
  ricky: {
    photo: { src: "assets/img/equipe/ricky.webp", position: "50% 40%" },
    // Tête, et l'enseigne « NEVER DIES » à gauche
    protect: [[41, 17, 26, 24], [0, 44, 14, 36]],
    badges: { align: "end", role: "bottom", tagsAlign: "end", nameColor: "cyan", roleColor: "violet", tagsColor: "violet" },
    objects: [
      // Verres qui trinquent, dans le halo jaune à droite, débordant sur le bord
      { id: "verres", type: "cocktails", x: 80, y: 51, size: 44, mobile: { size: 42 } }
    ]
  },
  "celeste-yelena": {
    photo: { src: "assets/img/equipe/celeste-yelena.webp", position: "50% 55%" },
    protect: [[25, 25, 27, 29], [51, 28, 26, 27]],
    badges: { align: "start", role: "bottom", nameColor: "violet", roleColor: "cyan", tagsColor: "cyan" },
    objects: [
      { id: "planete", type: "planet", options: { tint: "violet" }, x: 85, y: 15, size: 26, rotate: 4 }
    ]
  },
  remi: {
    photo: { src: "assets/img/equipe/remi.webp", position: "50% 45%" },
    protect: [[39, 44, 22, 21], [20, 30, 58, 17]],
    badges: { align: "center", role: "top", nameColor: "cyan", roleColor: "violet", tagsColor: "violet" }
  },
  "elena-yanniv": {
    photo: { src: "assets/img/equipe/elena-yanniv.webp", position: "50% 45%" },
    protect: [[19, 16, 29, 27], [43, 22, 28, 28]],
    badges: { align: "start", role: "bottom", nameColor: "violet", roleColor: "cyan", tagsColor: "violet" },
    objects: [
      // Dans le noir à droite, au-dessus de l'épaule
      { id: "paire-etoiles", type: "star-pair", x: 86, y: 33, size: 26, rotate: -8, mobile: { size: 25 } }
    ]
  },
  noah: {
    photo: { src: "assets/img/equipe/noah.webp", position: "50% 40%" },
    protect: [[49, 16, 26, 22], [25, 7, 18, 18]],
    // Missions à gauche : le coin bas droit reste libre pour l'épine
    badges: { align: "end", role: "bottom", tagsAlign: "start", nameColor: "cyan", roleColor: "violet", tagsColor: "violet" },
    objects: [
      // Épine qui monte de la jointure avec la carte suivante, en bas, et passe sous elle
      { id: "epine-jointure", type: "thorn", anchor: "end", x: 3, y: 99, size: 42, rotate: 32, layer: "between",
        mobile: { size: 38 } }
    ]
  },
  josephine: {
    photo: { src: "assets/img/equipe/josephine.webp", position: "50% 50%" },
    protect: [[30, 38, 30, 29], [48, 50, 30, 28]],
    badges: { align: "end", role: "top", nameColor: "cyan", roleColor: "violet", tagsColor: "violet" }
  }
};

/**
 * Composition complète d'une fiche (membre de js/data/equipe.js), valeurs par défaut comprises.
 * tuned : faux si la fiche n'est pas réglée pour la photo actuelle (mise en page sûre, voir plus haut).
 */
export function cardComposition(member) {
  const card = TEAM_COMPOSITION[member.slug];
  const tuned = Boolean(card && card.photo?.src === member.photo);
  if (!tuned) {
    // Seules les couleurs restent : elles ne dépendent pas de la photo
    const colors = ({ nameColor, roleColor, tagsColor }) => ({ nameColor, roleColor, tagsColor });
    return {
      tuned,
      photo: { ...DEFAULT_CARD.photo },
      protect: [],
      badges: { ...DEFAULT_CARD.badges, ...(card ? colors({ ...DEFAULT_CARD.badges, ...card.badges }) : {}), ...SAFE_BADGES },
      objects: []
    };
  }
  return {
    tuned,
    photo: { ...DEFAULT_CARD.photo, ...card.photo },
    protect: card.protect || DEFAULT_CARD.protect,
    badges: { ...DEFAULT_CARD.badges, ...card.badges },
    objects: card.objects || []
  };
}

/**
 * Contrôle de la composition pour les membres de js/data/equipe.js (dans l'ordre du CMS ; le bandeau
 * boucle) : fiches à régler (nouveau membre, photo changée), types inconnus, et familles d'objets
 * répétées sur une carte ou sur deux cartes voisines.
 * Renvoie une liste de messages (vide si tout va bien). Sans DOM : utilisé par tools/validate.mjs.
 */
export function compositionIssues(members) {
  const issues = [];
  const order = members.map((member) => member.slug);
  const n = order.length;
  for (const member of members) {
    if (!TEAM_COMPOSITION[member.slug]) issues.push(`${member.slug} : nouveau membre, mise en page par défaut (zones protégées et objets à régler)`);
    else if (!cardComposition(member).tuned) issues.push(`${member.slug} : photo changée (${member.photo}), mise en page par défaut tant que la fiche n'est pas réglée pour elle`);
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
