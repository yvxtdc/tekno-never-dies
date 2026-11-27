/**
 * Mise en page d'une carte du bandeau « L'équipe » (page L'association) : format, valeurs par défaut et
 * contrôle. Saisie dans le CMS (team_members.layout, migration 007), exportée dans js/data/equipe.js
 * (clé « layout » du membre, absente = mise en page par défaut), rendue par js/components/team.js.
 * Partagé par le site, tools/validate.mjs et le serveur du CMS (services/team.mjs) : aucun accès au DOM.
 *
 * Une seule mise en page pour mobile et ordinateur : les cartes ont presque la même largeur partout
 * (210 à 250 px, format 4/5) et toutes les valeurs sont en % de la carte. La photo n'est jamais modifiée.
 *
 * layout = {
 *   photo   : { position } — cadrage CSS (object-position) de la photo dans la carte, « 50% 40% »
 *   groups  : 1 à 3 groupes de pastilles posés sur la carte ; chacun empile ses éléments, dans l'ordre :
 *     items  : parmi "name", "role", "missions" (chacun présent dans exactement un groupe)
 *     x, y   : point d'ancrage en % de la largeur (x) et de la hauteur (y) de la carte
 *     align  : "start" (x = bord gauche du groupe) | "center" (x = son milieu) | "end" (x = son bord droit)
 *     valign : "top" (y = haut du groupe, qui s'allonge vers le bas) | "bottom" (y = son bas, il s'allonge
 *              vers le haut) : un texte plus long (traduction allemande, rôle sur deux lignes) s'étend
 *              à l'opposé de l'ancrage.
 *     Largeur du groupe : tout l'espace entre l'ancrage et la marge de la carte (groupWidth).
 *   colors  : { name, role, missions } : "violet" | "cyan"
 *   objects : objets chromés (au plus MAX_OBJECTS), chacun :
 *     id       nom lisible, unique sur la carte (data-decor dans la page)
 *     type     objet du catalogue CHROME_OBJECTS (chrome.js)
 *     options  réglages du dessin, facultatifs : tint "silver" | "violet" ; points 4 | 8 (étincelle)
 *     anchor   "card" : x mesuré depuis le bord gauche de la carte ;
 *              "end"  : x mesuré depuis le milieu de l'espace qui suit la carte (objet à cheval sur
 *                       deux cartes : x = 0 exactement entre les deux)
 *     x, y     centre de l'objet, en % de la largeur (x) et de la hauteur (y) de la carte
 *     size     largeur de l'objet, en % de la largeur de la carte (hauteur proportionnelle)
 *     rotate   rotation en degrés ; flip : miroir
 *     layer    "front" (devant toutes les cartes) | "between" (devant sa carte, sous la suivante) |
 *              "back" (derrière toutes les cartes, visible seulement dans les espaces)
 *     hideMobile : masqué sur les écrans ≤ 700 px
 * }
 * Les valeurs sont toujours complètes (normalizeLayout) : l'export est stable et comparable.
 */

import { CHROME_OBJECTS } from "./chrome.js";

export const ITEMS = ["name", "role", "missions"];
export const ALIGNS = ["start", "center", "end"];
export const VALIGNS = ["top", "bottom"];
export const COLORS = ["violet", "cyan"];
export const LAYERS = ["front", "between", "back"];
export const ANCHORS = ["card", "end"];
export const MAX_GROUPS = 3;
export const MAX_OBJECTS = 3;

/** Marge intérieure de la carte (7cqi), en % de sa largeur : les pastilles ne vont pas plus loin. */
export const MARGIN = 7;
/** Largeur minimale d'un groupe, en % de la carte (un ancrage collé au bord garde de la place). */
export const MIN_GROUP_WIDTH = 30;
/** Ancrages des pastilles en haut (9,5cqi) et en bas (8cqi) de la carte, en % de sa hauteur (4/5). */
export const TOP_Y = 7.6;
export const BOTTOM_Y = 93.6;
/** Ancrage horizontal selon l'alignement, contre la marge ou au milieu. */
export const ALIGN_X = { start: MARGIN, center: 50, end: 100 - MARGIN };

/** Mise en page par défaut (nouveau membre) : rien en haut de la photo, où sont souvent les têtes. */
export const DEFAULT_LAYOUT = Object.freeze({
  photo: { position: "50% 40%" },
  groups: [{ items: ["name", "role", "missions"], x: 50, y: BOTTOM_Y, align: "center", valign: "bottom" }],
  colors: { name: "violet", role: "cyan", missions: "violet" },
  objects: []
});

export const defaultLayout = () => structuredClone(DEFAULT_LAYOUT);

const round = (n) => Math.round(n * 100) / 100;
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const POSITION = /^(\d{1,3}(?:\.\d{1,2})?)% (\d{1,3}(?:\.\d{1,2})?)%$/;
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Largeur d'un groupe, en % de la carte : de son ancrage jusqu'à la marge (des deux côtés si centré). */
export function groupWidth({ x, align }) {
  const left = x - MARGIN, right = 100 - MARGIN - x;
  const width = align === "start" ? right : align === "end" ? left : 2 * Math.min(left, right);
  return round(Math.max(MIN_GROUP_WIDTH, width));
}

