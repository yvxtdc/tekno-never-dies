/** Champs composés : étiquettes, listes, liens, choix dans une liste (combobox), choix d'image. */
import { h, append, clear, replace, debounce, uid } from "./dom.js";
import { get, upload, qs } from "./api.js";
import { icon, dialog, toast, errorMessage, loadingState, emptyState, input } from "./ui.js";
import { fileSize } from "./format.js";

/** Étiquettes (styles musicaux, missions…) : Entrée ou virgule pour ajouter. */
export function tagInput({ values = [], placeholder = "Ajouter…", label, onChange, max = 12, suggestions = [], decorate = null }) {
  let items = [...values];
  const listId = uid("dl");
  const field = h("input", { type: "text", placeholder, "aria-label": label, list: suggestions.length ? listId : undefined });
  const root = h("div", { class: "tags" });
  const render = () => {
    clear(root);
    items.forEach((tag, i) => root.append(h("span", { class: "tag" }, decorate ? decorate(tag) : null, tag,
      h("button", { type: "button", "aria-label": `Retirer ${tag}`, onclick: () => { items.splice(i, 1); render(); onChange(items); field.focus(); } }, "×"))));
    root.append(field);
    if (suggestions.length) root.append(h("datalist", { id: listId }, suggestions.map((s) => h("option", { value: s }))));
  };
  const add = () => {
    const value = field.value.replace(/,/g, " ").trim();
    if (!value) return;
    if (items.length >= max) return toast(`${max} éléments maximum.`, "warn");
    if (!items.some((t) => t.toLowerCase() === value.toLowerCase())) items.push(value);
    field.value = "";
    render();
    onChange(items);
    field.focus();
  };
  field.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    } else if (e.key === "Backspace" && !field.value && items.length) {
      items.pop();
      render();
      onChange(items);
      field.focus();
    }
  });
  field.addEventListener("blur", add);
  render();
  root.input = field;
  // Remplacement de toute la liste (ex. choix dans un catalogue), sans repasser par la saisie
  root.setValues = (next) => {
    items = [...next].slice(0, max);
    render();
    onChange(items);
  };
  return root;
}

/** Liste de lignes de texte (infos pratiques…), réordonnable. */
export function listEditor({ values = [], placeholder = "", label, onChange, addLabel = "Ajouter une ligne", max = 12 }) {
  let items = values.length ? [...values] : [];
  const root = h("div", { class: "list-editor" });
  const render = (focusIndex) => {
    clear(root);
    items.forEach((value, i) => {
      const field = input({ value, placeholder, "aria-label": `${label} ${i + 1}`, oninput: (e) => { items[i] = e.target.value; onChange(items); } });
      root.append(h("div", { class: "list-editor__row" }, field,
        h("div", { class: "actions" },
          h("button", { type: "button", class: "btn btn--icon btn--sm btn--ghost", "aria-label": `Monter la ligne ${i + 1}`, disabled: i === 0, onclick: () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; onChange(items); render(i - 1); } }, icon("up")),
          h("button", { type: "button", class: "btn btn--icon btn--sm btn--ghost", "aria-label": `Descendre la ligne ${i + 1}`, disabled: i === items.length - 1, onclick: () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; onChange(items); render(i + 1); } }, icon("down")),
          h("button", { type: "button", class: "btn btn--icon btn--sm btn--ghost", "aria-label": `Supprimer la ligne ${i + 1}`, onclick: () => { items.splice(i, 1); onChange(items); render(); } }, icon("trash")))));
      if (i === focusIndex) queueMicrotask(() => field.focus());
    });
    root.append(h("div", {}, h("button", { type: "button", class: "btn btn--sm", disabled: items.length >= max, onclick: () => { items.push(""); onChange(items); render(items.length - 1); } }, icon("plus"), addLabel)));
  };
  render();
  return root;
}

