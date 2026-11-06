/*
 * vsemvamdam-Steam-Helper — продажа на торговой площадке Steam: расчёт цены,
 * быстрая продажа одного предмета и массовое выставление лотов.
 */
(function () {
  'use strict';
  const VH = globalThis.VH;
  const F = VH.fees;
  const C = VH.currency;
  const h = VH.h;

  const STRATEGIES = {
    undercut: 'Дешевле минимума',
    lowest: 'По минимуму',
    median: 'По медиане (24ч)',
    buyorder: 'По лучшей заявке (мгновенно)',
    provider: 'От цены площадки'
  };

  function feeOpts() {
    const w = VH.state.wallet || {};
    const pub = w.wallet_publisher_fee_percent_default != null ? Number(w.wallet_publisher_fee_percent_default) : 0.10;
    const steam = w.wallet_fee_percent != null ? Number(w.wallet_fee_percent) : 0.05;
    return { publisherFee: pub, steamFee: steam };
  }

  const toMinor = (v) => (v == null ? null : Math.round(v * 100));
  const fmtMinor = (m) => (m == null ? '—' : C.format(m / 100, VH.walletCode()));

  /** Рекомендуемая цена для покупателя (в копейках/центах валюты кошелька). */
  async function suggest(app, name, strategy) {
    const s = strategy || VH.cfg.sellStrategy;
    const cid = VH.walletCurrencyId();
    const country = (VH.state.wallet && VH.state.wallet.wallet_country) || VH.state.country || 'US';
    if (s === 'buyorder') {
      const o = await VH.send('orders', { app, name, currencyId: cid, country });
      if (o.highestBuy) return { pay: o.highestBuy, source: 'заявка' };
    }
    if (s === 'provider') {
      const usd = VH.priceOf(app, name, VH.cfg.sellProvider);
      if (usd != null) {
        const v = C.convert(usd, 'USD', VH.walletCode(), VH.rates);
        if (v != null) return { pay: Math.max(3, Math.round(v * 100 * (VH.cfg.sellPercent || 100) / 100)), source: VH.settings.PROVIDERS[VH.cfg.sellProvider].title };
      }
    }
    const ex = await VH.steamExact(app, name, true);
    if (s === 'median' && ex.median) return { pay: toMinor(ex.median), source: 'медиана' };
    if (ex.lowest) {
      const low = toMinor(ex.lowest);
      if (s === 'undercut') return { pay: Math.max(3, low - (Number(VH.cfg.undercutStep) || 1)), source: 'минимум − шаг' };
      return { pay: low, source: 'минимум' };
    }
    const o = await VH.send('orders', { app, name, currencyId: cid, country });
    if (o.lowestSell) return { pay: s === 'undercut' ? Math.max(3, o.lowestSell - 1) : o.lowestSell, source: 'стакан' };
    if (o.highestBuy) return { pay: o.highestBuy, source: 'заявка' };
    return { pay: null, source: 'нет данных' };
  }

  /** Выставляет один предмет. pay — цена для покупателя в минимальных единицах. */
  async function sellOne(it, pay, amount) {
    const receive = F.receiveFromPay(pay, feeOpts());
    if (receive < 1) throw new Error('Слишком низкая цена');
    const { json } = await VH.post('https://steamcommunity.com/market/sellitem/', {
      appid: it.appid, contextid: it.contextid, assetid: it.assetid, amount: amount || 1, price: receive
    });
    if (!json || !json.success) throw new Error((json && json.message) || 'Steam отклонил лот');
    return { receive, confirm: !!(json.requires_confirmation || json.needs_mobile_confirmation), email: !!json.needs_email_confirmation };
  }

  /** Блок быстрой продажи для панели предмета. */
  function quickBox(it, onDone) {
    const opts = feeOpts();
    const code = VH.walletCode();
    const payIn = h('input', { class: 'vh-input', type: 'number', step: '0.01', min: '0.03', placeholder: 'цена' });
    const recIn = h('input', { class: 'vh-input', type: 'number', step: '0.01', min: '0.01', placeholder: 'получу' });
    const note = h('div', { class: 'vh-mutetext', style: { fontSize: '11px', marginTop: '6px' } }, 'Считаю цену Steam…');
    payIn.addEventListener('input', () => {
      const p = toMinor(parseFloat(payIn.value));
      recIn.value = p ? (F.receiveFromPay(p, opts) / 100).toFixed(2) : '';
    });
    recIn.addEventListener('input', () => {
      const r = toMinor(parseFloat(recIn.value));
      payIn.value = r ? (F.payFromReceive(r, opts) / 100).toFixed(2) : '';
    });
    const setPay = (m) => { if (m) { payIn.value = (m / 100).toFixed(2); payIn.dispatchEvent(new Event('input')); } };
    let ex = null;
    let ord = null;
    const bLow = VH.btn('−шаг от минимума', () => ex && ex.lowest && setPay(Math.max(3, toMinor(ex.lowest) - (Number(VH.cfg.undercutStep) || 1))));
    const bMed = VH.btn('Медиана', () => ex && ex.median && setPay(toMinor(ex.median)));
    const bOrd = VH.btn('По заявке', () => ord && ord.highestBuy && setPay(ord.highestBuy));
    const go = VH.btn('Выставить', async () => {
      const pay = toMinor(parseFloat(payIn.value));
      if (!pay) return VH.toast('Укажите цену', 'bad');
      go.disabled = true;
      try {
        const r = await sellOne(it, pay, 1);
        VH.toast(`Выставлено за ${fmtMinor(pay)} (получите ${fmtMinor(r.receive)})` + (r.confirm ? ' — подтвердите в приложении Steam' : ''), 'good', 5000);
        onDone && onDone(it, r);
      } catch (e) {
        VH.toast(e.message, 'bad', 5000);
      } finally {
        go.disabled = false;
      }
    }, 'primary');
    const box = h('div', {},
      h('div', { class: 'vh-sellbox' },
        h('label', {}, `Цена покупателя, ${code}`, payIn),
        h('label', {}, `Вы получите, ${code}`, recIn)),
      h('div', { class: 'vh-row' }, bLow, bMed, bOrd),
      h('div', { class: 'vh-row' }, go),
      note);
    (async () => {
      try {
        ex = await VH.steamExact(it.appid, it.name, true);
        note.textContent = `Steam: минимум ${ex.lowest != null ? C.format(ex.lowest, ex.code) : '—'} · медиана ${ex.median != null ? C.format(ex.median, ex.code) : '—'} · продаж за сутки ${ex.volume || 0}`;
        const sug = await suggest(it.appid, it.name, VH.cfg.sellStrategy === 'buyorder' ? 'undercut' : VH.cfg.sellStrategy);
        if (sug.pay) setPay(sug.pay);
      } catch (e) {
        note.textContent = 'Цена Steam недоступна: ' + e.message;
      }
      try {
        const cid = VH.walletCurrencyId();
        ord = await VH.send('orders', { app: it.appid, name: it.name, currencyId: cid, country: (VH.state.wallet && VH.state.wallet.wallet_country) || 'US' });
        if (ord.highestBuy) bOrd.textContent = 'Заявка ' + fmtMinor(ord.highestBuy);
      } catch (e) { bOrd.disabled = true; }
    })();
    return box;
  }

  /** Диалог массовой продажи. items — модели предметов (свои, marketable). */
  function massDialog(items, onSold) {
    const sellable = items.filter((i) => i.marketable);
    if (!sellable.length) return VH.toast('Среди выбранных нет предметов, которые можно продать', 'bad');
    const opts = feeOpts();
    const groups = new Map();
    for (const it of sellable) {
      const k = it.appid + '|' + it.name;
      if (!groups.has(k)) groups.set(k, { app: it.appid, name: it.name, display: it.display || it.name, icon: it.icon, color: it.color, items: [], pay: null, source: '' });
      groups.get(k).items.push(it);
    }
    const list = [...groups.values()];
    const strategySel = h('select', { class: 'vh-select' }, Object.entries(STRATEGIES).map(([k, v]) => h('option', { value: k, selected: k === VH.cfg.sellStrategy }, v)));
    const totalEl = h('span', { class: 'vh-spacer' });
    const progress = h('div', { class: 'vh-progress' }, h('i'));
    const log = h('div', { class: 'vh-log' });
    const tbody = h('tbody');

    function recalcTotal() {
      let rec = 0;
      let n = 0;
      for (const g of list) if (g.pay) { rec += F.receiveFromPay(g.pay, opts) * g.items.reduce((a, i) => a + (i.amount || 1), 0); n += g.items.length; }
      totalEl.textContent = `Лотов: ${n} · вы получите ≈ ${fmtMinor(rec)}`;
    }

    function row(g) {
      const inp = h('input', { class: 'vh-input vh-num', type: 'number', step: '0.01', min: '0.03' });
      const rec = h('td', { class: 'vh-r' });
      const src = h('td', { class: 'vh-mutetext' });
      const upd = () => {
        inp.value = g.pay ? (g.pay / 100).toFixed(2) : '';
        rec.textContent = g.pay ? fmtMinor(F.receiveFromPay(g.pay, opts)) : '—';
        src.textContent = g.source || '';
        recalcTotal();
      };
      inp.addEventListener('input', () => { g.pay = toMinor(parseFloat(inp.value)) || null; g.source = 'вручную'; rec.textContent = g.pay ? fmtMinor(F.receiveFromPay(g.pay, opts)) : '—'; src.textContent = g.source; recalcTotal(); });
      g.update = upd;
      const qty = g.items.reduce((a, i) => a + (i.amount || 1), 0);
      return h('tr', {},
        h('td', {}, g.icon ? h('img', { class: 'vh-ic', src: `https://community.fastly.steamstatic.com/economy/image/${g.icon}/62fx62f` }) : ''),
        h('td', { style: { color: g.color ? '#' + g.color : '' } }, g.display),
        h('td', { class: 'vh-r' }, '×' + qty),
        h('td', { class: 'vh-r' }, inp),
        rec, src);
    }

    for (const g of list) tbody.append(row(g));
    const table = h('table', { class: 'vh-table' },
      h('thead', {}, h('tr', {}, h('th'), h('th', {}, 'Предмет'), h('th', { class: 'vh-r' }, 'Кол-во'), h('th', { class: 'vh-r' }, `Цена, ${VH.walletCode()}`), h('th', { class: 'vh-r' }, 'Получите'), h('th', {}, 'Источник'))),
      tbody);

    let pricing = 0;
    async function price() {
      const my = ++pricing;
      const strat = strategySel.value;
      let i = 0;
      for (const g of list) {
        if (my !== pricing) return;
        i++;
        totalEl.textContent = `Считаю цены ${i}/${list.length}…`;
        try {
          const s = await suggest(g.app, g.name, strat);
          if (my !== pricing) return;
          g.pay = s.pay; g.source = s.source;
        } catch (e) {
          g.source = 'ошибка: ' + e.message;
        }
        g.update();
      }
      recalcTotal();
    }

    let running = false;
    let stop = false;
    const startBtn = VH.btn('Выставить', async () => {
      if (running) { stop = true; startBtn.textContent = 'Останавливаю…'; return; }
      const queue = [];
      for (const g of list) if (g.pay) for (const it of g.items) queue.push([g, it]);
      if (!queue.length) return VH.toast('Нет предметов с ценой', 'bad');
      running = true; stop = false;
      startBtn.textContent = 'Стоп';
      let ok = 0; let fail = 0; let confirm = false;
      for (let i = 0; i < queue.length && !stop; i++) {
        const [g, it] = queue[i];
        try {
          const r = await sellOne(it, g.pay, it.amount || 1);
          ok++; confirm = confirm || r.confirm;
          log.prepend(h('div', {}, h('span', { class: 'vh-good' }, '✓ '), `${g.display} — ${fmtMinor(g.pay)}`));
          onSold && onSold(it, r);
        } catch (e) {
          fail++;
          log.prepend(h('div', {}, h('span', { class: 'vh-bad' }, '✗ '), `${g.display}: ${e.message}`));
          if (/many|слишком/i.test(e.message)) await VH.sleep(10000);
        }
        progress.firstChild.style.width = ((i + 1) / queue.length * 100) + '%';
        await VH.sleep(Math.max(600, Number(VH.cfg.sellDelay) || 1500));
      }
      running = false;
      startBtn.textContent = 'Выставить';
      totalEl.textContent = `Готово: ${ok} выставлено, ${fail} с ошибкой` + (confirm ? ' · подтвердите лоты в мобильном приложении Steam' : '');
      VH.toast(totalEl.textContent, fail ? 'bad' : 'good', 7000);
    }, 'primary');

    strategySel.addEventListener('change', price);
    const m = VH.modal({
      title: `Массовая продажа · ${sellable.length} шт.`,
      wide: true,
      body: [
        h('div', { class: 'vh-filters' }, h('label', {}, 'Цена:', strategySel), VH.btn('Пересчитать', price),
          h('span', { class: 'vh-mutetext' }, 'Цены можно поправить вручную. Steam может попросить подтвердить лоты в мобильном приложении.')),
        table, progress, log
      ],
      actions: [totalEl, VH.btn('Закрыть', () => { stop = true; m.close(); }), startBtn],
      onClose: () => { stop = true; pricing++; }
    });
    price();
    return m;
  }

  VH.sell = { suggest, list: sellOne, quickBox, massDialog, feeOpts, STRATEGIES, fmtMinor, toMinor };
})();
