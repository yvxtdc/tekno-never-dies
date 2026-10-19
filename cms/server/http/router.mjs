/** Routeur minimal : "GET /api/events/:id" -> handler(ctx). Les paramètres :id sont validés. */
export class Router {
  constructor() {
    this.routes = [];
  }

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
