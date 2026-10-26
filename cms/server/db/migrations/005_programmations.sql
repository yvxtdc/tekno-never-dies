-- Programmations ciblées (services/schedule.mjs) : une modification précise d'un contenu (un champ, un
-- passage du line-up, un statut…) appliquée automatiquement à une date donnée, sans réécrire le reste.
-- Rien de visible ne change : les contenus existants sont conservés tels quels.

-- Identifiant stable de chaque passage du line-up (l'identifiant numérique changeait à chaque
-- enregistrement de la fiche) : une programmation vise un passage précis par ce code.
ALTER TABLE lineup_slots ADD COLUMN uid TEXT;
UPDATE lineup_slots SET uid = lower(hex(randomblob(8))) WHERE uid IS NULL;
CREATE UNIQUE INDEX lineup_slots_uid ON lineup_slots(uid);

-- Génération : numéro immuable de chaque contenu, jamais réutilisé (AUTOINCREMENT : SQLite ne
-- redonne jamais un numéro, même après suppression). Un identifiant (id) peut être réutilisé par SQLite
-- après la suppression d'un contenu : une programmation ou une version de l'historique désigne donc un
-- contenu par son type, son id ET sa génération. Les déclencheurs numérotent toute nouvelle ligne,
-- quel que soit le code qui l'insère (interface, import, migration SQL).
CREATE TABLE content_generations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL
);
ALTER TABLE events ADD COLUMN generation INTEGER;
ALTER TABLE artists ADD COLUMN generation INTEGER;
ALTER TABLE venues ADD COLUMN generation INTEGER;
ALTER TABLE faq_items ADD COLUMN generation INTEGER;
ALTER TABLE team_members ADD COLUMN generation INTEGER;
INSERT INTO content_generations (entity_type, entity_id)
  SELECT 'event', id FROM events UNION ALL SELECT 'artist', id FROM artists UNION ALL SELECT 'venue', id FROM venues
  UNION ALL SELECT 'faq', id FROM faq_items UNION ALL SELECT 'team', id FROM team_members;
UPDATE events SET generation = (SELECT g.id FROM content_generations g WHERE g.entity_type = 'event' AND g.entity_id = events.id);
UPDATE artists SET generation = (SELECT g.id FROM content_generations g WHERE g.entity_type = 'artist' AND g.entity_id = artists.id);
UPDATE venues SET generation = (SELECT g.id FROM content_generations g WHERE g.entity_type = 'venue' AND g.entity_id = venues.id);
UPDATE faq_items SET generation = (SELECT g.id FROM content_generations g WHERE g.entity_type = 'faq' AND g.entity_id = faq_items.id);
UPDATE team_members SET generation = (SELECT g.id FROM content_generations g WHERE g.entity_type = 'team' AND g.entity_id = team_members.id);
CREATE UNIQUE INDEX events_generation ON events(generation);
CREATE UNIQUE INDEX artists_generation ON artists(generation);
CREATE UNIQUE INDEX venues_generation ON venues(generation);
CREATE UNIQUE INDEX faq_items_generation ON faq_items(generation);
CREATE UNIQUE INDEX team_members_generation ON team_members(generation);
-- Dans un déclencheur, last_insert_rowid() est celui de la ligne qu'il vient d'insérer ; l'appelant
-- retrouve ensuite l'identifiant de sa propre ligne (comportement documenté de SQLite).
CREATE TRIGGER events_generation_insert AFTER INSERT ON events BEGIN
  INSERT INTO content_generations (entity_type, entity_id) VALUES ('event', NEW.id);
  UPDATE events SET generation = last_insert_rowid() WHERE id = NEW.id;
END;
CREATE TRIGGER artists_generation_insert AFTER INSERT ON artists BEGIN
  INSERT INTO content_generations (entity_type, entity_id) VALUES ('artist', NEW.id);
  UPDATE artists SET generation = last_insert_rowid() WHERE id = NEW.id;
END;
CREATE TRIGGER venues_generation_insert AFTER INSERT ON venues BEGIN
  INSERT INTO content_generations (entity_type, entity_id) VALUES ('venue', NEW.id);
  UPDATE venues SET generation = last_insert_rowid() WHERE id = NEW.id;
END;
CREATE TRIGGER faq_items_generation_insert AFTER INSERT ON faq_items BEGIN
  INSERT INTO content_generations (entity_type, entity_id) VALUES ('faq', NEW.id);
  UPDATE faq_items SET generation = last_insert_rowid() WHERE id = NEW.id;
