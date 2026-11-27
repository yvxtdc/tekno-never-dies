// Infos de l'association dans les pages (attribut data-info, voir js/components/association-info.js).
//
//   syncInfoHtml(html, values)        : réécrit les valeurs marquées d'une page source (tools/sync-infos.mjs) ;
//                                       édition du texte, sans reformater le reste du fichier.
//   withInfoTokens(doc, names)        : arbre d'une page -> valeurs remplacées par {info:nom}, data-info retiré
//                                       (clés de traduction : tools/langues.mjs, tools/i18n-pages.mjs).
//   fillInfoTokens(doc, valueOf)      : {info:nom} -> valeur (dans la langue) dans l'arbre traduit.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setAttr } from "./html.mjs";

const load = (root, file) => import(pathToFileURL(path.join(root, file)).href);

/** Valeurs actuelles (js/data/association.js) et outils de js/components/association-info.js. */
export async function loadInfos(root) {
  const { ASSOCIATION } = await load(root, "js/data/association.js");
  const info = await load(root, "js/components/association-info.js");
  const values = info.infoValues(ASSOCIATION);
  return { values, names: Object.keys(values), ...info };
}

const escText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => escText(s).replace(/"/g, "&quot;");

/**
 * Réécrit chaque élément marqué data-info avec les valeurs données. Lève une erreur lisible si un
 * marquage est invalide (cible inconnue, cible « text » avec des balises, sameAs hors JSON-LD…).
 */
export function syncInfoHtml(html, values, parseInfoSpec) {
  const names = Object.keys(values);
  const OPEN = /<([a-zA-Z][\w-]*)\b([^>]*?\sdata-info="([^"]*)"[^>]*)>/g;
  let out = "";
  let last = 0;
  for (let m; (m = OPEN.exec(html));) {
    const [whole, tag, attrs, spec] = m;
    const line = html.slice(0, m.index).split("\n").length;
    const fail = (message) => { throw new Error(`ligne ${line}, <${tag} data-info="${spec}"> : ${message}`); };
    let targets;
    try {
      targets = parseInfoSpec(spec, names);
    } catch (error) {
      fail(error.message);
    }
    let newAttrs = attrs;
    for (const [target, name] of targets.filter(([t]) => !["text", "sameAs"].includes(t))) {
      const re = new RegExp(`(\\s${target}=")[^"]*(")`);
      newAttrs = re.test(newAttrs) ? newAttrs.replace(re, (_, a, b) => `${a}${escAttr(values[name])}${b}`) : `${newAttrs} ${target}="${escAttr(values[name])}"`;
    }
    out += html.slice(last, m.index) + `<${tag}${newAttrs}>`;
    last = m.index + whole.length;
    const text = targets.find(([t]) => t === "text");
    const sameAs = targets.find(([t]) => t === "sameAs");
    if (text) {
      const content = html.slice(last).match(new RegExp(`^([^<]*)</${tag}>`));
      if (!content) fail("une cible « text » ne doit contenir que du texte, sans balise");
      out += escText(values[text[1]]);
      last += content[1].length;
    }
    if (sameAs) {
      if (tag.toLowerCase() !== "script" || !/application\/ld\+json/.test(attrs)) fail("« sameAs » n'est permis que sur un <script type=\"application/ld+json\">");
      const end = html.indexOf("</script>", last);
      const json = html.slice(last, end);
      if (!/"sameAs"\s*:\s*\[[^\]]*\]/.test(json)) fail("liste « sameAs » introuvable dans les données structurées");
      out += json.replace(/("sameAs"\s*:\s*)\[[^\]]*\]/, (_, key) => `${key}${JSON.stringify([values[sameAs[1]]])}`);
      last = end;
    }
  }
  return out + html.slice(last);
}

/**
 * Arbre d'une page (tools/lib/html.mjs) : chaque valeur marquée devient {info:nom}, l'attribut data-info
 * est retiré, et un <span> qui ne servait qu'à porter la marque est remplacé par son repère. Les clés de
 * traduction ne contiennent ainsi jamais les valeurs elles-mêmes.
 */
export function withInfoTokens(node, { names, parseInfoSpec, infoToken }) {
  for (let i = 0; i < (node.children || []).length; i++) {
    const el = node.children[i];
    if (el.type !== 1) continue;
    const spec = el.attrs.find(([n]) => n === "data-info")?.[1];
    if (spec !== undefined) {
      const targets = parseInfoSpec(spec, names);
      el.attrs = el.attrs.filter(([n]) => n !== "data-info");
      for (const [target, name] of targets) {
        if (target === "text") el.children = [{ type: 3, value: infoToken(name) }];
        else if (target !== "sameAs") setAttr(el, target, infoToken(name));
      }
      if (el.name === "SPAN" && !el.attrs.length && targets.length === 1 && targets[0][0] === "text") {
        node.children[i] = { type: 3, value: infoToken(targets[0][1]) };
        continue;
      }
    }
    withInfoTokens(el, { names, parseInfoSpec, infoToken });
  }
  // Repère voisin d'un texte : un seul nœud (« Écrire à {info:email} » est une seule clé, comme le
  // texte que le navigateur lit quand la valeur est dans le même élément)
  if (node.children) {
    node.children = node.children.reduce((list, child) => {
      const prev = list.at(-1);
      if (child.type === 3 && prev?.type === 3) prev.value += child.value;
      else list.push(child);
      return list;
    }, []);
  }
  return node;
}

/** Remplace les repères {info:nom} restants (texte et attributs) par valueOf(nom). */
export function fillInfoTokens(node, valueOf, TOKEN = /\{info:(\w+)\}/g) {
  const fill = (s) => s.replace(TOKEN, (token, name) => valueOf(name) ?? token);
  for (const child of node.children || []) {
    if (child.type === 3) child.value = fill(child.value);
    else if (child.type === 1) {
      child.attrs = child.attrs.map(([n, v]) => [n, typeof v === "string" ? fill(v) : v]);
      fillInfoTokens(child, valueOf, TOKEN);
    }
  }
  return node;
}

/** Pages sources où les infos sont écrites : partials et pages de la racine. */
export function infoFiles(root) {
  return [
    ...fs.readdirSync(path.join(root, "partials")).filter((f) => f.endsWith(".html")).map((f) => `partials/${f}`),
    ...fs.readdirSync(root).filter((f) => f.endsWith(".html")).sort()
  ];
}
