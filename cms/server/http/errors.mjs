/**
 * Erreurs « attendues » renvoyées au client avec un message compréhensible.
 * Toute autre exception devient une erreur 500 générique : le détail reste dans les journaux du
 * serveur (identifiant de requête fourni pour les retrouver), jamais dans la réponse.
 */
export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} message message lisible par l'utilisateur (français)
   * @param {object} [extra] détails sûrs à transmettre (ex. erreurs de champs)
   */
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const badRequest = (message, extra) => new HttpError(400, message, extra);
export const unauthorized = (message = "Connexion requise.") => new HttpError(401, message);
export const forbidden = (message = "Action non autorisée pour votre rôle.") => new HttpError(403, message);
export const notFound = (message = "Élément introuvable.") => new HttpError(404, message);
export const conflict = (message, extra) => new HttpError(409, message, extra);

/** Erreurs de validation de formulaire : { champ: "message" }. */
export class ValidationError extends HttpError {
  constructor(fields, message = "Certains champs sont invalides.") {
    super(422, message, { fields });
  }
}