/** Liens { label, url }. */
export function linksEditor({ values = [], onChange, max = 6, labelPlaceholder = "Libellé (ex. Événement Facebook)" }) {
  let items = values.map((l) => ({ ...l }));
  const root = h("div", { class: "list-editor" });
  const render = (focus) => {
    clear(root);
    items.forEach((link, i) => {
      const label = input({ value: link.label, placeholder: labelPlaceholder, "aria-label": `Libellé du lien ${i + 1}`, oninput: (e) => { items[i].label = e.target.value; onChange(items); } });
      const url = input({ type: "url", value: link.url, placeholder: "https://…", "aria-label": `Adresse du lien ${i + 1}`, oninput: (e) => { items[i].url = e.target.value; onChange(items); } });
      root.append(h("div", { class: "list-editor__row list-editor__row--pair" }, label, url,
        h("button", { type: "button", class: "btn btn--icon btn--sm btn--ghost", "aria-label": `Supprimer le lien ${i + 1}`, onclick: () => { items.splice(i, 1); onChange(items); render(); } }, icon("trash"))));
      if (focus === i) queueMicrotask(() => label.focus());
    });
    root.append(h("div", {}, h("button", { type: "button", class: "btn btn--sm", disabled: items.length >= max, onclick: () => { items.push({ label: "", url: "" }); onChange(items); render(items.length - 1); } }, icon("plus"), "Ajouter un lien")));
  };
  render();
  return root;
}

/**
 * Choix dans une liste avec recherche (ARIA combobox) : flèches, Entrée, Échap.
 * search(texte) -> Promise<[{ id, label, sub, thumbUrl }]> ; onSelect(option) ; onCreate(texte) facultatif.
 */
export function combobox({ label, placeholder = "Rechercher…", search, onSelect, onCreate, createLabel = (t) => `Créer « ${t} »` }) {
  const listId = uid("lb");
  const field = input({ role: "combobox", "aria-expanded": "false", "aria-controls": listId, "aria-autocomplete": "list", placeholder, "aria-label": label, autocomplete: "off" });
  const list = h("ul", { class: "combo__list", id: listId, role: "listbox", hidden: true, "aria-label": label });
  const root = h("div", { class: "combo" }, field, list);
  let options = [];
  let active = -1;
  let seq = 0;
  const close = () => {
    list.hidden = true;
    field.setAttribute("aria-expanded", "false");
    field.removeAttribute("aria-activedescendant");
    active = -1;
  };
  const choose = (opt) => {
    close();
    field.value = "";
    if (opt.create) onCreate?.(opt.text);
    else onSelect(opt);
  };
  const highlight = (i) => {
    active = i;
    [...list.children].forEach((li, j) => li.setAttribute("aria-selected", String(j === i)));
    const li = list.children[i];
    if (li) {
      field.setAttribute("aria-activedescendant", li.id);
      li.scrollIntoView({ block: "nearest" });
    }
  };
  const refresh = debounce(async () => {
    const text = field.value.trim();
    const mine = ++seq;
    let results = [];
    try {
      results = await search(text);
    } catch (error) {
      toast(errorMessage(error), "error");
    }
    if (mine !== seq) return;
    options = results.slice(0, 30);
    if (onCreate && text && !options.some((o) => o.label.toLowerCase() === text.toLowerCase())) options.push({ create: true, text, label: createLabel(text) });
    clear(list);
    if (!options.length) list.append(h("li", { class: "combo__empty", role: "presentation" }, text ? "Aucun résultat." : "Tapez pour rechercher."));
    options.forEach((opt, i) => {
      list.append(h("li", { id: `${listId}-${i}`, role: "option", class: ["combo__option", opt.create && "combo__option--create"], "aria-selected": "false", onmousedown: (e) => { e.preventDefault(); choose(opt); } },
        opt.create ? icon("plus") : opt.thumbUrl ? h("img", { src: opt.thumbUrl, alt: "" }) : h("span", { class: "ph", "aria-hidden": "true" }),
        h("span", {}, opt.label),
        opt.sub ? h("small", {}, opt.sub) : null));
    });
    list.hidden = false;
    field.setAttribute("aria-expanded", "true");
    if (options.length) highlight(0);
  }, 180);
  field.addEventListener("input", refresh);
  field.addEventListener("focus", refresh);
  field.addEventListener("blur", () => setTimeout(close, 120));
  field.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (list.hidden) refresh(); else highlight(Math.min(options.length - 1, active + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); highlight(Math.max(0, active - 1)); }
    else if (e.key === "Enter") { if (!list.hidden && options[active]) { e.preventDefault(); choose(options[active]); } }
    else if (e.key === "Escape") { if (!list.hidden) { e.stopPropagation(); close(); } }
  });
  root.input = field;
  return root;
}

