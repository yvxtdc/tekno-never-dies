// « Le prochain rendez-vous » : rempli depuis js/data/events.js pour ne jamais afficher une date passée.
import { EVENTS } from "../data/events.js";
import { eventStatus, formatDate, formatTime, esc } from "./helpers.js";
import { t, tr } from "../i18n/i18n.js";

const text = document.getElementById("next-event-text");
const link = document.getElementById("next-event-link");
const next = EVENTS
  .filter((ev) => eventStatus(ev) === "a-venir")
  .sort((a, b) => a.date.localeCompare(b.date))[0];

if (text && link) {
  if (next) {
    const start = next.time?.match(/\d{1,2}h\d{2}/)?.[0];
    const details = [next.price && t("Entrée {price}", { price: tr(next.price) }), next.age && tr(next.age)].filter(Boolean).join(" · ");
    // Phrase déjà traduite ici (elle contient des valeurs) : le traducteur automatique la laisse telle quelle.
    text.setAttribute("translate", "no");
    text.innerHTML = t("La prochaine date annoncée est {title}, le {date}{time}{place}.", {
      title: `<strong>${esc(next.title)}</strong>`,
      date: esc(formatDate(next.date, next.datePrecision)),
      time: start ? ` ${esc(t("à {time}", { time: formatTime(start) }))}` : "",
      place: next.place ? `, ${esc(next.place)}` : ""
    }) + (details ? ` ${esc(details)}.` : "");
    link.href = `evenement.html?slug=${encodeURIComponent(next.slug)}`;
    link.textContent = "Voir la soirée";
  } else {
    text.setAttribute("translate", "no");
    text.textContent = tr("La prochaine date sera annoncée ici et sur Instagram @tnd6tem dès qu'elle sera confirmée.");
    link.href = "evenements.html";
    link.textContent = "Voir les événements";
  }
}

/* ---------- « Ce qui nous porte » : halo sous la souris, carte allumée au défilement sur téléphone ---------- */
const pillars = document.querySelectorAll(".pillars__list li");
if (matchMedia("(hover: hover) and (pointer: fine)").matches) {
  pillars.forEach((card) => card.addEventListener("pointermove", (event) => {
    const r = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${event.clientX - r.left}px`);
    card.style.setProperty("--my", `${event.clientY - r.top}px`);
  }));
} else if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => entries.forEach((entry) => entry.target.classList.toggle("is-active", entry.isIntersecting)),
    { rootMargin: "-40% 0px -40% 0px" } // bande centrale de l'écran
  );
  pillars.forEach((card) => observer.observe(card));
}
