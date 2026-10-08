import { FAQ } from "../data/faq.js";
import { esc } from "./helpers.js";

// Les réponses (x.a) peuvent contenir des liens <a> écrits dans js/data/faq.js : elles restent en HTML.
// "needsValidation" n'est pas affiché au public : npm run validate liste ces réponses à faire relire.
document.querySelector("#faq").innerHTML = FAQ.map(
  (x) => `<details><summary>${esc(x.q)}</summary><p>${x.a}</p></details>`
).join("");