/**
 * Contrôle et normalise une mise en page saisie (CMS, import, fichier exporté).
 * Renvoie { layout, errors } : layout complet et ordonné si errors est vide, sinon null.
 */
export function parseLayout(raw) {
  const errors = [];
  if (!isObject(raw)) return { layout: null, errors: ["la mise en page doit être un objet"] };
  const unknown = (obj, keys, where) => {
    for (const key of Object.keys(obj)) if (!keys.includes(key)) errors.push(`${where} : réglage inconnu « ${key} »`);
  };
  const num = (value, min, max, where) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
      errors.push(`${where} : nombre attendu entre ${min} et ${max}`);
      return min;
    }
    return round(value);
  };
  const oneOf = (value, values, where) => {
    if (!values.includes(value)) errors.push(`${where} : valeur attendue parmi ${values.join(", ")}`);
    return value;
  };
  const bool = (value, where) => {
    if (value !== undefined && typeof value !== "boolean") errors.push(`${where} : vrai ou faux attendu`);
    return value === true;
  };
  unknown(raw, ["photo", "groups", "colors", "objects"], "mise en page");

  // Photo : cadrage seulement
  let position = DEFAULT_LAYOUT.photo.position;
  if (raw.photo !== undefined) {
    if (!isObject(raw.photo)) errors.push("photo : objet attendu");
    else {
      unknown(raw.photo, ["position"], "photo");
      const match = POSITION.exec(raw.photo.position ?? "");
      if (!match || Number(match[1]) > 100 || Number(match[2]) > 100) errors.push("photo : cadrage attendu sous la forme « 50% 40% »");
      else position = raw.photo.position;
    }
  }

  // Groupes de pastilles : nom, rôle et missions, chacun une fois
  const groups = [];
  if (!Array.isArray(raw.groups) || !raw.groups.length || raw.groups.length > MAX_GROUPS) {
    errors.push(`groupes : de 1 à ${MAX_GROUPS} groupes attendus`);
  } else {
    const seen = [];
    raw.groups.forEach((group, i) => {
      const where = `groupe ${i + 1}`;
      if (!isObject(group)) return errors.push(`${where} : objet attendu`);
      unknown(group, ["items", "x", "y", "align", "valign"], where);
      const items = Array.isArray(group.items) ? group.items : [];
      if (!items.length) errors.push(`${where} : au moins un élément (nom, rôle ou missions)`);
      for (const item of items) {
        if (!ITEMS.includes(item)) errors.push(`${where} : élément inconnu « ${item} »`);
        else if (seen.includes(item)) errors.push(`${where} : « ${item} » est déjà dans un autre groupe`);
        else seen.push(item);
      }
      groups.push({
        items: [...items],
        x: num(group.x, 0, 100, `${where}, x`),
        y: num(group.y, 0, 100, `${where}, y`),
        align: oneOf(group.align, ALIGNS, `${where}, alignement`),
        valign: oneOf(group.valign, VALIGNS, `${where}, ancrage vertical`)
      });
    });
    for (const item of ITEMS) if (!seen.includes(item)) errors.push(`groupes : « ${item} » n'est placé dans aucun groupe`);
  }

  // Couleurs des pastilles
  const colors = { ...DEFAULT_LAYOUT.colors };
  if (raw.colors !== undefined) {
    if (!isObject(raw.colors)) errors.push("couleurs : objet attendu");
    else {
      unknown(raw.colors, ITEMS, "couleurs");
      for (const item of ITEMS) if (raw.colors[item] !== undefined) colors[item] = oneOf(raw.colors[item], COLORS, `couleur (${item})`);
    }
  }

  // Objets chromés
  const objects = [];
  const rawObjects = raw.objects ?? [];
  if (!Array.isArray(rawObjects) || rawObjects.length > MAX_OBJECTS) {
    errors.push(`objets : au plus ${MAX_OBJECTS}`);
  } else {
    const ids = new Set();
    rawObjects.forEach((object, i) => {
      const where = `objet ${i + 1}`;
      if (!isObject(object)) return errors.push(`${where} : objet attendu`);
      unknown(object, ["id", "type", "options", "anchor", "x", "y", "size", "rotate", "flip", "layer", "hideMobile"], where);
      if (typeof object.id !== "string" || !ID.test(object.id)) errors.push(`${where} : identifiant attendu (minuscules, chiffres, tirets ; 40 caractères max)`);
      else if (ids.has(object.id)) errors.push(`${where} : identifiant « ${object.id} » déjà utilisé sur la carte`);
      else ids.add(object.id);
      if (!Object.hasOwn(CHROME_OBJECTS, object.type ?? "")) errors.push(`${where} : type inconnu « ${object.type} »`);
      const options = {};
      if (object.options !== undefined) {
        if (!isObject(object.options)) errors.push(`${where} : options attendues sous forme d'objet`);
        else {
          unknown(object.options, ["tint", "points"], `${where}, options`);
          if (object.options.tint !== undefined) options.tint = oneOf(object.options.tint, ["silver", "violet"], `${where}, teinte`);
          if (object.options.points !== undefined) options.points = oneOf(object.options.points, [4, 8], `${where}, branches`);
        }
      }
      objects.push({
        id: object.id,
        type: object.type,
        ...(Object.keys(options).length ? { options } : {}),
        anchor: oneOf(object.anchor ?? "card", ANCHORS, `${where}, ancrage`),
        x: num(object.x, -100, 200, `${where}, x`),
        y: num(object.y, -100, 200, `${where}, y`),
        size: num(object.size, 5, 100, `${where}, taille`),
        rotate: num(object.rotate ?? 0, -180, 180, `${where}, rotation`),
        flip: bool(object.flip, `${where}, miroir`),
        layer: oneOf(object.layer ?? "front", LAYERS, `${where}, plan`),
        hideMobile: bool(object.hideMobile, `${where}, masqué sur mobile`)
      });
    });
  }

  if (errors.length) return { layout: null, errors };
  return { layout: { photo: { position }, groups, colors, objects }, errors };
}

