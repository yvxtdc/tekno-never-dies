/**
 * Badges des missions de l'équipe : pictogrammes et catalogue du site (js/components/mission-icons.js,
 * servi par /admin/shared/mission-icons.js), pour les choisir dans la fiche d'un membre.
 */
import { h } from "./dom.js";
import { dialog } from "./ui.js";
import { MISSION_CATALOG, MISSION_ICONS, missionIcon } from "/admin/shared/mission-icons.js";

const SVG = "http://www.w3.org/2000/svg";
const SHAPES = new Set(["path", "circle", "rect", "ellipse", "line", "polyline", "polygon"]);

/** Pictogramme d'une mission (même dessin que sur le site), construit nœud par nœud. */
export function missionIconNode(mission) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "mission-icon");
  // Tracés constants du code du site (pas de donnée saisie) ; seules les formes SVG simples sont reprises.
  const parsed = new DOMParser().parseFromString(`<svg xmlns="${SVG}">${MISSION_ICONS[missionIcon(mission)]}</svg>`, "image/svg+xml");
  for (const node of parsed.documentElement.children) {
    if (SHAPES.has(node.localName)) svg.append(document.importNode(node, false));
  }
  return svg;
}

/** Toutes les missions du catalogue (libellés), pour les suggestions à la frappe. */
export const catalogMissions = MISSION_CATALOG.flatMap(({ missions }) => missions.map(([label]) => label));

/**
 * Fenêtre « Catalogue des badges » : recherche, missions par pôle, cocher / décocher.
 * selected : missions actuelles ; max : nombre maximum ; onChange(missions) à chaque changement.
 */
export function openMissionCatalog({ selected, max, onChange }) {
  let current = [...selected];
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  const count = h("p", { class: "mission-catalog__count", "aria-live": "polite" });
  const search = h("input", { type: "search", class: "input", placeholder: "Rechercher une mission…", "aria-label": "Rechercher une mission" });
  const buttons = [];

  const refresh = () => {
    count.textContent = `${current.length} / ${max} mission(s) choisie(s)`;
    for (const { button, label } of buttons) {
      const on = current.some((m) => same(m, label));
      button.setAttribute("aria-pressed", String(on));
      button.disabled = !on && current.length >= max;
    }
  };

  const groups = MISSION_CATALOG.map(({ group, missions }) => {
    const items = missions.map(([label]) => {
      const button = h("button", {
        type: "button",
        class: "mission-option",
        onclick: () => {
          current = current.some((m) => same(m, label)) ? current.filter((m) => !same(m, label)) : [...current, label];
          refresh();
          onChange(current);
        }
      }, h("span", { class: "mission-badge" }, missionIconNode(label)), h("span", {}, label));
      buttons.push({ button, label });
      return button;
    });
    const section = h("section", { class: "mission-catalog__group" }, h("h3", {}, group), h("div", { class: "mission-catalog__grid" }, items));
    return { section, items: items.map((button, i) => ({ button, label: missions[i][0] })) };
  });

  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    for (const { section, items } of groups) {
      let visible = 0;
      for (const { button, label } of items) {
        const match = !q || label.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(q);
        button.hidden = !match;
        if (match) visible++;
      }
      section.hidden = !visible;
    }
  });

  const body = h("div", { class: "mission-catalog" },
    h("p", { class: "muted" }, "Cliquez pour ajouter ou retirer une mission. Chaque badge s'affiche sur la carte du membre ; une mission écrite à la main reçoit un pictogramme d'après ses mots."),
    h("div", { class: "mission-catalog__bar" }, search, count),
    groups.map((g) => g.section));
  refresh();
  const d = dialog({ title: "Catalogue des badges", wide: true, body, actions: [h("button", { type: "button", class: "btn btn--primary", onclick: () => d.close() }, "Terminé")] });
  search.focus();
  return d;
}
