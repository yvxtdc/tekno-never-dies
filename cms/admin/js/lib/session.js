/** Session courante (utilisateur, permissions, jeton CSRF). */
import { setCsrf } from "./api.js";

export const session = { user: null, permissions: [], publishMode: "files", idleMinutes: 120 };

export function setSession(data) {
  Object.assign(session, data);
  setCsrf(data.csrf);
}

export const can = (permission) => session.permissions.includes(permission);
export const isAdmin = () => session.user?.role === "admin";
