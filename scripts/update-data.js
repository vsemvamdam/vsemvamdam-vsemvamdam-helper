#!/usr/bin/env node
/*
 * Обновляет компактные справочники CS2 в src/data/ из открытой базы ByMykel/CSGO-API (MIT):
 *   stickers.json  — id наклейки -> английское название (для цен наклеек)
 *   keychains.json — id брелока  -> название
 *   skins.json     — "defindex_paintindex" -> [minFloat, maxFloat, фаза?]
 * Запуск: node scripts/update-data.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const BASE = 'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/';
const OUT = path.join(__dirname, '..', 'src', 'data');

async function get(name) {
  const r = await fetch(BASE + name + '.json');
  if (!r.ok) throw new Error(name + ': HTTP ' + r.status);
  return r.json();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const stickers = await get('stickers');
  const st = {};
  for (const s of stickers) {
    const id = String(s.id).replace('sticker-', '');
    if (/^\d+$/.test(id)) st[id] = s.market_hash_name || s.name;
  }
  fs.writeFileSync(path.join(OUT, 'stickers.json'), JSON.stringify(st));

  const keychains = await get('keychains');
  const kc = {};
  for (const k of keychains) {
    const id = String(k.def_index || String(k.id).replace('keychain-', ''));
    if (/^\d+$/.test(id)) kc[id] = k.market_hash_name || k.name;
  }
  fs.writeFileSync(path.join(OUT, 'keychains.json'), JSON.stringify(kc));

  const skins = await get('skins');
  const sk = {};
  for (const s of skins) {
    const w = s.weapon && s.weapon.weapon_id;
    if (w == null || s.paint_index == null) continue;
    const row = [s.min_float ?? 0, s.max_float ?? 1];
    if (s.phase) row.push(s.phase);
    sk[w + '_' + s.paint_index] = row;
  }
  fs.writeFileSync(path.join(OUT, 'skins.json'), JSON.stringify(sk));

  console.log(`stickers: ${Object.keys(st).length}, keychains: ${Object.keys(kc).length}, skins: ${Object.keys(sk).length}`);
})().catch((e) => { console.error(e); process.exit(1); });
