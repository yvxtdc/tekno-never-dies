/**
 * Fichiers statiques : résolution sûre d'un chemin d'URL dans un dossier racine (pas de « .. »,
 * pas de fichiers cachés, pas de liens symboliques sortant du dossier, extensions autorisées).
 */
import fs from "node:fs";
import path from "node:path";
import { MIME } from "./respond.mjs";

export function safeResolve(rootDir, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const segments = decoded.split("/").filter(Boolean);
  if (segments.some((s) => s === ".." || s === "." || s.startsWith("."))) return null;
  const full = path.resolve(rootDir, ...segments);
  const root = path.resolve(rootDir);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

/** Renvoie true si le fichier a été servi. */
export function serveFile(req, res, file, { root, cache = "no-cache", allowed = MIME, headers = {} } = {}) {
  if (!file) return false;
  const ext = path.extname(file).toLowerCase();
  const type = allowed[ext];
  if (!type) return false;
  let stat;
  try {
    const real = fs.realpathSync(file);
    // Lien symbolique : la cible doit rester dans le dossier racine.
    if (root) {
      const realRoot = fs.realpathSync(root);
      if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return false;
    }
    stat = fs.statSync(real);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, { ETag: etag, "Cache-Control": cache, ...headers });
    res.end();
    return true;
  }
  res.writeHead(200, { "Content-Type": type, "Content-Length": stat.size, ETag: etag, "Cache-Control": cache, ...headers });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  fs.createReadStream(file).pipe(res);
  return true;
}
