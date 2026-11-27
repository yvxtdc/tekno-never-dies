/**
 * Composition du bandeau « L'équipe » (page L'association) : mise en page de chaque carte, et contrôle
 * de l'ensemble. Rendu par js/components/team.js, styles dans css/components/team.css, format dans
 * js/components/team-layout.js, objets dans js/components/chrome.js.
 *
 * Source : la mise en page saisie dans le CMS (clé « layout » de chaque membre de js/data/equipe.js).
 * Sans elle, mise en page par défaut (DEFAULT_LAYOUT : tout en bas, aucun objet).
 */

import { CHROME_OBJECTS } from "./chrome.js";
import { defaultLayout, normalizeLayout, parseLayout } from "./team-layout.js";

/**
 * Mise en page d'une carte (membre de js/data/equipe.js), toujours complète.
 * source : "cms" (saisie dans le CMS) ou "default" (aucune mise en page réglée).
 */
export function cardComposition(member) {
  if (member.layout) return { source: "cms", ...normalizeLayout(member.layout) };
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
