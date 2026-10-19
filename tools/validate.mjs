// Contrôle le site avant publication :  node tools/validate.mjs   (ou : npm run validate)
//
//   ✗ erreurs    → font échouer la commande (liens cassés, HTML mal fermé, header/footer pas à jour…)
//   ! à compléter → informations encore fictives ou manquantes ; ne bloquent pas (--strict pour bloquer)
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const strict = process.argv.includes("--strict");
const errors = [];
const todo = [];
const rel = (f) => path.relative(root, f).replaceAll("\\", "/");
const read = (f) => fs.readFileSync(f, "utf8");
const err = (file, msg) => errors.push(`${rel(file)} : ${msg}`);

/* ---------- fichiers du site ---------- */
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", "vendor", "import", "dist"].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (/\.(html|css|js|mjs|xml|txt)$/.test(e.name) && !full.includes(`${path.sep}assets${path.sep}`)) files.push(full);
  }
})(root);
const pages = files.filter((f) => path.dirname(f) === root && f.endsWith(".html"));
// Pages allemandes et anglaises générées par tools/langues.mjs (contrôlées par sa vérification, plus bas)
const generated = (f) => /^(de|en)\//.test(rel(f));

/* ---------- 1. liens et ressources locaux ---------- */
const skip = /^(https?:|webcal:|mailto:|tel:|#|data:|javascript:|\/\/|\?)/;
for (const file of files.filter((f) => /\.(html|css|js)$/.test(f))) {
  const source = read(file).replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const refs = [...source.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/g), ...source.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)];
  for (const [, raw] of refs) {
    if (raw.includes("${") || skip.test(raw)) continue;
    const ref = raw.split(/[?#]/)[0];
    if (!ref) continue;
    // Les chemins écrits dans les scripts de pages sont relatifs à la page (racine du site).
    // Idem pour les partials : leur contenu est copié dans les pages, à la racine.
    // Pages de/ et en/ : <base href="../">, leurs chemins partent aussi de la racine.
    const base = file.endsWith(".js") || rel(file).startsWith("partials/") || generated(file) ? root : path.dirname(file);
    if (!fs.existsSync(path.resolve(base, ref))) err(file, `référence absente : ${raw}`);
  }
}

/* ---------- 2. header / footer synchronisés ---------- */
const sync = spawnSync(process.execPath, [path.join(root, "tools", "sync-partials.mjs"), "--check"], { encoding: "utf8" });
if (sync.status !== 0) errors.push(...sync.stderr.trim().split("\n").filter(Boolean));

/* ---------- 2 bis. agenda .ics à jour ---------- */
const calendar = spawnSync(process.execPath, [path.join(root, "tools", "generate-calendar.mjs"), "--check"], { encoding: "utf8" });
if (calendar.status !== 0) errors.push(calendar.stderr.trim().split("\n").filter(Boolean).at(-1) || "calendar/events.ics pas à jour");

/* ---------- 2 ter. fiches événement (evenement-….html) à jour ---------- */
const eventPages = spawnSync(process.execPath, [path.join(root, "tools", "event-pages.mjs"), "--check"], { encoding: "utf8" });
if (eventPages.status !== 0) errors.push(...eventPages.stderr.trim().split("\n").filter(Boolean));

/* ---------- 2 quater. pages de/ et en/, sitemap à jour ---------- */
const langPages = spawnSync(process.execPath, [path.join(root, "tools", "langues.mjs"), "--check"], { encoding: "utf8" });
if (langPages.status !== 0) errors.push(...langPages.stderr.trim().split("\n").filter(Boolean));

/* ---------- 3. structure HTML de chaque page ---------- */
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
for (const file of pages) {
  const html = read(file);
  const clean = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "<$1></$1>");
  const stack = [];
  for (const m of clean.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>])*)>/g)) {
    const [, closing, tag, attrs] = m;
    const name = tag.toLowerCase();
    if (VOID.has(name) || attrs.trimEnd().endsWith("/")) continue;
    if (!closing) stack.push(name);
    else if (stack.at(-1) === name) stack.pop();
    else err(file, `balise </${name}> inattendue (ouverte : <${stack.at(-1) ?? "aucune"}>)`);
  }
  if (stack.length) err(file, `balise(s) non fermée(s) : ${stack.join(", ")}`);

  const ids = [...clean.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) err(file, `id en double : ${[...new Set(dup)].join(", ")}`);

  const noindex = /<meta name="robots" content="noindex"/.test(html);
  if (!/<html lang="fr"/.test(html)) err(file, "attribut lang manquant");
  if (!/<title>[^<]+<\/title>/.test(html)) err(file, "balise <title> manquante");
  if (!noindex && !/<meta name="description" content="[^"]+"/.test(html)) err(file, "meta description manquante");
  if (!noindex && !/<meta property="og:image" content="https:\/\/[^"]+"/.test(html)) err(file, "og:image manquante (aperçu sur les réseaux sociaux)");
  if ((clean.match(/<h1[\s>]/g) || []).length > 1) err(file, "plusieurs <h1>");
  if (!/<main id="main"/.test(html)) err(file, '<main id="main"> manquant (cible du lien « Aller au contenu »)');
  for (const m of clean.matchAll(/<img\b[^>]*>/g)) if (!/\salt=/.test(m[0])) err(file, `image sans alt : ${m[0].slice(0, 70)}`);

  // Politique de sécurité : présente, et autorise chaque script écrit dans la page (empreinte sha256).
  const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
  if (!csp) err(file, "meta Content-Security-Policy manquante");
  else {
    // Les blocs JSON-LD ne sont pas exécutés : la CSP ne les concerne pas.
    for (const m of html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/g)) {
      const hash = `'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`;
      if (!csp.includes(hash)) err(file, `script en ligne modifié : ajouter ${hash} au script-src de la CSP (toutes les pages)`);
    }
  }
}

