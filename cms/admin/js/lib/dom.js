/**
 * Construction du DOM sans innerHTML : h("a", { href, class: "btn" }, "Texte", enfant…).
 * Les textes sont toujours insérés comme texte (aucune injection HTML possible).
 * Attributs : on* = écouteur (onclick…), class, style (objet), dataset (objet), booléens.
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "class") el.className = Array.isArray(value) ? value.filter(Boolean).join(" ") : value;
    else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key === "ref" && typeof value === "function") value(el);
    else if (key === "value" && "value" in el) el.value = value;
    else if (key === "checked" || key === "selected" || key === "disabled" || key === "hidden" || key === "required" || key === "multiple") el[key] = Boolean(value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  append(el, children);
  return el;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

export function replace(el, ...children) {
  clear(el);
  return append(el, children);
}

/** SVG d'icône (chemins statiques définis dans icons.js). */
export function svg(paths, { size = 18, label } = {}) {
  const ns = "http://www.w3.org/2000/svg";
  const el = document.createElementNS(ns, "svg");
  el.setAttribute("viewBox", "0 0 24 24");
  el.setAttribute("width", size);
  el.setAttribute("height", size);
  el.setAttribute("fill", "none");
  el.setAttribute("stroke", "currentColor");
  el.setAttribute("stroke-width", "2");
  el.setAttribute("stroke-linecap", "round");
  el.setAttribute("stroke-linejoin", "round");
  if (label) {
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", label);
  } else el.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", d);
    el.append(p);
  }
  return el;
}

export const debounce = (fn, ms = 250) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

/** Identifiant unique pour relier label et champ. */
let counter = 0;
export const uid = (prefix = "f") => `${prefix}-${++counter}`;
