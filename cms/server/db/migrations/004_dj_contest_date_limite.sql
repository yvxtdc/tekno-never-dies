-- DJ Contest d'ICE BOILER v2 : date limite d'envoi des sets le 4 novembre 2026 (et non le 15,
-- valeur provisoire de la migration 003). Ne change rien si la date a déjà été modifiée dans le CMS.
UPDATE events SET contest = json_set(contest, '$.deadline', '2026-11-04'), version = version + 1,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE slug = 'ice-boiler-v2-2026' AND json_extract(contest, '$.deadline') = '2026-11-15';
