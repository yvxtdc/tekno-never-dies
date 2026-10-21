-- Billets en plusieurs tarifs (early, regular, late… puis caisse du soir) et DJ Contest.
--
-- events.tickets : [{ label, price, note, status, until, door }] (JSON), dans l'ordre d'affichage.
--   status : 'available' (en vente), 'soldout' (épuisé, grisé), 'soon' (bientôt), 'closed' (vente terminée) ;
--   until : dernier jour de vente AAAA-MM-JJ (facultatif : passé ce jour, le tarif s'affiche « terminé ») ;
--   door : 1 pour la caisse du soir (toujours affichée en dernier).
-- events.contest : { email, deadline, text } (JSON) : DJ Contest de la soirée (place à gagner au line-up).
-- artists.mystery : 1 = artiste mystère (« DJ Contest ») : sur le site, pas de lien Instagram mais une
--   fenêtre qui explique comment participer.

ALTER TABLE events ADD COLUMN tickets TEXT NOT NULL DEFAULT '[]';
ALTER TABLE events ADD COLUMN contest TEXT NOT NULL DEFAULT '{}';
ALTER TABLE artists ADD COLUMN mystery INTEGER NOT NULL DEFAULT 0;
