/*
 * vsemvamdam-Steam-Helper — торговая площадка Steam.
 * Страница предмета: цены площадок, калькулятор комиссии и профита, float/наклейки
 * у каждого лота, сортировка по float, быстрая покупка, лотов на странице.
 * Главная маркета: мои лоты (сумма, фильтр, массовое снятие, проверка перебитых),
 * заявки на покупку, экспорт истории в CSV.
 */
(function () {
  'use strict';
  const VH = globalThis.VH;
  const h = VH.h;
  const C = VH.currency;
  const F = VH.fees;
  if (!/^\/market/.test(location.pathname)) return;

  const listingMatch = location.pathname.match(/^\/market\/listings\/(\d+)\/([^/?#]+)/);

  /* ======================= страница предмета ======================= */
  async function listingPage() {
    const app = Number(listingMatch[1]);
    const name = decodeURIComponent(listingMatch[2]);
    const code = VH.walletCode();
    await VH.loadPrices(app, [name]);

    const panel = h('div', { class: 'vh-market-panel' });
    const anchor = document.querySelector('#searchResultsTable') || document.querySelector('.market_listing_nav');
    if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(panel, anchor);
    else return;

    let ex = null; let ord = null; let csf = null; let dm = null;
    const left = h('div');
    const right = h('div');
    panel.append(left, right);

    function renderLeft() {
      left.textContent = '';
      left.append(h('div', { class: 'vh-sec' }, h('div', { class: 'vh-sec-t' }, h('span', { class: 'vh-logo', style: { marginRight: '6px' } }, 'vh'), 'Цены на площадках'),
        VH.priceTable(app, name, { csfloat: csf, dmarket: dm })));
      if (ex || ord) {
        const kv = h('div', { class: 'vh-kv' });
        if (ex) {
          kv.append(h('span', {}, 'Минимальный лот'), h('span', {}, ex.lowest != null ? C.format(ex.lowest, ex.code) : '—'));
          kv.append(h('span', {}, 'Медиана за сутки'), h('span', {}, ex.median != null ? C.format(ex.median, ex.code) : '—'));
          kv.append(h('span', {}, 'Продаж за сутки'), h('span', {}, String(ex.volume || 0)));
        }
        if (ord) {
          kv.append(h('span', {}, 'Лучшая заявка'), h('span', {}, ord.highestBuy ? C.format(ord.highestBuy / 100, code) : '—'));
          if (ord.highestBuy && ord.lowestSell) {
            const recv = F.receiveFromPay(ord.lowestSell, VH.sell.feeOpts());
            const spread = recv - ord.highestBuy;
            kv.append(h('span', {}, 'Спред (заявка → лот)'), h('span', { class: spread > 0 ? 'vh-good' : 'vh-bad' }, C.format(spread / 100, code) + ` (${(spread / ord.highestBuy * 100).toFixed(1)}%)`));
          }
        }
        left.append(h('div', { class: 'vh-sec' }, h('div', { class: 'vh-sec-t' }, 'Steam'), kv));
      }
    }

    function renderRight() {
      right.textContent = '';
      const opts = VH.sell.feeOpts();
      const pay = h('input', { class: 'vh-input', type: 'number', step: '0.01', min: '0.03', value: ex && ex.lowest ? ex.lowest.toFixed(2) : '' });
      const rec = h('input', { class: 'vh-input', type: 'number', step: '0.01', min: '0.01' });
      const out = h('div', { class: 'vh-kv', style: { marginTop: '8px' } });
      const provSel = h('select', { class: 'vh-select' }, VH.cfg.compare.filter((p) => p !== 'steam' && !VH.settings.PROVIDERS[p].linkOnly)
        .map((p) => h('option', { value: p }, VH.settings.PROVIDERS[p].title)));
      const calc = () => {
        const p = VH.sell.toMinor(parseFloat(pay.value));
        out.textContent = '';
        if (!p) return;
        const fz = F.feesForReceive(F.receiveFromPay(p, opts), opts);
        if (document.activeElement !== rec) rec.value = (fz.receive / 100).toFixed(2);
        out.append(h('span', {}, 'Комиссия Steam'), h('span', {}, C.format(fz.steam / 100, code)));
        out.append(h('span', {}, 'Комиссия игры'), h('span', {}, C.format(fz.publisher / 100, code)));
        const prov = provSel.value;
        let pu = VH.priceOf(app, name, prov);
        if (prov === 'csfloat' && csf) pu = csf.price;
        if (prov === 'dmarket' && dm) pu = dm.price;
        const pv = pu != null ? C.convert(pu, 'USD', code, VH.rates) : null;
        if (pv != null) {
          const buyThereSellSteam = fz.receive / 100 - pv;
          const buySteamSellThere = pv - p / 100;
          out.append(h('span', {}, `Купить на ${VH.settings.PROVIDERS[prov].title} → продать в Steam`),
            h('span', { class: buyThereSellSteam > 0 ? 'vh-good' : 'vh-bad' }, C.format(buyThereSellSteam, code) + ` (${(buyThereSellSteam / pv * 100).toFixed(1)}%)`));
          out.append(h('span', {}, `Купить в Steam → продать на ${VH.settings.PROVIDERS[prov].title}`),
            h('span', { class: buySteamSellThere > 0 ? 'vh-good' : 'vh-bad' }, C.format(buySteamSellThere, code) + ' без комиссии площадки'));
        }
      };
      pay.addEventListener('input', calc);
      rec.addEventListener('input', () => {
        const r = VH.sell.toMinor(parseFloat(rec.value));
        if (r) { pay.value = (F.payFromReceive(r, opts) / 100).toFixed(2); calc(); }
      });
      provSel.addEventListener('change', calc);
      right.append(h('div', { class: 'vh-sec' }, h('div', { class: 'vh-sec-t' }, 'Калькулятор комиссии и профита'),
        h('div', { class: 'vh-calc' },
          h('span', { class: 'vh-mutetext' }, `Цена покупателя, ${code}`), pay,
          h('span', { class: 'vh-mutetext' }, `Продавец получит, ${code}`), rec,
          h('span', { class: 'vh-mutetext' }, 'Сравнить с'), provSel), out));
      calc();

      const sizeSel = h('select', { class: 'vh-select' }, [10, 20, 50, 100].map((n) => h('option', { value: n, selected: n === Number(VH.cfg.marketPageSize) }, n + ' лотов')));
      sizeSel.addEventListener('change', async () => {
        await VH.saveCfg({ marketPageSize: Number(sizeSel.value) });
        VH.page('setMarketPageSize', { size: Number(sizeSel.value) }).catch(() => {});
      });
      const sortSel = h('select', { class: 'vh-select' }, [['', 'Порядок Steam'], ['asc', 'Float ↑'], ['desc', 'Float ↓'], ['price', 'Цена ↑'], ['stickers', 'Дороже наклейки']]
        .map(([v, l]) => h('option', { value: v }, l)));
      sortSel.addEventListener('change', () => { sortMode = sortSel.value; sortRows(); });
      right.append(h('div', { class: 'vh-sec' }, h('div', { class: 'vh-sec-t' }, 'Лоты'), h('div', { class: 'vh-row' }, sizeSel, sortSel)));
    }

    renderLeft();
    renderRight();
    VH.steamExact(app, name, true).then((r) => { ex = r; renderLeft(); renderRight(); }).catch(() => {});
    VH.send('orders', { app, name, currencyId: VH.walletCurrencyId(), country: (VH.state.wallet && VH.state.wallet.wallet_country) || VH.state.country || 'US' })
      .then((r) => { ord = r; renderLeft(); }).catch(() => {});
    if (app === 730 && VH.cfg.csfloatKey && VH.cfg.compare.includes('csfloat')) VH.send('csfloat', { name }).then((r) => { csf = r; renderLeft(); }).catch(() => {});
    if (app === 730 && VH.cfg.compare.includes('dmarket')) VH.send('dmarket', { names: [name] }).then((r) => { dm = r[name] || null; renderLeft(); }).catch(() => {});

    if (Number(VH.cfg.marketPageSize) > 10) VH.page('setMarketPageSize', { size: Number(VH.cfg.marketPageSize) }).catch(() => {});

    /* ---------- лоты ---------- */
    let sortMode = '';
    const rowData = new Map();

    async function enhanceRows() {
      if (!VH.cfg.marketFloats) return;
      let listings = [];
      try { listings = await VH.page('listings'); } catch (e) { return; }
      const byId = new Map(listings.map((l) => [String(l.listingid), l]));
      const stickerNames = new Set();
      for (const row of document.querySelectorAll('#searchResultsRows .market_listing_row[id^="listing_"]')) {
        const id = row.id.replace('listing_', '');
        const l = byId.get(id);
        if (!l) continue;
        const it = VH.makeItem({
          appid: l.asset.appid, contextid: l.asset.contextid, assetid: l.asset.id, name: l.asset.name || name,
          display: l.asset.display, inspect: l.asset.inspect, props: l.asset.props, rich: l.asset.rich, tradable: true, marketable: true
        });
        await VH.resolveExtras(it);
        it.stickers.forEach((s) => s.market && stickerNames.add(s.market));
        it.charms.forEach((c) => c.market && stickerNames.add(c.market));
        rowData.set(id, { row, l, it });
      }
      if (stickerNames.size) await VH.loadPrices(app, [...stickerNames]);
      for (const [id, { row, l, it }] of rowData) renderRow(id, row, l, it);
      if (sortMode) sortRows();
    }

    function stickerSum(it) {
      let s = 0;
      for (const x of [...it.stickers, ...it.charms]) {
        const p = x.market ? (VH.priceOf(app, x.market, 'steam') ?? VH.priceOf(app, x.market, 'skinport')) : null;
        if (p) s += p;
      }
      return s;
    }

    function renderRow(id, row, l, it) {
      const nameBlock = row.querySelector('.market_listing_item_name_block');
      if (!nameBlock) return;
      let extra = nameBlock.querySelector('.vh-listing-extra');
      if (!extra) { extra = h('div', { class: 'vh-listing-extra' }); nameBlock.append(extra); }
      extra.textContent = '';
      if (it.float != null) extra.append(h('span', { class: 'vh-chip vh-mono', title: 'Float' }, VH.fmtFloat(it.float, 10)));
      if (it.wear) extra.append(h('span', { class: 'vh-chip' }, it.wear.short));
      if (it.seed != null) extra.append(h('span', { class: 'vh-chip', title: 'Паттерн' }, '#' + it.seed));
      if (it.phase) extra.append(VH.phaseBadge(it.phase));
      const ss = stickerSum(it);
      for (const s of it.stickers) {
        if (!s.market && !s.title) continue;
        const p = s.market ? (VH.priceOf(app, s.market, 'steam') ?? VH.priceOf(app, s.market, 'skinport')) : null;
        extra.append(h('span', { class: 'vh-stkname' }, (s.market || s.title).replace(/^Sticker \| /, ''), s.wear ? ` (${Math.round(s.wear * 100)}%)` : '', p ? ' · ' + VH.money(p) : ''));
      }
      if (ss) extra.append(h('span', { class: 'vh-chip', title: 'Сумма наклеек и брелоков' }, 'Σ ' + VH.money(ss)));
      if (it.inspect) extra.append(h('a', { class: 'vh-stkname', href: '#', onclick: (e) => { e.preventDefault(); VH.copy(it.inspect); } }, 'копировать inspect'));

      // быстрая покупка
      const btns = row.querySelector('.market_listing_buy_button');
      if (btns && VH.loggedIn() && !btns.querySelector('.vh-qbuy') && l.converted_price != null) {
        const b = VH.btn('Быстро', (e) => { e.preventDefault(); quickBuy(l, row, b); }, 'primary', { title: 'Купить без окна Steam' });
        b.classList.add('vh-qbuy');
        btns.append(b);
      }
    }

    async function quickBuy(l, row, btn) {
      const cid = l.converted_currencyid ? l.converted_currencyid - 2000 : VH.walletCurrencyId();
      const total = l.converted_price + l.converted_fee;
      const code2 = C.codeOf(cid);
      if (VH.cfg.confirmBuy && !confirm(`Купить «${l.asset.display || name}» за ${C.format(total / 100, code2)}?`)) return;
      btn.disabled = true;
      try {
        const { json } = await VH.post(`https://steamcommunity.com/market/buylisting/${l.listingid}`, {
          currency: cid, subtotal: l.converted_price, fee: l.converted_fee, total, quantity: 1,
          first_name: '', last_name: '', billing_address: '', billing_address_two: '', billing_country: '', billing_city: '', billing_state: '', billing_postal_code: '', save_my_address: 0
        });
        if (json && json.wallet_info && json.wallet_info.success === 1) {
          VH.toast('Куплено за ' + C.format(total / 100, code2), 'good');
          row.style.opacity = '.4';
          btn.textContent = '✓';
        } else if (json && json.need_confirmation) {
          VH.toast('Steam просит подтвердить покупку в мобильном приложении', 'bad', 6000);
        } else {
          VH.toast((json && json.message) || 'Не удалось купить', 'bad', 6000);
          btn.disabled = false;
        }
      } catch (e) {
        VH.toast(e.message, 'bad');
        btn.disabled = false;
      }
    }

    let sorting = false;
    function sortRows() {
      const box = document.querySelector('#searchResultsRows');
      if (!box) return;
      sorting = true;
      setTimeout(() => { sorting = false; }, 500);
      const rows = [...box.querySelectorAll('.market_listing_row[id^="listing_"]')];
      const get = (r) => rowData.get(r.id.replace('listing_', ''));
      const key = {
        asc: (r) => (get(r) && get(r).it.float != null ? get(r).it.float : 9),
        desc: (r) => (get(r) && get(r).it.float != null ? -get(r).it.float : 9),
        price: (r) => (get(r) ? get(r).l.converted_price + get(r).l.converted_fee : 1e12),
        stickers: (r) => (get(r) ? -stickerSum(get(r).it) : 0)
      }[sortMode];
      if (!key) return;
      rows.sort((a, b) => key(a) - key(b)).forEach((r) => box.append(r));
    }

    const box = document.querySelector('#searchResultsRows');
    if (box) VH.observe(box, () => { if (!sorting) enhanceRows(); }, 300);
    enhanceRows();
  }

  /* ======================= главная маркета ======================= */
  function marketHome() {
    const code = VH.walletCode();
    let bar = null;
    const picked = new Set();
    let filterText = '';
    let checked = false;

    function rows() {
      return [...document.querySelectorAll('.market_listing_row[id^="mylisting_"]')];
    }
    function rowInfo(r) {
      const id = r.id.replace('mylisting_', '');
      const link = r.querySelector('.market_listing_item_name_link');
      const href = link ? link.getAttribute('href') : '';
      const m = href.match(/\/market\/listings\/(\d+)\/([^/?#]+)/);
      const prices = r.querySelectorAll('.market_listing_price span');
      const payText = prices[0] ? prices[0].textContent : (r.querySelector('.market_listing_price') || {}).textContent;
      const recText = prices[1] ? prices[1].textContent : '';
      return {
        id, row: r, app: m ? Number(m[1]) : null, name: m ? decodeURIComponent(m[2]) : (link ? link.textContent.trim() : ''),
        title: link ? link.textContent.trim() : '', pay: C.parse(payText), receive: C.parse(recText)
      };
    }

    function build() {
      const host = document.querySelector('#tabContentsMyActiveMarketListingsTable') || document.querySelector('#tabContentsMyListings');
      if (!host) return;
      if (!bar || !bar.isConnected) {
        const filter = h('input', { class: 'vh-input', placeholder: 'Фильтр по названию', value: filterText, style: { width: '200px' } });
        filter.addEventListener('input', () => { filterText = filter.value.toLowerCase(); apply(); });
        const size = h('select', { class: 'vh-select' }, [10, 30, 100].map((n) => h('option', { value: n }, `${n} на странице`)));
        size.addEventListener('change', () => VH.page('setMarketPageSize', { size: Number(size.value), target: 'mylistings' }).catch(() => {}));
        bar = h('div', { class: 'vh-mylistings-bar' },
          h('span', { class: 'vh-logo' }, 'vh'), h('span', { class: 'vh-sum' }), filter, size,
          VH.btn('Выбрать видимые', () => { rows().filter((r) => r.style.display !== 'none').forEach((r) => picked.add(r.id)); apply(); }),
          VH.btn('Снять выбор', () => { picked.clear(); apply(); }),
          VH.btn('Проверить цены', checkPrices),
          VH.btn('Снять с продажи', removeSelected, 'danger'));
        host.parentElement.insertBefore(bar, host);
      }
      apply();
    }

    function apply() {
      let sumPay = 0; let sumRec = 0; let n = 0; let sel = 0;
      for (const r of rows()) {
        const info = rowInfo(r);
        const show = !filterText || info.title.toLowerCase().includes(filterText) || info.name.toLowerCase().includes(filterText);
        r.style.display = show ? '' : 'none';
        let cb = r.querySelector('.vh-mycheck');
        if (!cb) {
          cb = h('input', { type: 'checkbox', class: 'vh-mycheck' });
          cb.addEventListener('change', () => { cb.checked ? picked.add(r.id) : picked.delete(r.id); apply(); });
          const target = r.querySelector('.market_listing_item_name_block') || r;
          target.prepend(cb);
        }
        cb.checked = picked.has(r.id);
        if (show) { n++; sumPay += info.pay || 0; sumRec += info.receive || 0; }
        if (picked.has(r.id)) sel++;
      }
      const buyOrders = [...document.querySelectorAll('.market_listing_row[id^="mybuyorder_"]')];
      let orders = 0;
      for (const r of buyOrders) {
        const p = C.parse((r.querySelector('.market_listing_price') || {}).textContent);
        const q = parseInt((r.querySelector('.market_listing_buyorder_qty .market_listing_price, .market_listing_buyorder_qty') || {}).textContent, 10) || 1;
        if (p) orders += p * q;
      }
      if (bar) {
        bar.querySelector('.vh-sum').innerHTML = '';
        bar.querySelector('.vh-sum').append(
          'Лотов: ', h('b', {}, String(n)), ' · покупатели заплатят ', h('b', {}, C.format(sumPay, code)), ' · вы получите ', h('b', {}, C.format(sumRec, code)),
          sel ? ` · выбрано ${sel}` : '', buyOrders.length ? ` · заявки: ${buyOrders.length} на ${C.format(orders, code)}` : '');
      }
    }

    async function checkPrices() {
      if (checked) return;
      checked = true;
      const infos = rows().map(rowInfo).filter((i) => i.app && i.name);
      const names = [...new Set(infos.map((i) => i.app + '|' + i.name))];
      VH.toast(`Проверяю ${names.length} предметов (Steam ограничивает частоту запросов)…`);
      for (const key of names) {
        const [app, name] = [Number(key.split('|')[0]), key.slice(key.indexOf('|') + 1)];
        try {
          const ex = await VH.steamExact(app, name, true);
          for (const i of infos.filter((x) => x.name === name)) {
            const old = i.row.querySelector('.vh-under');
            if (old) old.remove();
            if (ex.lowest != null && i.pay != null) {
              const cheaper = ex.lowest < i.pay - 0.001;
              const nameEl = i.row.querySelector('.market_listing_item_name_block .market_listing_item_name, .market_listing_item_name_link');
              if (nameEl) nameEl.after(h('span', { class: cheaper ? 'vh-under' : 'vh-under vh-good' }, cheaper ? `перебили: минимум ${C.format(ex.lowest, ex.code)}` : 'ваш лот самый дешёвый'));
            }
          }
        } catch (e) { /* пропускаем */ }
      }
      checked = false;
    }

    async function removeSelected() {
      const list = rows().filter((r) => picked.has(r.id));
      if (!list.length) return VH.toast('Отметьте лоты галочками');
      if (!confirm(`Снять с продажи ${list.length} лотов?`)) return;
      let ok = 0;
      for (const r of list) {
        const id = r.id.replace('mylisting_', '');
        try {
          const res = await VH.post(`https://steamcommunity.com/market/removelisting/${id}`, {});
          if (res.status === 200) { ok++; r.style.opacity = '.3'; picked.delete(r.id); }
        } catch (e) { /* дальше */ }
        await VH.sleep(700);
      }
      VH.toast(`Снято лотов: ${ok} из ${list.length}`, ok === list.length ? 'good' : 'bad');
      apply();
    }

    // экспорт истории
    function addHistoryExport() {
      const tab = document.querySelector('#tabMyMarketHistory');
      if (!tab || document.querySelector('.vh-hist-export')) return;
      const b = VH.btn('Экспорт истории в CSV', exportHistory);
      b.classList.add('vh-hist-export');
      b.style.marginLeft = '10px';
      tab.parentElement.append(b);
    }

    async function exportHistory() {
      const rowsOut = [['date_acted', 'date_listed', 'type', 'name', 'game', 'price', 'currency']];
      const parser = new DOMParser();
      let start = 0; let total = 1;
      VH.toast('Загружаю историю маркета…');
      while (start < total && start < 5000) {
        const r = await fetch(`/market/myhistory/render/?query=&start=${start}&count=500&l=english`, { credentials: 'include' });
        if (r.status === 429) { await VH.sleep(20000); continue; }
        const j = await r.json();
        if (!j || !j.success) break;
        total = j.total_count || 0;
        const doc = parser.parseFromString(j.results_html || '', 'text/html');
        for (const row of doc.querySelectorAll('.market_listing_row')) {
          const sign = (row.querySelector('.market_listing_gainorloss') || {}).textContent || '';
          const type = sign.includes('+') ? 'buy' : sign.includes('-') ? 'sell' : 'listing';
          const dates = [...row.querySelectorAll('.market_listing_listed_date')].map((d) => d.textContent.trim());
          rowsOut.push([dates[0] || '', dates[1] || '', type,
            ((row.querySelector('.market_listing_item_name') || {}).textContent || '').trim(),
            ((row.querySelector('.market_listing_game_name') || {}).textContent || '').trim(),
            C.parse((row.querySelector('.market_listing_price') || {}).textContent) ?? '', code]);
        }
        start += 500;
        await VH.sleep(1500);
      }
      const csv = rowsOut.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      const a = h('a', { href: URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })), download: 'steam_market_history.csv' });
      a.click();
      VH.toast(`Готово: ${rowsOut.length - 1} записей`, 'good');
    }

    build();
    addHistoryExport();
    VH.observe(document.querySelector('#myListings, #tabContentsMyListings') || document.body, () => { build(); addHistoryExport(); }, 400);
  }

  VH.ready.then(() => {
    if (listingMatch) listingPage();
    else if (/^\/market\/?$/.test(location.pathname)) marketHome();
  });
})();
