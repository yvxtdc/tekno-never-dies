/**
 * Infos de l'association : coordonnées, siège, responsable de publication, hébergeur. Écrites partout sur
 * le site à la mise en ligne (en-tête, pied de page, Contact, mentions légales, confidentialité,
 * conditions : tools/sync-infos.mjs). Modification réservée aux administrateurs (settings.manage) ;
 * lecture seule pour les éditeurs. Service : server/services/site-info.mjs.
 */
import { h, replace } from "../lib/dom.js";
import { get, put } from "../lib/api.js";
import { pageHead, loadingState, errorState, field, input, toast, errorMessage, busy, showFieldErrors } from "../lib/ui.js";
import { can } from "../lib/session.js";

const GROUPS = [
  ["Coordonnées", "Menu, pied de page, page Contact, pages légales.", [
    ["email", "Adresse e-mail", { type: "email", maxlength: 200, required: true }, "Liens « Écrire à… » partout sur le site, et contact des pages légales."],
    ["phone", "Téléphone", { type: "tel", maxlength: 30 }, "Page Contact et mentions légales. Format : +33 7 81 87 82 23."],
    ["instagram", "Compte Instagram", { type: "url", maxlength: 200, required: true }, "Adresse complète : https://www.instagram.com/nom/."]
  ]],
  ["Siège de l'association", "Mentions légales et politique de confidentialité, données structurées pour les moteurs de recherche.", [
    ["street", "Rue", { maxlength: 120, required: true }],
    ["postalCode", "Code postal", { maxlength: 10, required: true }],
    ["city", "Ville", { maxlength: 80, required: true }]
  ]],
  ["Responsable de publication", "Mentions légales : « Nom, fonction et responsable de publication. »", [
    ["publisherName", "Nom", { maxlength: 80, required: true }],
    ["publisherRole", "Fonction", { maxlength: 120, required: true }, "Ex. « président de l'association », « présidente de l'association ». À traduire dans Traductions."]
  ]],
  ["Hébergeur du site", "Mentions légales (obligatoire). À changer si le site change d'hébergeur.", [
    ["hostName", "Nom", { maxlength: 120, required: true }],
    ["hostAddress", "Adresse", { maxlength: 200, required: true }, "Sur une ligne. À traduire dans Traductions (pays)."],
    ["hostUrl", "Site web", { type: "url", maxlength: 200, required: true }]
  ]]
];

export async function siteInfoView(ctx, main) {
  document.title = "Infos de l'association — Administration TND";
  replace(main, loadingState());
  let info;
  try {
    info = await get("/api/site-info");
  } catch (error) {
    return replace(main, errorState(error, () => siteInfoView(ctx, main)));
  }
  const editable = can("settings.manage");
  const controls = {};
  const form = h("form", { class: "stack", novalidate: true },
    editable ? null : h("p", { class: "card small" }, "Lecture seule : seuls les administrateurs peuvent modifier ces infos (elles figurent dans les mentions légales)."),
    GROUPS.map(([title, where, fields]) => h("section", { class: "card stack" },
      h("div", {}, h("h2", { style: { margin: 0 } }, title), h("p", { class: "hint", style: { margin: "4px 0 0" } }, where)),
      h("div", { class: "fields fields--2" }, fields.map(([name, label, attrs, hint]) => {
        controls[name] = input({ ...attrs, value: info[name] ?? "", disabled: !editable, autocomplete: "off" });
        return field({ label, control: controls[name], name, hint, required: attrs.required });
      })))));
  const save = h("button", { type: "submit", class: "btn btn--primary", hidden: !editable }, "Enregistrer");
  form.append(h("div", { class: "actions" }, save,
    h("span", { class: "small muted" }, "Visible sur le site après la mise en ligne. Fonction et adresse de l'hébergeur : traductions dans ", h("a", { href: "/admin/translations" }, "Traductions"), ".")));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!editable) return;
    busy(save, async () => {
      const data = Object.fromEntries(Object.entries(controls).map(([name, control]) => [name, control.value]));
      try {
        info = await put("/api/site-info", { ...data, version: info.version });
        for (const [name, control] of Object.entries(controls)) control.value = info[name] ?? "";
        showFieldErrors(form, {});
        toast("Infos enregistrées.");
      } catch (error) {
        if (error.status === 422) showFieldErrors(form, error.fields);
        else toast(errorMessage(error), "error");
      }
    });
  });
  replace(main,
    pageHead({ title: "Infos de l'association", subtitle: "Coordonnées, siège, responsable de publication et hébergeur : écrits partout sur le site, pages légales comprises." }),
    form);
}
