import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";


/* ============================================================
   CONFIGURATION
   ============================================================ */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "..");

const EVENTS_FILE = path.join(ROOT, "js", "data", "evenements.js");

const CALENDAR_DIR = path.join(ROOT, "calendar");
const ICS_FILE = path.join(CALENDAR_DIR, "events.ics");
const STATE_FILE = path.join(CALENDAR_DIR, ".event-state.json");

const CALENDAR_NAME = "Tekno Never Dies";
const CALENDAR_DESCRIPTION = "Événements officiels Tekno Never Dies";
const CALENDAR_DOMAIN = "tekno-never-dies.fr";

const DEFAULT_TIMEZONE = "Europe/Paris";


/* ============================================================
   UTILITAIRES
   ============================================================ */

function escapeICS(value = "") {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}


/*
 * Les lignes iCalendar sont normalement limitées à 75 octets.
 * Cette fonction coupe proprement les longues lignes.
 */
function foldICSLine(line) {
  const MAX_BYTES = 75;

  if (Buffer.byteLength(line, "utf8") <= MAX_BYTES) {
    return line;
  }

  const lines = [];
  let current = "";

  for (const char of line) {
    const candidate = current + char;

    if (Buffer.byteLength(candidate, "utf8") > MAX_BYTES) {
      lines.push(current);
      current = " " + char;
    } else {
      current = candidate;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.join("\r\n");
}


function formatUTC(date) {
  return (
    date.getUTCFullYear().toString().padStart(4, "0") +
    (date.getUTCMonth() + 1).toString().padStart(2, "0") +
    date.getUTCDate().toString().padStart(2, "0") +
    "T" +
    date.getUTCHours().toString().padStart(2, "0") +
    date.getUTCMinutes().toString().padStart(2, "0") +
    date.getUTCSeconds().toString().padStart(2, "0") +
    "Z"
  );
}


function formatLocalDateTime(value) {
  const match = String(value).match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
  );

  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second = "00"] = match;

  return `${year}${month}${day}T${hour}${minute}${second}`;
}


function formatDateOnly(value) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  return `${match[1]}${match[2]}${match[3]}`;
}


/*
 * Accepte :
 *
 * 2026-10-31
 *
 * 2026-10-31T21:00:00
 *
 * 2026-10-31T21:00:00+01:00
 *
 * 2026-10-31T20:00:00Z
 */
function makeDateProperty(property, value, timezone = DEFAULT_TIMEZONE) {
  if (!value) {
    return null;
  }

  const stringValue = String(value);

  // Journée entière
  const dateOnly = formatDateOnly(stringValue);

  if (dateOnly) {
    return `${property};VALUE=DATE:${dateOnly}`;
  }

  // Heure locale sans timezone explicite
  const local = formatLocalDateTime(stringValue);

  if (local) {
    return `${property};TZID=${timezone}:${local}`;
  }

  // Date avec offset ou Z
  const date = new Date(stringValue);

  if (Number.isNaN(date.getTime())) {
    throw new Error(
      `Date invalide pour ${property} : "${stringValue}"`
    );
  }

  return `${property}:${formatUTC(date)}`;
}


function normalizeStatus(status) {
  const value = String(status ?? "confirmed").toLowerCase();

  switch (value) {
    case "cancelled":
    case "canceled":
    case "annule":
    case "annulé":
      return "CANCELLED";

    case "tentative":
    case "provisional":
      return "TENTATIVE";

    default:
      return "CONFIRMED";
  }
}


function createHash(data) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(data))
    .digest("hex");
}


/* ============================================================
   CHARGEMENT DES ÉVÉNEMENTS
   ============================================================ */

async function loadEvents() {
  const moduleUrl =
    pathToFileURL(EVENTS_FILE).href + `?cache=${Date.now()}`;

  const module = await import(moduleUrl);

  const events =
    module.EVENTS ??
    module.events ??
    module.EVENEMENTS ??
    module.evenements ??
    module.default;

  if (!Array.isArray(events)) {
    throw new Error(
      [
        "Impossible de trouver le tableau des événements.",
        "",
        "Le fichier js/data/evenements.js doit exporter par exemple :",
        "",
        "export const EVENTS = [...]",
        "",
        "ou :",
        "",
        "export default [...]",
      ].join("\n")
    );
  }

  return events;
}


