/*
 * vsemvamdam-Steam-Helper — профиль Steam: идентификаторы, полезные ссылки,
 * стоимость CS2-инвентаря владельца профиля.
 */
(function () {
  'use strict';
  const VH = globalThis.VH;
  const h = VH.h;
  if (!/^\/(id|profiles)\/[^/]+\/?$/.test(location.pathname)) return;

  function steamId3(id64) {
    return '[U:1:' + (BigInt(id64) - 76561197960265728n).toString() + ']';
  }

  async function run() {
    const p = VH.state.profile;
    const id = p && p.steamid;
    if (!id) return;
    const col = document.querySelector('.profile_rightcol') || document.querySelector('.profile_content');
    if (!col) return;

    const valueEl = h('div', { class: 'vh-mutetext' });
    const calc = VH.btn('Посчитать стоимость CS2-инвентаря', async () => {
      calc.disabled = true;
      valueEl.textContent = 'Загружаю инвентарь…';
      try {
        const items = await VH.fetchInventory(id, 730, '2', (n, t) => { valueEl.textContent = `Загружаю ${n}/${t || '?'}…`; });
        await VH.loadPrices(730, [...new Set(items.map((i) => i.name))]);
        let sum = 0;
        const priced = items.map((it) => ({ it, p: (VH.priceOf(730, it.name) || 0) * (it.amount || 1) }));
        priced.forEach((x) => { sum += x.p; });
        priced.sort((a, b) => b.p - a.p);
        valueEl.textContent = '';
        valueEl.append(h('div', {}, h('b', { style: { color: 'var(--vh-cream)', fontSize: '15px' } }, VH.money(sum)), ` · ${items.length} предметов · ${VH.settings.PROVIDERS[VH.cfg.mainProvider].title}`));
        for (const x of priced.slice(0, 5)) {
          valueEl.append(h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px', marginTop: '3px' } },
            h('span', { style: { color: x.it.color ? '#' + x.it.color : '' } }, x.it.display || x.it.name), h('span', {}, VH.money(x.p))));
        }
      } catch (e) {
        valueEl.textContent = e.message;
      } finally {
        calc.disabled = false;
      }
    });

    const links = [
      ['csstats.gg', `https://csstats.gg/player/${id}`],
      ['Leetify', `https://leetify.com/app/profile/${id}`],
      ['FACEIT', `https://faceitfinder.com/profile/${id}`],
      ['SteamDB', `https://steamdb.info/calculator/${id}/`],
      ['SteamID.io', `https://steamid.io/lookup/${id}`],
      ['Инвентарь', `https://steamcommunity.com/profiles/${id}/inventory/#730`]
    ];
    const box = h('div', { class: 'vh-profile-box' },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' } }, h('span', { class: 'vh-logo' }, 'vh'), h('b', {}, 'vsemvamdam-Steam-Helper')),
      h('div', { class: 'vh-kv' },
        h('span', {}, 'SteamID64'), h('span', { class: 'vh-mono', style: { cursor: 'pointer' }, title: 'Скопировать', onclick: () => VH.copy(id) }, id),
        h('span', {}, 'SteamID3'), h('span', { class: 'vh-mono', style: { cursor: 'pointer' }, onclick: () => VH.copy(steamId3(id)) }, steamId3(id))),
      h('div', { class: 'vh-row' }, links.map(([t, u]) => h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, t))),
      h('div', { class: 'vh-row' }, calc), valueEl);
    col.prepend(box);
  }

  VH.ready.then(run);
})();
