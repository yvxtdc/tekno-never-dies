import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const ignored = /^(https?:|mailto:|tel:|#|data:|javascript:|\/\/|\?|\{)/;
const files = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== "vendor" && entry.name !== ".git") walk(full);
    else if (entry.isFile() && /\.(html|css|js|xml|txt)$/.test(entry.name)) files.push(full);
  }
}

function report(file, message) {
  failures.push(`${path.relative(root, file)}: ${message}`);
}

walk(root);
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const references = [...source.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/g), ...source.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)];
  for (const match of references) {
    const reference = match[1].split(/[?#]/)[0];
    if (!reference || ignored.test(reference)) continue;
    const target = path.resolve(path.dirname(file), reference);
    if (!fs.existsSync(target)) report(file, `reference locale absente: ${reference}`);
  }
}

const dataFiles = ["js/data/events.js", "js/data/materiel.js"];
for (const relative of dataFiles) {
  const file = path.join(root, relative);
  const source = fs.readFileSync(file, "utf8");
  const slugs = [...source.matchAll(/slug:\s*["']([^"']+)["']/g)].map((match) => match[1]);
  const duplicates = slugs.filter((slug, index) => slugs.indexOf(slug) !== index);
  if (duplicates.length) report(file, `slugs dupliques: ${[...new Set(duplicates)].join(", ")}`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Validation OK: ${files.length} fichiers controles.`);
}
