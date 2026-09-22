# Tekno Never Dies — site vitrine

Site de l'association **Tekno Never Dies** (TND6TEM) : événements, location de matériel événementiel, présentation de l'association, galerie, contact/devis. Accueil animé avec des étoiles chrome en 3D (Three.js).

Site 100 % statique : **HTML + CSS + JavaScript**, aucune installation (ni Node, ni npm) n'est nécessaire pour travailler dessus.

## Pages

| Fichier | Contenu |
|---|---|
| `index.html` | Accueil — piliers événements / location / asso, agenda et catalogue dynamiques |
| `evenements.html` | Liste des événements à venir + archives (onglets) |
| `evenement.html?e=slug` | Fiche détaillée d'un événement (lit `js/data/events.js`) |
| `location.html` | Catalogue de location, filtres par catégorie et recherche |
| `materiel.html?m=slug` | Fiche détaillée d'un matériel/pack (lit `js/data/catalogue.js`) |
| `association.html` | Qui sommes-nous, valeurs, bureau, rejoindre |
| `galerie.html` | Galerie photo/vidéo filtrable par événement |
| `contact.html` | Formulaire de contact/devis (Formspree) + FAQ |
| `mentions-legales.html` | Mentions légales, RGPD, conditions générales de location |

**Contenu à remplacer avant mise en ligne** : tout ce qui est dans `js/data/events.js` et `js/data/catalogue.js` (événements et matériel) est un exemple. Modifie ces deux fichiers pour mettre tes vraies données — les pages se mettent à jour automatiquement, sans toucher au HTML.

**Formulaire de contact** : va sur <https://formspree.io>, crée un compte gratuit et un formulaire, puis remplace `YOUR_FORM_ID` dans `contact.html` (attribut `action` du `<form>`) par ton identifiant. Tant que ce n'est pas fait, le formulaire se soumet normalement (rechargement de page) au lieu de rester sur place — et le lien mailto reste utilisable en attendant.

**Vers un vrai backend plus tard** : `events.js` et `catalogue.js` exportent de simples tableaux JavaScript. Le jour où tu veux un calendrier de disponibilité en temps réel ou un espace membre, tu peux remplacer ces fichiers par des appels à une API (`fetch(...)`) sans changer les pages HTML ni leur logique d'affichage.

---

## 1. Mise en place (depuis zéro)

1. **Dézippe** le projet dans un dossier stable, par exemple `Documents/tekno-never-dies`.
2. Ouvre **VS Code** → menu **Fichier › Ouvrir le dossier…** → choisis le dossier `tekno-never-dies` (celui qui contient `index.html`).
   Si VS Code demande « Faites-vous confiance aux auteurs ? », clique sur **Oui**.
3. **Installe l'extension Live Server** : en bas à droite, VS Code propose les extensions recommandées → *Installer*.
   Sinon : icône Extensions (`Ctrl+Maj+X`, `Cmd+Maj+X` sur Mac) → cherche **Live Server** (auteur : *Ritwick Dey*) → *Installer*.
   (Prettier, aussi recommandé, est un formateur de code : facultatif.)
4. **Lance le site** : clic droit sur `index.html` → **Open with Live Server**
   (ou le bouton **Go Live** en bas à droite de VS Code).
   Le navigateur s'ouvre sur `http://127.0.0.1:5500` et **se recharge tout seul à chaque enregistrement** (`Ctrl+S`).

> **Pourquoi pas un double-clic sur `index.html` ?** Le navigateur bloque les modules JavaScript quand la page est ouverte comme un simple fichier (`file://`) : le texte s'affiche mais les étoiles n'apparaissent pas. Il faut passer par Live Server (un mini serveur local).

Pour arrêter : clic sur **Port : 5500** en bas à droite de VS Code.

---

## 2. Structure du projet

