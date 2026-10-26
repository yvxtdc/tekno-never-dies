/**
 * Section visée par l'ancre de l'adresse (« #billetterie » depuis l'aperçu). Sans ancre, ou si l'élément
 * n'est pas une section du formulaire : null. Sans dépendance au DOM global (testé sous Node).
 * @param {string} hash location.hash (« » ou « #id »)
 * @param {(id: string) => Element | null} getById document.getElementById
 */
export function sectionFromHash(hash, getById) {
  if (!hash || hash.length < 2) return null;
  let id;
  try {
    id = decodeURIComponent(hash.slice(1));
  } catch {
    return null; // ancre mal encodée (« #%E0 »)
  }
  const el = getById(id);
  return el?.classList?.contains("form-section") ? el : null;
}
