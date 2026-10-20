/** Réponses HTTP et en-têtes de sécurité communs. */

const BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
};

// Interface d'administration : aucun script ni style externe, aucune iframe sauf la prévisualisation
// (même origine), pas d'inline script.
export const ADMIN_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'none'",
  "object-src 'none'"
].join("; ");

export function securityHeaders(res, { secure, csp = ADMIN_CSP, frame = "deny" } = {}) {
  for (const [k, v] of Object.entries(BASE_HEADERS)) res.setHeader(k, v);
  if (csp) res.setHeader("Content-Security-Policy", csp);
  if (frame === "deny") res.setHeader("X-Frame-Options", "DENY");
  else if (frame === "sameorigin") res.setHeader("X-Frame-Options", "SAMEORIGIN");
  if (secure) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}

export function sendJson(res, status, data) {
  const body = JSON.stringify(data ?? null);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

export function sendText(res, status, text, type = "text/plain; charset=utf-8", extra = {}) {
  res.writeHead(status, { "Content-Type": type, "Content-Length": Buffer.byteLength(text), ...extra });
  res.end(text);
}

export function redirect(res, location, status = 302) {
  res.writeHead(status, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

export const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".ics": "text/calendar; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};
