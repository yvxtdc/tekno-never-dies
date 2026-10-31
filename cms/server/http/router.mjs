/** Routeur minimal : "GET /api/events/:id" -> handler(ctx). Les paramètres :id sont validés. */
export class Router {
  constructor() {
    this.routes = [];
  }

  /**
   * Déclare une route de l'API ; les contrôles sont appliqués par handleApi (app.mjs) avant l'appel.
   * Un paramètre dont le nom finit par « id » n'accepte que des chiffres et arrive en nombre.
   * @param {string} method
   * @param {string} pattern ex. "/api/events/:id/duplicate"
   * @param {(ctx: object) => any} handler reçoit ctx (req, res, url, query, params, config, db, log,
   *   publisher, session, user, ip, requestId, actor) ; sa valeur de retour est envoyée en JSON
   *   (204 si undefined), sauf s'il a déjà répondu lui-même (fichier, flux).
   * @param {object} [options]
   * @param {string} [options.perm] permission exigée (auth/permissions.mjs). Sans elle, la route est
   *   ouverte à tout compte connecté.
   * @param {boolean} [options.public] ni session ni jeton CSRF exigés (connexion) ; l'origine reste contrôlée
   * @param {boolean} [options.allowPasswordChange] permise avec un mot de passe temporaire à changer
   * @param {number} [options.status] statut HTTP de la réponse (200 par défaut, 201 pour une création)
   */
  add(method, pattern, handler, options = {}) {
    const keys = [];
    const source = pattern
      .split("/")
      .map((part) => {
        if (part.startsWith(":")) {
          const name = part.slice(1);
          keys.push(name);
          // Identifiants numériques uniquement pour :id et :xxxId ; texte simple sinon.
          return /id$/i.test(name) ? "(\\d{1,12})" : "([A-Za-z0-9_.-]{1,200})";
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("/");
    this.routes.push({ method, regex: new RegExp(`^${source}$`), keys, handler, options });
    return this;
  }

  get(p, h, o) { return this.add("GET", p, h, o); }
  post(p, h, o) { return this.add("POST", p, h, o); }
  put(p, h, o) { return this.add("PUT", p, h, o); }
  patch(p, h, o) { return this.add("PATCH", p, h, o); }
  delete(p, h, o) { return this.add("DELETE", p, h, o); }

  match(method, pathname) {
    let allowed = false;
    for (const route of this.routes) {
      const m = route.regex.exec(pathname);
      if (!m) continue;
      allowed = true;
      if (route.method !== method && !(method === "HEAD" && route.method === "GET")) continue;
      const params = {};
      route.keys.forEach((key, i) => {
        params[key] = /id$/i.test(key) ? Number(m[i + 1]) : decodeURIComponent(m[i + 1]);
      });
      return { route, params };
    }
    return allowed ? { methodNotAllowed: true } : null;
  }
}
