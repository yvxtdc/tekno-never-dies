import { FAQ } from "../data/faq.js";
import { esc } from "./helpers.js";

// Les réponses (x.a) peuvent contenir des liens <a> écrits dans js/data/faq.js : elles restent en HTML.
document.querySelector("#faq").innerHTML = FAQ.map(
  (x) => `<details><summary>${esc(x.q)}${x.needsValidation ? ' <span class="demo-label">À CONFIRMER</span>' : ""}</summary><p>${x.a}</p></details>`
).join("");
