/**
 * Routeur de l'interface (History API, adresses /admin/…). Protège les formulaires non
 * enregistrés : changement de page interne et fermeture de l'onglet demandent confirmation.
 */
import { confirm } from "./ui.js";

const routes = [];
let current = null; // { dispose, isDirty }
let renderInto = null;
let notFoundView = null;

export function route(pattern, view) {
  const keys = [];
  const regex = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)"))}/?$`);
  routes.push({ regex, keys, view });
}

export function start(container, { notFound }) {
  renderInto = container;
  notFoundView = notFound;
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.("a[href]");
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === "_blank" || a.hasAttribute("download")) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith("/admin")) return;
    e.preventDefault();
    navigate(url.pathname + url.search + url.hash);
  });
  window.addEventListener("popstate", async () => {
    if (current?.isDirty?.() && !(await confirmLeave())) {
      history.pushState(null, "", current.path);
      return;
    }
    render(location.pathname + location.search);
  });
  window.addEventListener("beforeunload", (e) => {
    if (current?.isDirty?.()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  render(location.pathname + location.search);
}

const confirmLeave = () => confirm({
  title: "Quitter sans enregistrer ?",
  message: "Vos modifications n'ont pas été enregistrées et seront perdues.",
  confirmLabel: "Quitter sans enregistrer",
  danger: true
});

export async function navigate(path, { replace = false, force = false } = {}) {
  if (!force && current?.isDirty?.() && !(await confirmLeave())) return false;
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  render(path);
  return true;
}

async function render(path) {
  const url = new URL(path, location.origin);
  const pathname = url.pathname.replace(/\/+$/, "") || "/admin";
  current?.dispose?.();
  current = null;
  for (const r of routes) {
    const m = r.regex.exec(pathname);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const ctx = { params, query: url.searchParams, path: url.pathname + url.search };
    current = { path: ctx.path };
    const result = await r.view(ctx, renderInto);
    if (current?.path === ctx.path) Object.assign(current, result || {});
    afterRender();
    return;
  }
  notFoundView(renderInto);
  afterRender();
}

function afterRender() {
  document.dispatchEvent(new CustomEvent("route:change", { detail: { path: location.pathname } }));
  const h1 = renderInto.querySelector("h1");
  if (h1) {
    h1.setAttribute("tabindex", "-1");
    h1.focus({ preventScroll: true });
  }
  window.scrollTo(0, 0);
}

/** La vue courante déclare son état « modifié » (pour les confirmations). */
export function setDirtyChecker(fn) {
  if (current) current.isDirty = fn;
}