END;
CREATE TRIGGER team_members_generation_insert AFTER INSERT ON team_members BEGIN
  INSERT INTO content_generations (entity_type, entity_id) VALUES ('team', NEW.id);
  UPDATE team_members SET generation = last_insert_rowid() WHERE id = NEW.id;
END;
-- La génération ne change jamais.
CREATE TRIGGER events_generation_fixed BEFORE UPDATE OF generation ON events WHEN OLD.generation IS NOT NULL BEGIN SELECT RAISE(ABORT, 'generation immuable'); END;
CREATE TRIGGER artists_generation_fixed BEFORE UPDATE OF generation ON artists WHEN OLD.generation IS NOT NULL BEGIN SELECT RAISE(ABORT, 'generation immuable'); END;
CREATE TRIGGER venues_generation_fixed BEFORE UPDATE OF generation ON venues WHEN OLD.generation IS NOT NULL BEGIN SELECT RAISE(ABORT, 'generation immuable'); END;
CREATE TRIGGER faq_items_generation_fixed BEFORE UPDATE OF generation ON faq_items WHEN OLD.generation IS NOT NULL BEGIN SELECT RAISE(ABORT, 'generation immuable'); END;
CREATE TRIGGER team_members_generation_fixed BEFORE UPDATE OF generation ON team_members WHEN OLD.generation IS NOT NULL BEGIN SELECT RAISE(ABORT, 'generation immuable'); END;

-- Historique : origine de chaque version (saisie, programmation, restauration, statut), programmation
-- associée et liste des champs modifiés par rapport à la version précédente.
ALTER TABLE revisions ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE revisions ADD COLUMN change_id INTEGER;
ALTER TABLE revisions ADD COLUMN changes TEXT NOT NULL DEFAULT '[]';
-- Génération du contenu de chaque version. Versions existantes : rattachées au contenu actuel de même
-- identifiant seulement si l'attribution est sûre, sinon laissées sans génération (conservées en base,
-- mais ni listées, ni comparées, ni restaurées : mieux vaut une version non rattachée qu'une version
-- attribuée au mauvais contenu, par exemple celle d'un contenu supprimé dont l'identifiant a été réutilisé) :
--  - la copie enregistrée, si elle contient sa date de création (soirées, artistes, lieux), doit avoir
--    celle du contenu actuel ;
--  - la version doit être postérieure à la création du contenu ; dans la même milliseconde, seulement la
--    version 1 si c'est l'unique version de cet identifiant à cet instant (sinon : ambiguë).
ALTER TABLE revisions ADD COLUMN generation INTEGER;
UPDATE revisions SET generation = CASE entity_type
    WHEN 'event' THEN (SELECT e.generation FROM events e WHERE e.id = revisions.entity_id
      AND (json_extract(revisions.data, '$.createdAt') IS NULL OR json_extract(revisions.data, '$.createdAt') = e.created_at)
      AND (revisions.created_at > e.created_at
        OR (revisions.created_at = e.created_at AND revisions.version = 1
          AND (SELECT COUNT(*) FROM revisions r2 WHERE r2.entity_type = revisions.entity_type AND r2.entity_id = revisions.entity_id AND r2.created_at = e.created_at) = 1)))
    WHEN 'artist' THEN (SELECT a.generation FROM artists a WHERE a.id = revisions.entity_id
      AND (json_extract(revisions.data, '$.createdAt') IS NULL OR json_extract(revisions.data, '$.createdAt') = a.created_at)
      AND (revisions.created_at > a.created_at
        OR (revisions.created_at = a.created_at AND revisions.version = 1
          AND (SELECT COUNT(*) FROM revisions r2 WHERE r2.entity_type = revisions.entity_type AND r2.entity_id = revisions.entity_id AND r2.created_at = a.created_at) = 1)))
    WHEN 'venue' THEN (SELECT v.generation FROM venues v WHERE v.id = revisions.entity_id
      AND (json_extract(revisions.data, '$.createdAt') IS NULL OR json_extract(revisions.data, '$.createdAt') = v.created_at)
      AND (revisions.created_at > v.created_at
        OR (revisions.created_at = v.created_at AND revisions.version = 1
          AND (SELECT COUNT(*) FROM revisions r2 WHERE r2.entity_type = revisions.entity_type AND r2.entity_id = revisions.entity_id AND r2.created_at = v.created_at) = 1)))
    WHEN 'faq' THEN (SELECT f.generation FROM faq_items f WHERE f.id = revisions.entity_id
      AND (json_extract(revisions.data, '$.createdAt') IS NULL OR json_extract(revisions.data, '$.createdAt') = f.created_at)
      AND (revisions.created_at > f.created_at
        OR (revisions.created_at = f.created_at AND revisions.version = 1
          AND (SELECT COUNT(*) FROM revisions r2 WHERE r2.entity_type = revisions.entity_type AND r2.entity_id = revisions.entity_id AND r2.created_at = f.created_at) = 1)))
    WHEN 'team' THEN (SELECT t.generation FROM team_members t WHERE t.id = revisions.entity_id
      AND (json_extract(revisions.data, '$.createdAt') IS NULL OR json_extract(revisions.data, '$.createdAt') = t.created_at)
      AND (revisions.created_at > t.created_at
        OR (revisions.created_at = t.created_at AND revisions.version = 1
          AND (SELECT COUNT(*) FROM revisions r2 WHERE r2.entity_type = revisions.entity_type AND r2.entity_id = revisions.entity_id AND r2.created_at = t.created_at) = 1)))
  END;
