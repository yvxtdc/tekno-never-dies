const ICE_BOILER_PHOTO_PREFIX = "assets/img/gallery/2025/ice-boiler/";
const ICE_BOILER_PHOTO_CREDIT = "Crédit photo : Jennifer Samtmann (Nebula Studio)";

export function photoCreditFor(src) {
  return src?.startsWith(ICE_BOILER_PHOTO_PREFIX) ? ICE_BOILER_PHOTO_CREDIT : "";
}