/* ---------- 4. données ---------- */
const events = (await import(pathToFileURL(path.join(root, "js/data/events.js")).href)).EVENTS;
const slugs = events.map((e) => e.slug);
const dupSlugs = slugs.filter((s, i) => slugs.indexOf(s) !== i);
if (dupSlugs.length) err(path.join(root, "js/data/events.js"), `slugs en double : ${[...new Set(dupSlugs)].join(", ")}`);
for (const e of events) if (e.demo) todo.push(`événement « ${e.slug} » encore marqué demo`);

// Contenus de démonstration (masqués au public, mais à remplacer) et réponses à faire relire
const dataModule = async (name) => import(pathToFileURL(path.join(root, "js/data", name)).href);
const { TEAM } = await dataModule("equipe.js");
const { FAQ } = await dataModule("faq.js");
const demoCount = (list) => list.filter((x) => x.demo).length;
if (demoCount(TEAM)) todo.push(`js/data/equipe.js : ${demoCount(TEAM)} profil(s) de démo`);
const toCheck = FAQ.filter((x) => x.needsValidation).length;
if (toCheck) todo.push(`js/data/faq.js : ${toCheck} réponse(s) marquée(s) needsValidation à faire valider par l'équipe`);

// Traductions (js/i18n/de.js et en.js) des textes de js/data : un nouvel événement, une nouvelle
// question de FAQ ou un nouveau membre s'affichent en français tant qu'ils ne sont pas traduits.
const norm = (s) => String(s).replace(/\s+/g, " ").trim();
const dataTexts = [
  ...events.flatMap((e) => [e.description, e.price, e.age, ...(e.practical || []),
    e.about?.kicker, e.about?.title, e.about?.text, ...(e.about?.points || []).flat()]),
  ...FAQ.flatMap((x) => [x.q, x.a]),
  ...TEAM.flatMap((m) => [m.role, m.bio, ...(m.tags || []), ...Object.entries(m.extra || {}).flat()])
].filter((s) => s && /\p{L}{2}/u.test(s)).map(norm);
for (const lang of ["de", "en"]) {
  const dict = (await import(pathToFileURL(path.join(root, "js/i18n", `${lang}.js`)).href)).default;
  const untranslated = [...new Set(dataTexts)].filter((s) => !(s in dict));
  if (untranslated.length) todo.push(`js/i18n/${lang}.js : ${untranslated.length} texte(s) de js/data sans traduction, ex. « ${untranslated[0].slice(0, 60)} »`);
}
// Textes écrits dans les pages HTML (détail : npm run traductions). Un texte français corrigé
// n'a plus de traduction tant que sa clé n'est pas corrigée aussi dans de.js et en.js.
const { missingTranslations } = await import(pathToFileURL(path.join(root, "tools/i18n-pages.mjs")).href);
for (const [lang, byPage] of Object.entries(await missingTranslations())) {
  const texts = [...new Set([...byPage.values()].flat())];
  if (texts.length) todo.push(`js/i18n/${lang}.js : ${texts.length} texte(s) des pages HTML sans traduction, ex. « ${texts[0].slice(0, 60)} » (détail : npm run traductions)`);
}
for (const e of events.filter((e) => e.date >= new Date().toISOString().slice(0, 10))) {
  if (!e.ticketUrl) todo.push(`événement « ${e.slug} » : lien de billetterie (ticketUrl) vide`);
  if (!e.lineup?.length) todo.push(`événement « ${e.slug} » : line-up pas encore renseigné`);
}

