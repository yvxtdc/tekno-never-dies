# Tekno Never Dies — ajouts V2

Cette V2 ajoute les pages et briques manquantes sans remplacer l'architecture existante.

## Informations publiques vérifiées

Les informations ci-dessous proviennent de l'API publique de recherche des
entreprises, consultée le 23 septembre 2026 à partir de la fiche data.gouv
fournie pour l'association :

- Nom : **TEKNO NEVER DIES**
- Sigle : **TND**
- Statut : association active
- SIREN : **939 301 768**
- SIRET du siège : **939 301 768 00015**
- Siège déclaré : **51 avenue Georges Clemenceau, 67630 Lauterbourg**
- Date de création : **4 décembre 2024**
- Activité principale déclarée : **90.01Z — Arts du spectacle vivant**

Ces informations sont conservées comme base de travail. Elles ne remplacent
pas la validation par l'association des mentions légales, des coordonnées
publiques et des informations de publication.

## Nouvelles pages
- nos-actions.html
- rejoindre.html
- actualites.html
- partenaires.html
- faq.html
- conditions-location.html
- mentions-legales.html
- confidentialite.html
- 404.html

## Nouvelles données
- js/data/actualites.js
- js/data/faq.js
- js/data/partenaires.js

## Infrastructure
- menu mobile dans partials/header.html + js/partials.js
- footer enrichi dans partials/footer.html
- CSS commun ajouté dans css/style.css et css/pages.css
- robots.txt et sitemap.xml (remplacer example.org)
- formulaire de contact préremplissable avec ?type=location
- paramètres `type`, `evenement` et `materiel` harmonisés entre les fiches et le formulaire
- chargement Three.js différé : les modules WebGL ne sont chargés que sur l'accueil
- modale équipe avec restauration du focus, fermeture par Échap et piège de focus
- libellé accessible du bouton de menu synchronisé avec son état

## Avant publication
Remplacer les placeholders entre crochets, le domaine example.org, les coordonnées, les réseaux sociaux, les partenaires, les photos et les conditions réelles de location.

L'action Formspree de `contact.html` contient encore `VOTRE_ID`. Créer le
formulaire Formspree puis remplacer cette valeur par l'identifiant fourni avant
la mise en ligne.
