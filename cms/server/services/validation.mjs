/**
 * Validation côté serveur des données envoyées par l'interface. Chaque méthode lit un champ,
 * le nettoie et enregistre un message d'erreur en français si la valeur est invalide.
 * L'interface valide aussi en direct, mais seul ce contrôle fait foi.
 */
import { ValidationError } from "../http/errors.mjs";

// Caractères de contrôle interdits (sauf tabulation et retour à la ligne).
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

// Espaces regroupés sur une ligne, sauf les espaces insécables de la typographie française (« bénévole ? ») :
// un texte relu puis réenregistré reste identique.
export const cleanText = (value, { multiline = false } = {}) => {
  let text = String(value ?? "").replace(CONTROL, "").replace(/\r\n?/g, "\n");
  text = multiline ? text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n") : text.replace(/[^\S\u00a0\u202f]+/g, " ");
  return text.trim();
};

export function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d && y >= 2000 && y <= 2100;
}

export const isValidTime = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

/** Adresse web http(s) valide (ou "" si vide) ; sinon null. */
export function normalizeUrl(value, { httpsOnly = false } = {}) {
  const text = cleanText(value);
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && (httpsOnly || url.protocol !== "http:")) return null;
    if (!url.hostname.includes(".")) return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Utilisation : `const v = new Validator(input)`, une lecture par champ (`v.text("title", { required: true })`),
 * puis `v.throwIfErrors()` (erreur 422 avec les messages par champ) avant d'utiliser les valeurs.
 * Une lecture invalide n'interrompt rien : elle enregistre le premier message du champ et renvoie undefined
 * (ou [] pour les listes). Un champ absent de l'entrée renvoie sa valeur par défaut, sans erreur s'il
 * n'est pas obligatoire : le service qui appelle décide si l'absence vaut « inchangé » ou « vide ».
 */
export class Validator {
  constructor(input) {
    this.input = input && typeof input === "object" ? input : {};
    this.errors = {};
  }

  has(field) {
    return Object.prototype.hasOwnProperty.call(this.input, field);
  }

  error(field, message) {
    if (!this.errors[field]) this.errors[field] = message;
    return undefined;
  }

  text(field, { required = false, max = 200, min = 0, multiline = false, label = "Ce champ", fallback = "" } = {}) {
    if (!this.has(field) && !required) return fallback;
    const raw = this.input[field];
    if (raw != null && typeof raw !== "string" && typeof raw !== "number") return this.error(field, `${label} doit être un texte.`);
    const value = cleanText(raw, { multiline });
    if (required && !value) return this.error(field, `${label} est obligatoire.`);
    if (value && value.length < min) return this.error(field, `${label} doit contenir au moins ${min} caractères.`);
    if (value.length > max) return this.error(field, `${label} ne doit pas dépasser ${max} caractères (actuellement ${value.length}).`);
    return value;
  }

  bool(field, fallback = false) {
    if (!this.has(field)) return fallback;
    const v = this.input[field];
    return v === true || v === 1 || v === "1" || v === "true" || v === "on";
  }

  int(field, { required = false, min = -Infinity, max = Infinity, label = "Ce nombre", fallback = null } = {}) {
    const raw = this.input[field];
    if (raw === undefined || raw === null || raw === "") {
      if (required) return this.error(field, `${label} est obligatoire.`);
      return fallback;
    }
    const n = Number(raw);
    if (!Number.isInteger(n)) return this.error(field, `${label} doit être un nombre entier.`);
    if (n < min || n > max) return this.error(field, `${label} doit être compris entre ${min} et ${max}.`);
    return n;
  }

  number(field, { required = false, min = -Infinity, max = Infinity, label = "Ce nombre" } = {}) {
    const raw = this.input[field];
    if (raw === undefined || raw === null || raw === "") {
      if (required) return this.error(field, `${label} est obligatoire.`);
      return null;
    }
    const n = Number(String(raw).replace(",", "."));
    if (!Number.isFinite(n)) return this.error(field, `${label} doit être un nombre.`);
    if (n < min || n > max) return this.error(field, `${label} doit être compris entre ${min} et ${max}.`);
    return n;
  }

  id(field, { required = false, label = "Cet élément" } = {}) {
    return this.int(field, { required, min: 1, max: 1e12, label });
  }

