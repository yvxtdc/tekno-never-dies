/** Démarrage de l'administration : session, structure, navigation, routes. */
import { h, replace, append } from "./lib/dom.js";
import { get, post, setCsrf, setUnauthorizedHandler, ApiError } from "./lib/api.js";
import { route, start, navigate } from "./lib/router.js";
import { icon, toast, field, input, busy, showFieldErrors, errorMessage } from "./lib/ui.js";
import { session, setSession, can } from "./lib/session.js";
import { dashboardView } from "./views/dashboard.js";
import { eventsListView } from "./views/events-list.js";
import { eventEditView } from "./views/event-edit.js";
import { artistsListView, artistEditView } from "./views/artists.js";
import { venuesListView, venueEditView } from "./views/venues.js";
import { mediaView } from "./views/media.js";
import { galleryListView, albumView } from "./views/gallery.js";
import { faqView } from "./views/faq.js";
import { teamView } from "./views/team.js";
import { translationsView } from "./views/translations.js";
import { publishView } from "./views/publish.js";
import { usersView, auditView, backupsView } from "./views/admin.js";
import { accountView } from "./views/account.js";

const app = document.getElementById("app");

const NAV = [
  [null, [["Tableau de bord", "/admin", "dashboard"]]],
  ["Programmation", [["Soirées", "/admin/events", "events"], ["Artistes", "/admin/artists", "artists"], ["Lieux", "/admin/venues", "venues"]]],
  ["Contenus", [["Médiathèque", "/admin/media", "media"], ["Galerie photo", "/admin/gallery", "gallery"], ["FAQ", "/admin/faq", "faq"], ["Équipe", "/admin/team", "team"], ["Traductions", "/admin/translations", "translate"]]],
  ["Site", [["Mise en ligne", "/admin/publish", "publish"]]],
  ["Administration", [["Comptes", "/admin/users", "users", "users.manage"], ["Journal d'activité", "/admin/audit", "audit", "audit.read"], ["Sauvegardes", "/admin/backups", "backup", "backups.manage"]]]
];

