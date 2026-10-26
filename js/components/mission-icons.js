/**
 * Pictogrammes des missions de l'équipe (bandeau « L'équipe » et fiche d'un membre).
 *
 * Les missions sont saisies dans le CMS (Équipe → Missions). Le CMS propose MISSION_CATALOG : un large
 * catalogue de missions prêtes à l'emploi, rangées par pôle, chacune avec son pictogramme (bouton
 * « Catalogue des badges » et suggestions à la frappe). Une mission choisie dans le catalogue a toujours
 * le pictogramme prévu ; une mission écrite librement en reçoit un d'après ses mots (MISSION_RULES, dans
 * l'ordre : la première règle qui correspond gagne), sinon l'éclair par défaut, que npm run validate
 * signale. Le texte reste la source : lu par les lecteurs d'écran, affiché au survol et dans la fiche.
 * Les missions du catalogue sont déjà traduites (js/i18n/de.js, en.js).
 *
 * Dessins maison au trait (grille 24 × 24, trait arrondi), pas des emojis : même rendu sur tous les
 * appareils, couleur héritée (currentColor). Aucune dépendance au DOM : utilisable sous Node et servi
 * tel quel à l'administration (/admin/shared/mission-icons.js, cms/server/app.mjs).
 */

/* Tracés des pictogrammes (contenu d'un <svg viewBox="0 0 24 24">) */
export const MISSION_ICONS = {
  // Planchette avec cases cochées : organisation
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9.5 2.8h5v2.6h-5zM8.5 10.5l1.3 1.3 2.2-2.4M8.5 15.8l1.3 1.3 2.2-2.4M14 11h1.8M14 16.3h1.8"/>',
  // Œil : supervision
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r=".6" fill="currentColor"/>',
  // Réseau de points reliés : coordination, gestion
  network: '<circle cx="12" cy="5" r="2.3"/><circle cx="5" cy="18.5" r="2.3"/><circle cx="19" cy="18.5" r="2.3"/><path d="M12 7.3v4.4M12 11.7l-5.4 5M12 11.7l5.4 5"/>',
  // Enceinte : son, installation technique
  speaker: '<rect x="5.5" y="2.5" width="13" height="19" rx="2.2"/><circle cx="12" cy="14.6" r="3.8"/><circle cx="12" cy="14.6" r="1" fill="currentColor"/><circle cx="12" cy="6.8" r="1.5"/>',
  // Faders de table de mixage : réglages, tests
  sliders: '<path d="M6 3v18M12 3v18M18 3v18"/><rect x="3.8" y="13" width="4.4" height="3.2" rx="1" fill="currentColor"/><rect x="9.8" y="6" width="4.4" height="3.2" rx="1" fill="currentColor"/><rect x="15.8" y="10" width="4.4" height="3.2" rx="1" fill="currentColor"/>',
  // Clé plate : entretien du matériel
  wrench: '<path d="M15.6 3.4a4.6 4.6 0 0 0-4.3 6.2L3.9 17a2.1 2.1 0 0 0 3 3l7.4-7.4a4.6 4.6 0 0 0 6.2-4.3l-2.7 2.7-2.9-.8-.8-2.9Z"/>',
  // Marteau : montage, démontage
  hammer: '<path d="M11.5 9.5 19.6 17.6a1.8 1.8 0 0 1-2.5 2.5L9 12"/><path d="M4 9.6 9.3 4.3l3.6 1.2 1.6 1.6-6 6-1.6-1.6Z"/>',
  // Pièce de puzzle : polyvalent
  puzzle: '<path d="M10 4.6a2 2 0 0 1 4 0V6h4v4h-1.4a2 2 0 0 0 0 4H18v4h-4v-1.4a2 2 0 0 0-4 0V18H6v-4h1.4a2 2 0 0 0 0-4H6V6h4Z"/>',
  // Caisse : stocks
  crate: '<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5Z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9M7.8 5.3l8.4 4.5"/>',
  // Verre à cocktail : bar
  cocktail: '<path d="M4.5 4.5h15L12 12.5Z"/><path d="M12 12.5v7.5M8.2 20h7.6M7 7.2h10"/><circle cx="18" cy="4.2" r="2"/>',
  // Téléphone avec cœur : réseaux sociaux
  phone: '<rect x="6.8" y="2.5" width="10.4" height="19" rx="2.3"/><path d="M10.8 18.6h2.4"/><path d="M12 13.6 9.9 11.6a1.3 1.3 0 0 1 2.1-1.6 1.3 1.3 0 0 1 2.1 1.6Z" fill="currentColor"/>',
  // Appareil photo : création de contenus
  camera: '<path d="M3.5 8h3.4L8.5 5.5h7L17.1 8h3.4v11.5h-17Z"/><circle cx="12" cy="13.5" r="3.6"/>',
  // Cible : stratégie, image
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
  // Étiquette : bons commerciaux, partenaires
  tag: '<path d="M3.5 12.4V4.5h7.9l9 9-7.9 7.9Z"/><circle cx="8" cy="9" r="1.6"/>',
  // Billet : entrée, billetterie
  ticket: '<path d="M3 6.5h18v3.6a2 2 0 0 0 0 3.8v3.6H3v-3.6a2 2 0 0 0 0-3.8Z"/><path d="M15 6.5v2M15 10.9v2.2M15 15.5v2"/>',
  // Bombe de peinture : graffitis
  spray: '<rect x="6.5" y="8.5" width="9" height="12.5" rx="2"/><path d="M8.5 8.5V6h5v2.5M10 6V3.8h2V6M6.5 13h9"/><path d="M18 4.5h.01M20.5 3.2h.01M20.5 6h.01M19 7.6h.01" stroke-width="2.4"/>',
  // Palette : créations visuelles
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.3 0 1.9-.9 1.6-1.9-.4-1.4.5-2.6 2-2.6H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3Z"/><circle cx="7.5" cy="11.2" r="1.3" fill="currentColor"/><circle cx="10.2" cy="7" r="1.3" fill="currentColor"/><circle cx="15.2" cy="7.6" r="1.3" fill="currentColor"/>',
  // Calendrier étoilé : événementiel
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><path d="m12 11.6 1 2 2.2.3-1.6 1.6.4 2.2-2-1.1-2 1.1.4-2.2-1.6-1.6 2.2-.3Z" fill="currentColor"/>',
  // Éclair (par défaut)
  bolt: '<path d="M13.2 2.5 5 13.5h6.2l-1.4 8 8.2-11.2h-6.2Z"/>',

  /* ---------- Organisation, administration ---------- */
  // Couronne : présidence
  crown: '<path d="M3.5 8 7.5 12 12 5l4.5 7 4-4-1.8 10.5H5.3Z"/><path d="M5.3 21h13.4"/>',
  // Document : secrétariat, comptes rendus
  document: '<path d="M6.5 2.5h8l4 4V20a1.5 1.5 0 0 1-1.5 1.5H6.5A1.5 1.5 0 0 1 5 20V4a1.5 1.5 0 0 1 1.5-1.5Z"/><path d="M14.5 2.5v4h4M8.5 11.5h7M8.5 15h7M8.5 18.5h4"/>',
  // Portefeuille : trésorerie
  wallet: '<path d="M3 7.5A2 2 0 0 1 5 5.5h11"/><path d="M3 7.5V18a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2V10.5a2 2 0 0 0-2-2H4"/><path d="M15.5 12.5H20v3h-4.5a1.5 1.5 0 0 1 0-3Z"/>',
  // Calculatrice : comptabilité
  calculator: '<rect x="5" y="2.5" width="14" height="19" rx="2"/><rect x="8" y="5.5" width="8" height="4" rx=".8"/><path d="M8.5 13h.01M12 13h.01M15.5 13h.01M8.5 16.8h.01M12 16.8h.01M15.5 16.8h.01" stroke-width="2.4"/>',
  // Horloge : planning, horaires
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  // Bulles : réunions, communication interne
  chat: '<path d="M4 5h11a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 15 14H9l-3.5 3v-3H4a1.5 1.5 0 0 1-1.5-1.5v-6A1.5 1.5 0 0 1 4 5Z"/><path d="M16.5 8.5H20a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 20 17.5h-1v2.8l-3.4-2.8H11a1.5 1.5 0 0 1-1.5-1.5v-1.5"/>',
  // Dossier : archives
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2.5h8.4A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5Z"/>',
  // Carte de membre : adhésions
  idcard: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><circle cx="8.5" cy="10.8" r="2.3"/><path d="M5 16a3.6 3.6 0 0 1 7 0M14.5 10h4.5M14.5 13.5h3"/>',
  // Tampon : démarches, autorisations
  stamp: '<path d="M10 3.5h4v4.5l3 2.5v3H7v-3l3-2.5Z"/><path d="M5.5 16.5h13M7.5 20.5h9"/>',
  // Dossier en euros : subventions
  grant: '<path d="M6.5 2.5h8l4 4V20a1.5 1.5 0 0 1-1.5 1.5H6.5A1.5 1.5 0 0 1 5 20V4a1.5 1.5 0 0 1 1.5-1.5Z"/><path d="M14.5 2.5v4h4"/><path d="M14.5 11.6a3.2 3.2 0 1 0 0 5.3M8.6 13.4h4.6M8.6 15.2h4.6"/>',
  // Parapluie : assurances
  umbrella: '<path d="M3 12a9 9 0 0 1 18 0Z"/><path d="M12 12v6.5a2 2 0 0 1-4 0M12 3V1.8"/>',
  // Balance : juridique, statuts
  scale: '<path d="M12 3.5v17M7.5 20.5h9M4.5 6.5h15"/><path d="M4.5 6.5 2 13a2.6 2.6 0 0 0 5 0Z"/><path d="M19.5 6.5 17 13a2.6 2.6 0 0 0 5 0Z"/>',
  // Graphique : statistiques, bilans
  chart: '<path d="M3.5 3.5v17h17"/><path d="m7 15 4-4.5 3 3 5.5-6.5"/>',
  // Ordinateur : informatique, billetterie en ligne
  laptop: '<rect x="4" y="4.5" width="16" height="11" rx="1.5"/><path d="M2 19.5h20M9.5 17.5h5"/>',

  /* ---------- Partenaires, relations ---------- */
  // Anneaux entrelacés : partenariats
  handshake: '<circle cx="9" cy="12" r="5.5"/><circle cx="15" cy="12" r="5.5"/>',
  // Bâtiment public : mairie, institutions
  building: '<path d="M3 21h18M4.5 21V10M19.5 21V10M3 10h18L12 3.5Z"/><path d="M8.5 13.5V18M12 13.5V18M15.5 13.5V18"/>',
  // Maison : riverains, voisinage
  house: '<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5M10 20v-5.5h4V20"/>',
  // Maillons : collaborations entre collectifs
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/>',
  // T-shirt : merchandising
  tshirt: '<path d="M8.5 3.5 3 6.5l2 4.5 2-1v10.5h10V10l2 1 2-4.5-5.5-3a3.5 3.5 0 0 1-7 0Z"/>',
  // Cadeau : tombola, goodies, lots
  gift: '<rect x="3.5" y="8.5" width="17" height="4" rx="1"/><path d="M5 12.5v8h14v-8M12 8.5v12M12 8.5S10.5 4 8 4.5a2 2 0 0 0 0 4M12 8.5S13.5 4 16 4.5a2 2 0 0 1 0 4"/>',

  /* ---------- Technique ---------- */
  // Projecteur : lumières
  spotlight: '<rect x="4" y="7" width="9" height="7" rx="1.5" transform="rotate(-20 8.5 10.5)"/><path d="M13 7.5 21 5v11l-7.3-2.3M6.5 15.5 5 20.5M11 14l1.5 6.5M4 20.5h10"/>',
  // Laser : lasers, effets
  laser: '<rect x="2.5" y="9.5" width="5" height="5" rx="1.2"/><path d="M7.5 12 21 5M7.5 12H21M7.5 12 21 19"/>',
  // Vidéoprojecteur : vidéo, VJing
  projector: '<rect x="2.5" y="8" width="15" height="9" rx="2"/><circle cx="8" cy="12.5" r="2.4"/><path d="M13.5 11h1.5M17.5 10.5l4-2.5M17.5 14.5l4 2.5M5 17v2M15 17v2"/>',
  // Jack audio : câblage
  cable: '<path d="M3 21c1.5-3 3-4 5-4.5"/><path d="m8 16.5 2.5-2.5M9 14l4.5-4.5 2 2L11 16Z"/><path d="m14.8 9.2 3.7-3.7M18.5 5.5l1 -1"/>',
  // Prise : électricité, groupe électrogène
  plug: '<path d="M9 2.5v5M15 2.5v5M6 7.5h12v4a6 6 0 0 1-12 0Z"/><path d="M12 17.5v4"/>',
  // Structure en treillis : truss, scène
  truss: '<path d="M2.5 8h19M2.5 16h19M2.5 8v8M21.5 8v8"/><path d="m2.5 16 4.75-8 4.75 8 4.75-8 4.75 8"/>',
  // Platine : DJ, matériel DJ
  turntable: '<rect x="2.5" y="4.5" width="19" height="15" rx="2"/><circle cx="10" cy="12" r="5"/><circle cx="10" cy="12" r="1.2" fill="currentColor"/><path d="M18 7.5v6.5l-2.5 2"/>',
  // Casque : régie, booking
  headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4.5" height="6.5" rx="1.6"/><rect x="16.5" y="14" width="4.5" height="6.5" rx="1.6"/>',
  // Nuage : machine à fumée
  smoke: '<rect x="2.5" y="12" width="10" height="7" rx="1.5"/><path d="M12.5 15.5H15M5 19v1.5M10 19v1.5"/><path d="M15.5 12.5c1.5-1 3-1 4 0M16 9c1.8-1.3 3.5-1.2 5 0M16.5 5.5c1.5-1 3-1 4 .3"/>',
  // Camion : transport, logistique
  truck: '<path d="M2.5 6.5h11v9h-11ZM13.5 9.5h4l3 3.2v2.8h-7"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="16.5" cy="17.5" r="1.8"/>',

  /* ---------- Soirées, lieu ---------- */
  // Lune : soirées, nuit
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>',
  // Repère : recherche de lieux
  pin: '<path d="M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21Z"/><circle cx="12" cy="9.8" r="2.4"/>',
  // Plan : implantation du site
  map: '<path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20Z"/><path d="M9 4v13.5M15 6.5V20"/>',
  // Rideaux de scène : scénographie
  stage: '<path d="M3 4h18M4.5 4c0 7 1.5 10 4 11.5M19.5 4c0 7-1.5 10-4 11.5M3 20h18M7 20v-2h10v2"/>',
  // Boule à facettes : décoration
  discoball: '<path d="M12 2v3"/><circle cx="12" cy="13" r="7.5"/><path d="M4.5 13h15M12 5.5v15M6 8.5c3.8 1.2 8.2 1.2 12 0M6 17.5c3.8-1.2 8.2-1.2 12 0M8.5 6.4c-1.3 4.2-1.3 9.2 0 13.2M15.5 6.4c1.3 4.2 1.3 9.2 0 13.2"/>',
  // Drapeau : signalétique
  flag: '<path d="M5 21V3.5M5 4h12l-2.5 4L17 12H5"/>',
  // Balai : rangement, nettoyage
  broom: '<path d="M15 3 10.5 11.5"/><path d="M6.5 11 13.5 14 11.5 21H4.5Z"/><path d="M7.3 21l1.3-4.8M10 21l1.1-4.2"/>',
  // Flèches en boucle : tri des déchets
  recycle: '<path d="M7.5 9.5 10 5.2a2.3 2.3 0 0 1 4 0l2.3 4"/><path d="m14.4 8.9 1.9.4.5-1.9"/><path d="m18 13.5 1.7 3a2.3 2.3 0 0 1-2 3.5H13"/><path d="m14.6 18.5-1.6 1.5 1.6 1.4"/><path d="M8.6 20H6.3a2.3 2.3 0 0 1-2-3.5l2.3-3.7"/><path d="m5 13.6 1.6-.8.8 1.7"/>',
  // Feuille : développement durable
  leaf: '<path d="M5 19c0-8 5.5-14 15-14 0 9.5-6 15-14 15"/><path d="M5 19c3-4 6-7 9.5-9"/>',
  // P : parking, circulation
  parking: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M9.5 17V7.5h3.5a3 3 0 0 1 0 6H9.5"/>',
  // Tente : camping, hébergement
  tent: '<path d="M12 4 2.5 20h19Z"/><path d="m12 4-2 2.6M12 4l2 2.6M12 12.5 8.8 20M12 12.5l3.2 7.5"/>',
  // Navette : bus
  bus: '<rect x="4" y="3.5" width="16" height="14" rx="2.5"/><path d="M4 11h16M8 17.5V20M16 17.5V20"/><path d="M7.5 14.5h.01M16.5 14.5h.01" stroke-width="2.4"/>',
  // Voiture : covoiturage, SAM
  car: '<path d="M3.5 16.5v-4l2-5a1.8 1.8 0 0 1 1.7-1.2h9.6a1.8 1.8 0 0 1 1.7 1.2l2 5v4ZM3.5 12.5h17"/><path d="M5 16.5V19h2.5v-2.5M16.5 16.5V19H19v-2.5"/><path d="M7 14.5h.01M17 14.5h.01" stroke-width="2.4"/>',
  // Mégaphone : annonces
  megaphone: '<path d="M3.5 10v4a1 1 0 0 0 1 1H7l7 4.5v-15L7 9H4.5a1 1 0 0 0-1 1Z"/><path d="M7 15v4.5M17.5 9a4 4 0 0 1 0 6"/>',

  /* ---------- Artistes ---------- */
  // Disque : programmation
  vinyl: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r=".7" fill="currentColor"/><path d="M12 5.5a6.5 6.5 0 0 1 6.5 6.5"/>',
  // Étoile : accueil des artistes
  star: '<path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8Z"/>',
  // Onde sonore : live, production musicale
  waveform: '<path d="M3 12h1.5M7 8.5v7M10.5 5v14M14 8.5v7M17.5 6.5v11M21 12h-.5"/>',
  // Micro : MC, animation
  mic: '<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v4M8.5 21.5h7"/>',
  // Étincelles : performances, danse
  sparkles: '<path d="M11 3c.8 4.6 2.4 6.2 7 7-4.6.8-6.2 2.4-7 7-.8-4.6-2.4-6.2-7-7 4.6-.8 6.2-2.4 7-7Z"/><path d="M19 15c.3 1.7.9 2.3 2.5 2.5-1.6.3-2.2.9-2.5 2.5-.3-1.6-.9-2.2-2.5-2.5 1.6-.2 2.2-.8 2.5-2.5Z"/>',
  // Note : musique
  music: '<path d="M9 17.5V5.5l11-2v12"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="15.5" r="2.5"/>',

  /* ---------- Bar, restauration ---------- */
  // Chope : service au bar
  beer: '<path d="M5 8h10v11.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 5 19.5Z"/><path d="M15 10.5h2.5a2 2 0 0 1 2 2V15a2 2 0 0 1-2 2H15"/><path d="M5 8a2.5 2.5 0 0 1 2.2-3.7 3 3 0 0 1 5.6 0A2.5 2.5 0 0 1 15 8"/><path d="M8.5 11.5v6M11.5 11.5v6"/>',
  // Chariot : approvisionnement, courses
  cart: '<path d="M2.5 4H5l2.4 11.5h11l2-8H6.3"/><circle cx="9" cy="19.5" r="1.5"/><circle cx="17" cy="19.5" r="1.5"/>',
  // Pièces : caisse
  coins: '<ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v4.5c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 10.5V15c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-4.5"/>',
  // Marmite : restauration
  food: '<path d="M4 11h16v2.5a6.5 6.5 0 0 1-6.5 6.5h-3A6.5 6.5 0 0 1 4 13.5Z"/><path d="M2.5 11h19M9 7.5c0-1.5 1-1.5 1-3M13 7.5c0-1.5 1-1.5 1-3"/>',
  // Goutte : point d'eau
  droplet: '<path d="M12 3s6.5 7 6.5 11.5a6.5 6.5 0 0 1-13 0C5.5 10 12 3 12 3Z"/><path d="M9 14.5a3 3 0 0 0 3 3"/>',
  // Gobelet : écocups, consigne
  cup: '<path d="M5.5 4.5h13l-1.6 15a1.8 1.8 0 0 1-1.8 1.5H8.9a1.8 1.8 0 0 1-1.8-1.5Z"/><path d="M6.3 10h11.4M8 14h8"/>',

  /* ---------- Accueil du public ---------- */
  // Porte : accueil du public
  door: '<path d="M5 21V4.5A1.5 1.5 0 0 1 6.5 3h11A1.5 1.5 0 0 1 19 4.5V21M3 21h18"/><path d="M14.5 12.5h.01" stroke-width="2.6"/>',
  // Cadre de lecture : contrôle des billets
  scan: '<path d="M3.5 8V5A1.5 1.5 0 0 1 5 3.5h3M16 3.5h3A1.5 1.5 0 0 1 20.5 5v3M20.5 16v3a1.5 1.5 0 0 1-1.5 1.5h-3M8 20.5H5A1.5 1.5 0 0 1 3.5 19v-3"/><path d="M3.5 12h17"/>',
  // Bracelet : bracelets, tampons
  wristband: '<path d="M5 9.5a7 3.5 0 0 1 14 0v5a7 3.5 0 0 1-14 0Z"/><path d="M5 9.5a7 3.5 0 0 0 14 0"/><rect x="10" y="12" width="4" height="4.5" rx="1"/>',
  // Cintre : vestiaire
  hanger: '<path d="M12 7.5a2 2 0 1 1 2-2"/><path d="M12 7.5V9l8.5 6.5a1.4 1.4 0 0 1-.9 2.5H4.4a1.4 1.4 0 0 1-.9-2.5L12 9"/>',
  // i : point info
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><path d="M12 7.6h.01" stroke-width="2.6"/>',
  // Lampe torche : orientation, veille de nuit
  flashlight: '<path d="M8 3.5h8V7l-2 3v11h-4V10L8 7Z"/><path d="M8 7h8M12 13v2"/>',

  /* ---------- Sécurité, prévention ---------- */
  // Bouclier : sécurité
  shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8 7.5 9.5 4.4-1.5 7.5-4.9 7.5-9.5V6Z"/><path d="m8.8 12 2.2 2.2 4.2-4.4"/>',
  // Trousse : premiers secours
  firstaid: '<rect x="3" y="6.5" width="18" height="13" rx="2"/><path d="M9 6.5V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v1.5M12 10v6M9 13h6"/>',
  // Main et cœur : réduction des risques
  care: '<path d="M12 11.5S8 9.2 8 6.6a2.1 2.1 0 0 1 4-1.2 2.1 2.1 0 0 1 4 1.2c0 2.6-4 4.9-4 4.9Z"/><path d="M3 14.5h3l3.5-1.5c1-.4 2 .1 2.3 1l.2.5H15l3.5-2a1.6 1.6 0 0 1 1.8 2.6L15 19.5H6.5L3 19"/>',
  // Oreille : prévention auditive
  ear: '<path d="M7 9.5a5.5 5.5 0 0 1 11 0c0 3-2.5 4-3 6.5-.4 2.3-1.8 4-4 4a3.5 3.5 0 0 1-3.5-3.5"/><path d="M10 10a2.5 2.5 0 0 1 5 0c0 1.5-1.5 2-1.5 3.5"/>',
  // Cœur : bienveillance
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z"/>',
  // Bouclier et cœur : lieu sûr, lutte contre le harcèlement
  shieldheart: '<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8 7.5 9.5 4.4-1.5 7.5-4.9 7.5-9.5V6Z"/><path d="M12 15.2s-3-1.8-3-4a1.6 1.6 0 0 1 3-.9 1.6 1.6 0 0 1 3 .9c0 2.2-3 4-3 4Z"/>',
  // Extincteur : sécurité incendie
  extinguisher: '<rect x="8" y="8" width="7" height="13" rx="2"/><path d="M11.5 8V5.5M9 5.5h5M14 4.5l4-1.5M18 3v3"/>',
  // Talkie-walkie : liaison radio
  walkie: '<rect x="7" y="7" width="10" height="14" rx="2"/><path d="M9 7V2.5M10 11h4M10 14h4"/><circle cx="12" cy="17.5" r="1"/>',

  /* ---------- Communication ---------- */
  // Caméra : vidéo
  video: '<rect x="2.5" y="6.5" width="13" height="11" rx="2"/><path d="m15.5 10.5 6-3.5v10l-6-3.5"/>',
  // Affiche : affiches, flyers
  poster: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="m5 15 4-4 3.5 3.5 2-2L19 17"/><circle cx="14.5" cy="7.5" r="1.5"/>',
  // Plume : graphisme
  pen: '<path d="m12 19 7-7 2.5 2.5-7 7Z"/><path d="m18 13-1.5-7.5L3 2.5l3 13.5 7.5 1.5Z"/><path d="m3 2.5 7.6 7.6"/><circle cx="11" cy="11" r="1.8"/>',
  // Enveloppe : newsletter
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>',
  // Journal : relations presse
  newspaper: '<path d="M4 5h13v14.5a1.5 1.5 0 0 0 1.5 1.5h-13A1.5 1.5 0 0 1 4 19.5Z"/><path d="M17 9h3v10.5a1.5 1.5 0 0 1-3 0M7 8.5h7M7 12h7M7 15.5h4"/>',
  // Globe : site internet
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z"/>',
  // Ondes : streaming, live
  broadcast: '<circle cx="12" cy="12" r="2"/><path d="M8.2 15.8a5.4 5.4 0 0 1 0-7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.4 18.6a9.3 9.3 0 0 1 0-13.2M18.6 5.4a9.3 9.3 0 0 1 0 13.2"/>',

  /* ---------- Bénévoles ---------- */
  // Personne + : recrutement
  userplus: '<circle cx="9" cy="8" r="3.8"/><path d="M2.5 20.5a6.5 6.5 0 0 1 13 0M18.5 8v6M15.5 11h6"/>',
  // Groupe : coordination des bénévoles
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M15.5 4.8a3.5 3.5 0 0 1 0 6.4M17.5 14.2a6.5 6.5 0 0 1 4 5.8"/>',
  // Toque : formation
  cap: '<path d="M2 9.5 12 5l10 4.5L12 14Z"/><path d="M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5M22 9.5v5"/>'
};

