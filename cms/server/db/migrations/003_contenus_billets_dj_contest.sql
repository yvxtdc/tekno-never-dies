-- Contenus d'octobre 2026 (appliqués une fois au démarrage du CMS, sans rien écraser d'autre) :
--  - billets d'ICE BOILER v2 en quatre tarifs (Early, Regular, Late, caisse du soir), si aucun tarif n'est saisi ;
--  - infos pratiques des soirées sans les prix (désormais dans « Billets ») mais avec les conseils du soir
--    (bouchons d'oreilles, âge, hydratation, équipe, parking, respect), si elles n'ont pas déjà été réécrites ;
--  - fiche « DJ Contest » (artiste mystère, illustration assets/img/artistes/dj-contest.webp) à la place de
--    T.B.R dans le line-up d'ICE BOILER v2, avec la date limite d'envoi des sets ;
--  - traductions allemandes et anglaises de ces textes.
-- Sur une base vide (installation neuve, tests), ces requêtes ne modifient rien.

UPDATE events SET tickets = '[{"label":"Early","price":10,"note":"Les premières places, au meilleur prix","status":"available","until":"","door":false},{"label":"Regular","price":13,"note":"","status":"available","until":"","door":false},{"label":"Late","price":16,"note":"Dernières places en prévente","status":"available","until":"","door":false},{"label":"Caisse du soir","price":18,"note":"Sur place, dans la limite des places disponibles","status":"available","until":"","door":true}]', version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE slug = 'ice-boiler-v2-2026' AND tickets = '[]';

UPDATE events SET practical = '["Début : 21h00","Dès 16 ans","Le son est fort : des bouchons d''oreilles te sont offerts gratuitement à l''entrée, n''hésite pas à en demander.","Entrée interdite aux moins de 16 ans : prévois une pièce d''identité, elle peut t''être demandée.","Caisse du soir disponible sur place, dans la limite des places restantes.","Reste hydraté·e : bois de l''eau régulièrement, toute la nuit.","Un souci, un malaise, quelqu''un qui te met mal à l''aise ? Viens voir un membre de l''équipe : on est là pour t''aider.","Parking possible à côté de la salle : pense au covoiturage et désigne un·e Sam qui ne boit pas.","Respect et consentement sur le dancefloor : aucun comportement déplacé n''est toléré."]', version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE slug = 'ice-boiler-v2-2026' AND practical NOT LIKE '%bouchons%';

UPDATE events SET practical = '["Dès 16 ans","250 participant·es","Le son est fort : des bouchons d''oreilles te sont offerts gratuitement à l''entrée, n''hésite pas à en demander.","Entrée interdite aux moins de 16 ans : prévois une pièce d''identité, elle peut t''être demandée.","Reste hydraté·e : bois de l''eau régulièrement, toute la nuit.","Un souci, un malaise, quelqu''un qui te met mal à l''aise ? Viens voir un membre de l''équipe : on est là pour t''aider.","Respect et consentement sur le dancefloor : aucun comportement déplacé n''est toléré."]', version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE slug = 'center-drop-2026' AND practical NOT LIKE '%bouchons%';

UPDATE events SET practical = '["Dès 16 ans","200 participant·es","Le son est fort : des bouchons d''oreilles te sont offerts gratuitement à l''entrée, n''hésite pas à en demander.","Entrée interdite aux moins de 16 ans : prévois une pièce d''identité, elle peut t''être demandée.","Reste hydraté·e : bois de l''eau régulièrement, toute la nuit.","Un souci, un malaise, quelqu''un qui te met mal à l''aise ? Viens voir un membre de l''équipe : on est là pour t''aider.","Parking possible à côté de la salle : pense au covoiturage et désigne un·e Sam qui ne boit pas.","Respect et consentement sur le dancefloor : aucun comportement déplacé n''est toléré."]', version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE slug = 'ice-boiler-v1-2025' AND practical NOT LIKE '%bouchons%';

UPDATE events SET practical = '["150 participant·es","Le son est fort : des bouchons d''oreilles te sont offerts gratuitement à l''entrée, n''hésite pas à en demander.","Reste hydraté·e : bois de l''eau régulièrement, toute la nuit.","Un souci, un malaise, quelqu''un qui te met mal à l''aise ? Viens voir un membre de l''équipe : on est là pour t''aider.","Respect et consentement sur le dancefloor : aucun comportement déplacé n''est toléré."]', version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE slug = 'fete-musique-wissembourg-2025' AND practical NOT LIKE '%bouchons%';

INSERT INTO media (uid, storage, repo_path, original_name, mime, size, width, height, sha256, alt, variants, created_at, updated_at)
  SELECT lower(hex(randomblob(6))), 'repo', 'assets/img/artistes/dj-contest.webp', 'dj-contest.webp', 'image/webp', 13586, 600, 600,
         '3e7349b83adf46358e80e3ed8336a3d89fdfd6956213fd7fbd8f197600d3f4c7', 'DJ mystère au casque derrière les platines, un point d''interrogation à la place du visage', '{}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE EXISTS (SELECT 1 FROM events WHERE slug = 'ice-boiler-v2-2026')
    AND NOT EXISTS (SELECT 1 FROM media WHERE repo_path = 'assets/img/artistes/dj-contest.webp');

INSERT INTO artists (slug, name, match_key, photo_media_id, styles, mystery, notes, created_at, updated_at)
  SELECT 'dj-contest', 'DJ Contest', 'djcontest', (SELECT id FROM media WHERE repo_path = 'assets/img/artistes/dj-contest.webp'), 'Artiste mystère', 1,
         'Place à gagner au line-up : le nom ouvre la fenêtre de participation (section « DJ Contest » de chaque soirée).', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE EXISTS (SELECT 1 FROM events WHERE slug = 'ice-boiler-v2-2026')
    AND NOT EXISTS (SELECT 1 FROM artists WHERE match_key = 'djcontest');

-- Passage de T.B.R (ouverture d'ICE BOILER v2) : la place devient celle du DJ Contest.
UPDATE lineup_slots SET label = '', style = ''
  WHERE event_id = (SELECT id FROM events WHERE slug = 'ice-boiler-v2-2026')
    AND id IN (SELECT la.slot_id FROM lineup_slot_artists la JOIN artists a ON a.id = la.artist_id WHERE a.match_key = 'tbr');
UPDATE lineup_slot_artists SET artist_id = (SELECT id FROM artists WHERE match_key = 'djcontest')
  WHERE artist_id = (SELECT id FROM artists WHERE match_key = 'tbr')
    AND slot_id IN (SELECT s.id FROM lineup_slots s JOIN events e ON e.id = s.event_id WHERE e.slug = 'ice-boiler-v2-2026')
    AND EXISTS (SELECT 1 FROM artists WHERE match_key = 'djcontest');
UPDATE events SET contest = '{"email":"","deadline":"2026-11-15","text":""}', version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE slug = 'ice-boiler-v2-2026' AND contest = '{}';

INSERT OR IGNORE INTO translations (source, lang, text, updated_at)
  SELECT column1, column2, column3, column4 FROM (VALUES
  ('Le son est fort : des bouchons d''oreilles te sont offerts gratuitement à l''entrée, n''hésite pas à en demander.', 'de', 'Der Sound ist laut: Ohrstöpsel gibt es kostenlos am Eingang – frag einfach danach.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Le son est fort : des bouchons d''oreilles te sont offerts gratuitement à l''entrée, n''hésite pas à en demander.', 'en', 'The sound is loud: free earplugs are handed out at the entrance, just ask.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Entrée interdite aux moins de 16 ans : prévois une pièce d''identité, elle peut t''être demandée.', 'de', 'Kein Einlass unter 16 Jahren: Bring einen Ausweis mit, er kann verlangt werden.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Entrée interdite aux moins de 16 ans : prévois une pièce d''identité, elle peut t''être demandée.', 'en', 'No entry under 16: bring ID, you may be asked for it.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Caisse du soir disponible sur place, dans la limite des places restantes.', 'de', 'Abendkasse vor Ort, solange noch Plätze frei sind.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Caisse du soir disponible sur place, dans la limite des places restantes.', 'en', 'Tickets also on sale at the door, while places last.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Reste hydraté·e : bois de l''eau régulièrement, toute la nuit.', 'de', 'Trink genug: Nimm die ganze Nacht über regelmäßig Wasser zu dir.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Reste hydraté·e : bois de l''eau régulièrement, toute la nuit.', 'en', 'Stay hydrated: drink water regularly throughout the night.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Un souci, un malaise, quelqu''un qui te met mal à l''aise ? Viens voir un membre de l''équipe : on est là pour t''aider.', 'de', 'Ein Problem, dir geht es nicht gut, jemand ist dir unangenehm? Sprich ein Mitglied des Teams an: Wir sind für dich da.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Un souci, un malaise, quelqu''un qui te met mal à l''aise ? Viens voir un membre de l''équipe : on est là pour t''aider.', 'en', 'A problem, feeling unwell, someone making you uncomfortable? Come and see a member of the team: we''re here to help.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Parking possible à côté de la salle : pense au covoiturage et désigne un·e Sam qui ne boit pas.', 'de', 'Parkplätze direkt neben der Halle: Denk an Fahrgemeinschaften und bestimme eine Person, die nüchtern bleibt und fährt.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Parking possible à côté de la salle : pense au covoiturage et désigne un·e Sam qui ne boit pas.', 'en', 'Parking available next to the venue: think carpooling and pick a designated driver who stays sober.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Respect et consentement sur le dancefloor : aucun comportement déplacé n''est toléré.', 'de', 'Respekt und Konsens auf dem Dancefloor: Übergriffiges Verhalten wird nicht toleriert.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Respect et consentement sur le dancefloor : aucun comportement déplacé n''est toléré.', 'en', 'Respect and consent on the dancefloor: no inappropriate behaviour is tolerated.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Early', 'de', 'Early', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Early', 'en', 'Early', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Regular', 'de', 'Regular', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Regular', 'en', 'Regular', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Late', 'de', 'Late', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Late', 'en', 'Late', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Caisse du soir', 'de', 'Abendkasse', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Caisse du soir', 'en', 'At the door', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Les premières places, au meilleur prix', 'de', 'Die ersten Tickets zum besten Preis', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Les premières places, au meilleur prix', 'en', 'The first tickets, at the best price', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Dernières places en prévente', 'de', 'Letzte Tickets im Vorverkauf', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Dernières places en prévente', 'en', 'Last presale tickets', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Sur place, dans la limite des places disponibles', 'de', 'Vor Ort, solange Plätze frei sind', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Sur place, dans la limite des places disponibles', 'en', 'On site, while places last', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))
  WHERE EXISTS (SELECT 1 FROM events WHERE slug = 'ice-boiler-v2-2026');
