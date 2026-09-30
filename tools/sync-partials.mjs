// Insère partials/header.html et partials/footer.html directement dans chaque page.
//
//   node tools/sync-partials.mjs           réécrit les pages (à lancer après avoir modifié un partial)
//   node tools/sync-partials.mjs --check   vérifie seulement que les pages sont à jour (utilisé par validate)
//
// Chaque page contient deux zones balisées, par exemple :
//   <!-- partial:header -->  …contenu généré…  <!-- /partial:header -->
// Ne modifie jamais le contenu entre ces balises à la main : il est écrasé.
import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const NAMES = ["header", "footer"];

const partials = {};
for (const name of NAMES) partials[name] = (await readFile(path.join(ROOT, "partials", `${name}.html`), "utf8")).trim();

const pages = (await readdir(ROOT)).filter((f) => f.endsWith(".html")).sort();
let outdated = 0;

for (const page of pages) {
  const file = path.join(ROOT, page);
  const before = await readFile(file, "utf8");
  let after = before;
  for (const name of NAMES) {
    const re = new RegExp(`<!-- partial:${name} -->[\\s\\S]*?<!-- /partial:${name} -->`);
    if (!re.test(after)) {
      console.error(`✗ ${page} : balises « partial:${name} » absentes`);
      outdated++;
      continue;
    }
    after = after.replace(re, () => `<!-- partial:${name} -->\n${partials[name]}\n<!-- /partial:${name} -->`);
  }
  if (after !== before) {
    if (check) {
      console.error(`✗ ${page} : header/footer pas à jour (lance : node tools/sync-partials.mjs)`);
      outdated++;
    } else {
      await writeFile(file, after);
      console.log(`✓ ${page} mis à jour`);
    }
  }
}

if (outdated) process.exit(1);
console.log(check ? "Header et footer à jour dans toutes les pages." : "Terminé.");
