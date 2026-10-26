/** Fonctions de l'interface d'administration sans dépendance au navigateur. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sectionFromHash } from "../admin/js/lib/hash.js";

test("ancre de section : sans ancre, ancre inconnue ou élément qui n'est pas une section → null, sans erreur", () => {
  const section = { classList: { contains: (c) => c === "form-section" } };
  const other = { classList: { contains: () => false } };
  const byId = (id) => ({ billetterie: section, "titre-x": other }[id] ?? null);
  // Cas de l'erreur corrigée : location.hash vaut "" à l'ouverture d'une soirée sans #section.
  assert.equal(sectionFromHash("", byId), null);
  assert.equal(sectionFromHash("#", byId), null);
  assert.equal(sectionFromHash("#inconnue", byId), null);
  assert.equal(sectionFromHash("#titre-x", byId), null);
  assert.equal(sectionFromHash("#%E0", byId), null, "ancre mal encodée");
  assert.equal(sectionFromHash("#billetterie", byId), section);
});
