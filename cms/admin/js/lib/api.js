/**
 * Client de l'API : JSON, jeton CSRF, erreurs lisibles. Une session expirée renvoie vers la
 * connexion (en revenant ensuite à la page en cours).
 */
let csrf = "";
let onUnauthorized = () => {};

export const setCsrf = (token) => { csrf = token || ""; };
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error || (status === 0 ? "Connexion au serveur impossible. Vérifiez votre réseau." : `Erreur ${status}`));
    this.status = status;
    this.data = data || {};
    this.fields = data?.fields || {};
  }
}

export async function api(method, url, body, { signal } = {}) {
  const headers = { Accept: "application/json" };
  if (method !== "GET") headers["X-CSRF-Token"] = csrf;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin", signal });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new ApiError(0, null);
  }
  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: "Réponse inattendue du serveur." };
    }
  }
  if (res.status === 401 && !url.startsWith("/api/auth/login") && url !== "/api/auth/session") {
    onUnauthorized();
    throw new ApiError(401, data);
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const get = (url, opts) => api("GET", url, undefined, opts);
export const post = (url, body = {}) => api("POST", url, body);
export const put = (url, body) => api("PUT", url, body);
export const del = (url) => api("DELETE", url);

/** Envoi d'un fichier (corps brut) avec progression. */
export function upload(url, file, { method = "POST", onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.setRequestHeader("X-CSRF-Token", csrf);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name || "image"));
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onerror = () => reject(new ApiError(0, null));
    xhr.onload = () => {
      if (xhr.status === 401) onUnauthorized();
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
      else reject(new ApiError(xhr.status, xhr.response));
    };
    xhr.send(file);
  });
}

/** Paramètres de requête sans valeurs vides. */
export const qs = (params) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v !== undefined && v !== null)).toString();
  return s ? `?${s}` : "";
};
