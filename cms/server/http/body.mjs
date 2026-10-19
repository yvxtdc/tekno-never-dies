/** Lecture des corps de requête avec limite de taille (protection contre les abus). */
import { HttpError, badRequest } from "./errors.mjs";

export async function readBuffer(req, limit) {
  const declared = Number(req.headers["content-length"] || 0);
  if (declared > limit) throw new HttpError(413, `Fichier ou contenu trop volumineux (maximum ${Math.round(limit / 1048576)} Mo).`);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      req.destroy();
      throw new HttpError(413, `Fichier ou contenu trop volumineux (maximum ${Math.round(limit / 1048576)} Mo).`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req, limit = 1024 * 1024) {
  const type = String(req.headers["content-type"] || "");
  if (!type.startsWith("application/json")) throw new HttpError(415, "Format attendu : JSON.");
  const buffer = await readBuffer(req, limit);
  if (!buffer.length) return {};
  try {
    const data = JSON.parse(buffer.toString("utf8"));
    if (data === null || typeof data !== "object") throw new Error("not an object");
    return data;
  } catch {
    throw badRequest("Données JSON invalides.");
  }
}
