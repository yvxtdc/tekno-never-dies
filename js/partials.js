async function include(el) {
  const url = el.getAttribute("data-include");
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    el.outerHTML = await res.text();
  } catch (err) {
    console.error(`Impossible de charger ${url}`, err);
  }
}

function markActiveLink() {
  const page = document.body.dataset.page;
  if (page) document.querySelectorAll(`[data-nav="${page}"]`).forEach(a => a.classList.add("active"));
}

function initMenu() {
  const button = document.querySelector(".menu-toggle");
  const nav = document.querySelector("#main-navigation");
  if (!button || !nav) return;

  const close = () => {
    button.setAttribute("aria-expanded", "false");
    nav.classList.remove("is-open");
  };

  button.addEventListener("click", () => {
    const open = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!open));
    nav.classList.toggle("is-open", !open);
  });

  nav.querySelectorAll("a").forEach(a => a.addEventListener("click", close));
  document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
}

const nodes = [...document.querySelectorAll("[data-include]")];
Promise.all(nodes.map(include)).then(() => {
  markActiveLink();
  initMenu();
});