```
tekno-never-dies/
├── index.html              Accueil
├── evenements.html         Liste des événements (à venir / archives)
├── evenement.html          Fiche détaillée d'un événement (?e=slug)
├── location.html           Catalogue de location
├── materiel.html           Fiche détaillée d'un matériel/pack (?m=slug)
├── association.html        Page "L'association"
├── galerie.html             Galerie photo/vidéo
├── contact.html             Formulaire de contact/devis + FAQ
├── mentions-legales.html    Mentions légales, RGPD, CGL
├── css/
│   └── style.css           Charte (couleurs, polices), mise en page, mode sombre
├── js/
│   ├── main.js             Point d'entrée : lance les étoiles (accueil uniquement)
│   ├── home.js             Agenda et catalogue dynamiques sur l'accueil
│   ├── evenements.js / evenement-detail.js   Liste et fiche événement
│   ├── location.js / materiel-detail.js      Catalogue et fiche matériel
│   ├── galerie.js          Filtres de la galerie
│   ├── contact.js          Formulaire de contact (champs conditionnels, envoi)
│   ├── legal-tabs.js       Onglets de la page mentions légales
│   ├── data/
│   │   ├── events.js       ★ Données des événements (à remplacer)
│   │   └── catalogue.js    ★ Données du catalogue de location (à remplacer)
│   └── stars/
│       ├── config.js       ★ Tous les réglages des étoiles (vitesse, couleurs, ombre…)
│       ├── stars.js        Scène 3D, trajectoires aléatoires, animation
│       ├── star-geometry.js  Fabrique la forme "coussin" arrondie de l'étoile
│       └── environment.js  Le "studio" de reflets qui donne l'effet chrome
├── assets/
│   ├── img/                badge-black / badge-white, favicon
│   │   └── decor/          Éléments chromés de la charte (chaîne, serpentin, étoiles…), non utilisés pour la plupart : ils t'attendent
│   └── fonts/              Archivo Black + Montserrat (hébergées ici, licence OFL)
├── vendor/three/           Three.js (copie locale, le site marche hors ligne)
├── .vscode/                Réglages VS Code et extensions recommandées
└── README.md
```

## 3. Où modifier quoi

| Je veux… | Je vais dans… |
|---|---|
| Changer un texte, ajouter une section | `index.html` |
| Changer une couleur, une taille, un espacement | `css/style.css` (couleurs = variables en haut, `:root`) |
| Ralentir / accélérer les étoiles | `js/stars/config.js` → `motion.speed` |
| Ajouter, retirer, recolorer une étoile | `js/stars/config.js` → liste `stars` |
| Changer la forme (branches, épaisseur, concavité) | `js/stars/config.js` → `shapes` |
| Ombre plus ou moins marquée | `js/stars/config.js` → `shadow.opacity` |
| Chrome plus doux / plus miroir | `js/stars/config.js` → `chrome.roughness`, `envMapIntensity` |
| Désactiver les étoiles | `js/stars/config.js` → `enabled: false` |
| Mettre les étoiles derrière le texte | `css/style.css` → `#stage { z-index: 0 }` |
| Changer l'adresse de contact | `contact.html` et `mentions-legales.html` → chercher `example.org` |
| Ajouter/modifier un événement | `js/data/events.js` |
| Ajouter/modifier un matériel ou pack | `js/data/catalogue.js` |
| Activer le vrai formulaire de devis/contact | `contact.html` → remplacer `YOUR_FORM_ID` par ton identifiant Formspree |
| Utiliser un décor de la charte | `assets/img/decor/…` (images `.webp` transparentes) |

Astuce : dans le navigateur, **F12 › Console**, tape `TND.stars.stars[0].mesh.material.color.set(0xff60dc)` pour tester une couleur en direct.

## 4. Versionner avec Git (recommandé)

1. Installe Git : <https://git-scm.com/downloads> (puis redémarre VS Code).
2. Dans VS Code : icône **Contrôle de code source** (`Ctrl+Maj+G`) → **Initialiser le dépôt**.
3. Écris un message (« Première version ») → **Commit**.
4. À chaque étape de travail : nouveau commit. Tu peux revenir en arrière à tout moment.
5. Pour sauvegarder en ligne : compte sur <https://github.com> → bouton **Publier sur GitHub** dans VS Code.

## 5. Mettre le site en ligne

Comme il n'y a pas d'étape de compilation, tu publies simplement le dossier tel quel :

- **GitHub Pages**, **Netlify** ou **Cloudflare Pages** (gratuits) : envoie le dossier, ils fournissent une adresse.
- **Hébergeur classique** (OVH, o2switch…) : dépose tout le contenu du dossier par FTP à la racine du site.

## 6. Pour aller plus loin (plus tard)

Quand le site grandira (plusieurs pages, composants, optimisation automatique), tu pourras migrer vers **Vite** : installe Node.js (version LTS, <https://nodejs.org>), puis `npm create vite@latest`. Le code de ce projet (modules ES, `import ... from "three"`) est déjà écrit pour s'y adapter facilement ; il suffira de remplacer `vendor/three/` par `npm install three`.

## Crédits et licences

- Charte, badge et éléments chromés : `CHARTE_TND.pdf`.
- Three.js r180 — licence MIT (`vendor/three/LICENSE`).
- Archivo Black et Montserrat — licence SIL OFL (`assets/fonts/LICENSE-*.txt`).
