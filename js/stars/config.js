/**
 * Tous les réglages des étoiles 3D sont ici.
 * Modifie une valeur, enregistre : la page se recharge toute seule (Live Server).
 */
export const STARS_CONFIG = {
  enabled: true,               // false = aucune étoile (pas de WebGL du tout)

  camera: { fov: 40, distance: 10 },
  pixelRatioMax: 1.75,         // baisse à 1 si la page rame sur un petit PC

  // --- Ombre douce projetée sur la page -----------------------------------
  shadow: {
    enabled: true,
    opacity: 0.26,             // 0 = invisible, 0.5 = très marquée
    color: 0x1c1030,
    blur: 12,                  // flou de l'ombre
    mapSize: 1024,             // qualité de l'ombre (512 / 1024 / 2048)
    wallZ: -1.9                // plus c'est loin, plus l'ombre est décalée
  },

  // --- Aspect du chrome ---------------------------------------------------
  chrome: {
    roughness: 0.045,          // 0 = miroir parfait, 0.2 = métal brossé
    envMapIntensity: 1.35,     // force des reflets
    clearcoat: 0.6,
    exposure: 1.05
  },

  // --- Mouvement (aléatoire à chaque visite, mais toujours lent) ----------
  motion: {
    speed: 1,                  // 0.5 = deux fois plus lent, 2 = deux fois plus vite
    reducedMotionSpeed: 0.12,  // vitesse si l'utilisateur a coupé les animations
    // périodes d'oscillation en rad/s : [min, max] (0.05 rad/s ≈ 2 min pour un cycle)
    driftSlow: [0.045, 0.075],
    driftFast: [0.10, 0.16],
    spin: [0.04, 0.20],        // vitesse de rotation sur elles-mêmes
    marginX: 0.86,             // part de la largeur / hauteur de l'écran parcourue
    marginY: 0.84,
    parallax: 0.35             // décalage de la caméra selon la souris (0 = aucun)
  },

  // --- Battement de kick (très discret) -----------------------------------
  kick: { bpm: 140, amount: 0.014 },   // amount: 0 pour désactiver

  // --- Formes -------------------------------------------------------------
  shapes: {
    five:  { tips: 5, outer: 2.30, inner: 1.00, pull: 0.20, tipRound: 1.7, thickness: 0.78, bevel: 1.30, ridge: 0.22, soften: 4 },
    spark: { tips: 4, outer: 2.45, inner: 0.62, pull: 0.36, tipRound: 1.7, thickness: 0.62, bevel: 1.00, ridge: 0.25, soften: 4 }
    // tips: nombre de branches | outer / inner: rayon des pointes / des creux
    // pull: concavité des côtés | thickness: épaisseur | ridge: arête le long des branches
  },

  // --- Les étoiles (ajoute, retire ou modifie des lignes) -----------------
  stars: [
    { shape: 'five',  color: 0xf4f4f6, scale: 0.62, z:  0.0, speed: 1.00 },   // grande étoile chrome
    { shape: 'five',  color: 0xf4f4f6, scale: 0.20, z: -0.8, speed: 1.25 },   // petite étoile chrome
    { shape: 'spark', color: 0xb9a6ff, scale: 0.36, z:  0.7, speed: 1.10 },   // sparkle lavande
    { shape: 'five',  color: 0x7f62ff, scale: 0.27, z:  1.3, speed: 1.15, hideOnPortrait: true }
  ]
};