/**
 * Catalogue des missions proposées dans le CMS : [libellé, pictogramme], rangées par pôle. Les missions
 * déjà en ligne en font partie, avec le pictogramme qu'elles avaient déjà.
 */
export const MISSION_CATALOG = [
  { group: "Organisation & administration", missions: [
    ["Organisation générale", "clipboard"], ["Supervision", "eye"], ["Gestion & coordination", "network"],
    ["Présidence", "crown"], ["Secrétariat", "document"], ["Trésorerie", "wallet"], ["Comptabilité", "calculator"],
    ["Planning & horaires", "clock"], ["Réunions d'équipe", "chat"], ["Archives & documents", "folder"],
    ["Adhésions", "idcard"], ["Démarches administratives", "stamp"], ["Autorisations & déclarations", "stamp"],
    ["Demandes de subventions", "grant"], ["Assurances", "umbrella"], ["Juridique & statuts", "scale"],
    ["Statistiques & bilans", "chart"], ["Informatique & outils", "laptop"]
  ] },
  { group: "Partenariats & relations", missions: [
    ["Bons commerciaux", "tag"], ["Partenariats", "handshake"], ["Recherche de partenaires", "handshake"],
    ["Sponsoring", "tag"], ["Relations avec la mairie", "building"], ["Relations avec les riverains", "house"],
    ["Collaborations entre collectifs", "link"], ["Merchandising", "tshirt"], ["Tombola & goodies", "gift"]
  ] },
  { group: "Technique son & lumière", missions: [
    ["Sonorisation", "speaker"], ["Gestion & installation", "speaker"], ["Réglages & tests", "sliders"],
    ["Mixage & balances", "sliders"], ["Lumières", "spotlight"], ["Lasers & effets", "laser"],
    ["Vidéoprojection & VJing", "projector"], ["Câblage", "cable"], ["Électricité & groupe électrogène", "plug"],
    ["Structures & truss", "truss"], ["Platines & matériel DJ", "turntable"], ["Régie technique", "headphones"],
    ["Machine à fumée", "smoke"], ["Entretien du matériel", "wrench"], ["Montage/installation", "hammer"],
    ["Montage & démontage", "hammer"], ["Transport du matériel", "truck"]
  ] },
  { group: "Soirées & lieu", missions: [
    ["Événementiel", "calendar"], ["Organisation des soirées", "moon"], ["Recherche de lieux", "pin"],
    ["Plan & implantation du site", "map"], ["Scénographie", "stage"], ["Décoration", "discoball"],
    ["Signalétique", "flag"], ["Logistique", "truck"], ["Rangement & nettoyage", "broom"],
    ["Remise en état du site", "broom"], ["Tri des déchets", "recycle"], ["Développement durable", "leaf"],
    ["Parking & circulation", "parking"], ["Camping & hébergement", "tent"], ["Navettes", "bus"],
    ["Covoiturage", "car"], ["Annonces au micro", "megaphone"]
  ] },
  { group: "Artistes & programmation", missions: [
    ["Programmation artistique", "vinyl"], ["Booking DJ", "headphones"], ["Accueil des artistes", "star"],
    ["DJ", "turntable"], ["Live & production musicale", "waveform"], ["MC & animation", "mic"],
    ["Performances & danse", "sparkles"], ["Sélection musicale", "music"]
  ] },
  { group: "Bar & restauration", missions: [
    ["Organisation du bar", "cocktail"], ["Service au bar", "beer"], ["Gestion des stocks", "crate"],
    ["Approvisionnement", "cart"], ["Caisse", "coins"], ["Restauration", "food"], ["Point d'eau", "droplet"],
    ["Écocups & consigne", "cup"]
  ] },
  { group: "Accueil & billetterie", missions: [
    ["Entrée & billetterie", "ticket"], ["Billetterie en ligne", "laptop"], ["Contrôle des billets", "scan"],
    ["Accueil du public", "door"], ["Bracelets & tampons", "wristband"], ["Vestiaire", "hanger"],
    ["Point info", "info"], ["Orientation du public", "flashlight"]
  ] },
  { group: "Sécurité & prévention", missions: [
    ["Sécurité", "shield"], ["Premiers secours", "firstaid"], ["Réduction des risques", "care"],
    ["Prévention auditive", "ear"], ["Prévention alcool & SAM", "car"], ["Bienveillance & médiation", "heart"],
    ["Lutte contre le harcèlement", "shieldheart"], ["Sécurité incendie", "extinguisher"],
    ["Liaison radio", "walkie"], ["Veille de nuit", "flashlight"]
  ] },
  { group: "Communication & création", missions: [
    ["Réseaux sociaux", "phone"], ["Création de contenus", "camera"], ["Stratégie & image", "target"],
    ["Photographie", "camera"], ["Vidéo & montage", "video"], ["Affiches & flyers", "poster"],
    ["Graphisme", "pen"], ["Newsletter", "mail"], ["Relations presse", "newspaper"], ["Site internet", "globe"],
    ["Streaming & live", "broadcast"], ["Communication interne", "chat"], ["Graffitis", "spray"],
    ["Créations visuelles", "palette"]
  ] },
  { group: "Bénévoles & équipe", missions: [
    ["Polyvalent", "puzzle"], ["Renfort ponctuel", "puzzle"], ["Recrutement des bénévoles", "userplus"],
    ["Coordination des bénévoles", "users"], ["Accueil des nouveaux membres", "userplus"], ["Formation", "cap"]
  ] }
];