/* ============================================================
   NORMALISATION
   ============================================================ */

function parseTimeRange(date, time) {
  if (!date || !time) {
    return {
      start: date,
      end: null,
    };
  }

  /*
   * Formats acceptés :
   *
   * 22h00 – 5h00
   * 22h00 - 5h00
   * 22h – 5h
   * 14h00 – 19h00
   */

  const matches = String(time).match(
    /(\d{1,2})h(\d{2})?\s*[–—-]\s*(\d{1,2})h(\d{2})?/i
  );

  if (!matches) {
    console.warn(
      `⚠️ Heure non reconnue : "${time}". ` +
      `L'événement sera exporté sans heure de fin précise.`
    );

    return {
      start: date,
      end: null,
    };
  }

  const startHour = Number(matches[1]);
  const startMinute = Number(matches[2] ?? 0);

  const endHour = Number(matches[3]);
  const endMinute = Number(matches[4] ?? 0);

  const start =
    `${date}T` +
    `${String(startHour).padStart(2, "0")}:` +
    `${String(startMinute).padStart(2, "0")}:00`;

  /*
   * Calcul de la date de fin.
   *
   * Si :
   *
   * début = 22h
   * fin   = 05h
   *
   * alors l'événement finit le lendemain.
   */

  let endDate = date;

  const startTotal = startHour * 60 + startMinute;
  const endTotal = endHour * 60 + endMinute;

  if (endTotal <= startTotal) {
    const [year, month, day] = date
      .split("-")
      .map(Number);

    const nextDay = new Date(
      Date.UTC(year, month - 1, day + 1)
    );

    endDate =
      `${nextDay.getUTCFullYear()}-` +
      `${String(nextDay.getUTCMonth() + 1).padStart(2, "0")}-` +
      `${String(nextDay.getUTCDate()).padStart(2, "0")}`;
  }

  const end =
    `${endDate}T` +
    `${String(endHour).padStart(2, "0")}:` +
    `${String(endMinute).padStart(2, "0")}:00`;

  return {
    start,
    end,
  };
}


function normalizeEvent(event, index) {
  const id =
    event.slug ??
    event.id ??
    event.uid;

  const title =
    event.title ??
    event.name ??
    event.nom;

  if (!id) {
    throw new Error(
      `Événement #${index + 1} : "slug" manquant.`
    );
  }

  if (!title) {
    throw new Error(
      `Événement "${id}" : "title" manquant.`
    );
  }

  if (!event.date) {
    throw new Error(
      `Événement "${id}" : "date" manquante.`
    );
  }

  const {
    start,
    end,
  } = parseTimeRange(
    event.date,
    event.time
  );

  /*
   * Ton statut du SITE ("a-venir" / "passe")
   * n'est pas le statut iCalendar.
   *
   * Un événement passé reste CONFIRMED.
   *
   * On utilisera éventuellement "cancelled"
   * pour une vraie annulation.
   */

  let calendarStatus = "CONFIRMED";

  if (
    event.cancelled === true ||
    event.status === "annule" ||
    event.status === "annulé" ||
    event.status === "cancelled"
  ) {
    calendarStatus = "CANCELLED";
  }

  return {
    id: String(id),

    title: String(title),

    start,

    end,

    timezone: "Europe/Paris",

    location:
      event.place ?? "",

    description:
      event.description ?? "",

    url:
      event.ticketUrl ?? "",

    status:
      calendarStatus,

    siteStatus:
      event.status,

    demo:
      event.demo === true,
  };
}


/* ============================================================
   ÉTAT / SEQUENCE
   ============================================================ */

