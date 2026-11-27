-- Infos de l'association saisies dans le CMS (écran « Infos de l'association », administrateurs) :
-- coordonnées, responsable de publication, hébergeur. Une seule ligne (id = 1). Exportées dans
-- js/data/association.js ; écrites dans les pages par tools/sync-infos.mjs (attributs data-info).
-- Valeurs de départ : celles du site au moment de la migration (mentions légales, contact, pied de page),
-- pour que la première mise en ligne ne change rien.
CREATE TABLE site_info (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  instagram TEXT NOT NULL DEFAULT '',
  street TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  city TEXT NOT NULL,
  publisher_name TEXT NOT NULL,
  -- Fonction du responsable de publication, en français (traduite dans l'écran Traductions)
  publisher_role TEXT NOT NULL,
  host_name TEXT NOT NULL,
  -- Adresse de l'hébergeur, en français (traduite dans l'écran Traductions)
  host_address TEXT NOT NULL,
  host_url TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO site_info (id, email, phone, instagram, street, postal_code, city, publisher_name, publisher_role, host_name, host_address, host_url, updated_at)
VALUES (1, 'tnd6tem@gmail.com', '+33 7 81 87 82 23', 'https://www.instagram.com/tnd6tem/', '5 avenue Georges Clemenceau', '67630', 'Lauterbourg',
  'Yannis Metzinger', 'président de l’association', 'GitHub, Inc. — GitHub Pages',
  '88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, États-Unis', 'https://github.com/', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- Traductions des deux textes traduisibles : celles des pages légales d'avant la migration
INSERT OR IGNORE INTO translations (source, lang, text, updated_at) VALUES
  ('président de l’association', 'de', 'Präsident des Vereins', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('président de l’association', 'en', 'president of the association', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, États-Unis', 'de', '88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, USA', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, États-Unis', 'en', '88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, United States', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
