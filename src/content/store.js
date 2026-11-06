/*
 * vsemvamdam-Steam-Helper — магазин Steam: цены игры в разных регионах
 * с пересчётом в одну валюту и быстрые ссылки на SteamDB / IsThereAnyDeal.
 */
(function () {
  'use strict';
  const VH = globalThis.VH;
  const h = VH.h;
  const C = VH.currency;
  const m = location.pathname.match(/^\/app\/(\d+)/);
  if (!m) return;
  const appid = m[1];

  const NAMES = { US: 'США', RU: 'Россия', KZ: 'Казахстан', TR: 'Турция', AR: 'Аргентина', UA: 'Украина', PL: 'Польша', BR: 'Бразилия',
    IN: 'Индия', CN: 'Китай', DE: 'Европа', GB: 'Великобритания', JP: 'Япония', CA: 'Канада', AU: 'Австралия', KR: 'Корея', MX: 'Мексика' };

  async function run() {
    const host = document.querySelector('#game_area_purchase') || document.querySelector('.game_area_purchase_game_wrapper');
    if (!host) return;
    const pageCur = (document.querySelector('meta[itemprop="priceCurrency"]') || {}).content;
    const target = VH.cfg.currency && VH.cfg.currency !== 'auto' ? VH.cfg.currency : (pageCur || 'USD');
    const body = h('div', { class: 'vh-mutetext' }, 'Загружаю цены регионов…');
    const box = h('div', { class: 'vh-profile-box' },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' } },
        h('span', { class: 'vh-logo' }, 'vh'), h('b', {}, 'Цены в регионах'),
        h('span', { style: { marginLeft: 'auto', display: 'flex', gap: '10px' } },
          h('a', { href: `https://steamdb.info/app/${appid}/`, target: '_blank', rel: 'noopener noreferrer' }, 'SteamDB'),
          h('a', { href: `https://isthereanydeal.com/steam/app/${appid}/`, target: '_blank', rel: 'noopener noreferrer' }, 'IsThereAnyDeal'))),
      body);
    host.prepend(box);
    try {
      const res = await VH.send('regional', { appid, regions: VH.cfg.storeRegions });
      const rows = Object.entries(res).filter(([, v]) => v).map(([cc, v]) => ({ cc, v, conv: C.convert(v.final, v.currency, target, VH.rates) }));
      if (!rows.length) { body.textContent = 'Игра бесплатная или цены недоступны'; return; }
      const min = Math.min(...rows.filter((r) => r.conv != null).map((r) => r.conv));
      rows.sort((a, b) => (a.conv ?? 1e12) - (b.conv ?? 1e12));
      const t = h('table', { class: 'vh-region' });
      for (const r of rows) {
        t.append(h('tr', { class: r.conv === min ? 'vh-cheapest' : '' },
          h('td', {}, NAMES[r.cc] || r.cc),
          h('td', { style: { textAlign: 'right' } }, C.format(r.v.final, r.v.currency), r.v.discount ? ` −${r.v.discount}%` : ''),
          h('td', { style: { textAlign: 'right', fontWeight: '600' } }, r.conv != null ? C.format(r.conv, target) : '—')));
      }
      body.replaceWith(t);
    } catch (e) {
      body.textContent = 'Не удалось загрузить: ' + e.message;
    }
  }

  VH.ready.then(run);
})();