function layout() {
  const main = h("main", { id: "main", class: "main", tabindex: "-1" });
  const shell = h("div", { class: "layout" });
  const closeNav = () => shell.classList.remove("nav-open");
  const nav = h("nav", { class: "nav", "aria-label": "Navigation de l'administration" });
  for (const [group, items] of NAV) {
    const visible = items.filter(([, , , perm]) => !perm || can(perm));
    if (!visible.length) continue;
    if (group) nav.append(h("p", { class: "nav__group" }, group));
    for (const [label, href, ic] of visible) nav.append(h("a", { href, onclick: closeNav }, icon(ic), h("span", {}, label)));
  }
  const user = session.user;
  const sidebar = h("aside", { class: "sidebar", id: "sidebar" },
    h("a", { class: "brand", href: "/admin" }, h("span", { class: "brand__logo", "aria-hidden": "true" }), h("span", {}, h("span", { class: "brand__name" }, "Tekno Never Dies"), h("span", { class: "brand__sub" }, "Administration"))),
    nav,
    h("div", { class: "sidebar__foot" },
      h("a", { href: "/admin/account", class: "me", onclick: closeNav, "aria-label": "Mon compte" },
        h("span", { class: "me__avatar", "aria-hidden": "true" }, (user.name || "?").slice(0, 1).toUpperCase()),
        h("span", {}, h("span", { class: "me__name" }, user.name), h("span", { class: "me__role", style: { display: "block" } }, user.roleLabel))),
      h("a", { class: "btn btn--sm btn--ghost", href: "/preview/site/", target: "_blank", rel: "noopener" }, icon("eye"), "Aperçu du site"),
      h("button", { type: "button", class: "btn btn--sm btn--ghost", onclick: logout }, icon("logout"), "Se déconnecter")));
  const topbar = h("div", { class: "topbar" },
    h("button", { type: "button", class: "btn btn--icon btn--ghost", "aria-label": "Ouvrir le menu", "aria-controls": "sidebar", onclick: () => shell.classList.toggle("nav-open") }, icon("menu")),
    h("a", { class: "brand", href: "/admin" }, h("span", { class: "brand__logo", "aria-hidden": "true" }), h("span", { class: "brand__name" }, "TND · Admin")));
  shell.addEventListener("click", (e) => { if (e.target === shell) closeNav(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeNav(); });
  append(shell, [sidebar, h("div", {}, topbar, main)]);
  document.addEventListener("route:change", () => {
    const path = location.pathname.replace(/\/+$/, "") || "/admin";
    nav.querySelectorAll("a").forEach((a) => {
      const href = a.getAttribute("href");
      const active = href === "/admin" ? path === "/admin" : path === href || path.startsWith(`${href}/`);
      if (active) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  });
  return { shell, main };
}

async function logout() {
  try {
    await post("/api/auth/logout");
  } catch { /* session déjà fermée */ }
  location.href = "/admin/login";
}

/* ---------- Connexion ---------- */
function loginView() {
  document.title = "Connexion — Administration Tekno Never Dies";
  const email = input({ type: "email", name: "email", autocomplete: "username", required: true, autofocus: true });
  const password = input({ type: "password", name: "password", autocomplete: "current-password", required: true });
  const errors = h("div", { class: "form-errors", hidden: true, role: "alert" });
  const submit = h("button", { type: "submit", class: "btn btn--primary" }, "Se connecter");
  const form = h("form", { class: "stack", novalidate: true },
    errors,
    field({ label: "Adresse e-mail", control: email, name: "email" }),
    field({ label: "Mot de passe", control: password, name: "password" }),
    submit);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    busy(submit, async () => {
      try {
        const data = await post("/api/auth/login", { email: email.value, password: password.value });
        setSession(data);
        const next = new URLSearchParams(location.search).get("next");
        // Retour à la page demandée (même origine, administration ou aperçu uniquement).
        const target = next && /^\/(admin|preview)\//.test(next) && !next.startsWith("//") ? next : "/admin";
        if (target.startsWith("/preview/")) location.href = target;
        else boot(target);
      } catch (error) {
        password.value = "";
        if (error instanceof ApiError && error.status === 422) showFieldErrors(form, error.fields);
        else {
          errors.hidden = false;
          replace(errors, errorMessage(error));
          errors.focus?.();
        }
      }
    });
  });
  replace(app, h("main", { class: "auth", id: "main" },
    h("div", { class: "auth__card" },
      h("div", { class: "auth__logo", role: "img", "aria-label": "Logo Tekno Never Dies" }),
      h("h1", {}, "Administration"),
      h("p", { class: "auth__sub" }, "Tekno Never Dies · accès réservé à l'équipe"),
      form)));
  app.removeAttribute("aria-busy");
  app.className = "";
}

/** Mot de passe temporaire : changement obligatoire avant tout le reste. */
function forcedPasswordView() {
  const current = input({ type: "password", autocomplete: "current-password" });
  const next = input({ type: "password", autocomplete: "new-password" });
  const confirmInput = input({ type: "password", autocomplete: "new-password" });
  const submit = h("button", { type: "submit", class: "btn btn--primary" }, "Enregistrer mon mot de passe");
  const form = h("form", { class: "stack", novalidate: true },
    field({ label: "Mot de passe temporaire", control: current, name: "currentPassword" }),
    field({ label: "Nouveau mot de passe", control: next, name: "newPassword", hint: "12 caractères minimum. Une phrase de plusieurs mots est idéale." }),
    field({ label: "Confirmer le nouveau mot de passe", control: confirmInput, name: "confirm" }),
    submit);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (next.value !== confirmInput.value) return showFieldErrors(form, { confirm: "Les deux mots de passe ne correspondent pas." });
    busy(submit, async () => {
      try {
        await post("/api/auth/password", { currentPassword: current.value, newPassword: next.value });
        toast("Mot de passe enregistré. Bienvenue !");
        boot("/admin");
      } catch (error) {
        if (error.status === 422) showFieldErrors(form, error.fields);
        else toast(errorMessage(error), "error");
      }
    });
  });
  replace(app, h("main", { class: "auth", id: "main" },
    h("div", { class: "auth__card" },
      h("div", { class: "auth__logo", "aria-hidden": "true" }),
      h("h1", {}, "Nouveau mot de passe"),
      h("p", { class: "auth__sub" }, `Bonjour ${session.user.name} : choisissez votre mot de passe personnel pour continuer.`),
      form)));
  app.className = "";
}

