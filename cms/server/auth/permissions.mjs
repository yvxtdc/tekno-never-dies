/**
 * Rôles et permissions, vérifiés côté serveur pour chaque route de l'API.
 *
 *  - admin  : accès complet (comptes, journal, sauvegardes, suppressions définitives).
 *  - editor : gestion des contenus (création, modification, publication, médias), sans les
 *             fonctions sensibles : comptes, journal d'activité, sauvegardes, suppressions
 *             définitives de contenus ou de médias.
 */
export const PERMISSIONS = {
  "content.read": ["admin", "editor"],
  "content.write": ["admin", "editor"],
  "content.publish": ["admin", "editor"],
  "content.delete": ["admin"],
  "media.write": ["admin", "editor"],
  "media.delete": ["admin"],
  "site.publish": ["admin", "editor"],
  "users.manage": ["admin"],
  "audit.read": ["admin"],
  "backups.manage": ["admin"]
};

export const ROLES = {
  admin: "Administrateur",
  editor: "Éditeur"
};

export function can(user, permission) {
  if (!user || !user.active) return false;
  const roles = PERMISSIONS[permission];
  if (!roles) throw new Error(`Permission inconnue : ${permission}`);
  return roles.includes(user.role);
}

export function permissionsOf(user) {
  return Object.keys(PERMISSIONS).filter((p) => can(user, p));
}
