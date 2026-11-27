/**
 * Indicateur « Mise en ligne » : pastille dans le menu (et point sur le bouton du menu sur téléphone),
 * repère dans le titre de l'onglet, et notification quand une modification enregistrée attend d'être
 * mise en ligne ou qu'un déploiement échoue. État calculé par le serveur (GET /api/publications/status,
 * publish/publisher.mjs → publishStatus) : jamais deviné ici.
 *
 * Rafraîchi après chaque enregistrement (événement api:change de lib/api.js), à chaque changement de
 * page, au retour sur l'onglet, et régulièrement (programmations, autres personnes) : toutes les
 * 10 secondes pendant une mise en ligne ou un déploiement, toutes les 2 minutes sinon.
 */
import { h } from "./dom.js";
import { get } from "./api.js";
import { toast } from "./ui.js";
import { can } from "./session.js";

const ACTIVE = new Set(["running", "deploying"]);
const ALERT = new Set(["failed", "deploy-failed", "blocked"]);
const FAST = 10e3;
const SLOW = 120e3;
let stopPrevious = () => {};

/**
 * link : lien « Mise en ligne » du menu ; menuButton : bouton d'ouverture du menu (téléphone).
 * Un seul indicateur à la fois : un nouvel appel (nouvelle connexion) arrête le précédent.
 * Renvoie refresh() (rafraîchissement immédiat).
 */
export function watchPublishStatus({ link, menuButton }) {
  stopPrevious();
  const listeners = new AbortController();
  const { signal } = listeners;
  const badge = h("span", { class: "nav__badge", hidden: true });
  const dot = h("span", { class: "nav-dot", hidden: true, "aria-hidden": "true" });
  link?.append(badge);
  menuButton?.append(dot);
  const menuLabel = menuButton?.getAttribute("aria-label") || "Ouvrir le menu";
  const baseTitle = () => document.title.replace(/^● /, "");
  let previous = null;
  let timer = null;
  let inflight = null;
  let afterChange = false;

  function render(status) {
    const shown = status.state !== "ok";
    badge.hidden = !shown;
    badge.textContent = status.label;
    badge.className = `nav__badge nav__badge--${status.state}`;
    if (link) link.title = status.detail;
    dot.hidden = !shown;
    dot.className = `nav-dot nav-dot--${status.state}`;
    menuButton?.setAttribute("aria-label", shown ? `${menuLabel} (mise en ligne : ${status.label.toLowerCase()})` : menuLabel);
    // Onglet en arrière-plan : un repère dans le titre quand quelque chose attend ou a échoué
    document.title = (status.state === "pending" || ALERT.has(status.state) ? "● " : "") + baseTitle();
  }

  function announce(status) {
    if (!previous || previous.state === status.state) return;
    if (status.state === "pending" && afterChange) {
      toast(can("site.publish")
        ? "Enregistré. Ce n'est pas encore sur le site : pensez à « Mise en ligne » (menu)."
        : "Enregistré. Ce sera visible sur le site après la prochaine mise en ligne.", "warn", { timeout: 7000 });
    } else if (ALERT.has(status.state)) {
      toast(`Mise en ligne : ${status.detail}`, "error");
    } else if (status.state === "ok" && previous.state === "deploying" && status.deployment?.level === "ok") {
      // Seulement quand GitHub confirme le déploiement (jamais « à jour » sans cette confirmation)
      toast("Déployé : le site public est à jour.");
    }
  }

  async function refresh({ fromChange = false } = {}) {
    if (signal.aborted) return;
    if (inflight) return inflight;
    afterChange = fromChange;
    inflight = (async () => {
      try {
        const status = await get("/api/publications/status");
        if (signal.aborted) return;
        render(status);
        announce(status);
        previous = status;
      } catch {
        // Indicateur seulement : une erreur réseau passagère ne doit rien bloquer ; nouvel essai plus tard.
      } finally {
        inflight = null;
        clearTimeout(timer);
        if (!signal.aborted) timer = setTimeout(() => { if (!document.hidden) refresh(); }, ACTIVE.has(previous?.state) ? FAST : SLOW);
      }
    })();
    return inflight;
  }

  let debounce = null;
  window.addEventListener("api:change", (event) => {
    if (event.detail.url.startsWith("/api/auth/")) return; // connexion, déconnexion, mot de passe
    clearTimeout(debounce);
    debounce = setTimeout(() => refresh({ fromChange: true }), 600);
  }, { signal });
  document.addEventListener("route:change", () => {
    // Le titre de la nouvelle page vient d'être posé : on remet le repère sans attendre le serveur
    if (previous) render(previous);
    refresh();
  }, { signal });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); }, { signal });
  stopPrevious = () => {
    listeners.abort();
    clearTimeout(timer);
    clearTimeout(debounce);
  };
  refresh();
  return refresh;
}
