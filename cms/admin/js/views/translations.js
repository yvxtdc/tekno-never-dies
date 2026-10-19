/** Traductions allemandes et anglaises des textes des contenus (soirées, FAQ, équipe). */
import { h, replace, debounce } from "../lib/dom.js";
import { get, put, qs } from "../lib/api.js";
import { icon, pageHead, loadingState, errorState, emptyState, input, textarea, select, errorMessage } from "../lib/ui.js";
import { richTextToPlain } from "/admin/shared/richtext.mjs";

export async function translationsView(ctx, main) {
  document.title = "Traductions — Administration TND";
  const state = { missing: ctx.query.get("missing") || "any", q: "" };
  const results = h("div", { "aria-live": "polite" });
  const load = async () => {
    replace(results, loadingState());
    try {
      const items = await get(`/api/translations${qs(state)}`);
      if (!items.length) return replace(results, emptyState(state.missing ? "Tout est traduit 🎉" : "Aucun texte", state.missing ? "Aucun texte à traduire avec ce filtre." : null));
      replace(results, h("p", { class: "small muted" }, `${items.length} texte(s). Enregistrement automatique en quittant un champ.`),
        h("div", { class: "stack" }, items.map((t) => row(t))));
    } catch (error) {
      replace(results, errorState(error, load));
    }
  };
  replace(main,
    pageHead({ title: "Traductions", subtitle: "Les pages allemande et anglaise affichent ces traductions ; sans traduction, le texte français reste affiché. Les textes fixes des pages (menus, boutons) se traduisent dans js/i18n/de.js et en.js." }),
    h("div", { class: "toolbar" },
      h("div", { class: "search" }, icon("search"), input({ type: "search", placeholder: "Rechercher un texte…", "aria-label": "Rechercher un texte", oninput: debounce((e) => { state.q = e.target.value.trim(); load(); }, 300) })),
      select([["any", "À traduire (DE ou EN)"], ["de", "Sans allemand"], ["en", "Sans anglais"], ["", "Tous les textes"]], { value: state.missing, "aria-label": "Filtrer", onchange: (e) => { state.missing = e.target.value; load(); } })),
    results);
  load();
}

function row(t) {
  const card = h("article", { class: "card", style: { padding: "14px" } },
    h("p", { class: "small muted", style: { marginBottom: "4px" } }, t.usedIn.join(" · ")),
    h("p", { style: { fontWeight: 600 } }, "FR · ", t.rich ? richTextToPlain(t.source) : t.source),
    t.rich ? h("p", { class: "hint" }, "Texte avec liens : gardez la syntaxe [texte](adresse) et **gras**.") : null);
  const grid = h("div", { class: "fields fields--2" });
  for (const lang of ["de", "en"]) {
    const control = (t.source.length > 90 || t.rich ? textarea : input)({ value: t[lang], rows: 3, "aria-label": `${lang === "de" ? "Allemand" : "Anglais"} : ${t.source.slice(0, 80)}` });
    const status = h("p", { class: "hint", "aria-live": "polite" });
    let last = t[lang];
    control.addEventListener("blur", async () => {
      if (control.value === last) return;
      status.textContent = "Enregistrement…";
      try {
        await put("/api/translations", { source: t.source, lang, text: control.value });
        last = control.value;
        status.textContent = "Enregistré ✓";
      } catch (error) {
        status.textContent = errorMessage(error);
      }
    });
    grid.append(h("div", { class: "field" }, h("label", { class: "label", for: control.id || (control.id = `tr-${lang}-${Math.random().toString(36).slice(2)}`) }, lang === "de" ? "Allemand (DE)" : "Anglais (EN)"), control, status));
  }
  card.append(grid);
  return card;
}
