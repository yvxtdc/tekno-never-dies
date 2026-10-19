/** Administration : comptes, journal d'activité, sauvegardes (administrateurs uniquement). */
import { h, replace, debounce } from "../lib/dom.js";
import { get, post, put, del, qs } from "../lib/api.js";
import { icon, pageHead, loadingState, errorState, emptyState, statusBadge, field, input, select, toast, errorMessage, confirm, dialog, busy, pagination, copyText, showFieldErrors } from "../lib/ui.js";
import { formatDateTime, relative, fileSize } from "../lib/format.js";
import { session } from "../lib/session.js";

function showPassword(title, email, password) {
  dialog({
    title,
    body: h("div", { class: "stack" },
      h("p", {}, `Mot de passe temporaire de ${email}. Il ne sera plus affiché : transmettez-le de façon sûre (en main propre, message éphémère…). Il devra être changé à la première connexion.`),
      h("div", { class: "secret" }, h("span", { style: { flex: 1 } }, password), h("button", { type: "button", class: "btn btn--icon btn--sm", "aria-label": "Copier le mot de passe", onclick: () => copyText(password) }, icon("copy")))),
    actions: [h("button", { type: "button", class: "btn btn--primary", onclick: (e) => e.target.closest("dialog").close() }, "J'ai noté le mot de passe")]
  });
}