// Images et fichiers cités dans les données (js/data/*.js)
for (const name of fs.readdirSync(path.join(root, "js/data"))) {
  const file = path.join(root, "js/data", name);
  for (const [, ref] of read(file).matchAll(/["'](assets\/[^"']+)["']/g)) {
    if (!fs.existsSync(path.join(root, ref))) err(file, `fichier absent : ${ref}`);
  }
}

// Images que rien n'utilise (doublons « photo-01 2.webp » créés par le Finder, anciennes versions…) :
// elles alourdissent le dépôt et le site publié pour rien.
const sources = files.map(read).join("\n") + read(path.join(root, "site.webmanifest"));
const images = [];
(function walkImages(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkImages(full);
    else if (/\.(webp|jpe?g|png|svg|gif|avif)$/i.test(e.name)) images.push(full);
  }
})(path.join(root, "assets/img"));
// Plans des lieux (assets/img/maps/<slug>-village.svg / -lieu.svg) : adresses construites par
// js/pages/evenement.js. Utilisés si la soirée a un "venue" ; un plan attendu manquant est une erreur.
const expectedMaps = new Set(events.filter((e) => e.venue).flatMap((e) => [`${e.slug}-village`, ...(e.venue.precise === false ? [] : [`${e.slug}-lieu`])]).map((n) => `assets/img/maps/${n}.svg`));
for (const map of expectedMaps) if (!fs.existsSync(path.join(root, map))) err(path.join(root, "js/data/events.js"), `plan absent : ${map} (lance : npm run plans)`);
for (const image of images) if (!sources.includes(rel(image)) && !expectedMaps.has(rel(image))) todo.push(`${rel(image)} : image utilisée nulle part (à supprimer ?)`);

const { SITE } = await import(pathToFileURL(path.join(root, "js/data/site.js")).href);
const streets = new Set();
for (const file of files.filter((f) => /\.(html|js)$/.test(f))) {
  for (const m of read(file).matchAll(/(\d+) avenue Georges Clemenceau/g)) streets.add(`${m[1]} (${rel(file)})`);
}
const nums = new Set([...streets].map((s) => s.split(" ")[0]));
if (nums.size > 1) err(path.join(root, "js/data/site.js"), `adresse incohérente entre les fichiers : ${[...streets].join(", ")}`);

/* ---------- 5. sitemap ---------- */
const sitemap = read(path.join(root, "sitemap.xml")).replace(/<!--[\s\S]*?-->/g, "");
const listed = [...sitemap.matchAll(/<loc>[^<]*\/([^/<]*)<\/loc>/g)].map((m) => m[1] || "index.html");
for (const name of listed) if (!fs.existsSync(path.join(root, name))) err(path.join(root, "sitemap.xml"), `page inexistante : ${name}`);
for (const file of pages) {
  const name = path.basename(file);
  const noindex = /noindex/.test(read(file));
  if (!noindex && name !== "evenement.html" && !listed.includes(name)) err(path.join(root, "sitemap.xml"), `${name} absente du sitemap`);
}

/* ---------- 6. à compléter avant la mise en ligne ---------- */
const placeholderRe = /\[[A-ZÉÈÀÂÔ][A-ZÉÈÀÂÔ' ]{5,}[^\]]*\]/g;
for (const file of files.filter((f) => /\.(html|js)$/.test(f) && !f.includes("tools") && !generated(f))) {
  const found = [...new Set(read(file).match(placeholderRe) || [])];
  if (found.length) todo.push(`${rel(file)} : ${found.length} champ(s) à remplacer, ex. ${found[0]}`);
}
if (SITE.url.includes("example.org")) todo.push("js/data/site.js, sitemap.xml, robots.txt : le domaine (example.org) reste à renseigner");

/* ---------- résultat ---------- */
if (todo.length) console.log(`! À compléter avant la mise en ligne (${todo.length}) :\n  - ${todo.join("\n  - ")}\n`);
if (errors.length) {
  console.error(`✗ ${errors.length} erreur(s) :\n  - ${errors.join("\n  - ")}`);
  process.exit(1);
}
if (strict && todo.length) process.exit(1);
console.log(`✓ Validation OK : ${files.length} fichiers, ${pages.length} pages.`);
