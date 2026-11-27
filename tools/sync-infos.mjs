// Écrit les infos de l'association (js/data/association.js, saisies dans le CMS : « Infos de
// l'association ») dans les partials et les pages, partout où un élément porte un attribut data-info.
//
//   node tools/sync-infos.mjs           réécrit les fichiers (lancé par la mise en ligne du CMS et npm run partials)
//   node tools/sync-infos.mjs --check   vérifie seulement qu'ils sont à jour et bien marqués (utilisé par validate)
//
// Marquage et valeurs : js/components/association-info.js. Ne modifie jamais une valeur marquée à la main :
// elle est écrasée ; corrige-la dans le CMS. Les pages de/ et en/ suivent (tools/langues.mjs).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadInfos, syncInfoHtml, infoFiles } from "./lib/infos.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const { values, parseInfoSpec } = await loadInfos(ROOT);

let problems = 0;
for (const file of infoFiles(ROOT)) {
  const full = path.join(ROOT, file);
  const before = fs.readFileSync(full, "utf8");
  let after;
  try {
    after = syncInfoHtml(before, values, parseInfoSpec);
  } catch (error) {
    console.error(`✗ ${file} : ${error.message}`);
    problems++;
    continue;
  }
  if (after === before) continue;
  if (check) {
    console.error(`✗ ${file} : infos de l'association pas à jour (lance : node tools/sync-infos.mjs)`);
    problems++;
  } else {
    fs.writeFileSync(full, after);
    console.log(`✓ ${file} mis à jour`);
  }
}

if (problems) process.exit(1);
console.log(check ? "Infos de l'association à jour dans les pages." : "Terminé.");