export async function usersView(ctx, main) {
  document.title = "Comptes — Administration TND";
  replace(main, loadingState());
  let users;
  try {
    users = await get("/api/users");
  } catch (error) {
    return replace(main, errorState(error, () => usersView(ctx, main)));
  }
  const create = () => {
    const email = input({ type: "email", autocomplete: "off" });
    const name = input();
    const role = select([["editor", "Éditeur — gère les contenus et la mise en ligne"], ["admin", "Administrateur — accès complet"]]);
    const form = h("div", { class: "stack" }, field({ label: "Adresse e-mail", control: email, name: "email", required: true }), field({ label: "Nom", control: name, name: "name", required: true }), field({ label: "Rôle", control: role, name: "role" }));
    const ok = h("button", { type: "button", class: "btn btn--primary" }, "Créer le compte");
    const d = dialog({ title: "Nouveau compte", body: form, actions: [h("button", { type: "button", class: "btn", onclick: () => d.close() }, "Annuler"), ok] });
    ok.addEventListener("click", () => busy(ok, async () => {
      try {
        const { user, temporaryPassword } = await post("/api/users", { email: email.value, name: name.value, role: role.value });
        d.close();
        showPassword("Compte créé", user.email, temporaryPassword);
        usersView(ctx, main);
      } catch (error) {
        if (error.status === 422) showFieldErrors(form, error.fields);
        else toast(errorMessage(error), "error");
      }
    }));
    email.focus();
  };
  const action = (fn) => async (e) => busy(e.btn || e.currentTarget, async () => {
    try {
      await fn();
      usersView(ctx, main);
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  });
  replace(main,
    pageHead({ title: "Comptes", subtitle: "Pas d'inscription publique : seuls les administrateurs créent les comptes.", actions: [h("button", { type: "button", class: "btn btn--primary", onclick: create }, icon("plus"), "Nouveau compte")] }),
    h("div", { class: "table-wrap" }, h("table", { class: "table table--stack" },
      h("thead", {}, h("tr", {}, h("th", {}, "Personne"), h("th", {}, "Rôle"), h("th", {}, "Dernière connexion"), h("th", {}, h("span", { class: "sr-only" }, "Actions")))),
      h("tbody", {}, users.map((u) => {
        const me = u.id === session.user.id;
        const role = select([["editor", "Éditeur"], ["admin", "Administrateur"]], { value: u.role, disabled: me, "aria-label": `Rôle de ${u.name}` });
        role.addEventListener("change", async () => {
          try {
            await put(`/api/users/${u.id}`, { role: role.value });
            toast(`Rôle de ${u.name} modifié (ses sessions ouvertes sont fermées).`);
          } catch (error) {
            role.value = u.role;
            toast(errorMessage(error), "error");
          }
        });
        return h("tr", {},
          h("td", { class: "title-col" }, h("div", {}, h("strong", {}, u.name, me ? " (vous)" : ""), h("div", { class: "small muted" }, u.email), !u.active ? statusBadge("archived", "Désactivé") : u.mustChangePassword ? statusBadge("scheduled", "Mot de passe temporaire") : null)),
          h("td", { "data-label": "Rôle" }, role),
          h("td", { "data-label": "Connexion" }, u.lastLoginAt ? relative(u.lastLoginAt) : h("span", { class: "muted" }, "jamais")),
          h("td", {}, me ? null : h("div", { class: "actions" },
            h("button", { type: "button", class: "btn btn--sm", onclick: async (e) => {
              const btn = e.currentTarget;
              if (!(await confirm({ title: `Réinitialiser le mot de passe de ${u.name} ?`, message: "Un mot de passe temporaire sera créé et ses sessions fermées.", confirmLabel: "Réinitialiser" }))) return;
              await busy(btn, async () => {
                try {
                  const { temporaryPassword } = await post(`/api/users/${u.id}/reset-password`);
                  showPassword("Mot de passe réinitialisé", u.email, temporaryPassword);
                } catch (error) {
                  toast(errorMessage(error), "error");
                }
              });
            } }, "Réinitialiser le mot de passe"),
            h("button", { type: "button", class: "btn btn--sm", onclick: action(() => put(`/api/users/${u.id}`, { active: !u.active })) }, u.active ? "Désactiver" : "Réactiver"),
            h("button", { type: "button", class: "btn btn--sm btn--danger", onclick: async (e) => {
              const btn = e.currentTarget;
              if (await confirm({ title: `Supprimer le compte de ${u.name} ?`, message: "Son historique reste dans le journal (sans lien vers le compte). Préférez « Désactiver » si la personne peut revenir.", confirmLabel: "Supprimer", danger: true })) action(() => del(`/api/users/${u.id}`))({ btn });
            } }, "Supprimer"))));
      })))));
}

const ENTITY_TYPES = [["", "Tout"], ["event", "Soirées"], ["artist", "Artistes"], ["venue", "Lieux"], ["media", "Médias"], ["faq", "FAQ"], ["team", "Équipe"], ["album", "Galerie"], ["user", "Comptes et connexions"], ["publication", "Mises en ligne"], ["backup", "Sauvegardes"]];

export async function auditView(ctx, main) {
  document.title = "Journal d'activité — Administration TND";
  const state = { entityType: "", q: "", page: 1 };
  const results = h("div", { "aria-live": "polite" });
  const load = async () => {
    replace(results, loadingState());
    try {
      const data = await get(`/api/audit${qs({ ...state, pageSize: 50 })}`);
      if (!data.items.length) return replace(results, emptyState("Aucune action", "Rien ne correspond à ces filtres."));
      replace(results, h("div", { class: "table-wrap" }, h("table", { class: "table table--stack" },
        h("thead", {}, h("tr", {}, h("th", {}, "Date"), h("th", {}, "Qui"), h("th", {}, "Action"), h("th", {}, "Détail"), h("th", {}, "IP"))),
        h("tbody", {}, data.items.map((a) => h("tr", {},
          h("td", { "data-label": "Date" }, h("time", { datetime: a.created_at, title: a.created_at }, formatDateTime(a.created_at))),
          h("td", { "data-label": "Qui" }, a.user_name || h("span", { class: "muted" }, a.ip === "cli" ? "ligne de commande" : "—")),
          h("td", { "data-label": "Action" }, h("code", {}, a.action)),
          h("td", { class: "title-col" }, a.summary),
          h("td", { "data-label": "IP", class: "small muted" }, a.ip || "")))))),
        pagination({ page: data.page, pageSize: data.pageSize, total: data.total, onChange: (p) => { state.page = p; load(); } }));
    } catch (error) {
      replace(results, errorState(error, load));
    }
  };
  replace(main,
    pageHead({ title: "Journal d'activité", subtitle: "Qui a fait quoi, et quand : modifications, publications, connexions (y compris les échecs)." }),
    h("div", { class: "toolbar" },
      h("div", { class: "search" }, icon("search"), input({ type: "search", placeholder: "Rechercher…", "aria-label": "Rechercher dans le journal", oninput: debounce((e) => { state.q = e.target.value.trim(); state.page = 1; load(); }, 300) })),
      select(ENTITY_TYPES, { "aria-label": "Type", onchange: (e) => { state.entityType = e.target.value; state.page = 1; load(); } })),
    results);
  load();
}

export async function backupsView(ctx, main) {
  document.title = "Sauvegardes — Administration TND";
  replace(main, loadingState());
  let data;
  try {
    data = await get("/api/backups");
  } catch (error) {
    return replace(main, errorState(error, () => backupsView(ctx, main)));
  }
  replace(main,
    pageHead({ title: "Sauvegardes", subtitle: `Copies de la base du CMS (contenus, comptes, historique). ${data.everyHours ? `Sauvegarde automatique toutes les ${data.everyHours} h` : "Sauvegarde automatique désactivée"} ; les ${data.keep} plus récentes sont conservées.`,
      actions: [h("button", { type: "button", class: "btn btn--primary", onclick: async (e) => busy(e.currentTarget, async () => {
        try {
          const b = await post("/api/backups");
          toast(`Sauvegarde créée : ${b.name}`);
          backupsView(ctx, main);
        } catch (error) {
          toast(errorMessage(error), "error");
        }
      }) }, icon("backup"), "Sauvegarder maintenant")] }),
    h("div", { class: "split" },
      data.items.length
        ? h("div", { class: "table-wrap" }, h("table", { class: "table table--stack" },
            h("thead", {}, h("tr", {}, h("th", {}, "Fichier"), h("th", {}, "Date"), h("th", {}, "Taille"), h("th", {}, h("span", { class: "sr-only" }, "Télécharger")))),
            h("tbody", {}, data.items.map((b) => h("tr", {},
              h("td", { class: "title-col" }, h("code", {}, b.name)),
              h("td", { "data-label": "Date" }, formatDateTime(b.createdAt)),
              h("td", { "data-label": "Taille" }, fileSize(b.size)),
              h("td", {}, h("a", { class: "btn btn--sm", href: `/api/backups/${encodeURIComponent(b.name)}`, download: b.name }, "Télécharger")))))))
        : emptyState("Aucune sauvegarde", "Créez la première sauvegarde."),
      h("div", { class: "split__side" }, h("section", { class: "card card--warn" }, h("h2", {}, "Restaurer une sauvegarde"),
        h("p", { class: "small", style: { marginTop: "8px" } }, "La restauration se fait sur le serveur, CMS arrêté, pour éviter toute perte :"),
        h("pre", { class: "log" }, "npm run cms:admin -- restore <fichier> --yes"),
        h("p", { class: "small muted" }, "La base actuelle est conservée automatiquement avant d'être remplacée. Les fichiers contiennent les empreintes des mots de passe : stockez-les en lieu sûr. Les images importées (dossier media) se sauvegardent à part : voir docs/cms/exploitation.md.")))));
}
