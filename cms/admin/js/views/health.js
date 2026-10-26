/**
 * Santé du CMS : serveur et base (administrateurs), programmations, mise en ligne et déploiement,
 * sauvegardes (administrateurs). Chaque ligne : niveau, valeur, explication et lien vers le détail.
 */
import { h, replace } from "../lib/dom.js";
import { get, post } from "../lib/api.js";
import { icon, pageHead, loadingState, errorState, toast, errorMessage, busy } from "../lib/ui.js";
import { formatDateTime, relative } from "../lib/format.js";
import { isAdmin, can } from "../lib/session.js";
import { levelBadge } from "../lib/supervision.js";

export async function healthView(ctx, main) {
  document.title = "Santé du CMS — Administration TND";
  replace(main, loadingState());
  let report;
  try {
    report = await get("/api/health");
  } catch (error) {
    return replace(main, errorState(error, () => healthView(ctx, main)));
  }
  const action = (label, url, done) => h("button", { type: "button", class: "btn btn--sm", onclick: (e) => busy(e.currentTarget, async () => {
    try {
      const result = await post(url, {});
      toast(done(result), result.ok === false ? "error" : "success");
      healthView(ctx, main);
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }) }, label);
  const value = (item) => (item.dateValue && item.value !== "Aucune" ? `${formatDateTime(item.value)} (${relative(item.value)})` : item.value);
  replace(main,
    pageHead({
      title: "Santé du CMS",
      subtitle: "Ce qui fonctionne, ce qui demande une intervention. Une information impossible à vérifier est signalée comme telle, jamais comme normale.",
      actions: [h("button", { type: "button", class: "btn", onclick: () => healthView(ctx, main) }, icon("history"), "Actualiser")]
    }),
    h("p", { class: "row" }, levelBadge(report.level, { ok: "Tout fonctionne", info: "Fonctionnement normal", warning: "À surveiller", error: "Intervention nécessaire", unknown: "Certains états sont inconnus" }[report.level]),
      h("span", { class: "small muted" }, `Mis à jour ${relative(report.generatedAt)}${report.full ? "" : " · détails techniques et sauvegardes réservés aux administrateurs"}.`)),
    h("div", { class: "stack" }, report.sections.map((s) => h("section", { class: `card ${s.level === "error" ? "card--danger" : s.level === "warning" ? "card--warn" : ""}`, "aria-labelledby": `health-${s.id}` },
      h("div", { class: "card__head" }, h("h2", { id: `health-${s.id}` }, s.title), levelBadge(s.level)),
      h("ul", { class: "health-list" }, s.items.map((item) => h("li", {},
        h("span", { class: "health-list__label" }, item.label),
        h("span", { class: "health-list__value" }, levelBadge(item.level, value(item))),
        item.message || item.link ? h("span", { class: "health-list__more small muted" },
          item.message ? item.message.split("\n").map((line, i) => [i ? h("br") : null, line]) : null,
          item.link ? [" ", h("a", { href: item.link, ...(item.external ? { target: "_blank", rel: "noopener noreferrer" } : {}) }, item.external ? "Journal GitHub Actions ↗" : "Voir le détail →")] : null) : null))),
      s.id === "server" && isAdmin() ? h("div", { class: "actions", style: { marginTop: "10px" } }, action("Contrôler l'intégrité maintenant", "/api/health/integrity", (r) => (r.ok ? "Base intègre." : `Anomalie : ${r.detail}`))) : null,
      s.id === "backups" && can("backups.manage") ? h("div", { class: "actions", style: { marginTop: "10px" } },
        action("Tester la restauration", "/api/health/restore-test", (r) => (r.ok ? `Restauration testée : ${r.detail}` : r.detail)),
        h("a", { class: "btn btn--sm btn--ghost", href: "/admin/backups" }, "Sauvegardes")) : null,
      s.id === "publication" && can("site.publish") ? h("div", { class: "actions", style: { marginTop: "10px" } },
        action("Vérifier le déploiement maintenant", "/api/deployments/check", (r) => (r.error ? r.error : r.checked ? "Déploiement vérifié." : "Aucun déploiement en cours de suivi.")),
        h("a", { class: "btn btn--sm btn--ghost", href: "/admin/publish" }, "Mise en ligne")) : null))));
}
