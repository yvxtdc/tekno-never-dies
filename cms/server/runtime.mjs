/**
 * État du processus du CMS, en mémoire (tableau de santé) : démarrage, battement du planificateur,
 * erreurs récentes (messages sans pile ni chemin), dernier contrôle d'intégrité de la base.
 * Remis à zéro à chaque démarrage : seules les informations dont la perte est sans conséquence y sont.
 */
const MAX_ERRORS = 20;

export const runtime = {
  startedAt: new Date().toISOString(),
  config: null,
  scheduler: { enabled: false, startedAt: null, lastTickAt: null, lastTickError: null, lastBackupError: null },
  integrity: null, // { at, ok, detail }
  errors: [], // { at, source, message }
  // Accès réseau (GitHub, GoatCounter) : remplaçable dans les tests (jamais d'appel réel en test).
  fetch: (...args) => globalThis.fetch(...args)
};

/** Message d'erreur sans pile ni chemin absolu (affichable aux administrateurs). */
export function cleanMessage(error) {
  const text = String(error?.message ?? error ?? "").split("\n")[0];
  return text.replace(/(?:\/[\w.-]+){2,}/g, "…").slice(0, 300);
}

export function recordError(source, error) {
  runtime.errors.unshift({ at: new Date().toISOString(), source, message: cleanMessage(error) });
  runtime.errors.length = Math.min(runtime.errors.length, MAX_ERRORS);
}
