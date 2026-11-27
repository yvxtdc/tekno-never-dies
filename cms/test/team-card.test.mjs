/**
 * Rendu partagé des cartes de l'équipe (js/components/team-card.js) : chargeable sans navigateur, et
 * liste blanche SVG complète pour tous les dessins du site (sinon un tracé disparaîtrait sans erreur).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SVG_ELEMENTS, SVG_ATTRIBUTES, teamSlide } from "../../js/components/team-card.js";
import { CHROME_OBJECTS, chromeSvg } from "../../js/components/chrome.js";
import { MISSION_ICONS, missionIconSvg } from "../../js/components/mission-icons.js";

/** Tous les dessins possibles : chaque objet chromé avec chaque réglage permis, chaque pictogramme. */
function allDrawings() {
  const drawings = [];
  for (const type of Object.keys(CHROME_OBJECTS)) {
    for (const options of [undefined, { tint: "silver" }, { tint: "violet" }, { points: 4 }, { points: 8 }, { points: 4, tint: "violet" }]) {
      const svg = chromeSvg(type, options);
      if (svg) drawings.push([`${type} ${JSON.stringify(options || {})}`, svg]);
    }
  }
  for (const icon of Object.keys(MISSION_ICONS)) {
    // missionIconSvg part d'un libellé : on passe par le nom du pictogramme lui-même
    drawings.push([`mission ${icon}`, missionIconSvg(icon).replace(/>.*<\/svg>$/s, `>${MISSION_ICONS[icon]}</svg>`)]);
  }
  return drawings;
}

describe("rendu partagé d'une carte (team-card.js)", () => {
  test("module chargeable sans navigateur (aucun accès au DOM au chargement)", () => {
    assert.equal(typeof teamSlide, "function");
    assert.equal(typeof globalThis.document, "undefined");
  });

  test("chaque élément et attribut des dessins SVG du site est dans la liste blanche", () => {
    const drawings = allDrawings();
    assert.ok(drawings.length > Object.keys(CHROME_OBJECTS).length, "dessins trouvés");
    for (const [name, svg] of drawings) {
      for (const [, tag, attrs] of svg.matchAll(/<([a-zA-Z]+)\b([^>]*)>/g)) {
        assert.ok(SVG_ELEMENTS.has(tag), `${name} : élément <${tag}> absent de SVG_ELEMENTS`);
        for (const [, attr, value] of attrs.matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)) {
          assert.ok(SVG_ATTRIBUTES.has(attr), `${name} : attribut ${attr} absent de SVG_ATTRIBUTES`);
          if (/url\(/i.test(value)) assert.match(value, /^url\(#[\w-]+\)$/, `${name} : ${attr} doit viser un élément du dessin`);
        }
      }
    }
  });

  test("aucun gestionnaire d'événement ni lien externe autorisé par la liste blanche", () => {
    for (const attr of SVG_ATTRIBUTES) assert.ok(!/^on|href|style|src/i.test(attr), attr);
    for (const tag of ["script", "foreignObject", "a", "use", "image", "animate", "set"]) assert.ok(!SVG_ELEMENTS.has(tag), tag);
  });
});
