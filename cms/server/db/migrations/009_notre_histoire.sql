-- « Notre histoire » (page L'association) : les étapes clés de l'association, saisies dans le CMS
-- (écran « Notre histoire »). Sur le site, elles s'intercalent par année avec les chapitres des soirées,
-- ajoutés automatiquement (js/pages/association.js). Exportées dans js/data/histoire.js.
--  date / date_precision : date de l'étape ; « month » et « year » n'affichent que le mois ou l'année
--    (la date est alors le premier jour du mois ou de l'année).
--  visual : decor (étincelles), badge (logo de l'association) ou photo (media_id, médiathèque).
CREATE TABLE history_items (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  date_precision TEXT NOT NULL DEFAULT 'day' CHECK (date_precision IN ('day', 'month', 'year')),
  title TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  visual TEXT NOT NULL DEFAULT 'decor' CHECK (visual IN ('decor', 'badge', 'photo')),
  media_id INTEGER REFERENCES media(id) ON DELETE RESTRICT,
  published INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (visual <> 'photo' OR media_id IS NOT NULL)
);
CREATE INDEX history_items_date ON history_items(date);

-- Étapes écrites jusque-là dans association.html, et leurs traductions (js/i18n/de.js, en.js)
INSERT INTO history_items (date, date_precision, title, text, visual, created_at, updated_at) VALUES
  ('2023-06-01', 'month', 'L''idée naît', 'Une passion commune, et l''envie d''organiser nos propres soirées.', 'decor', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('2024-12-04', 'day', 'L''association est créée', 'Après une année à réunir l''équipe et le matériel, TND devient officiellement une association.', 'badge', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT OR IGNORE INTO translations (source, lang, text, updated_at) VALUES
  ('L''idée naît', 'de', 'Die Idee entsteht', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('L''idée naît', 'en', 'The idea is born', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Une passion commune, et l''envie d''organiser nos propres soirées.', 'de', 'Eine gemeinsame Leidenschaft und der Wunsch, eigene Partys zu organisieren.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Une passion commune, et l''envie d''organiser nos propres soirées.', 'en', 'A shared passion, and the urge to throw our own parties.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('L''association est créée', 'de', 'Der Verein wird gegründet', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('L''association est créée', 'en', 'The association is founded', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Après une année à réunir l''équipe et le matériel, TND devient officiellement une association.', 'de', 'Nach einem Jahr, in dem Team und Equipment zusammenkamen, wird TND offiziell ein Verein.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Après une année à réunir l''équipe et le matériel, TND devient officiellement une association.', 'en', 'After a year bringing the team and gear together, TND officially becomes an association.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
