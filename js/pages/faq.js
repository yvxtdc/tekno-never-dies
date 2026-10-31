import { FAQ } from "../data/faq.js";
import { esc } from "./helpers.js";

// Les réponses (x.a) sont du HTML (liens, gras) produit par le CMS depuis sa syntaxe de texte enrichi
// (cms/server/services/richtext.mjs, qui n'accepte aucun HTML saisi) : elles sont insérées telles quelles.
// "needsValidation" n'est pas affiché au public : npm run validate liste ces réponses à faire relire.
document.querySelector("#faq").innerHTML = FAQ.map(
  (x) => `<details><summary>${esc(x.q)}</summary><p>${x.a}</p></details>`
).join("");