CREATE INDEX revisions_generation ON revisions(entity_type, generation, id);

-- Une programmation = une opération ciblée sur un contenu.
--  changes : [{ key, base, from, to, … }] (JSON) : clé visée (champ, « slot:<uid> », « slot:<uid>:<champ> »,
--            « order:<uid> », « status »), valeur vue à la préparation (base), valeur attendue juste avant
--            l'exécution (from : base, ou résultat de la programmation précédente sur la même clé) et
--            valeur programmée (to).
--  status  : pending (en attente), applied (appliquée dans le CMS, mise en ligne à faire),
--            published (mise en ligne réussie), conflict, blocked, failed, cancelled.
--  depends_on : programmations qui doivent être appliquées avant (JSON [id…]).
CREATE TABLE scheduled_changes (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('event', 'artist', 'venue', 'faq', 'team')),
  entity_id INTEGER NOT NULL,
  -- Génération du contenu visé (voir content_generations) : un identifiant réutilisé par SQLite après
  -- une suppression ne désigne pas le même contenu (la programmation échoue au lieu de le modifier).
  entity_generation INTEGER NOT NULL,
  -- Nom du contenu à la programmation (reste lisible si le contenu est supprimé ensuite).
  entity_label TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  changes TEXT NOT NULL,
  run_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'applied', 'published', 'conflict', 'blocked', 'failed', 'cancelled')),
  depends_on TEXT NOT NULL DEFAULT '[]',
  base_version INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  -- Dernier résultat lisible (motif du conflit, de l'échec, du blocage…) et détails (JSON).
  result TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '{}',
  revision_id INTEGER,
  publication_id INTEGER,
  applied_at TEXT,
  published_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX scheduled_changes_due ON scheduled_changes(status, run_at, id);
CREATE INDEX scheduled_changes_entity ON scheduled_changes(entity_type, entity_id);

-- Journal de chaque programmation (création, modification, exécution, conflit, mise en ligne…).
CREATE TABLE scheduled_change_log (
  id INTEGER PRIMARY KEY,
  change_id INTEGER NOT NULL REFERENCES scheduled_changes(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX scheduled_change_log_change ON scheduled_change_log(change_id, id);

-- Mises en ligne de soirées déjà programmées (ancien mécanisme events.publish_at) : reprises comme
-- programmations, à la même heure. La soirée reste « Programmée » et invisible jusque-là.
INSERT INTO scheduled_changes (entity_type, entity_id, entity_generation, entity_label, summary, changes, run_at, base_version, created_at, updated_at)
  SELECT 'event', id, generation, title, 'Mise en ligne',
         json_array(json_object('key', 'status', 'kind', 'status', 'base', 'scheduled', 'from', 'scheduled', 'to', 'published')),
         publish_at, version, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM events WHERE status = 'scheduled' AND publish_at IS NOT NULL;
INSERT INTO scheduled_change_log (change_id, action, message, created_at)
  SELECT id, 'created', 'Reprise de la mise en ligne programmée existante.', created_at FROM scheduled_changes;
