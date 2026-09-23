/**
 * Catalogue du matériel de location. Un objet par équipement, regroupés par
 * catégorie. Pour ajouter un équipement : copie un objet et modifie-le.
 * "slug" unique, sans espaces ni accents, utilisé dans l'adresse de la fiche
 * (ex : materiel.html?slug=enceinte-active-15).
 * "price" : laisse vide ("") pour afficher "Sur devis" plutôt qu'un tarif.
 */
export const CATEGORIES = [
  { id: "sonorisation", label: "Sonorisation" },
  { id: "eclairage", label: "Éclairage" },
  { id: "structures", label: "Structures" },
  { id: "mobilier", label: "Mobilier" },
  { id: "accessoires", label: "Accessoires & câblage" }
];

export const MATERIEL = [
  {
    slug: "enceinte-active-15",
    category: "sonorisation",
    name: "Enceinte active 15\"",
    short: "Enceinte de diffusion polyvalente, pour petites et moyennes salles.",
    description:
      "Enceinte amplifiée 15 pouces, adaptée aux soirées en salle comme aux petits événements en extérieur.",
    specs: ["1000 W", "Entrées XLR / Jack", "Trépied compatible"],
    accessories: ["Câble XLR 10 m", "Housse de transport"],
    quantity: 4,
    price: "35 € / jour",
    conditions: "Caution demandée. Retrait et retour à convenir.",
    cover: "assets/img/decor/star-hollow.webp",
    demo: true
  },
  {
    slug: "caisson-basse-18",
    category: "sonorisation",
    name: "Caisson de basse 18\"",
    short: "Renfort de basses pour les sessions qui tapent.",
    description: "Caisson actif 18 pouces, à associer aux enceintes actives pour un rendu plus complet.",
    specs: ["1400 W", "Filtre passe-bas intégré"],
    accessories: ["Câble XLR 10 m"],
    quantity: 2,
    price: "45 € / jour",
    conditions: "Caution demandée.",
    cover: "assets/img/decor/star-lavender.webp",
    demo: true
  },
  {
    slug: "lyres-led",
    category: "eclairage",
    name: "Lyres LED (lot de 2)",
    short: "Jeu de lumières automatisées, plusieurs effets et couleurs.",
    description: "Lot de deux lyres LED avec contrôleur DMX, pour habiller une piste de danse.",
    specs: ["Contrôleur DMX inclus", "Multicolore", "Effets automatiques ou pilotés"],
    accessories: ["Câbles DMX", "Pieds de lumière"],
    quantity: 1,
    price: "",
    conditions: "Installation possible par l'équipe sur demande, en supplément.",
    cover: "assets/img/decor/sparkle-blue.webp",
    demo: true
  },
  {
    slug: "structure-truss-3m",
    category: "structures",
    name: "Structure truss 3 m",
    short: "Portique pour suspendre lumières ou décors.",
    description: "Segment de structure aluminium de 3 mètres avec pieds, pour surélever lumières ou banderoles.",
    specs: ["Hauteur réglable", "Charge max : voir fiche technique sur demande"],
    accessories: ["Pieds", "Élingues"],
    quantity: 2,
    price: "Sur devis",
    conditions: "Montage recommandé par l'équipe.",
    cover: "assets/img/decor/chain.webp",
    demo: true
  },
  {
    slug: "mange-debout",
    category: "mobilier",
    name: "Mange-debout",
    short: "Table haute pour un espace bar ou cocktail.",
    description: "Table haute pliante, avec ou sans housse, pour aménager un coin bar ou détente.",
    specs: ["Hauteur 110 cm", "Pliable"],
    accessories: ["Housse noire (en option)"],
    quantity: 6,
    price: "8 € / jour",
    conditions: "",
    cover: "assets/img/decor/star-outline.webp",
    demo: true
  },
  {
    slug: "lot-cables-xlr",
    category: "accessoires",
    name: "Lot de câbles XLR",
    short: "Câbles audio de différentes longueurs.",
    description: "Assortiment de câbles XLR (5 m, 10 m, 20 m) pour compléter une installation son.",
    specs: ["Longueurs : 5 m / 10 m / 20 m"],
    accessories: [],
    quantity: 10,
    price: "Inclus avec la location de sonorisation",
    conditions: "",
    cover: "assets/img/decor/squiggle.webp",
    demo: true
  }
];
