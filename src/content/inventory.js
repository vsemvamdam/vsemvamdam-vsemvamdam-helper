/*
 * vsemvamdam-Steam-Helper — инвентарь Steam.
 * Цены на карточках, общая стоимость, float/паттерн/фазы/наклейки, трейдлок,
 * сортировка, режим выбора, массовая и быстрая продажа, менеджер-таблица.
 */
(function () {
  'use strict';
  const VH = globalThis.VH;
  const h = VH.h;
  const C = VH.currency;
  if (!/\/inventory/.test(location.pathname)) return;

  const S = {
    owner: null, isOwn: false,
    app: null, ctx: null,
    json: new Map(),        // key -> item (из JSON инвентаря)
    jsonFor: null,          // "app_ctx", для которого загружен JSON
    selected: new Set(),
    selectMode: false,
    sort: 'default',
    sold: new Set(),
    toolbar: null, detail: null, selbar: null
  };

  /* ---------- контекст ---------- */
  function ownerFromUrl() {
    const m = location.pathname.match(/\/profiles\/(\d{17})/);
    return m ? m[1] : null;
  }

  function currentContext() {
    const m = location.hash.match(/#(\d+)(?:_(\d+))?/);
    const inv = VH.state.inventory || {};
    const app = m ? Number(m[1]) : Number(inv.appid) || 730;
    let ctx = m && m[2] ? m[2] : (inv.appid == app ? String(inv.contextid) : null);
    if (!ctx) ctx = app === 753 ? '6' : '2';
    return { app, ctx };
  }

  function itemEls() {
    // запасной путь: если мост не разметил элемент, берём ключ из id вида 730_2_123456
    for (const el of document.querySelectorAll(`.item[id^="${S.app}_${S.ctx}_"]:not([data-vh-key])`)) {
      if (S.json.has(el.id)) el.dataset.vhKey = el.id;
    }
    return [...document.querySelectorAll(`.item[data-vh-key^="${S.app}_${S.ctx}_"]`)];
  }

  function modelFor(el) {
    const key = el.dataset.vhKey;
    return S.json.get(key) || VH.itemFromEl(el);
  }

  /* ---------- загрузка данных ---------- */
  async function loadJson() {
    const tag = S.app + '_' + S.ctx;
    if (S.jsonFor === tag || !S.owner) return;
    S.jsonFor = tag;
    S.json = new Map();
    try {
      const items = await VH.fetchInventory(S.owner, S.app, S.ctx, (n, total) => setStatus(`Загружаю инвентарь ${n}/${total || '?'}…`));
      for (const it of items) S.json.set(it.key, it);
      if (S.app === 730) await Promise.all(items.filter((i) => i.stickers.length || i.charms.length).map(VH.resolveExtras));
    } catch (e) {
      VH.warn('inventory json', e);
      setStatus('Не удалось загрузить JSON инвентаря: ' + e.message);
    }
  }

  async function loadPrices() {
    const names = new Set();
    const src = S.json.size ? [...S.json.values()] : itemEls().map(modelFor).filter(Boolean);
    for (const it of src) {
      if (it.name) names.add(it.name);
      for (const s of it.stickers) if (s.market) names.add(s.market);
      for (const c of it.charms) if (c.market) names.add(c.market);
    }
    setStatus('Загружаю цены…');
    await VH.loadPrices(S.app, [...names]);
  }

  /* ---------- карточки ---------- */
  function decorateAll() {
    for (const el of itemEls()) {
      const it = modelFor(el);
      if (!it) continue;
      VH.decorateCard(el, it);
      el.classList.toggle('vh-selected', S.selected.has(it.key));
      el.classList.toggle('vh-sold', S.sold.has(it.key));
    }
    updateTotal();
  }

  /* ---------- панель инструментов ---------- */
  function setStatus(t) {
    if (S.toolbar) S.toolbar.querySelector('.vh-status').textContent = t || '';
  }

  function allModels() {
    return S.json.size ? [...S.json.values()] : itemEls().map(modelFor).filter(Boolean);
  }

  function updateTotal() {
    if (!S.toolbar) return;
    let sum = 0; let tradable = 0; let n = 0; let priced = 0;
    for (const it of allModels()) {
      const qty = it.amount || 1;
      n += qty;
      const p = VH.priceOf(S.app, it.name);
      if (p != null) { sum += p * qty; priced += qty; if (!it.lockUntil) tradable += p * qty; }
    }
    const t = S.toolbar.querySelector('.vh-total');
    if (!n) return;
    t.textContent = '';
    t.append(h('span', { class: 'vh-logo' }, 'vh'),
      h('b', {}, VH.money(sum)),
      h('small', {}, `${n} шт. · с ценой ${priced} · доступно к обмену ${VH.money(tradable)}`));
    if (n) setStatus('');
  }

  function buildToolbar() {
    if (S.toolbar && document.body.contains(S.toolbar)) return;
    const anchor = document.querySelector('#inventories') || document.querySelector('.inventory_ctn');
    if (!anchor || !anchor.parentElement) return;
    const P = VH.settings.PROVIDERS;
    const provSel = h('select', { class: 'vh-select', title: 'Цена на карточках' },
      Object.entries(P).filter(([, d]) => !d.linkOnly && !d.onDemand && !d.needsKey)
        .map(([k, d]) => h('option', { value: k, selected: k === VH.cfg.mainProvider }, d.title)));
    provSel.addEventListener('change', async () => { await VH.saveCfg({ mainProvider: provSel.value }); decorateAll(); });

    const sortSel = h('select', { class: 'vh-select', title: 'Сортировка' },
      [['default', 'Как в Steam'], ['price-desc', 'Цена ↓'], ['price-asc', 'Цена ↑'], ['float-asc', 'Float ↑'], ['float-desc', 'Float ↓'],
        ['name', 'Название'], ['tradable', 'Сначала доступные'], ['stickers', 'Наклейки ↓']]
        .map(([v, l]) => h('option', { value: v }, l)));
    sortSel.addEventListener('change', () => { S.sort = sortSel.value; applySort(); });

    const selBtn = VH.btn('Выбор', () => setSelectMode(!S.selectMode));
    selBtn.classList.add('vh-selbtn');
    const tools = [provSel, sortSel, selBtn, VH.btn('Таблица', openManager), VH.btn('⟳', async () => {
      await VH.send('refreshTables', { app: S.app });
      VH.book(S.app).loaded.clear();
      S.jsonFor = null;
      await refresh();
    }, null, { title: 'Обновить цены и данные' })];

    S.toolbar = h('div', { class: 'vh-toolbar' },
      h('div', { class: 'vh-total' }, h('span', { class: 'vh-logo' }, 'vh'), h('small', {}, 'Считаю стоимость…')),
      h('span', { class: 'vh-status vh-mutetext' }), ...tools);
    anchor.parentElement.insertBefore(S.toolbar, anchor);
  }

  /* ---------- сортировка (переставляем предметы внутри ячеек Steam) ---------- */
  let defaultOrder = null;
  function applySort() {
    const holders = [...document.querySelectorAll(`#inventory_${S.owner}_${S.app}_${S.ctx} .itemHolder`)];
    const list = holders.map((hd) => hd.querySelector('.item')).filter(Boolean);
    if (!holders.length || !list.length) return VH.toast('Сортировка доступна после загрузки инвентаря');
    if (!defaultOrder) defaultOrder = list.slice();
    let sorted;
    const m = (el) => modelFor(el) || {};
    const price = (el) => { const it = m(el); const p = VH.priceOf(S.app, it.name); return p == null ? -1 : p * (it.amount || 1); };
    const fl = (el) => { const f = m(el).float; return f == null ? null : f; };
    switch (S.sort) {
      case 'price-desc': sorted = list.slice().sort((a, b) => price(b) - price(a)); break;
      case 'price-asc': sorted = list.slice().sort((a, b) => (price(a) < 0 ? 1e12 : price(a)) - (price(b) < 0 ? 1e12 : price(b))); break;
      case 'float-asc': sorted = list.slice().sort((a, b) => (fl(a) ?? 9) - (fl(b) ?? 9)); break;
      case 'float-desc': sorted = list.slice().sort((a, b) => (fl(b) ?? -1) - (fl(a) ?? -1)); break;
      case 'name': sorted = list.slice().sort((a, b) => (m(a).name || '').localeCompare(m(b).name || '')); break;
      case 'tradable': sorted = list.slice().sort((a, b) => (m(a).lockUntil ? 1 : 0) - (m(b).lockUntil ? 1 : 0)); break;
      case 'stickers': sorted = list.slice().sort((a, b) => (m(b).stickers || []).length - (m(a).stickers || []).length); break;
      default: sorted = defaultOrder.filter((el) => list.includes(el));
    }
    sorted.forEach((el, i) => { if (holders[i] && el.parentElement !== holders[i]) holders[i].append(el); });
  }

  /* ---------- режим выбора ---------- */
  function setSelectMode(on) {
    S.selectMode = on;
    document.body.classList.toggle('vh-select-mode', on);
    const b = S.toolbar && S.toolbar.querySelector('.vh-selbtn');
    if (b) b.classList.toggle('vh-on', on);
    if (!on) { S.selected.clear(); decorateAll(); }
    renderSelbar();
  }

  let lastClicked = null;
  function onItemClick(e) {
    const el = e.target.closest('.item[data-vh-key]');
    if (!el) return;
    if (S.selectMode) {
      e.preventDefault();
      e.stopPropagation();
      const key = el.dataset.vhKey;
      if (e.shiftKey && lastClicked) {
        const els = itemEls().filter((x) => x.offsetParent);
        const a = els.indexOf(lastClicked); const b = els.indexOf(el);
        if (a > -1 && b > -1) for (const x of els.slice(Math.min(a, b), Math.max(a, b) + 1)) S.selected.add(x.dataset.vhKey);
      } else if (S.selected.has(key)) S.selected.delete(key);
      else S.selected.add(key);
      lastClicked = el;
      for (const x of itemEls()) x.classList.toggle('vh-selected', S.selected.has(x.dataset.vhKey));
      renderSelbar();
      return;
    }
    setTimeout(() => showDetail(el), 30);
  }

  function selectedModels() {
    const out = [];
    for (const key of S.selected) {
      const it = S.json.get(key) || (document.querySelector(`.item[data-vh-key="${key}"]`) && VH.itemFromEl(document.querySelector(`.item[data-vh-key="${key}"]`)));
      if (it) out.push(it);
    }
    return out;
  }

  function renderSelbar() {
    if (!S.selectMode) { if (S.selbar) S.selbar.remove(); S.selbar = null; return; }
    if (!S.selbar) { S.selbar = h('div', { class: 'vh-selbar' }); document.body.append(S.selbar); }
    const sel = selectedModels();
    const sum = sel.reduce((a, it) => a + (VH.priceOf(S.app, it.name) || 0) * (it.amount || 1), 0);
    S.selbar.textContent = '';
    S.selbar.append(
      h('span', {}, 'Выбрано ', h('b', {}, String(sel.length)), ' · ', h('b', {}, VH.money(sum))),
      VH.btn('Все видимые', () => { itemEls().filter((x) => x.offsetParent).forEach((x) => S.selected.add(x.dataset.vhKey)); decorateAll(); renderSelbar(); }),
      VH.btn('Такие же', () => {
        const names = new Set(sel.map((i) => i.name));
        for (const it of allModels()) if (names.has(it.name)) S.selected.add(it.key);
        decorateAll(); renderSelbar();
      }),
      VH.btn('Снять', () => { S.selected.clear(); decorateAll(); renderSelbar(); }),
      S.isOwn && VH.loggedIn() ? VH.btn('Продать…', () => VH.sell.massDialog(selectedModels(), markSold), 'primary') : null,
      VH.btn('Готово', () => setSelectMode(false)));
  }

  function markSold(it) {
    S.sold.add(it.key);
    S.selected.delete(it.key);
    const el = document.querySelector(`.item[data-vh-key="${it.key}"]`);
    if (el) { el.classList.add('vh-sold'); el.classList.remove('vh-selected'); }
    renderSelbar();
  }

  /* ---------- панель предмета ---------- */
  async function showDetail(el) {
    const it = modelFor(el);
    if (!it) return;
    await VH.resolveExtras(it);

    const host = document.querySelector('.inventory_page_right');
    if (!S.detail) S.detail = h('div', { class: 'vh-detail' });
    if (host) { if (S.detail.parentElement !== host) host.prepend(S.detail); S.detail.classList.remove('vh-floating'); }
    else { if (!S.detail.isConnected) document.body.append(S.detail); S.detail.classList.add('vh-floating'); }

    let csf = null; let dm = null;
    const range = await VH.floatRange(it);
    const extraNames = [it.name, ...it.stickers.map((s) => s.market), ...it.charms.map((c) => c.market)].filter(Boolean);
    VH.loadPrices(it.appid, extraNames).then(() => render());

    function render() {
      const d = S.detail;
      d.textContent = '';
      d.append(
        h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px' } },
          h('div', {}, h('h3', { style: { color: it.color ? '#' + it.color : '' } }, it.display || it.name), h('div', { class: 'vh-sub' }, it.type || '')),
          h('button', { class: 'vh-x', title: 'Скрыть', onclick: () => d.remove() }, '×')));

      if (it.float != null || it.seed != null || it.phase) {
        const kv = h('div', { class: 'vh-kv' });
        if (it.float != null) kv.append(h('span', {}, 'Float'), h('span', { class: 'vh-mono' }, VH.fmtFloat(it.float, 12)));
        if (it.wear) kv.append(h('span', {}, 'Износ'), h('span', {}, it.wear.ru));
        if (range) kv.append(h('span', {}, 'Диапазон скина'), h('span', { class: 'vh-mono' }, `${range.min.toFixed(2)} – ${range.max.toFixed(2)}`));
        if (it.seed != null) kv.append(h('span', {}, 'Паттерн'), h('span', { class: 'vh-mono' }, String(it.seed)));
        if (it.paintindex != null) kv.append(h('span', {}, 'Paint index'), h('span', { class: 'vh-mono' }, String(it.paintindex)));
        if (it.phase) kv.append(h('span', {}, 'Фаза'), h('span', {}, VH.phaseBadge(it.phase)));
        d.append(h('div', { class: 'vh-sec' }, kv, it.float != null ? VH.wearBar(it.float, range) : null));
      }

      if (it.lockUntil) {
        d.append(h('div', { class: 'vh-sec vh-mutetext' }, '🔒 ', it.lockUntil === -1 ? 'Нельзя передать' : `Можно обменять через ${VH.lockLabel(it.lockUntil)} (${new Date(it.lockUntil).toLocaleString('ru-RU')})`));
      }

      if (it.stickers.length || it.charms.length) {
        let total = 0;
        const sec = h('div', { class: 'vh-sec' }, h('div', { class: 'vh-sec-t' }, 'Наклейки и брелоки'));
        for (const s of it.stickers) {
          const p = s.market ? VH.priceOf(it.appid, s.market, VH.cfg.mainProvider === 'steam' ? 'steam' : VH.cfg.mainProvider) ?? VH.priceOf(it.appid, s.market, 'skinport') : null;
          if (p) total += p;
          sec.append(h('div', { class: 'vh-stk' }, s.img ? h('img', { src: s.img }) : h('span'),
            h('div', {}, h('div', { class: 'vh-stk-n' }, (s.market || s.title || '').replace(/^Sticker \| /, '')),
              h('div', { class: 'vh-stk-w' }, s.wear ? `Потёртость ${Math.round(s.wear * 100)}%` : 'Целая')),
            h('div', { class: 'vh-stk-p' }, p != null ? VH.money(p) : '—')));
        }
        for (const c of it.charms) {
          const p = c.market ? VH.priceOf(it.appid, c.market) ?? VH.priceOf(it.appid, c.market, 'skinport') : null;
          if (p) total += p;
          sec.append(h('div', { class: 'vh-stk' }, c.img ? h('img', { src: c.img }) : h('span'),
            h('div', {}, h('div', { class: 'vh-stk-n' }, (c.market || c.title || '').replace(/^Charm \| /, '')),
              h('div', { class: 'vh-stk-w' }, c.pattern != null ? `Паттерн ${c.pattern}` : 'Брелок')),
            h('div', { class: 'vh-stk-p' }, p != null ? VH.money(p) : '—')));
        }
        if (total) sec.append(h('div', { class: 'vh-kv', style: { marginTop: '4px' } }, h('span', {}, 'Сумма наклеек'), h('span', {}, VH.money(total))));
        d.append(sec);
      }

      if (it.marketable || it.tradable) {
        d.append(h('div', { class: 'vh-sec' }, h('div', { class: 'vh-sec-t' }, 'Цены на площадках'), VH.priceTable(it.appid, it.name, { csfloat: csf, dmarket: dm })));
      }

      const actions = h('div', { class: 'vh-row' });
      if (it.inspect) {
        actions.append(VH.btn('Осмотреть в игре', () => { location.href = it.inspect; }), VH.btn('Копировать inspect', () => VH.copy(it.inspect)));
      }
      actions.append(VH.btn('Выбрать такие же', () => {
        setSelectMode(true);
        for (const x of allModels()) if (x.name === it.name) S.selected.add(x.key);
        decorateAll(); renderSelbar();
      }));
      d.append(actions);

      if (S.isOwn && VH.loggedIn() && it.marketable && !S.sold.has(it.key)) {
        d.append(h('div', { class: 'vh-sec' }, h('div', { class: 'vh-sec-t' }, 'Быстрая продажа'), VH.sell.quickBox(it, markSold)));
      }
    }

    render();
    // Точная цена Steam и площадки по запросу
    if (it.marketable || it.tradable) {
      VH.steamExact(it.appid, it.name, true).then(render).catch(() => {});
      if (it.appid === 730 && VH.cfg.compare.includes('csfloat') && VH.cfg.csfloatKey) VH.send('csfloat', { name: it.name }).then((r) => { csf = r; render(); }).catch(() => {});
      if (it.appid === 730 && VH.cfg.compare.includes('dmarket')) VH.send('dmarket', { names: [it.name] }).then((r) => { dm = r[it.name] || null; render(); }).catch(() => {});
    }
  }

  /* ---------- менеджер-таблица ---------- */
  function openManager() {
    const items = allModels();
    if (!items.length) return VH.toast('Инвентарь ещё загружается');
    const sel = new Set(S.selected);
    let sortKey = 'price'; let dir = -1;
    const q = h('input', { class: 'vh-input', placeholder: 'Поиск по названию', style: { width: '220px' } });
    const fTrad = h('input', { type: 'checkbox' });
    const fMark = h('input', { type: 'checkbox' });
    const fStk = h('input', { type: 'checkbox' });
    const tbody = h('tbody');
    const sumEl = h('span', { class: 'vh-spacer' });
    const cols = [
      ['', null], ['', null], ['Предмет', 'name'], ['Float', 'float'], ['Паттерн', 'seed'], ['Наклейки', 'stickers'],
      ['Трейдлок', 'lock'], ['Цена', 'price']
    ];
    const head = h('tr', {}, cols.map(([t, k], i) => {
      const th = h('th', { class: i >= 3 ? 'vh-r' : '' }, t);
      if (k) th.addEventListener('click', () => { if (sortKey === k) dir = -dir; else { sortKey = k; dir = k === 'name' ? 1 : -1; } draw(); });
      return th;
    }));
    const val = (it, k) => {
      switch (k) {
        case 'name': return it.name || '';
        case 'float': return it.float == null ? (dir > 0 ? 9 : -1) : it.float;
        case 'seed': return it.seed == null ? -1 : it.seed;
        case 'stickers': return it.stickers.length;
        case 'lock': return it.lockUntil ? (it.lockUntil === -1 ? 1e15 : it.lockUntil) : 0;
        default: return (VH.priceOf(S.app, it.name) || 0) * (it.amount || 1);
      }
    };
    function filtered() {
      const text = q.value.trim().toLowerCase();
      return items.filter((it) => (!text || (it.name || '').toLowerCase().includes(text) || (it.display || '').toLowerCase().includes(text)) &&
        (!fTrad.checked || !it.lockUntil) && (!fMark.checked || it.marketable) && (!fStk.checked || it.stickers.length));
    }
    function updSum() {
      let s = 0;
      for (const it of items) if (sel.has(it.key)) s += (VH.priceOf(S.app, it.name) || 0) * (it.amount || 1);
      sumEl.textContent = `Выбрано: ${sel.size} · ${VH.money(s)}`;
    }
    function draw() {
      const list = filtered().sort((a, b) => {
        const x = val(a, sortKey); const y = val(b, sortKey);
        return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir;
      });
      head.querySelectorAll('th').forEach((th, i) => th.classList.toggle('vh-sorted', cols[i][1] === sortKey));
      tbody.textContent = '';
      const frag = document.createDocumentFragment();
      for (const it of list.slice(0, 1500)) {
        const cb = h('input', { type: 'checkbox', checked: sel.has(it.key) });
        cb.addEventListener('change', () => { cb.checked ? sel.add(it.key) : sel.delete(it.key); updSum(); });
        const p = VH.priceOf(S.app, it.name);
        frag.append(h('tr', {},
          h('td', {}, cb),
          h('td', {}, it.icon ? h('img', { class: 'vh-ic', loading: 'lazy', src: `https://community.fastly.steamstatic.com/economy/image/${it.icon}/62fx62f` }) : ''),
          h('td', { style: { color: it.color ? '#' + it.color : '' } }, it.display || it.name, it.amount > 1 ? h('span', { class: 'vh-mutetext' }, ` ×${it.amount}`) : '', it.phase ? [' ', VH.phaseBadge(it.phase)] : ''),
          h('td', { class: 'vh-r vh-mono' }, it.float != null ? it.float.toFixed(6) : ''),
          h('td', { class: 'vh-r vh-mono' }, it.seed != null ? String(it.seed) : ''),
          h('td', { class: 'vh-r vh-stks' }, it.stickers.map((s) => (s.img ? h('img', { src: s.img, title: s.market || s.title }) : ''))),
          h('td', { class: 'vh-r vh-mutetext' }, VH.lockLabel(it.lockUntil)),
          h('td', { class: 'vh-r' }, p != null ? VH.money(p * (it.amount || 1)) : '—')));
      }
      tbody.append(frag);
      updSum();
    }
    [q, fTrad, fMark, fStk].forEach((x) => x.addEventListener('input', draw));
    const exportCsv = () => {
      const rows = [['name', 'assetid', 'amount', 'float', 'seed', 'phase', 'stickers', 'tradable_after', 'price_usd_' + VH.cfg.mainProvider]];
      for (const it of filtered()) {
        rows.push([it.name, it.assetid, it.amount, it.float ?? '', it.seed ?? '', it.phase || '', it.stickers.map((s) => s.market || s.title).join(' / '),
          it.lockUntil > 0 ? new Date(it.lockUntil).toISOString() : '', VH.priceOf(S.app, it.name) ?? '']);
      }
      const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      const a = h('a', { href: URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })), download: `inventory_${S.owner}_${S.app}.csv` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    const m = VH.modal({
      title: `Инвентарь · ${items.length} предметов`, wide: true,
      body: [h('div', { class: 'vh-filters' }, q, h('label', {}, fTrad, 'Можно обменять'), h('label', {}, fMark, 'Можно продать'), h('label', {}, fStk, 'С наклейками'),
        VH.btn('Выбрать все найденные', () => { filtered().forEach((it) => sel.add(it.key)); draw(); })),
      h('table', { class: 'vh-table' }, h('thead', {}, head), tbody)],
      actions: [sumEl, VH.btn('CSV', exportCsv),
        S.isOwn && VH.loggedIn() ? VH.btn('Продать выбранные…', () => {
          const chosen = items.filter((it) => sel.has(it.key));
          m.close();
          VH.sell.massDialog(chosen, markSold);
        }, 'primary') : null]
    });
    draw();
  }

  /* ---------- жизненный цикл ---------- */
  let refreshing = false;
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      try { VH.state = await VH.page('state'); } catch (e) { /* оставляем прежнее */ }
      S.owner = VH.state.activeUser || (VH.state.inventory && VH.state.inventory.owner) || ownerFromUrl() || S.owner;
      S.isOwn = !!S.owner && String(S.owner) === String(VH.state.steamId);
      const { app, ctx } = currentContext();
      if (app !== S.app || ctx !== S.ctx) { S.app = app; S.ctx = ctx; S.selected.clear(); defaultOrder = null; }
      buildToolbar();
      decorateAll();
      await loadJson();
      decorateAll();
      await loadPrices();
      decorateAll();
      if (S.sort !== 'default') applySort();
    } finally {
      refreshing = false;
    }
  }

  VH.ready.then(() => {
    if (!VH.cfg.inventoryToolbar) return;
    document.addEventListener('click', onItemClick, true);
    VH.onPage('annotated', () => { buildToolbar(); decorateAll(); });
    window.addEventListener('hashchange', () => setTimeout(refresh, 400));
    document.addEventListener('vh:settings', decorateAll);
    // Steam переключает игры без смены hash — следим за активной вкладкой
    document.addEventListener('click', (e) => { if (e.target.closest('.games_list_tab')) setTimeout(refresh, 900); });
    setTimeout(refresh, 600);
  });
})();