/* Mots-clés -> pictogramme pour une mission écrite librement, du plus précis au plus général
   (texte en minuscules, sans accents). Les règles d'origine sont en fin de liste (« son » limité au
   mot entier : il se déclenchait dans « livraison »). */
export const MISSION_RULES = [
  [/laser|effet/, "laser"],
  [/lumiere|eclairage|lights?\b/, "spotlight"],
  [/videoproj|\bvj/, "projector"],
  [/cabl/, "cable"],
  [/electri|groupe electrogene|energie/, "plug"],
  [/scenograph/, "stage"],
  [/truss|structure|\bscene\b/, "truss"],
  [/platine|\bdj\b/, "turntable"],
  [/regie|booking|casque/, "headphones"],
  [/fumee|brouillard/, "smoke"],
  [/transport|logistique|camion|livraison/, "truck"],
  [/direction artistique|identite visuelle/, "palette"],
  [/programmation|disque|vinyle/, "vinyl"],
  [/artiste|vip|loge/, "star"],
  [/\blive\b|production musicale|compo/, "waveform"],
  [/\bmc\b|animation|micro/, "mic"],
  [/danse|performance|spectacle/, "sparkles"],
  [/musique|musical/, "music"],
  [/premiers? secours|secouris|\bsoins?\b/, "firstaid"],
  [/auditi|bouchon|oreille/, "ear"],
  [/reduction des risques|\brdr\b|prevention/, "care"],
  [/harcel|safe/, "shieldheart"],
  [/incendie|extincteur/, "extinguisher"],
  [/securite|surete|vigil/, "shield"],
  [/bienveill|mediation|ecoute/, "heart"],
  [/radio|talkie/, "walkie"],
  [/veille|nuit|ronde/, "flashlight"],
  [/president/, "crown"],
  [/secretari|compte rendu|proces-verbal/, "document"],
  [/tresor|budget|financ/, "wallet"],
  [/comptab/, "calculator"],
  [/horaire|planning/, "clock"],
  [/reunion|interne|discussion/, "chat"],
  [/archive|classement/, "folder"],
  [/adhesion|adherent|cotisation/, "idcard"],
  [/subvention|dossier de financement/, "grant"],
  [/administrati|autorisation|declaration|demarche/, "stamp"],
  [/assurance/, "umbrella"],
  [/juridique|statut|legal/, "scale"],
  [/statisti|bilan|chiffre/, "chart"],
  [/informati|numerique|en ligne|ordinateur/, "laptop"],
  [/mairie|institution|prefecture|collectivite/, "building"],
  [/riverain|voisin/, "house"],
  [/collectif|collaboration|reseau d'assos/, "link"],
  [/merch|t-shirt|textile|serigraph/, "tshirt"],
  [/tombola|goodies|lot\b|cadeau/, "gift"],
  [/partenariat|negociation/, "handshake"],
  [/lieu|repérage|reperage/, "pin"],
  [/plan\b|implantation/, "map"],
  [/decoration|deco\b|disco/, "discoball"],
  [/signaletique|panneau|fleche/, "flag"],
  [/nettoyage|rangement|remise en etat/, "broom"],
  [/tri\b|dechet|recycl/, "recycle"],
  [/durable|ecolo|environnement/, "leaf"],
  [/parking|circulation|stationnement/, "parking"],
  [/camping|hebergement|dodo/, "tent"],
  [/navette|\bbus\b/, "bus"],
  [/covoiturage|\bsam\b|conducteur|voiture/, "car"],
  [/annonce|megaphone|porte-voix/, "megaphone"],
  [/soirees?\b|nocturne/, "moon"],
  [/service au bar|biere|tireuse|serveur|serveuse/, "beer"],
  [/approvisionnement|courses|achats?\b/, "cart"],
  [/caisse|monnaie|paiement|\bcb\b/, "coins"],
  [/restauration|cuisine|repas|food/, "food"],
  [/\beau\b|hydrat/, "droplet"],
  [/ecocup|gobelet|consigne/, "cup"],
  [/controle|scan|verification des billets/, "scan"],
  [/bracelet|tampon/, "wristband"],
  [/vestiaire/, "hanger"],
  [/point info|information/, "info"],
  [/orientation|guidage/, "flashlight"],
  [/accueil du public|accueil des? (festivaliers|teufeurs|participants)/, "door"],
  [/video|montage video|clip/, "video"],
  [/affiche|flyer|\btracts?\b/, "poster"],
  [/graphis|logo|illustration/, "pen"],
  [/newsletter|mail|courriel/, "mail"],
  [/presse|journalist|media/, "newspaper"],
  [/site internet|site web|\bweb\b/, "globe"],
  [/stream|diffusion|\bdirect\b/, "broadcast"],
  [/recrutement|nouveaux membres|integration/, "userplus"],
  [/benevole|equipe/, "users"],
  [/formation|tutorat|transmission/, "cap"],
  // Règles d'origine
  [/graff|tag mural|fresque/, "spray"],
  [/visuel|graphis|dessin|deco|creati(on|ve)s? visu/, "palette"],
  [/reseau|social|instagram|communication/, "phone"],
  [/contenu|photo|video/, "camera"],
  [/strateg|image|marque/, "target"],
  [/billet|entree|accueil|ticket/, "ticket"],
  [/\bbons?\b|partenai|sponsor|commerc/, "tag"],
  [/stock|inventaire|appro/, "crate"],
  [/\bbar\b|boisson|cocktail/, "cocktail"],
  [/montage|demontage|monter/, "hammer"],
  [/entretien|materiel|repar/, "wrench"],
  [/reglage|test|mix/, "sliders"],
  [/\bson\b|sono|lumiere|install/, "speaker"],
  [/supervis|surveill/, "eye"],
  [/coordin|gestion/, "network"],
  [/organis|planning/, "clipboard"],
  [/polyvalen|renfort|aide/, "puzzle"],
  [/evenement|soiree|fete/, "calendar"]
];

export const DEFAULT_MISSION_ICON = "bolt";

const plain = (text) => String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Missions du catalogue, par texte simplifié (choix exact = pictogramme prévu)
const CATALOG_ICONS = new Map(MISSION_CATALOG.flatMap(({ missions }) => missions.map(([label, icon]) => [plain(label), icon])));

/** Nom du pictogramme d'une mission (texte français du CMS) : catalogue, sinon mots-clés, sinon éclair. */
export function missionIcon(mission) {
  const text = plain(mission);
  return CATALOG_ICONS.get(text) || MISSION_RULES.find(([pattern]) => pattern.test(text))?.[1] || DEFAULT_MISSION_ICON;
}

/** Balisage <svg> du pictogramme d'une mission (décoratif : le texte est porté par l'élément parent). */
export function missionIconSvg(mission) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${MISSION_ICONS[missionIcon(mission)]}</svg>`;
}