/** Mise en page complète d'une valeur supposée valide ; défaut si elle ne l'est pas (le rendu ne casse jamais). */
export function normalizeLayout(raw) {
  return (raw && parseLayout(raw).layout) || defaultLayout();
}

const ITEM_LABELS = { name: "nom", role: "rôle", missions: "missions" };
const ALIGN_LABELS = { start: "à gauche", center: "au centre", end: "à droite" };
const VALIGN_LABELS = { top: "en haut", bottom: "en bas" };

/** Résumé lisible (historique et programmations du CMS). null = mise en page par défaut. */
export function layoutSummary(layout) {
  if (!layout) return "par défaut";
  const { layout: l } = parseLayout(layout);
  if (!l) return "réglage invalide";
  const groups = l.groups.map((g) => {
    const items = g.items.map((item) => ITEM_LABELS[item]).join(", ");
    return `${items.charAt(0).toUpperCase()}${items.slice(1)} ${VALIGN_LABELS[g.valign]} ${ALIGN_LABELS[g.align]} (${g.x} %, ${g.y} %)`;
  });
  const objects = l.objects.map((o) => `${CHROME_OBJECTS[o.type].label} (${o.x} %, ${o.y} %, ${o.size} %)`);
  return [...groups, objects.length ? `Objets : ${objects.join(", ")}` : "Aucun objet"].join(" · ");
}

/* ---------- Opérations d'édition (éditeur du CMS) : toujours sur une copie, jamais en place ---------- */

const slugOf = (text) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Identifiant libre sur la carte pour un nouvel objet de ce type : « etincelle », « etincelle-2 »… */
export function objectId(layout, type) {
  const base = slugOf(CHROME_OBJECTS[type]?.label || type) || "objet";
  const taken = new Set(layout.objects.map((o) => o.id));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** Ajoute un objet du catalogue (réglages par défaut du catalogue), au milieu de la carte par défaut. */
export function addObject(layout, type, { x = 50, y = 50, size = 24 } = {}) {
  const entry = CHROME_OBJECTS[type];
  if (!entry) throw new Error(`Objet inconnu : ${type}.`);
  if (layout.objects.length >= MAX_OBJECTS) throw new Error(`${MAX_OBJECTS} objets au plus par carte.`);
  const next = structuredClone(layout);
  const options = Object.fromEntries(Object.entries(entry.options || {}).map(([key, values]) => [key, values[0]]));
  next.objects.push({
    id: objectId(layout, type), type, ...(Object.keys(options).length ? { options } : {}),
    anchor: "card", x, y, size, rotate: 0, flip: false, layer: "front", hideMobile: false
  });
  return next;
}

/** Retire un objet. */
export function removeObject(layout, id) {
  const next = structuredClone(layout);
  next.objects = next.objects.filter((o) => o.id !== id);
  return next;
}

/**
 * Déplace un élément (name, role, missions) dans le groupe d'indice `to`, ou dans un nouveau groupe
 * (`to` = null) placé selon `place`. Dans un groupe, l'ordre de lecture reste nom, rôle, missions ; un
 * groupe vidé est retiré.
 */
export function moveItem(layout, item, to, place = { x: 50, y: 50, align: "center", valign: "top" }) {
  if (!ITEMS.includes(item)) throw new Error(`Élément inconnu : ${item}.`);
  const next = structuredClone(layout);
  const from = next.groups.find((g) => g.items.includes(item));
  const target = to === null ? null : next.groups[to];
  if (to !== null && !target) throw new Error("Groupe introuvable.");
  if (target === from) return next;
  if (!target && next.groups.length >= MAX_GROUPS && from.items.length > 1) throw new Error(`${MAX_GROUPS} groupes au plus.`);
  from.items = from.items.filter((i) => i !== item);
  if (target) target.items = ITEMS.filter((i) => i === item || target.items.includes(i));
  else next.groups.push({ items: [item], ...place });
  next.groups = next.groups.filter((g) => g.items.length);
  return next;
}