/* ---------- Médias ---------- */

/** Import de fichiers avec progression ; renvoie les médias créés. */
export async function uploadFiles(files, container) {
  const results = [];
  for (const file of files) {
    const bar = h("span");
    const row = h("div", { class: "upload-row" }, h("span", {}, `${file.name} · ${fileSize(file.size)}`), h("div", { class: "progress", role: "progressbar", "aria-label": `Import de ${file.name}` }, bar));
    container?.append(row);
    try {
      const res = await upload("/api/media", file, { onProgress: (p) => { bar.style.width = `${Math.round(p * 100)}%`; } });
      bar.style.width = "100%";
      if (res.duplicate) toast(`${file.name} : déjà présente dans la médiathèque, réutilisée.`, "warn");
      results.push(res.media);
      setTimeout(() => row.remove(), 1500);
    } catch (error) {
      row.classList.add("is-error");
      replace(row.firstChild, `${file.name} : ${errorMessage(error)}`);
      bar.style.width = "100%";
    }
  }
  return results;
}

export function dropzone({ onFiles, multiple = true, label = "Glissez des images ici ou" }) {
  const fileInput = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp,image/avif,image/gif", multiple, class: "sr-only", onchange: () => { if (fileInput.files.length) onFiles([...fileInput.files]); fileInput.value = ""; } });
  const zone = h("div", { class: "dropzone" },
    h("p", {}, label, " ", h("button", { type: "button", class: "link-btn", onclick: () => fileInput.click() }, "choisissez des fichiers"), "."),
    h("p", { class: "small" }, "JPEG, PNG, WebP, AVIF ou GIF. Les images sont optimisées automatiquement (WebP) et leurs métadonnées (position GPS…) retirées."),
    fileInput);
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("is-over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("is-over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("is-over");
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  });
  zone.open = () => fileInput.click();
  return zone;
}

