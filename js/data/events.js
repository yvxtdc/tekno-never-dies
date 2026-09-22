// ============================================================
// Données des événements — CONTENU D'EXEMPLE à remplacer.
// Chaque objet = une fiche événement. `slug` doit être unique
// (utilisé dans l'URL evenement.html?e=slug).
// `statut`: "avenir" ou "archive".
// Plus tard : ce fichier pourra être remplacé par un appel API
// vers un backend, sans changer evenements.html / evenement.html.
// ============================================================
export const EVENTS = [
  {
    slug: "solstice-warehouse-2026",
    statut: "avenir",
    nom: "Solstice Warehouse",
    date: "2026-12-13",
    horaires: "23h00 – 07h00",
    lieu: "Entrepôt La Rampe, Strasbourg",
    adresse: "12 rue des Docks, 67000 Strasbourg",
    prix: "12 € prévente / 15 € sur place",
    billetterie: "https://shotgun.live/",
    ageMin: "18 ans",
    dressCode: "Libre",
    acces: "Tram + 10 min à pied, parking gratuit à proximité",
    description: "Une nuit dans un entrepôt réchauffé pour l'occasion : gros système, lumières basses, line-up 100% local. Premier événement de la saison hiver.",
    lineup: ["Selecta Nox (live)", "Kranz b2b Ilo", "Résident TND"],
    visuel: "decor/star-outline.webp",
  },
  {
    slug: "session-plein-air-ete",
    statut: "avenir",
    nom: "Session plein air",
    date: "2027-02-21",
    horaires: "16h00 – 23h00",
    lieu: "Base de loisirs, à confirmer",
    adresse: "Adresse communiquée aux inscrits",
    prix: "Prix libre / participation conseillée 8 €",
    billetterie: "https://helloasso.com/",
    ageMin: "Aucun avant 22h, 18 ans après",
    dressCode: "Confortable, prévoir de quoi se couvrir",
    acces: "Covoiturage organisé, voir le formulaire de contact",
    description: "Format plus doux, en journée : moins de basses, plus de soleil. Bar associatif et petite restauration sur place.",
    lineup: ["Line-up en cours de confirmation"],
    visuel: "decor/sparkle-blue.webp",
  },
  {
    slug: "release-party-tnd6tem",
    statut: "archive",
    nom: "Release Party TND6TEM",
    date: "2026-06-06",
    horaires: "22h00 – 06h00",
    lieu: "Local associatif, Kehl",
    description: "Soirée de lancement officiel du sound system TND6TEM : premier déploiement complet du système son et de la scéno.",
    lineup: ["Résident TND", "Invité surprise"],
    retour: "Belle affluence pour une première, système rodé pour la suite. Merci à tous les bénévoles montage/démontage.",
    visuel: "decor/burst.webp",
  },
  {
    slug: "warmup-hiver-2025",
    statut: "archive",
    nom: "Warm-up d'hiver",
    date: "2025-11-29",
    horaires: "21h00 – 04h00",
    lieu: "Salle des fêtes, Scheibenhard",
    description: "Petit format pour tester la config lumière avant la saison des grosses soirées.",
    lineup: ["Résident TND"],
    retour: "Configuration lumière validée, quelques ajustements sur la diffusion du son en salle fermée.",
    visuel: "decor/star-pair.webp",
  },
];
