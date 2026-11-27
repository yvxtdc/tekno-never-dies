/**
 * Éditeur de la mise en page d'une carte de l'équipe (Équipe → fiche d'un membre → « Modifier la mise
 * en page… »). La carte est rendue par le même code que le site (team-card.js, team.css, servis par
 * /admin/shared/), entre ses deux voisines du bandeau : ce qui est affiché est ce qui sera publié.
 *
 * Glisser-déposer (souris ou doigt) des groupes de pastilles et des objets chromés ; clavier : flèches
 * (Maj : ×10), Suppr, Ctrl+Z / Ctrl+Maj+Z. La photo n'est jamais modifiée. Les réglages précis (alignement,
 * couleurs, taille, rotation, plan…) sont dans le panneau. Le résultat est rendu au formulaire du membre
 * (onApply) : il est enregistré, ou programmé, avec la fiche, comme les autres champs.
 * Format et contrôle : js/components/team-layout.js (le serveur revalide tout).
 */
import { h, clear } from "../lib/dom.js";
import { icon, dialog, confirm, toast, select, checkbox } from "../lib/ui.js";
import { get } from "../lib/api.js";
import { teamSlide, chromeObject } from "/admin/shared/team-card.js";
import {
  parseLayout, normalizeLayout, defaultLayout, groupWidth, addObject, removeObject, moveItem,
  MAX_OBJECTS, MAX_GROUPS, MARGIN, TOP_Y, BOTTOM_Y
} from "/admin/shared/team-layout.js";
import { CHROME_OBJECTS } from "/admin/shared/chrome.js";
import { compositionIssues } from "/admin/shared/team-composition.js";

/** Largeurs réelles des cartes sur le site (team.css) et espace entre deux cartes à ces largeurs. */
const SCREENS = [
  { key: "desktop", label: "Ordinateur, grand écran (carte 235 px)", width: 235, gap: 23, mobile: false },
  { key: "laptop", label: "Ordinateur, petit écran (carte 210 px)", width: 210, gap: 16, mobile: false },
  { key: "phone", label: "Téléphone (carte 250 px)", width: 250, gap: 14, mobile: true },
  { key: "small", label: "Petit téléphone, 320 px (carte 218 px)", width: 218, gap: 14, mobile: true }
];
const ZOOMS = [["1", "Taille réelle"], ["1.5", "150 %"], ["2", "200 %"]];
const LANGS = [["fr", "Français"], ["de", "Allemand"], ["en", "Anglais"]];
const ITEM_LABELS = { name: "Nom", role: "Rôle", missions: "Missions" };
const COLOR_LABELS = [["violet", "Violet"], ["cyan", "Turquoise"]];
const OPTION_LABELS = {
  tint: { label: "Teinte", values: { silver: "Argent", violet: "Violet" } },
  points: { label: "Branches", values: { 8: "8 branches", 4: "4 branches" } }
};
const LAYERS = [["front", "Devant toutes les cartes"], ["between", "Sous la carte suivante"], ["back", "Derrière les cartes"]];
const BLANK = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

