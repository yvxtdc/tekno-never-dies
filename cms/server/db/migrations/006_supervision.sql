-- Supervision (suivi du déploiement GitHub Pages, contrôle de la validation) et suivi des soirées.
-- Aucun contenu existant n'est modifié.

-- Mises en ligne : étape atteinte (pour situer un échec), résumé de la validation du site, et suivi
-- du déploiement GitHub Actions du commit envoyé (publish/deploy-tracker.mjs). Une seule source d'état
-- pour la page Mise en ligne, le tableau de santé et les programmations.
--  stage : preparation, export, generation, validation, commit, push, done
--  deploy_status : not_sent (mode files/commit), waiting (envoyé, exécution pas encore visible), queued,
--    in_progress, success, failure, cancelled, superseded (annulé, remplacé par un déploiement plus
--    récent qui contient ce commit), overwritten (une version plus ancienne a été déployée après),
--    skipped, unknown (suivi impossible).
ALTER TABLE publications ADD COLUMN stage TEXT;
ALTER TABLE publications ADD COLUMN validation TEXT;
ALTER TABLE publications ADD COLUMN deploy_status TEXT;
ALTER TABLE publications ADD COLUMN deploy_run_id INTEGER;
ALTER TABLE publications ADD COLUMN deploy_run_url TEXT;
ALTER TABLE publications ADD COLUMN deploy_started_at TEXT;
ALTER TABLE publications ADD COLUMN deploy_finished_at TEXT;
ALTER TABLE publications ADD COLUMN deploy_checked_at TEXT;
ALTER TABLE publications ADD COLUMN deploy_next_check_at TEXT;
ALTER TABLE publications ADD COLUMN deploy_message TEXT NOT NULL DEFAULT '';

-- Mises en ligne antérieures : leur déploiement n'a pas été suivi.
UPDATE publications SET deploy_status = CASE WHEN status = 'success' AND mode = 'push' THEN 'unknown' WHEN status = 'success' THEN 'not_sent' END,
  deploy_message = CASE WHEN status = 'success' AND mode = 'push' THEN 'Mise en ligne antérieure au suivi des déploiements.' ELSE '' END;
CREATE INDEX publications_deploy ON publications(deploy_status, id);

-- Suivi des soirées (services/lifecycle.mjs) : seules les confirmations manuelles sont enregistrées ;
-- les tâches déduites des données sont recalculées à chaque lecture (jamais de copie périmée).
-- event_generation : une confirmation ne vaut que pour cette soirée-là (identifiant réutilisé après
-- suppression, voir 005) ; une soirée dupliquée repart sans confirmation.
--  state : done (fait) ou skipped (non concerné pour cette soirée).
CREATE TABLE event_tasks (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  event_generation INTEGER NOT NULL,
  task_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('done', 'skipped')),
  note TEXT NOT NULL DEFAULT '',
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (event_id, event_generation, task_key)
);

-- Adresses des soirées : une adresse, actuelle OU ancienne (event_redirects), n'appartient qu'à une soirée.
-- Le contrôle existait dans le service (events.validateInput) ; ces déclencheurs le garantissent aussi pour
-- toute écriture (statistiques rattachées par l'adresse : services/stats.mjs). Données existantes inchangées.
CREATE TRIGGER events_slug_not_redirect_of_other_insert BEFORE INSERT ON events
  WHEN EXISTS (SELECT 1 FROM event_redirects WHERE old_slug = NEW.slug)
BEGIN SELECT RAISE(ABORT, 'adresse déjà utilisée (ancienne adresse d''une autre soirée)'); END;
CREATE TRIGGER events_slug_not_redirect_of_other_update BEFORE UPDATE OF slug ON events
  WHEN EXISTS (SELECT 1 FROM event_redirects WHERE old_slug = NEW.slug AND event_id <> NEW.id)
BEGIN SELECT RAISE(ABORT, 'adresse déjà utilisée (ancienne adresse d''une autre soirée)'); END;
CREATE TRIGGER event_redirects_not_slug_of_other_insert BEFORE INSERT ON event_redirects
  WHEN EXISTS (SELECT 1 FROM events WHERE slug = NEW.old_slug AND id <> NEW.event_id)
BEGIN SELECT RAISE(ABORT, 'ancienne adresse déjà utilisée par une autre soirée'); END;
CREATE TRIGGER event_redirects_not_slug_of_other_update BEFORE UPDATE ON event_redirects
  WHEN EXISTS (SELECT 1 FROM events WHERE slug = NEW.old_slug AND id <> NEW.event_id)
BEGIN SELECT RAISE(ABORT, 'ancienne adresse déjà utilisée par une autre soirée'); END;

-- Noms portés par chaque soirée (adresses et titres) et date à laquelle elle les a pris : les statistiques
-- d'un nom ne comptent pour une soirée qu'à partir de cette date (nom d'une soirée supprimée repris ensuite).
-- since NULL : nom déjà porté lors de cette migration, tout son historique revient à la soirée.
-- Tenu par des déclencheurs : vrai pour toute écriture. Supprimé avec la soirée (un identifiant réutilisé
-- repart de zéro).
CREATE TABLE event_names (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('slug', 'title')),
  value TEXT NOT NULL,
  since TEXT,
  PRIMARY KEY (event_id, kind, value)
);
INSERT OR IGNORE INTO event_names (event_id, kind, value) SELECT id, 'slug', slug FROM events;
INSERT OR IGNORE INTO event_names (event_id, kind, value) SELECT id, 'title', title FROM events;
INSERT OR IGNORE INTO event_names (event_id, kind, value) SELECT event_id, 'slug', old_slug FROM event_redirects;
INSERT OR IGNORE INTO event_names (event_id, kind, value)
  SELECT r.entity_id, 'title', json_extract(r.data, '$.title') FROM revisions r JOIN events e ON e.id = r.entity_id AND e.generation = r.generation
   WHERE r.entity_type = 'event' AND json_extract(r.data, '$.title') IS NOT NULL;
CREATE TRIGGER event_names_insert AFTER INSERT ON events BEGIN
  INSERT OR IGNORE INTO event_names (event_id, kind, value, since) VALUES (NEW.id, 'slug', NEW.slug, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  INSERT OR IGNORE INTO event_names (event_id, kind, value, since) VALUES (NEW.id, 'title', NEW.title, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
CREATE TRIGGER event_names_slug AFTER UPDATE OF slug ON events WHEN NEW.slug <> OLD.slug BEGIN
  INSERT OR IGNORE INTO event_names (event_id, kind, value, since) VALUES (NEW.id, 'slug', NEW.slug, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
CREATE TRIGGER event_names_title AFTER UPDATE OF title ON events WHEN NEW.title <> OLD.title BEGIN
  INSERT OR IGNORE INTO event_names (event_id, kind, value, since) VALUES (NEW.id, 'title', NEW.title, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
