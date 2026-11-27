/**
 * Infos de l'association (table site_info, une ligne, migration 008) : coordonnées, responsable de
 * publication, hébergeur. Exportées dans js/data/association.js (exportInfo), écrites dans les pages par
 * tools/sync-infos.mjs, dont les mentions légales : modification réservée aux administrateurs (route).
 * La fonction du responsable et l'adresse de l'hébergeur sont en français, traduites dans l'écran
 * Traductions (infoTranslatableTexts).
 */
import { now } from "../db/index.mjs";
import { conflict, notFound } from "../http/errors.mjs";
import { Validator } from "./validation.mjs";

const row = (db) => {
  const r = db.get("SELECT * FROM site_info WHERE id = 1");
  if (!r) throw notFound("Infos de l'association introuvables (migration 008 non appliquée ?).");
  return r;
};

/** Pour l'interface : champs à plat, version (verrou optimiste). */
export function getSiteInfo(db) {
  const r = row(db);
  return {
    email: r.email, phone: r.phone, instagram: r.instagram,
    street: r.street, postalCode: r.postal_code, city: r.city,
    publisherName: r.publisher_name, publisherRole: r.publisher_role,
    hostName: r.host_name, hostAddress: r.host_address, hostUrl: r.host_url,
    version: r.version, updatedAt: r.updated_at
  };
}

/** Format de js/data/association.js (lu par js/data/site.js et js/components/association-info.js). */
export function exportInfo(db) {
  const r = row(db);
  return {
    email: r.email,
    phone: r.phone,
    instagram: r.instagram,
    address: { street: r.street, postalCode: r.postal_code, city: r.city },
    publisher: { name: r.publisher_name, role: r.publisher_role },
    host: { name: r.host_name, address: r.host_address, url: r.host_url }
  };
}

/** Textes français à traduire (fonction du responsable, adresse de l'hébergeur). */
export const infoTranslatableTexts = (db) => {
  const r = row(db);
  return [r.publisher_role, r.host_address];
};

function validate(input) {
  const v = new Validator(input);
  const text = (field, label, max = 120) => v.text(field, { required: true, max, label });
  const data = {
    email: v.email("email", { required: true, label: "L'adresse e-mail" }),
    phone: v.text("phone", { max: 30, label: "Le téléphone" }),
    instagram: v.url("instagram", { httpsOnly: true, label: "Le compte Instagram" }),
    street: text("street", "La rue du siège"),
    postal_code: text("postalCode", "Le code postal", 10),
    city: text("city", "La ville", 80),
    publisher_name: text("publisherName", "Le nom du responsable de publication", 80),
    publisher_role: text("publisherRole", "Sa fonction", 120),
    host_name: text("hostName", "Le nom de l'hébergeur"),
    host_address: text("hostAddress", "L'adresse de l'hébergeur", 200),
    host_url: v.url("hostUrl", { httpsOnly: true, label: "Le site de l'hébergeur" })
  };
  if (data.phone && !/^\+?[\d .()-]{6,}$/.test(data.phone)) v.error("phone", "Le téléphone ne doit contenir que des chiffres, espaces et « + » (ex. +33 7 81 87 82 23).");
  if (data.instagram && !/^https:\/\/(www\.)?instagram\.com\/[\w.]+\/?$/i.test(data.instagram)) v.error("instagram", "Adresse d'un compte Instagram attendue (https://www.instagram.com/nom/).");
  if (!data.host_url && !v.errors.hostUrl) v.error("hostUrl", "Le site de l'hébergeur est obligatoire (mentions légales).");
  if (!data.instagram && !v.errors.instagram) v.error("instagram", "Le compte Instagram est obligatoire (lien du menu et du pied de page).");
  v.throwIfErrors();
  return data;
}

export function updateSiteInfo(db, input, user) {
  const current = row(db);
  if (input.version !== undefined && Number(input.version) !== current.version) {
    throw conflict("Ces infos ont été modifiées entre-temps. Rechargez la page.", { stale: true });
  }
  const d = validate(input);
  db.run(
    `UPDATE site_info SET email = ?, phone = ?, instagram = ?, street = ?, postal_code = ?, city = ?, publisher_name = ?, publisher_role = ?,
       host_name = ?, host_address = ?, host_url = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = 1`,
    d.email, d.phone, d.instagram, d.street, d.postal_code, d.city, d.publisher_name, d.publisher_role,
    d.host_name, d.host_address, d.host_url, user?.id ?? null, now()
  );
  return getSiteInfo(db);
}

/** Import initial (js/data/association.js) : remplace les valeurs de départ, sans contrôle de version. */
export function importInfo(db, a) {
  db.run(
    `UPDATE site_info SET email = ?, phone = ?, instagram = ?, street = ?, postal_code = ?, city = ?, publisher_name = ?, publisher_role = ?,
       host_name = ?, host_address = ?, host_url = ?, updated_at = ? WHERE id = 1`,
    a.email, a.phone || "", a.instagram || "", a.address.street, a.address.postalCode, a.address.city,
    a.publisher.name, a.publisher.role, a.host.name, a.host.address, a.host.url, now()
  );
}
