/** Chiffres clés d'une soirée, tirés de js/data/events.js : utilisés par la fiche et la liste des soirées. */
import { artistsOf } from "./artists.js";
import { eventTimes } from "../pages/ics.js";

export function eventStats(ev) {
  const times = ev.datePrecision !== "month" && ev.time ? eventTimes(ev) : null;
  const ms = ({ y, mo, d, h = 0, mi = 0 }) => Date.UTC(y, mo - 1, d, h, mi);
  return {
    // Durée en heures, à la demi-heure près (« 21h00 – 4h00 » → 7)
    hours: times && !times.allDay ? Math.round(((ms(times.end) - ms(times.start)) / 36e5) * 2) / 2 : null,
    // DJ différents du line-up (un B2B compte pour deux)
    djs: new Set((ev.lineup || []).flatMap((slot) => artistsOf(slot.name || ""))).size || null,
    // Fréquentation, si une info pratique la donne (« 250 participant·es »)
    crowd: (ev.practical || []).map((item) => item.match(/(\d+)\s*participant/i)?.[1]).find(Boolean) || null
  };
}