/** Images des objets détourés : servies à l'interface sous /admin/site/. */
const asset = (path) => path.replace(/^assets\//, "/admin/site/");
const round = (n) => Math.round(n * 10) / 10;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const groupName = (group) => group.items.map((item) => ITEM_LABELS[item]).join(" · ");
const objectName = (object) => CHROME_OBJECTS[object.type]?.label || object.type;

/** Feuille de style du bandeau du site, chargée une fois (même rendu que la page publique). */
function ensureTeamStyles() {
  if (document.querySelector("link[data-team-styles]")) return;
  document.head.append(h("link", { rel: "stylesheet", href: "/admin/shared/team.css", "data-team-styles": "" }));
}

/** Membre au format du site (js/data/equipe.js) d'après une fiche de l'interface. */
export function siteMember(m) {
  return { slug: m.slug || "nouveau-membre", name: m.name || "Nom", role: m.role || "", photo: m.photo?.previewUrl || BLANK, tags: m.tags || [] };
}

/** Carte non interactive (div au lieu du bouton du site) dans une diapositive du bandeau. */
function staticSlide(member, layout) {
  const li = teamSlide(member, { layout, clone: true, asset });
  const button = li.querySelector(".team-card");
  const card = h("div", { class: button.className });
  card.append(...button.childNodes);
  button.replaceWith(card);
  return li;
}

/** Aperçu de la carte dans le formulaire du membre (taille réelle, sans voisines). */
export function layoutPreview(m, layout) {
  ensureTeamStyles();
  return h("div", { class: "layout-preview", "aria-hidden": "true" },
    h("ul", { class: "layout-stage__track" }, staticSlide(siteMember(m), normalizeLayout(layout))));
}

/**
 * Ouvre l'éditeur. member : fiche (valeurs actuelles du formulaire) ; members : fiches de l'équipe dans
 * l'ordre (voisines du bandeau) ; onApply(layout | null) : null = mise en page par défaut.
 */
export function openLayoutEditor({ member, members, onApply }) {
  ensureTeamStyles();
  const startWasDefault = !member.layout;
  const initial = startWasDefault ? defaultLayout() : normalizeLayout(member.layout);
  const initialJson = JSON.stringify(initial);
  let state = structuredClone(initial);
  let resetToDefault = false;
  let history = [initialJson];
  let pos = 0;
  let selected = null; // { kind: "group", index } | { kind: "object", id }
  let screen = SCREENS[0];
  let zoom = matchMedia("(max-width: 700px)").matches ? 1 : 1.5; // téléphone : la carte tient dans l'écran
  let lang = "fr";
  const roles = { fr: member.role || "" };

  // Bandeau : membres affichés sur le site, dans l'ordre, avec celui-ci à sa place
  const ring = members.filter((x) => x.published || x.id === member.id);
  if (!ring.some((x) => x.id === member.id)) ring.push(member);
  const at = ring.findIndex((x) => x.id === member.id);
  const prev = ring.length > 1 ? ring[(at - 1 + ring.length) % ring.length] : null;
  const next = ring.length > 2 ? ring[(at + 1) % ring.length] : ring.length === 2 ? prev : null;

  const stageBox = h("div", { class: "layout-stage" });
  const panel = h("div", { class: "layout-panel" });
  const warnings = h("div", { class: "layout-warnings", role: "status", "aria-live": "polite" });
  let current = null; // <li> de la carte éditée

  /* ---------- État et historique ---------- */

  const dirty = () => resetToDefault || JSON.stringify(state) !== initialJson;
  function pushHistory() {
    const json = JSON.stringify(state);
    if (json === history[pos]) return;
    history = history.slice(0, pos + 1).concat(json);
    pos = history.length - 1;
    toolbarState();
  }
  /** Modifie l'état (copie) ; history : false pendant un réglage continu (curseur), ajouté à la fin. */
  function update(mutate, { history: keep = true, panel: withPanel = true, focus = false } = {}) {
    const draft = structuredClone(state);
    const result = mutate(draft);
    state = result || draft;
    resetToDefault = false;
    renderStage({ focus });
    if (withPanel) renderPanel();
    if (keep) pushHistory();
  }
  function travel(delta) {
    const target = pos + delta;
    if (target < 0 || target >= history.length) return;
    pos = target;
    state = JSON.parse(history[pos]);
    if (selected?.kind === "group" && !state.groups[selected.index]) selected = null;
    if (selected?.kind === "object" && !state.objects.some((o) => o.id === selected.id)) selected = null;
    renderStage();
    renderPanel();
    toolbarState();
  }
  const selectedGroup = () => (selected?.kind === "group" ? state.groups[selected.index] : null);
  const selectedObject = () => (selected?.kind === "object" ? state.objects.find((o) => o.id === selected.id) : null);
  function choose(target, { focus = false } = {}) {
    selected = target;
    markSelection(focus);
    renderPanel();
  }

  /* ---------- Scène : la carte et ses voisines ---------- */

  const memberFor = (x) => {
    const site = siteMember(x);
    if (x.id === member.id && lang !== "fr" && roles[lang]) site.role = roles[lang];
    return site;
  };
  const layoutOf = (x) => (x.id === member.id ? state : normalizeLayout(x.layout));
  const nodeFor = (target) => target?.kind === "group"
    ? current?.querySelector(`.team-card__group[data-group="${target.index}"]`)
    : target?.kind === "object" ? current?.querySelector(`.team-decor[data-decor="${CSS.escape(target.id)}"]`) : null;

  function markSelection(focus) {
    current?.querySelectorAll(".is-selected").forEach((n) => n.classList.remove("is-selected"));
    const node = nodeFor(selected);
    node?.classList.add("is-selected");
    if (focus) node?.focus({ preventScroll: true });
  }

  /** Carte éditée au centre de la scène (ouverture, changement de largeur ou de zoom). */
  function centerStage() {
    requestAnimationFrame(() => {
      const card = current?.querySelector(".team-card");
      if (!card) return;
      const box = stageBox.getBoundingClientRect(), r = card.getBoundingClientRect();
      stageBox.scrollLeft += r.left + r.width / 2 - (box.left + box.width / 2);
    });
  }

  function renderStage({ focus = false } = {}) {
    const slides = [];
    if (prev) slides.push(staticSlide(memberFor(prev), layoutOf(prev)));
    current = staticSlide(memberFor(member), state);
    current.removeAttribute("aria-hidden");
    current.classList.add("layout-stage__current");
    current.setAttribute("role", "group");
    current.setAttribute("aria-label", `Carte de ${member.name || "ce membre"} : éléments déplaçables`);
    slides.push(current);
    if (next) slides.push(staticSlide(memberFor(next), layoutOf(next)));
    slides.filter((li) => li !== current).forEach((li) => li.classList.add("layout-stage__neighbour"));

    current.querySelectorAll(".team-card__group").forEach((node) => {
      const index = Number(node.dataset.group);
      wire(node, { kind: "group", index }, `Groupe ${groupName(state.groups[index])}`);
    });
    current.querySelectorAll(".team-decor").forEach((node) => {
      const object = state.objects.find((o) => o.id === node.dataset.decor);
      if (object) wire(node, { kind: "object", id: object.id }, `Objet ${objectName(object)}`);
    });

    const track = h("ul", { class: "layout-stage__track" }, slides);
    track.style.setProperty("--team-gap", `${screen.gap}px`);
    track.style.setProperty("--editor-card-w", `${screen.width}px`);
    clear(stageBox).append(h("div", { class: ["layout-stage__zoom", screen.mobile && "is-mobile"], style: { zoom: String(zoom) } }, track));
    markSelection(focus);
    requestAnimationFrame(checkLayout);
  }

  /** Élément déplaçable : sélection, glisser-déposer, clavier. */
  function wire(node, target, label) {
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", `${label} : glisser pour déplacer, flèches pour ajuster`);
    node.removeAttribute("aria-hidden");
    node.addEventListener("pointerdown", (event) => startDrag(event, target, node));
    node.addEventListener("focus", () => { if (JSON.stringify(selected) !== JSON.stringify(target)) choose(target); });
    node.addEventListener("keydown", (event) => onKey(event, target));
  }

  function startDrag(event, target, node) {
    if (event.button !== 0) return;
    event.preventDefault();
    if (JSON.stringify(selected) !== JSON.stringify(target)) choose(target);
    node.focus({ preventScroll: true });
    const rect = current.querySelector(".team-card").getBoundingClientRect();
    const origin = structuredClone(target.kind === "group" ? state.groups[target.index] : state.objects.find((o) => o.id === target.id));
    let moved = null;
    node.setPointerCapture(event.pointerId);
    node.classList.add("is-dragging");
    const snap = (value, marks, free) => (free ? value : marks.reduce((best, m) => (Math.abs(m - value) < 1.5 ? m : best), value));
    const move = (e) => {
      if (!moved && Math.hypot(e.clientX - event.clientX, e.clientY - event.clientY) < 3) return;
      const dx = ((e.clientX - event.clientX) / rect.width) * 100;
      const dy = ((e.clientY - event.clientY) / rect.height) * 100;
      if (target.kind === "group") {
        const x = round(snap(clamp(origin.x + dx, 0, 100), [MARGIN, 50, 100 - MARGIN], e.altKey));
        const y = round(snap(clamp(origin.y + dy, 0, 100), [TOP_Y, 50, BOTTOM_Y], e.altKey));
        node.style.setProperty("--gx", x);
        node.style.setProperty("--gy", y);
        node.style.setProperty("--gw", groupWidth({ x, align: origin.align }));
        moved = { x, y };
      } else {
        const x = round(clamp(origin.x + dx, -100, 200));
        const y = round(clamp(origin.y + dy, -100, 200));
        node.style.setProperty("--x", x);
        node.style.setProperty("--y", y);
        moved = { x, y };
      }
    };
    const end = () => {
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", end);
      node.removeEventListener("pointercancel", end);
      node.classList.remove("is-dragging");
      if (!moved) return;
      update((draft) => {
        const item = target.kind === "group" ? draft.groups[target.index] : draft.objects.find((o) => o.id === target.id);
        Object.assign(item, moved);
      }, { focus: true });
    };
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", end);
    node.addEventListener("pointercancel", end);
  }

  function onKey(event, target) {
    const step = event.shiftKey ? 5 : 0.5;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (delta) {
      event.preventDefault();
      update((draft) => {
        const item = target.kind === "group" ? draft.groups[target.index] : draft.objects.find((o) => o.id === target.id);
        const [min, max] = target.kind === "group" ? [0, 100] : [-100, 200];
        item.x = round(clamp(item.x + delta[0], min, max));
        item.y = round(clamp(item.y + delta[1], min, max));
      }, { focus: true });
    } else if ((event.key === "Delete" || event.key === "Backspace") && target.kind === "object") {
      event.preventDefault();
      deleteObject(target.id);
    }
  }

  function deleteObject(id) {
    selected = null;
    update((draft) => removeObject(draft, id));
  }

  /* ---------- Contrôles : chevauchements, débordements, répétitions ---------- */

  function checkLayout() {
    if (!current?.isConnected) return;
    const card = current.querySelector(".team-card").getBoundingClientRect();
    const tolerance = 1;
    const messages = [];
    const groups = [...current.querySelectorAll(".team-card__group")].map((node) => ({
      name: groupName(state.groups[Number(node.dataset.group)]),
      box: node.getBoundingClientRect(),
      pieces: [...node.querySelectorAll(".team-pill, .team-mission")].flatMap((p) => [...p.getClientRects()])
    }));
    const hit = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > tolerance && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > tolerance;
    for (const g of groups) {
      if (g.pieces.some((r) => r.left < card.left - tolerance || r.right > card.right + tolerance || r.top < card.top - tolerance || r.bottom > card.bottom + tolerance)) {
        messages.push(`« ${g.name} » dépasse de la carte${lang === "fr" ? "" : " dans cette langue"}.`);
      }
    }
    groups.forEach((a, i) => groups.slice(i + 1).forEach((b) => {
      if (a.pieces.some((r) => b.pieces.some((s) => hit(r, s)))) messages.push(`« ${a.name} » et « ${b.name} » se chevauchent.`);
    }));
    for (const node of current.querySelectorAll(".team-decor")) {
      const box = node.getBoundingClientRect();
      const over = groups.filter((g) => g.pieces.some((r) => hit(r, box))).map((g) => `« ${g.name} »`);
      if (over.length) messages.push(`L'objet « ${objectName(state.objects.find((o) => o.id === node.dataset.decor) || { type: node.dataset.decor })} » touche ${over.join(" et ")} : vérifiez qu'il ne cache rien.`);
    }
    // Familles d'objets répétées avec les cartes voisines (même contrôle que npm run validate)
    const team = ring.map((x) => ({ slug: siteMember(x).slug, photo: "", layout: layoutOf(x) }));
    const slug = siteMember(member).slug;
    for (const issue of compositionIssues(team)) if (issue.includes("famille") && issue.includes(slug)) messages.push(issue.replace(/^[^:]+: /, "") + ".");
    clear(warnings).append(messages.length
      ? h("div", { class: "form-errors" }, h("strong", {}, "À vérifier"), h("ul", {}, messages.map((m) => h("li", {}, m))))
      : h("p", { class: "small muted" }, icon("check"), " Aucun chevauchement ni débordement à cette largeur."));
  }

  /* ---------- Panneau de réglages ---------- */

  const choice = (label, options, value, onPick) => h("div", { class: "field" },
    h("span", { class: "label" }, label),
    h("div", { class: "chips", role: "group", "aria-label": label },
      options.map(([v, text]) => h("button", { type: "button", class: "chip", "aria-pressed": String(v === value), onclick: () => onPick(v) }, text))));

  /** Ancrage changé sans déplacer le groupe à l'écran : le nouveau point d'ancrage est lu sur la carte. */
  function reanchor(index, change) {
    const node = current.querySelector(`.team-card__group[data-group="${index}"]`);
    const card = current.querySelector(".team-card").getBoundingClientRect();
    update((draft) => {
      const g = draft.groups[index];
      if (node) {
        const r = node.getBoundingClientRect();
        const pct = { left: ((r.left - card.left) / card.width) * 100, right: ((r.right - card.left) / card.width) * 100, top: ((r.top - card.top) / card.height) * 100, bottom: ((r.bottom - card.top) / card.height) * 100 };
        if (change.align) g.x = round(clamp(change.align === "start" ? pct.left : change.align === "end" ? pct.right : (pct.left + pct.right) / 2, 0, 100));
        if (change.valign) g.y = round(clamp(change.valign === "top" ? pct.top : pct.bottom, 0, 100));
      }
      Object.assign(g, change);
    });
  }

  function groupPanel(group, index) {
    const others = state.groups.map((g, i) => [i, g]).filter(([i]) => i !== index);
    return h("div", { class: "stack" },
      h("h3", { class: "layout-panel__title" }, groupName(group)),
      choice("Alignement", [["start", "Gauche"], ["center", "Centre"], ["end", "Droite"]], group.align, (align) => reanchor(index, { align })),
      choice("Ancrage", [["top", "En haut"], ["bottom", "En bas"]], group.valign, (valign) => reanchor(index, { valign })),
      h("p", { class: "hint" }, group.valign === "top" ? "Un texte plus long (traduction) agrandit le groupe vers le bas." : "Un texte plus long (traduction) agrandit le groupe vers le haut."),
      group.items.map((item) => h("div", { class: "layout-panel__item" },
        h("strong", {}, ITEM_LABELS[item]),
        choice("Couleur", COLOR_LABELS, state.colors[item], (color) => update((d) => { d.colors[item] = color; })),
        others.length || (group.items.length > 1 && state.groups.length < MAX_GROUPS) ? (() => {
          const options = [["", "Garder dans ce groupe"], ...others.map(([i, g]) => [String(i), `Avec ${groupName(g)}`])];
          if (group.items.length > 1 && state.groups.length < MAX_GROUPS) options.push(["new", "Séparer (groupe à part)"]);
          const control = select(options, { "aria-label": `Placer ${ITEM_LABELS[item]}` });
          control.addEventListener("change", () => {
            if (!control.value) return;
            const to = control.value === "new" ? null : Number(control.value);
            const place = { x: group.x, y: round(clamp(group.valign === "top" ? group.y + 18 : group.y - 18, 0, 100)), align: group.align, valign: group.valign };
            try {
              update((d) => moveItem(d, item, to, place));
              const found = state.groups.findIndex((g) => g.items.includes(item));
              choose({ kind: "group", index: found });
            } catch (error) {
              toast(error.message, "error");
            }
          });
          return h("div", { class: "field" }, h("span", { class: "label" }, "Placement"), control);
        })() : null)));
  }

  /** Bascule « à cheval sur la carte suivante » sans déplacer l'objet à l'écran. */
  function setAnchor(object, anchor) {
    const half = (screen.gap / 2 / screen.width) * 100;
    update((d) => {
      const o = d.objects.find((x) => x.id === object.id);
      o.x = round(anchor === "end" ? o.x - 100 - half : o.x + 100 + half);
      o.anchor = anchor;
    });
  }

  function objectPanel(object) {
    const entry = CHROME_OBJECTS[object.type];
    const range = (label, key, min, max, unit) => {
      const out = h("output", {}, `${object[key]}${unit}`);
      const control = h("input", { type: "range", class: "layout-range", min, max, step: 1, value: object[key], "aria-label": label });
      control.addEventListener("input", () => {
        out.textContent = `${control.value}${unit}`;
        update((d) => { d.objects.find((x) => x.id === object.id)[key] = Number(control.value); }, { history: false, panel: false });
      });
      control.addEventListener("change", pushHistory);
      return h("div", { class: "field" }, h("span", { class: "label" }, label, " ", out), control);
    };
    const typeSelect = select(Object.entries(CHROME_OBJECTS).map(([type, e]) => [type, e.label]), { value: object.type, "aria-label": "Objet" });
    typeSelect.addEventListener("change", () => update((d) => {
      const o = d.objects.find((x) => x.id === object.id);
      o.type = typeSelect.value;
      const options = Object.fromEntries(Object.entries(CHROME_OBJECTS[o.type].options || {}).map(([k, values]) => [k, values[0]]));
      if (Object.keys(options).length) o.options = options;
      else delete o.options;
    }));
    const layer = select(LAYERS, { value: object.layer, "aria-label": "Plan" });
    layer.addEventListener("change", () => update((d) => { d.objects.find((x) => x.id === object.id).layer = layer.value; }));
    const flag = (label, on, apply) => {
      const box = checkbox(label, { checked: on });
      box.input.addEventListener("change", () => apply(box.input.checked));
      return box;
    };
    return h("div", { class: "stack" },
      h("h3", { class: "layout-panel__title" }, objectName(object)),
      h("div", { class: "field" }, h("span", { class: "label" }, "Objet"), typeSelect),
      Object.entries(entry?.options || {}).map(([key, values]) => choice(OPTION_LABELS[key]?.label || key,
        values.map((v) => [v, OPTION_LABELS[key]?.values[v] || String(v)]), object.options?.[key] ?? values[0],
        (v) => update((d) => { const o = d.objects.find((x) => x.id === object.id); o.options = { ...o.options, [key]: v }; }))),
      range("Taille", "size", 5, 100, " %"),
      range("Rotation", "rotate", -180, 180, "°"),
      flag("Miroir", object.flip, (on) => update((d) => { d.objects.find((x) => x.id === object.id).flip = on; })),
      h("div", { class: "field" }, h("span", { class: "label" }, "Plan"), layer),
      flag("À cheval sur la carte suivante (reste centré sur la jointure, quelle que soit la largeur d'écran)", object.anchor === "end", (on) => setAnchor(object, on ? "end" : "card")),
      flag("Masquer sur téléphone", object.hideMobile, (on) => update((d) => { d.objects.find((x) => x.id === object.id).hideMobile = on; })),
      h("button", { type: "button", class: "btn btn--danger btn--sm", onclick: () => deleteObject(object.id) }, icon("trash"), "Retirer cet objet"));
  }

  function pickObject() {
    const grid = h("div", { class: "layout-catalog" }, Object.entries(CHROME_OBJECTS).map(([type, entry]) => {
      const preview = chromeObject(type, Object.fromEntries(Object.entries(entry.options || {}).map(([k, v]) => [k, v[0]])), asset);
      return h("button", { type: "button", class: "layout-catalog__item", onclick: () => {
        d.close();
        try {
          update((draft) => addObject(draft, type));
          const added = state.objects.at(-1);
          choose({ kind: "object", id: added.id }, { focus: true });
        } catch (error) {
          toast(error.message, "error");
        }
      } }, h("span", { class: "layout-catalog__shape", "aria-hidden": "true" }, preview), entry.label);
    }));
    const d = dialog({ title: "Ajouter un objet chromé", body: h("div", { class: "stack" }, h("p", { class: "hint" }, "L'objet est posé au milieu de la carte : glissez-le ensuite à sa place."), grid), actions: [h("button", { type: "button", class: "btn", onclick: () => d.close() }, "Annuler")] });
  }

  function renderPanel() {
    const group = selectedGroup();
    const object = selectedObject();
    const list = h("div", { class: "layout-panel__list", role: "group", "aria-label": "Éléments de la carte" },
      state.groups.map((g, index) => h("button", { type: "button", class: "chip", "aria-pressed": String(selected?.kind === "group" && selected.index === index), onclick: () => choose({ kind: "group", index }, { focus: true }) }, groupName(g))),
      state.objects.map((o) => h("button", { type: "button", class: "chip", "aria-pressed": String(selected?.kind === "object" && selected.id === o.id), onclick: () => choose({ kind: "object", id: o.id }, { focus: true }) }, objectName(o))),
      h("button", { type: "button", class: "chip", disabled: state.objects.length >= MAX_OBJECTS, title: state.objects.length >= MAX_OBJECTS ? `${MAX_OBJECTS} objets au plus` : null, onclick: pickObject }, "+ Objet"));
    clear(panel).append(
      h("div", { class: "field" }, h("span", { class: "label" }, "Éléments"), list),
      warnings,
      group ? groupPanel(group, selected.index) : object ? objectPanel(object) : h("p", { class: "hint" }, "Cliquez sur une pastille ou un objet de la carte (ou dans la liste ci-dessus) pour le régler."));
  }

  /* ---------- Barre d'outils : écran, zoom, langue, annuler ---------- */

  const screenSelect = select(SCREENS.map((s) => [s.key, s.label]), { value: screen.key, "aria-label": "Largeur d'écran" });
  screenSelect.addEventListener("change", () => { screen = SCREENS.find((s) => s.key === screenSelect.value); renderStage(); centerStage(); });
  const zoomSelect = select(ZOOMS, { value: String(zoom), "aria-label": "Zoom" });
  zoomSelect.addEventListener("change", () => { zoom = Number(zoomSelect.value); renderStage(); centerStage(); });
  const langSelect = select(LANGS, { value: lang, "aria-label": "Langue du rôle" });
  const langNote = h("span", { class: "small muted" });
  langSelect.addEventListener("change", async () => {
    lang = langSelect.value;
    langNote.textContent = "";
    if (lang !== "fr" && roles[lang] === undefined && roles.fr) {
      try {
        const items = await get(`/api/translations?q=${encodeURIComponent(roles.fr)}`);
        const found = items.find((i) => i.source === roles.fr);
        roles.de = found?.de || "";
        roles.en = found?.en || "";
      } catch (error) {
        toast("Traductions indisponibles : rôle affiché en français.", "warn");
        roles.de = roles.de ?? "";
        roles.en = roles.en ?? "";
      }
    }
    if (lang !== "fr" && !roles[lang]) langNote.textContent = "Rôle pas encore traduit : affiché en français (comme sur le site).";
    renderStage();
  });
  const undo = h("button", { type: "button", class: "btn btn--sm", title: "Ctrl+Z", onclick: () => travel(-1) }, "Annuler l'action");
  const redo = h("button", { type: "button", class: "btn btn--sm", title: "Ctrl+Maj+Z", onclick: () => travel(1) }, "Rétablir");
  const reset = h("button", { type: "button", class: "btn btn--sm", onclick: async () => {
    if (!(await confirm({ title: "Revenir à la mise en page par défaut ?", message: "Tout le texte en bas de la carte, centré, sans objet chromé. Vous pourrez encore annuler.", confirmLabel: "Mise en page par défaut" }))) return;
    selected = null;
    update(() => defaultLayout());
    resetToDefault = true;
  } }, "Mise en page par défaut");
  function toolbarState() {
    undo.disabled = pos === 0;
    redo.disabled = pos >= history.length - 1;
  }

  /* ---------- Fenêtre ---------- */

  const body = h("div", { class: "layout-editor" },
    h("div", { class: "layout-editor__bar" },
      h("label", { class: "layout-editor__control" }, h("span", { class: "small" }, "Écran"), screenSelect),
      h("label", { class: "layout-editor__control" }, h("span", { class: "small" }, "Zoom"), zoomSelect),
      h("label", { class: "layout-editor__control" }, h("span", { class: "small" }, "Rôle en"), langSelect),
      h("div", { class: "row" }, undo, redo, reset),
      langNote),
    h("div", { class: "layout-editor__main" }, stageBox, panel),
    h("p", { class: "hint" }, "Glissez les pastilles et les objets à la souris ou au doigt (Alt : sans aimantation sur les marges). "
      + "Au clavier : Tab pour choisir, flèches pour déplacer (Maj : plus vite), Suppr pour retirer un objet, Ctrl+Z pour annuler. "
      + "Les cartes voisines sont celles du bandeau ; vérifiez aussi les autres largeurs d'écran et langues."));

  const apply = h("button", { type: "button", class: "btn btn--primary", onclick: () => {
    const { layout, errors } = parseLayout(state);
    if (errors.length) return toast(`Mise en page invalide : ${errors[0]}`, "error");
    const result = resetToDefault || (startWasDefault && JSON.stringify(layout) === JSON.stringify(defaultLayout())) ? null : layout;
    closing = true;
    d.close("apply");
    onApply(result);
  } }, "Appliquer à la fiche");
  const cancel = h("button", { type: "button", class: "btn", onclick: () => requestClose() }, "Fermer sans appliquer");
  let closing = false;
  const d = dialog({ title: `Mise en page de la carte : ${member.name || "nouveau membre"}`, wide: true, body, actions: [cancel, apply] });
  d.el.classList.add("dialog--layout");

  async function requestClose() {
    if (closing) return;
    if (dirty() && !(await confirm({ title: "Abandonner les modifications ?", message: "La mise en page de la carte n'a pas été appliquée à la fiche.", confirmLabel: "Abandonner", danger: true }))) return;
    closing = true;
    d.close("cancel");
  }
  // Échap : désélectionne d'abord ; fermeture (Échap ou croix) : confirmation s'il y a des modifications
  d.el.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (selected) choose(null);
    else requestClose();
  });
  d.el.querySelector(".dialog__head .btn--icon")?.addEventListener("click", (event) => {
    if (closing) return;
    event.stopImmediatePropagation();
    requestClose();
  }, { capture: true });
  d.el.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.target.matches("input, select, textarea")) return;
    const key = event.key.toLowerCase();
    if (key === "z" || key === "y") {
      event.preventDefault();
      travel(key === "y" || event.shiftKey ? 1 : -1);
    }
  });

  toolbarState();
  renderStage();
  renderPanel();
  centerStage();
}
