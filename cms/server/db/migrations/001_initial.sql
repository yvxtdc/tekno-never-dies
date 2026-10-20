-- Schéma initial du CMS Tekno Never Dies.
-- Dates : texte ISO 8601 UTC (created_at, updated_at…) ; dates de soirée : AAAA-MM-JJ et HH:MM,
-- heure locale de Paris (fuseau unique du site). Listes simples : JSON dans une colonne TEXT.
-- "version" : verrou optimiste, incrémenté à chaque modification (évite d'écraser le travail
-- d'un autre membre qui a modifié la même fiche entre-temps).

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor')),
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  password_changed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Seule l'empreinte SHA-256 du jeton de session est stockée : une copie de la base ne permet pas
-- de reprendre une session.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  ip TEXT NOT NULL,
  success INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX login_attempts_ip ON login_attempts(ip, created_at);
CREATE INDEX login_attempts_email ON login_attempts(email, created_at);

-- Médias : fichiers importés dans le CMS (storage = 'upload', stockés dans CMS_DATA_DIR/media)
-- ou images déjà présentes dans le dépôt (storage = 'repo', référencées par leur chemin).
CREATE TABLE media (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  storage TEXT NOT NULL CHECK (storage IN ('upload', 'repo')),
  repo_path TEXT UNIQUE,
  file_name TEXT,
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  width INTEGER,
  height INTEGER,
  sha256 TEXT,
  alt TEXT NOT NULL DEFAULT '',
  credit TEXT NOT NULL DEFAULT '',
  -- Variantes déjà présentes dans le dépôt (galerie : vignette, JPEG haute qualité).
  variants TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX media_sha ON media(sha256);

CREATE TABLE venues (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  -- Libellé affiché sur le site (« Salle polyvalente, 81 rue du Rhin, Munchhausen ») ;
  -- vide = nom, adresse et ville assemblés automatiquement.
  public_label TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT 'FR',
  lat REAL,
  lon REAL,
  -- 0 : seule la commune est connue (plan du village, sans repère).
  precise INTEGER NOT NULL DEFAULT 1,
  map_span_km REAL,
  description TEXT NOT NULL DEFAULT '',
  website_url TEXT NOT NULL DEFAULT '',
  access_info TEXT NOT NULL DEFAULT '',
  capacity INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE artists (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  -- Clé de rapprochement du site public ("Dann Octa" -> "dannocta"), unique.
  match_key TEXT NOT NULL UNIQUE,
  photo_media_id INTEGER REFERENCES media(id) ON DELETE RESTRICT,
  styles TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT '',
  instagram_url TEXT NOT NULL DEFAULT '',
  soundcloud_url TEXT NOT NULL DEFAULT '',
  links TEXT NOT NULL DEFAULT '[]',
  contact TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE gallery_albums (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE gallery_photos (
  id INTEGER PRIMARY KEY,
  album_id INTEGER NOT NULL REFERENCES gallery_albums(id) ON DELETE CASCADE,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL,
  UNIQUE (album_id, media_id)
);
CREATE INDEX gallery_photos_album ON gallery_photos(album_id, position);

CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'published', 'cancelled', 'archived')),
  -- Mise en ligne programmée (status = 'scheduled'), ISO UTC.
  publish_at TEXT,
  date TEXT NOT NULL,
  date_precision TEXT NOT NULL DEFAULT 'day' CHECK (date_precision IN ('day', 'month')),
  start_time TEXT,
  end_time TEXT,
  doors_time TEXT,
  timezone TEXT NOT NULL DEFAULT 'Europe/Paris',
  venue_id INTEGER REFERENCES venues(id) ON DELETE RESTRICT,
  price TEXT NOT NULL DEFAULT '',
  age TEXT NOT NULL DEFAULT '',
  ticket_url TEXT NOT NULL DEFAULT '',
  flyer_media_id INTEGER REFERENCES media(id) ON DELETE RESTRICT,
  cover_media_id INTEGER REFERENCES media(id) ON DELETE RESTRICT,
  genres TEXT NOT NULL DEFAULT '[]',
  description TEXT NOT NULL DEFAULT '',
  practical TEXT NOT NULL DEFAULT '[]',
  links TEXT NOT NULL DEFAULT '[]',
  about_kicker TEXT NOT NULL DEFAULT '',
  about_title TEXT NOT NULL DEFAULT '',
  about_text TEXT NOT NULL DEFAULT '',
  gallery_album_id INTEGER REFERENCES gallery_albums(id) ON DELETE SET NULL,
  seo_title TEXT NOT NULL DEFAULT '',
  seo_description TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  first_published_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX events_status_date ON events(status, date);
CREATE INDEX events_venue ON events(venue_id);

CREATE TABLE event_photos (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE RESTRICT,
  caption TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL
);
CREATE INDEX event_photos_event ON event_photos(event_id, position);

-- Passages du line-up : un passage réunit un ou plusieurs artistes (B2B).
CREATE TABLE lineup_slots (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  -- Nom affiché sur cette soirée (ex. écrit comme sur l'affiche) ; vide = noms des fiches artistes.
  label TEXT NOT NULL DEFAULT '',
  -- Style affiché pour ce passage (prioritaire sur le style de la fiche artiste).
  style TEXT NOT NULL DEFAULT '',
  start_time TEXT,
  end_time TEXT,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX lineup_slots_event ON lineup_slots(event_id, position);

CREATE TABLE lineup_slot_artists (
  slot_id INTEGER NOT NULL REFERENCES lineup_slots(id) ON DELETE CASCADE,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL,
  PRIMARY KEY (slot_id, artist_id)
);
CREATE INDEX lineup_slot_artists_artist ON lineup_slot_artists(artist_id);

-- Anciennes adresses d'une soirée renommée : evenement-<old_slug>.html reste valable.
CREATE TABLE event_redirects (
  old_slug TEXT PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE faq_items (
  id INTEGER PRIMARY KEY,
  question TEXT NOT NULL,
  -- Texte enrichi limité (**gras**, *italique*, [lien](adresse)), converti en HTML sûr à l'export.
  answer TEXT NOT NULL,
  category TEXT NOT NULL,
  position INTEGER NOT NULL,
  needs_validation INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE team_members (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  photo_media_id INTEGER REFERENCES media(id) ON DELETE RESTRICT,
  tags TEXT NOT NULL DEFAULT '[]',
  -- Détails affichés sur la carte : [["Rôle", "…"], ["Pôle", "…"]] (ordre conservé).
  extra TEXT NOT NULL DEFAULT '[]',
  bio TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL,
  demo INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Traductions des textes des contenus, comme les dictionnaires js/i18n/de.js et en.js :
-- clé = texte français exact (espaces regroupés).
CREATE TABLE translations (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  lang TEXT NOT NULL CHECK (lang IN ('de', 'en')),
  text TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source, lang)
);

-- Historique des versions (restauration d'une version antérieure).
CREATE TABLE revisions (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX revisions_entity ON revisions(entity_type, entity_id, id);

-- Journal des actions (qui a fait quoi, quand).
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  summary TEXT NOT NULL DEFAULT '',
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX audit_log_created ON audit_log(created_at);
CREATE INDEX audit_log_entity ON audit_log(entity_type, entity_id);

CREATE TABLE publications (
  id INTEGER PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'schedule', 'cli')),
  mode TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  commit_sha TEXT,
  summary TEXT NOT NULL DEFAULT '',
  log TEXT NOT NULL DEFAULT ''
);

-- Liens de prévisualisation partageables (jeton haché, durée limitée).
CREATE TABLE preview_tokens (
  id TEXT PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