  oneOf(field, values, { fallback, label = "Cette valeur" } = {}) {
    if (!this.has(field)) return fallback;
    const v = this.input[field];
    if (!values.includes(v)) return this.error(field, `${label} n'est pas valide.`);
    return v;
  }

  date(field, { required = false, label = "La date" } = {}) {
    const v = cleanText(this.input[field]);
    if (!v) return required ? this.error(field, `${label} est obligatoire.`) : null;
    if (!isValidDate(v)) return this.error(field, `${label} doit être une date valide (AAAA-MM-JJ).`);
    return v;
  }

  time(field, { required = false, label = "L'heure" } = {}) {
    const v = cleanText(this.input[field]);
    if (!v) return required ? this.error(field, `${label} est obligatoire.`) : null;
    if (!isValidTime(v)) return this.error(field, `${label} doit être au format HH:MM.`);
    return v;
  }

  datetime(field, { required = false, label = "La date et l'heure" } = {}) {
    const v = cleanText(this.input[field]);
    if (!v) return required ? this.error(field, `${label} est obligatoire.`) : null;
    const t = Date.parse(v);
    if (!Number.isFinite(t)) return this.error(field, `${label} n'est pas valide.`);
    return new Date(t).toISOString();
  }

  url(field, { httpsOnly = false, label = "L'adresse" } = {}) {
    if (!this.has(field)) return "";
    const v = normalizeUrl(this.input[field], { httpsOnly });
    if (v === null) return this.error(field, `${label} doit être une adresse web complète${httpsOnly ? " en https://" : " (https://…)"}.`);
    return v;
  }

  email(field, { required = false, label = "L'adresse e-mail" } = {}) {
    const v = cleanText(this.input[field]).toLowerCase();
    if (!v) return required ? this.error(field, `${label} est obligatoire.`) : "";
    if (v.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return this.error(field, `${label} n'est pas valide.`);
    return v;
  }

  slug(field, { required = false, label = "L'identifiant d'adresse" } = {}) {
    const v = cleanText(this.input[field]).toLowerCase();
    if (!v) return required ? this.error(field, `${label} est obligatoire.`) : "";
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v) || v.length > 80) {
      return this.error(field, `${label} ne peut contenir que des lettres minuscules sans accent, des chiffres et des tirets (80 caractères maximum).`);
    }
    return v;
  }

  /** Liste de textes courts (styles, infos pratiques…). */
  list(field, { maxItems = 20, maxLength = 200, label = "Cette liste" } = {}) {
    if (!this.has(field)) return [];
    const raw = this.input[field];
    if (!Array.isArray(raw)) return this.error(field, `${label} n'est pas valide.`) ?? [];
    const items = raw.map((x) => cleanText(x)).filter(Boolean);
    if (items.length > maxItems) return this.error(field, `${label} : ${maxItems} éléments maximum.`) ?? [];
    const tooLong = items.find((x) => x.length > maxLength);
    if (tooLong) return this.error(field, `${label} : chaque élément doit faire au plus ${maxLength} caractères.`) ?? [];
    return items;
  }

  /** Liens [{ label, url }]. */
  links(field, { maxItems = 8, label = "Les liens" } = {}) {
    if (!this.has(field)) return [];
    const raw = this.input[field];
    if (!Array.isArray(raw)) return this.error(field, `${label} ne sont pas valides.`) ?? [];
    const out = [];
    for (const [i, item] of raw.entries()) {
      const text = cleanText(item?.label);
      const url = normalizeUrl(item?.url);
      if (!text && !cleanText(item?.url)) continue;
      if (!text || text.length > 60) return this.error(field, `Lien ${i + 1} : le libellé est obligatoire (60 caractères maximum).`) ?? [];
      if (!url) return this.error(field, `Lien ${i + 1} : l'adresse doit commencer par https://.`) ?? [];
      out.push({ label: text, url });
    }
    if (out.length > maxItems) return this.error(field, `${label} : ${maxItems} maximum.`) ?? [];
    return out;
  }

  get ok() {
    return Object.keys(this.errors).length === 0;
  }

  throwIfErrors() {
    if (!this.ok) throw new ValidationError(this.errors);
  }
}