async function loadState() {
  try {
    const content = await fs.readFile(STATE_FILE, "utf8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}


async function saveState(state) {
  await fs.writeFile(
    STATE_FILE,
    JSON.stringify(state, null, 2) + "\n",
    "utf8"
  );
}


/*
 * SEQUENCE est importante pour les calendriers abonnés.
 *
 * Si un événement change :
 *
 * 0 → 1 → 2 → 3...
 *
 * Apple / Outlook peuvent ainsi comprendre qu'une nouvelle
 * version de l'événement existe.
 */
function updateEventState(event, previousState) {
  const fingerprintData = {
    title: event.title,
    start: event.start,
    end: event.end,
    timezone: event.timezone,
    location: event.location,
    description: event.description,
    url: event.url,
    status: event.status,
  };

  const hash = createHash(fingerprintData);

  const previous = previousState[event.id];

  // Premier passage
  if (!previous) {
    return {
      sequence: 0,
      hash,
      lastModified: formatUTC(new Date()),
    };
  }

  // Aucun changement
  if (previous.hash === hash) {
    return previous;
  }

  // L'événement a changé
  return {
    sequence: Number(previous.sequence ?? 0) + 1,
    hash,
    lastModified: formatUTC(new Date()),
  };
}


/* ============================================================
   GÉNÉRATION D'UN VEVENT
   ============================================================ */

function generateEvent(event, state) {
  const uid = `${event.id}@${CALENDAR_DOMAIN}`;

  const lines = [
    "BEGIN:VEVENT",

    `UID:${escapeICS(uid)}`,

    `DTSTAMP:${formatUTC(new Date())}`,

    `LAST-MODIFIED:${state.lastModified}`,

    `SEQUENCE:${state.sequence}`,

    makeDateProperty(
      "DTSTART",
      event.start,
      event.timezone
    ),

    event.end
      ? makeDateProperty(
          "DTEND",
          event.end,
          event.timezone
        )
      : null,

    `SUMMARY:${escapeICS(event.title)}`,

    event.location
      ? `LOCATION:${escapeICS(event.location)}`
      : null,

    event.description
      ? `DESCRIPTION:${escapeICS(event.description)}`
      : null,

    event.url
      ? `URL:${escapeICS(event.url)}`
      : null,

    `STATUS:${event.status}`,

    "END:VEVENT",
  ];

  return lines
    .filter(Boolean)
    .map(foldICSLine)
    .join("\r\n");
}


/* ============================================================
   CALENDRIER COMPLET
   ============================================================ */

function generateCalendar(events, states) {
  const header = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//Tekno Never Dies//Calendrier événements//FR`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",

    `X-WR-CALNAME:${escapeICS(CALENDAR_NAME)}`,

    `X-WR-CALDESC:${escapeICS(CALENDAR_DESCRIPTION)}`,

    `X-WR-TIMEZONE:${DEFAULT_TIMEZONE}`,

    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];

  const body = events.map((event) =>
    generateEvent(event, states[event.id])
  );

  const footer = [
    "END:VCALENDAR",
  ];

  return [
    ...header,
    ...body,
    ...footer,
  ].join("\r\n") + "\r\n";
}


/* ============================================================
   MAIN
   ============================================================ */

async function main() {
  console.log("📅 Génération du calendrier TND...");

  await fs.mkdir(CALENDAR_DIR, {
    recursive: true,
  });

  const rawEvents = await loadEvents();

  const events = rawEvents.map(
    normalizeEvent
  );

  /*
   * Empêche deux événements d'avoir le même UID.
   */
  const ids = new Set();

  for (const event of events) {
    if (ids.has(event.id)) {
      throw new Error(
        `ID d'événement dupliqué : "${event.id}"`
      );
    }

    ids.add(event.id);
  }

  const previousState = await loadState();

  const newState = {};

  for (const event of events) {
    newState[event.id] = updateEventState(
      event,
      previousState
    );
  }

  const calendar = generateCalendar(
    events,
    newState
  );

  await fs.writeFile(
    ICS_FILE,
    calendar,
    "utf8"
  );

  await saveState(newState);

  console.log(
    `✅ ${events.length} événement(s) exporté(s)`
  );

  console.log(
    `📄 ${path.relative(ROOT, ICS_FILE)}`
  );
}


main().catch((error) => {
  console.error("");
  console.error("❌ Erreur calendrier");
  console.error(error);
  console.error("");

  process.exit(1);
});