function notFound(main) {
  replace(main, h("div", { class: "state" }, h("h1", {}, "Page introuvable"), h("p", {}, "Cette page de l'administration n'existe pas."), h("a", { class: "btn", href: "/admin" }, "Retour au tableau de bord")));
}

let started = false;
async function boot(target) {
  let data;
  try {
    data = await get("/api/auth/session");
  } catch (error) {
    if (error.status === 401 || error.status === 0) {
      if (location.pathname !== "/admin/login") {
        const next = location.pathname + location.search;
        history.replaceState(null, "", `/admin/login${next !== "/admin/" && next !== "/admin" ? `?next=${encodeURIComponent(next)}` : ""}`);
      }
      if (error.status === 0) toast(errorMessage(error), "error");
      return loginView();
    }
    throw error;
  }
  setSession(data);
  if (session.user.mustChangePassword) return forcedPasswordView();
  if (target) history.replaceState(null, "", target);
  if (location.pathname === "/admin/login") history.replaceState(null, "", "/admin");
  const { shell, main } = layout();
  replace(app, shell);
  app.className = "";
  app.removeAttribute("aria-busy");
  if (!started) {
    started = true;
    registerRoutes();
  }
  start(main, { notFound });
}

function registerRoutes() {
  route("/admin", dashboardView);
  route("/admin/events", eventsListView);
  route("/admin/events/new", (ctx, el) => eventEditView({ ...ctx, params: { id: "new" } }, el));
  route("/admin/events/:id", eventEditView);
  route("/admin/artists", artistsListView);
  route("/admin/artists/:id", artistEditView);
  route("/admin/venues", venuesListView);
  route("/admin/venues/:id", venueEditView);
  route("/admin/media", mediaView);
  route("/admin/gallery", galleryListView);
  route("/admin/gallery/:id", albumView);
  route("/admin/faq", faqView);
  route("/admin/team", teamView);
  route("/admin/translations", translationsView);
  route("/admin/publish", publishView);
  route("/admin/users", usersView);
  route("/admin/audit", auditView);
  route("/admin/backups", backupsView);
  route("/admin/account", accountView);
}

// Session expirée pendant l'utilisation : retour à la connexion, puis à la page en cours.
let redirecting = false;
setUnauthorizedHandler(() => {
  if (redirecting) return;
  redirecting = true;
  toast("Votre session a expiré : reconnectez-vous.", "warn");
  setTimeout(() => { location.href = `/admin/login?next=${encodeURIComponent(location.pathname + location.search)}`; }, 1200);
});

// Raccourci global : Ctrl/Cmd + S enregistre le formulaire ouvert.
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    const save = document.querySelector("[data-save-shortcut]");
    if (save) {
      e.preventDefault();
      save.click();
    }
  }
});

export { navigate, setCsrf };
boot().catch((error) => {
  console.error(error);
  replace(app, h("div", { class: "state state--error" }, h("h1", {}, "Erreur de chargement"), h("p", {}, errorMessage(error)), h("button", { class: "btn", onclick: () => location.reload() }, "Recharger")));
});