/** Dialogue de choix d'images (avec import). multiple : sélection multiple. Promise<média[] | null>. */
export function pickMedia({ title = "Choisir une image", multiple = false } = {}) {
  return new Promise((resolve) => {
    const selected = new Map();
    let q = "";
    let page = 1;
    const grid = h("div", { class: "media-grid" });
    const more = h("button", { type: "button", class: "btn btn--sm", hidden: true }, "Afficher plus");
    const uploads = h("div", { class: "uploads" });
    const confirmBtn = h("button", { type: "button", class: "btn btn--primary", disabled: true }, multiple ? "Ajouter la sélection" : "Choisir");
    const updateConfirm = () => {
      confirmBtn.disabled = !selected.size;
      confirmBtn.textContent = multiple && selected.size ? `Ajouter ${selected.size} image(s)` : multiple ? "Ajouter la sélection" : "Choisir";
    };
    const tile = (m) => {
      const btn = h("button", { type: "button", class: "media-tile", "aria-pressed": String(selected.has(m.id)), title: m.originalName },
        h("img", { src: m.thumbUrl, alt: m.alt || "", loading: "lazy" }),
        h("span", { class: "media-tile__check", "aria-hidden": "true" }, "✓"),
        h("span", { class: "media-tile__meta" }, h("span", { class: "media-tile__name" }, m.originalName), h("span", { class: "muted" }, `${m.width} × ${m.height}`)));
      btn.addEventListener("click", () => {
        if (!multiple) {
          selected.clear();
          grid.querySelectorAll(".media-tile").forEach((t) => t.setAttribute("aria-pressed", "false"));
        }
        if (selected.has(m.id)) selected.delete(m.id);
        else selected.set(m.id, m);
        btn.setAttribute("aria-pressed", String(selected.has(m.id)));
        updateConfirm();
      });
      btn.addEventListener("dblclick", () => { if (!multiple) { selected.set(m.id, m); finish(); } });
      return btn;
    };
    const load = async (reset = false) => {
      if (reset) {
        page = 1;
        replace(grid, loadingState());
      }
      try {
        const data = await get(`/api/media${qs({ q, page, pageSize: 48 })}`);
        if (reset) clear(grid);
        if (!data.items.length && reset) grid.append(emptyState("Aucune image", q ? "Essayez un autre mot." : "Importez une première image ci-dessus."));
        data.items.forEach((m) => grid.append(tile(m)));
        more.hidden = page * data.pageSize >= data.total;
      } catch (error) {
        replace(grid, h("p", { class: "error-text" }, errorMessage(error)));
      }
    };
    more.addEventListener("click", () => { page++; load(); });
    const search = input({ type: "search", placeholder: "Rechercher par nom ou texte alternatif…", "aria-label": "Rechercher une image", oninput: debounce((e) => { q = e.target.value; load(true); }, 250) });
    const zone = dropzone({
      multiple,
      onFiles: async (files) => {
        const created = await uploadFiles(files, uploads);
        if (!created.length) return;
        if (!multiple) selected.clear();
        created.forEach((m) => selected.set(m.id, m));
        updateConfirm();
        if (!multiple) return finish();
        await load(true);
      }
    });
    let done = false;
    const finish = () => {
      done = true;
      d.close("ok");
      resolve([...selected.values()]);
    };
    confirmBtn.addEventListener("click", finish);
    const d = dialog({
      title,
      wide: true,
      body: h("div", { class: "stack" }, zone, uploads, search, grid, h("div", {}, more)),
      actions: [h("button", { type: "button", class: "btn", onclick: () => d.close() }, "Annuler"), confirmBtn],
      onClose: () => { if (!done) resolve(null); }
    });
    load(true);
    search.focus();
  });
}

/** Emplacement d'image dans un formulaire (affiche, photo…) : aperçu + Choisir / Retirer. */
export function mediaSlot({ media, label, hint, onChange, wide = false }) {
  let current = media;
  const root = h("div", { class: ["media-slot", wide && "media-slot--wide"] });
  const render = () => {
    clear(root);
    append(root, [
      current ? h("img", { src: current.thumbUrl, alt: current.alt || "" }) : h("div", { class: "media-slot__empty", "aria-hidden": "true" }, "Aucune image"),
      h("div", { class: "stack", style: { gap: "8px" } },
        h("div", {}, h("strong", {}, label), hint ? h("p", { class: "hint", style: { margin: "2px 0 0" } }, hint) : null,
          current ? h("p", { class: "small muted", style: { margin: "4px 0 0" } }, `${current.originalName} · ${current.width} × ${current.height}`) : null),
        h("div", { class: "actions" },
          h("button", { type: "button", class: "btn btn--sm", onclick: async () => {
            const [picked] = (await pickMedia({ title: `Choisir : ${label}` })) || [];
            if (picked) { current = picked; render(); onChange(picked); }
          } }, icon("image"), current ? "Changer" : "Choisir une image"),
          current ? h("button", { type: "button", class: "btn btn--sm btn--ghost", onclick: () => { current = null; render(); onChange(null); } }, "Retirer") : null))
    ]);
  };
  render();
  return root;
}
