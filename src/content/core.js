/*
 * vsemvamdam-helper — общее ядро для всех страниц Steam (изолированный мир).
 */
(function () {
  'use strict';
  const VH = globalThis.VH;
  if (VH.core) return;
  const C = VH.currency;

  /* ================= настройки ================= */
  VH.cfg = VH.settings.merge();
  let hasKeys = {};
  const withKeys = (c) => Object.assign(c, { csfloatKey: hasKeys.csfloatKey ? '1' : '' }); // сам ключ остаётся в фоне
  const cfgReady = Promise.all([chrome.storage.sync.get('settings'), chrome.storage.local.get('secrets')])
    .then(([{ settings }, { secrets }]) => { hasKeys = secrets || {}; VH.cfg = withKeys(VH.settings.merge(settings)); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings) {
      VH.cfg = withKeys(VH.settings.merge(changes.settings.newValue));
      document.dispatchEvent(new CustomEvent('vh:settings'));
    }
    if (area === 'local' && changes.secrets) { hasKeys = changes.secrets.newValue || {}; withKeys(VH.cfg); }
  });
  VH.saveCfg = async (patch) => {
    VH.cfg = withKeys(VH.settings.merge(Object.assign({}, VH.cfg, patch)));
    const toSave = Object.assign({}, VH.cfg);
    delete toSave.csfloatKey;
    await chrome.storage.sync.set({ settings: toSave });
  };

  /* ================= сообщения ================= */
  VH.send = (type, payload) => new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(Object.assign({ type }, payload || {}), (r) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (r && r.ok) resolve(r.data); else reject(new Error(r ? r.error : 'нет ответа'));
      });
    } catch (e) { reject(e); }
  });

  let seq = 0;
  const waiters = {};
  const listeners = {};
  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || ev.data.source !== 'vh-main') return;
    const d = ev.data;
    if (d.event) { (listeners[d.event] || []).forEach((fn) => fn(d)); return; }
    const w = waiters[d.id];
    if (!w) return;
    delete waiters[d.id];
    d.error ? w.reject(new Error(d.error)) : w.resolve(d.result);
  });
  /** Вызов метода моста в мире страницы. */
  VH.page = (method, args, timeout) => new Promise((resolve, reject) => {
    const id = 'vh' + (++seq) + '_' + Date.now();
    waiters[id] = { resolve, reject };
    window.postMessage({ source: 'vh-iso', id, method, args }, '*');
    setTimeout(() => { if (waiters[id]) { delete waiters[id]; reject(new Error('bridge timeout')); } }, timeout || 4000);
  });
  VH.onPage = (event, fn) => { (listeners[event] = listeners[event] || []).push(fn); };

  /* ================= состояние страницы и валюта ================= */
  VH.state = {};
  VH.rates = null;
  VH.ready = (async () => {
    await cfgReady;
    try { VH.state = await VH.page('state', null, 6000); } catch (e) { VH.state = {}; }
    try { VH.rates = await VH.send('rates'); } catch (e) { VH.rates = null; }
    if (VH.state.wallet && VH.state.wallet.wallet_currency) {
      // запоминаем валюту кошелька для попапа
      chrome.storage.local.set({ wallet: { currency: C.codeOf(VH.state.wallet.wallet_currency), country: VH.state.wallet.wallet_country, steamId: VH.state.steamId } });
    }
    return VH;
  })();

  VH.walletCurrencyId = () => (VH.state.wallet && VH.state.wallet.wallet_currency) || 1;
  VH.walletCode = () => C.codeOf(VH.walletCurrencyId());
  VH.displayCode = () => (VH.cfg.currency && VH.cfg.currency !== 'auto' ? VH.cfg.currency : VH.walletCode());
  VH.loggedIn = () => !!(VH.state.steamId && VH.state.steamId !== 'false' && VH.state.steamId !== false);

  /** USD -> сумма в валюте отображения. */
  VH.fromUsd = (usd) => (usd == null ? null : C.convert(usd, 'USD', VH.displayCode(), VH.rates));
  VH.toUsd = (amount, code) => (amount == null ? null : C.convert(amount, code, 'USD', VH.rates));
  VH.money = (usd, opts) => {
    const v = VH.fromUsd(usd);
    if (v == null && usd != null) return C.format(usd, 'USD', opts);
    return C.format(v, VH.displayCode(), opts);
  };
  /** Сумма в произвольной валюте -> строка в валюте отображения. */
  VH.moneyFrom = (amount, code, opts) => {
    const disp = VH.displayCode();
    if (code === disp) return C.format(amount, disp, opts);
    const v = C.convert(amount, code, disp, VH.rates);
    return v == null ? C.format(amount, code, opts) : C.format(v, disp, opts);
  };

  /* ================= цены ================= */
  const book = {}; // app -> { providers: {p: {name: [usd, count]}}, est: {name: usd}, exact: {name: {...}} }
  const B = (app) => (book[app] = book[app] || { providers: {}, est: {}, exact: {}, loaded: new Set() });

  /** Подгружает массовые цены для списка названий. */
  VH.loadPrices = async (app, names) => {
    const b = B(app);
    const need = [...new Set(names)].filter((n) => n && !b.loaded.has(n));
    if (!need.length) return b;
    for (let i = 0; i < need.length; i += 1500) {
      const chunk = need.slice(i, i + 1500);
      try {
        const res = await VH.send('prices', { app, names: chunk });
        for (const [p, map] of Object.entries(res.providers)) Object.assign(b.providers[p] = b.providers[p] || {}, map);
        Object.assign(b.est, res.steamEstimate);
        b.errors = Object.assign(b.errors || {}, res.errors);
        b.updated = Object.assign(b.updated || {}, res.updated);
        chunk.forEach((n) => b.loaded.add(n));
      } catch (e) {
        VH.warn('prices', e);
      }
    }
    return b;
  };

  /** Точная цена Steam (минимум, медиана, объём) — через очередь. Возвращает в USD + исходную. */
  const exactPending = {};
  VH.steamExact = (app, name, priority) => {
    const k = app + '|' + name;
    if (B(app).exact[name]) return Promise.resolve(B(app).exact[name]);
    return exactPending[k] || (exactPending[k] = steamExact_(app, name, priority).finally(() => { delete exactPending[k]; }));
  };
  const steamExact_ = async (app, name, priority) => {
    const b = B(app);
    const cid = VH.walletCurrencyId();
    const code = C.codeOf(cid);
    const r = await VH.send('steamPrice', { app, name, currencyId: cid, priority: !!priority });
    const out = {
      code, lowest: r.lowest, median: r.median, volume: r.volume,
      lowestUsd: VH.toUsd(r.lowest, code), medianUsd: VH.toUsd(r.median, code)
    };
    b.exact[name] = out;
    return out;
  };

  /** Цена в USD у площадки (steam — точная, если уже есть, иначе оценка). */
  VH.priceOf = (app, name, provider) => {
    const b = B(app);
    const p = provider || VH.cfg.mainProvider;
    if (p === 'steam') {
      const ex = b.exact[name];
      if (ex && ex.lowestUsd != null) return ex.lowestUsd;
      return b.est[name] != null ? b.est[name] : null;
    }
    const row = (b.providers[p] || {})[name];
    return row ? row[0] : null;
  };
  VH.countOf = (app, name, provider) => {
    const row = (B(app).providers[provider] || {})[name];
    return row ? row[1] : null;
  };
  VH.isEstimate = (app, name) => !(B(app).exact[name] && B(app).exact[name].lowestUsd != null);
  VH.book = B;

  /* ================= справочники CS2 ================= */
  const dataCache = {};
  VH.data = (name) => (dataCache[name] = dataCache[name] ||
    fetch(chrome.runtime.getURL(`src/data/${name}.json`)).then((r) => r.json()).catch(() => ({})));

  /* ================= модель предмета ================= */
  const parser = new DOMParser();
  function parseRich(rich) {
    const out = { stickers: [], charms: [] };
    for (const r of rich || []) {
      const isCharm = r.name === 'keychain_info' || /keychain_info/.test(r.value);
      const doc = parser.parseFromString(r.value || '', 'text/html');
      const imgs = [...doc.querySelectorAll('img')].map((i) => ({
        img: i.getAttribute('src'),
        title: (i.getAttribute('title') || '').replace(/^[^:]+:\s*/, '')
      }));
      const text = (doc.body.textContent || '').trim();
      const names = text.replace(/^[^:]+:\s*/, '').split(/,\s(?=[^,])/).map((s) => s.trim()).filter(Boolean);
      imgs.forEach((im, i) => { if (!im.title && names[i]) im.title = names[i]; });
      (isCharm ? out.charms : out.stickers).push(...imgs);
    }
    return out;
  }

  /** Модель из data-атрибутов, которые проставил мост. */
  VH.itemFromEl = (el) => {
    const d = el.dataset;
    if (!d.vhKey) return null;
    const [appid, contextid, assetid] = d.vhKey.split('_');
    let props = [];
    let rich = [];
    try { props = JSON.parse(d.vhProps || '[]'); } catch (e) { /* ignore */ }
    try { rich = JSON.parse(d.vhRich || '[]'); } catch (e) { /* ignore */ }
    return VH.makeItem({
      appid: Number(appid), contextid, assetid,
      name: d.vhName, display: d.vhDisplay, type: d.vhType, color: d.vhColor, icon: d.vhIcon,
      tradable: d.vhTradable === '1', marketable: d.vhMarketable === '1', commodity: d.vhCommodity === '1',
      amount: Number(d.vhAmount || 1), cacheExp: d.vhCacheExp, lockText: d.vhLock,
      inspect: d.vhInspect, props, rich
    });
  };

  /** Модель из JSON инвентаря (/inventory/…). */
  VH.itemFromJson = (asset, desc, props) => {
    const actions = desc.actions || desc.market_actions || [];
    const tpl = (actions.find((a) => /csgo_econ_action_preview/.test(a.link || '')) || {}).link;
    const allDesc = [].concat(desc.owner_descriptions || [], desc.descriptions || []);
    const lock = allDesc.find((x) => x && /After|Trade Protected/i.test(x.value || ''));
    return VH.makeItem({
      appid: Number(asset.appid), contextid: String(asset.contextid), assetid: String(asset.assetid),
      name: desc.market_hash_name, display: desc.name, type: desc.type, color: desc.name_color, icon: desc.icon_url,
      tradable: !!desc.tradable, marketable: !!desc.marketable, commodity: !!desc.commodity,
      amount: Number(asset.amount || 1), cacheExp: desc.cache_expiration || '',
      lockText: lock ? String(lock.value).replace(/<[^>]+>/g, '').trim() : '',
      inspect: tpl ? VH.inspect.resolveLink(tpl, { properties: props, assetid: asset.assetid }) : '',
      props: props || [],
      rich: (desc.descriptions || []).filter((x) => x && (x.name === 'sticker_info' || x.name === 'keychain_info'))
        .map((x) => ({ name: x.name, value: x.value }))
    });
  };

  VH.makeItem = (raw) => {
    const it = Object.assign({}, raw);
    it.key = `${it.appid}_${it.contextid}_${it.assetid}`;
    const p = VH.inspect.readProperties(it.props);
    let decoded = null;
    const hex = p.inspectHex || VH.inspect.extractHex(it.inspect);
    if (hex) decoded = VH.inspect.decodeHex(hex);
    it.decoded = decoded;
    it.float = p.paintwear != null ? p.paintwear : (decoded && decoded.paintwear != null ? decoded.paintwear : null);
    it.seed = p.paintseed != null ? p.paintseed : (decoded ? decoded.paintseed : null);
    it.paintindex = decoded ? decoded.paintindex : null;
    it.defindex = decoded ? decoded.defindex : null;
    it.wear = it.float != null ? VH.inspect.wearOf(it.float) : null;
    it.phase = it.paintindex != null && /Doppler/i.test(it.name || '') ? VH.inspect.phaseOf(it.paintindex) : null;
    const r = parseRich(it.rich);
    it.stickers = r.stickers.map((s, i) => ({ img: s.img, title: s.title, slotIndex: i }));
    it.charms = r.charms;
    if (decoded) {
      const ds = (decoded.stickers || []).slice().sort((a, b) => (a.slot || 0) - (b.slot || 0));
      ds.forEach((s, i) => {
        const t = it.stickers[i] || (it.stickers[i] = { img: '', title: '' });
        t.id = s.stickerId; t.wear = s.wear || 0; t.slot = s.slot;
      });
      (decoded.keychains || []).forEach((k, i) => {
        const t = it.charms[i] || (it.charms[i] = { img: '', title: '' });
        t.id = k.stickerId; t.pattern = k.pattern; t.highlight = k.highlightReel;
      });
    }
    it.lockUntil = VH.parseLock(it);
    it.stattrak = /StatTrak™/.test(it.name || '');
    it.souvenir = /^Souvenir /.test(it.name || '');
    return it;
  };

  /** Названия наклеек/брелоков для маркета (английские) — по id из inspect-данных. */
  VH.resolveExtras = async (it) => {
    if (!it.stickers.length && !it.charms.length) return it;
    const [st, kc] = await Promise.all([VH.data('stickers'), VH.data('keychains')]);
    for (const s of it.stickers) {
      if (s.market) continue;
      if (s.id != null && st[s.id]) s.market = st[s.id];
      else if (s.title) s.market = /^Sticker \|/.test(s.title) ? s.title : 'Sticker | ' + s.title;
    }
    for (const c of it.charms) {
      if (c.market) continue;
      if (c.id != null && kc[c.id]) c.market = kc[c.id];
      else if (c.title) c.market = /^Charm \|/.test(c.title) ? c.title : 'Charm | ' + c.title;
    }
    return it;
  };

  VH.floatRange = async (it) => {
    if (it.defindex == null || it.paintindex == null) return null;
    const sk = await VH.data('skins');
    const row = sk[`${it.defindex}_${it.paintindex}`];
    return row ? { min: row[0], max: row[1] } : null;
  };

  /** Дата окончания трейдлока, если есть. */
  VH.parseLock = (it) => {
    if (it.tradable && !/After|Trade Protected/i.test(it.lockText || '')) return null;
    if (it.cacheExp) {
      const t = Date.parse(it.cacheExp);
      if (!isNaN(t)) return t;
    }
    const m = (it.lockText || '').match(/After\s+([A-Za-z]{3}\s+\d{1,2},\s+\d{4})(?:\s*\((\d{1,2}:\d{2}:\d{2})\))?/);
    if (m) {
      const t = Date.parse(`${m[1]} ${m[2] || '00:00:00'} GMT`);
      if (!isNaN(t)) return t;
    }
    return it.tradable ? null : -1; // -1 = непередаваемый без даты
  };

  VH.lockLabel = (until) => {
    if (until == null) return '';
    if (until === -1) return '∞';
    const ms = until - Date.now();
    if (ms <= 0) return '';
    const h = Math.ceil(ms / 3600000);
    return h >= 24 ? Math.ceil(h / 24) + 'д' : h + 'ч';
  };

  /* ================= DOM-утилиты ================= */
  VH.h = (tag, props, ...children) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  };
  VH.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  VH.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  VH.warn = (...a) => console.warn('[vsemvamdam-helper]', ...a);
  VH.fmtFloat = (f, digits) => (f == null ? '—' : Number(f).toFixed(digits || 8).replace(/0+$/, '').replace(/\.$/, '.0'));
  VH.copy = async (text) => {
    try { await navigator.clipboard.writeText(text); VH.toast('Скопировано'); } catch (e) { VH.toast('Не удалось скопировать', 'bad'); }
  };

  let toastBox;
  VH.toast = (text, kind, ms) => {
    if (!toastBox) { toastBox = VH.h('div', { class: 'vh-toasts' }); document.body.append(toastBox); }
    const t = VH.h('div', { class: 'vh-toast ' + (kind ? 'vh-' + kind : '') }, text);
    toastBox.append(t);
    setTimeout(() => { t.classList.add('vh-out'); setTimeout(() => t.remove(), 300); }, ms || 2600);
  };

  /** Модальное окно. Возвращает { el, body, close }. */
  VH.modal = ({ title, body, actions, wide, onClose }) => {
    const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const bodyEl = VH.h('div', { class: 'vh-modal-body' }, body);
    const foot = actions && actions.length ? VH.h('div', { class: 'vh-modal-foot' }, actions) : null;
    const box = VH.h('div', { class: 'vh-modal' + (wide ? ' vh-wide' : '') },
      VH.h('div', { class: 'vh-modal-head' },
        VH.h('span', { class: 'vh-logo' }, 'vh'), VH.h('div', { class: 'vh-modal-title' }, title),
        VH.h('button', { class: 'vh-x', title: 'Закрыть', onclick: close }, '×')),
      bodyEl, foot);
    const wrap = VH.h('div', { class: 'vh-overlay', onmousedown: (e) => { if (e.target === wrap) close(); } }, box);
    document.body.append(wrap);
    document.addEventListener('keydown', onKey);
    return { el: box, body: bodyEl, foot, close };
  };

  VH.btn = (label, onclick, kind, extra) => VH.h('button', Object.assign({ class: 'vh-btn ' + (kind ? 'vh-' + kind : ''), onclick }, extra || {}), label);

  /** Наблюдение за DOM с дебаунсом. */
  const own = (n) => n.nodeType !== 1 ? (n.parentElement ? own(n.parentElement) : false)
    : (typeof n.className === 'string' && /(^|\s)vh-/.test(n.className)) || !!n.closest('[class^="vh-"], [class*=" vh-"]');
  /** Наблюдение за DOM с дебаунсом; собственные изменения расширения игнорируются. */
  VH.observe = (root, fn, delay) => {
    let t = 0;
    const mo = new MutationObserver((records) => {
      const foreign = records.some((r) => {
        const nodes = [...r.addedNodes, ...r.removedNodes];
        if (!nodes.length) return false;
        if (r.target.nodeType === 1 && own(r.target)) return false;
        return nodes.some((n) => !own(n));
      });
      if (foreign && !t) t = setTimeout(() => { t = 0; fn(); }, delay || 150);
    });
    mo.observe(root || document.body, { childList: true, subtree: true });
    return mo;
  };

  /* ================= запросы к Steam (same-origin) ================= */
  VH.sessionId = () => VH.state.sessionId || (document.cookie.match(/(?:^|;\s*)sessionid=([^;]+)/) || [])[1] || '';
  VH.post = async (url, data, referrer) => {
    const body = new URLSearchParams(Object.assign({ sessionid: VH.sessionId() }, data));
    const r = await fetch(url, {
      method: 'POST', credentials: 'include', body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      referrer: referrer || location.href
    });
    let j = null;
    try { j = await r.json(); } catch (e) { /* не JSON */ }
    if (!r.ok && !j) throw new Error('HTTP ' + r.status);
    return { status: r.status, json: j };
  };

  /** Весь инвентарь пользователя через JSON-эндпоинт Steam (постранично). */
  VH.fetchInventory = async (steamId, app, ctx, onProgress) => {
    const items = [];
    let start = '';
    for (let page = 0; page < 40; page++) {
      const url = `/inventory/${steamId}/${app}/${ctx}?l=english&count=2000${start ? '&start_assetid=' + start : ''}`;
      const r = await fetch(url, { credentials: 'include' });
      if (r.status === 429) { await VH.sleep(15000); page--; continue; }
      if (!r.ok) throw new Error('Steam вернул ' + r.status + (r.status === 403 ? ' (инвентарь скрыт)' : ''));
      const j = await r.json();
      if (!j || !j.assets) break;
      const desc = {};
      for (const d of j.descriptions || []) desc[`${d.classid}_${d.instanceid}`] = d;
      const propsBy = {};
      for (const ap of j.asset_properties || []) propsBy[ap.assetid] = ap.asset_properties || [];
      for (const a of j.assets) {
        const d = desc[`${a.classid}_${a.instanceid}`];
        if (d) items.push(VH.itemFromJson(a, d, propsBy[a.assetid] || a.asset_properties || d.asset_properties || []));
      }
      onProgress && onProgress(items.length, j.total_inventory_count);
      if (!j.more_items || !j.last_assetid) break;
      start = j.last_assetid;
      await VH.sleep(800);
    }
    return items;
  };

  /* ================= общие элементы интерфейса ================= */
  const PHASE_COLORS = { Ruby: '#c33b4c', Sapphire: '#2f6fd6', 'Black Pearl': '#4b3b63', Emerald: '#1f9a62' };
  VH.phaseBadge = (phase) => VH.h('span', {
    class: 'vh-phase', style: { background: PHASE_COLORS[phase] || '#5b5f66' }
  }, phase.replace('Phase ', 'P'));

  /** Полоса износа с отметкой float. */
  VH.wearBar = (f, range) => {
    const bar = VH.h('div', { class: 'vh-wearbar' },
      VH.h('i', { style: { width: '7%' } }), VH.h('i', { style: { width: '8%' } }), VH.h('i', { style: { width: '23%' } }),
      VH.h('i', { style: { width: '7%' } }), VH.h('i', { style: { width: '55%' } }));
    if (range) {
      bar.append(VH.h('b', { class: 'vh-range', style: { left: range.min * 100 + '%', width: (range.max - range.min) * 100 + '%' } }));
    }
    if (f != null) bar.append(VH.h('em', { style: { left: Math.min(100, Math.max(0, f * 100)) + '%' } }));
    return bar;
  };

  /** Наложение на карточку предмета: цена, float, фаза, трейдлок, наклейки. */
  VH.decorateCard = (el, it, opts) => {
    const o = Object.assign({ price: true }, opts || {});
    const c = VH.cfg.cards;
    let ov = el.querySelector(':scope > .vh-card');
    if (!ov) {
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      ov = VH.h('div', { class: 'vh-card' });
      el.append(ov);
    }
    ov.textContent = '';
    const top = VH.h('div', { class: 'vh-card-top' });
    if (c.wear && it.wear) top.append(VH.h('span', { class: 'vh-chip vh-wear' }, it.wear.short));
    if (c.float && it.float != null) top.append(VH.h('span', { class: 'vh-chip vh-float' }, it.float.toFixed(4)));
    if (c.phase && it.phase) top.append(VH.phaseBadge(it.phase));
    ov.append(top);
    const lock = c.lock ? VH.lockLabel(it.lockUntil) : '';
    if (lock) ov.append(VH.h('span', { class: 'vh-chip vh-lock', title: it.lockText || 'Трейдлок' }, '🔒' + lock));
    if (c.stickers && (it.stickers.length || it.charms.length)) {
      const col = VH.h('div', { class: 'vh-card-stickers' });
      for (const s of it.stickers.slice(0, 6)) if (s.img) col.append(VH.h('img', { src: s.img, title: s.title || '', loading: 'lazy' }));
      for (const ch of it.charms.slice(0, 1)) if (ch.img) col.append(VH.h('img', { src: ch.img, title: ch.title || '', class: 'vh-charm', loading: 'lazy' }));
      ov.append(col);
    }
    if (c.seed && it.seed != null) ov.append(VH.h('span', { class: 'vh-chip vh-seed' }, '#' + it.seed));
    if (o.price && c.price) {
      const usd = VH.priceOf(it.appid, it.name);
      if (usd != null) {
        const total = usd * (it.amount || 1);
        ov.append(VH.h('span', { class: 'vh-chip vh-price', title: VH.settings.PROVIDERS[VH.cfg.mainProvider].title + (it.amount > 1 ? ` · ${it.amount} шт.` : '') },
          (VH.cfg.mainProvider === 'steam' && VH.isEstimate(it.appid, it.name) ? '≈' : '') + VH.money(total, { compact: true })));
      }
    }
    if (c.float && it.float != null) {
      ov.append(VH.h('div', { class: 'vh-card-floatline' }, VH.h('em', { style: { left: Math.min(100, it.float * 100) + '%' } })));
    }
    return ov;
  };

  /** Таблица цен по площадкам для предмета. */
  VH.priceTable = (app, name, opts) => {
    const o = opts || {};
    const P = VH.settings.PROVIDERS;
    const rows = [];
    let best = null;
    for (const p of VH.cfg.compare) {
      const def = P[p];
      if (!def || (def.apps && !def.apps.includes(app))) continue;
      let usd = VH.priceOf(app, name, p);
      if (p === 'csfloat' && o.csfloat) usd = o.csfloat.price;
      if (p === 'dmarket' && o.dmarket) usd = o.dmarket.price;
      if (usd != null && p !== 'steam' && (best == null || usd < best)) best = usd;
      rows.push({ p, def, usd, count: p === 'dmarket' && o.dmarket ? o.dmarket.count : VH.countOf(app, name, p) });
    }
    const steamUsd = VH.priceOf(app, name, 'steam');
    const table = VH.h('div', { class: 'vh-prices' });
    for (const r of rows) {
      const diff = steamUsd && r.usd != null && r.p !== 'steam' ? Math.round((r.usd / steamUsd - 1) * 100) : null;
      table.append(VH.h('a', {
        class: 'vh-price-row' + (r.usd != null && r.usd === best ? ' vh-best' : ''),
        href: r.def.url(name, app), target: '_blank', rel: 'noopener noreferrer'
      },
      VH.h('span', { class: 'vh-dot', style: { background: r.def.color } }),
      VH.h('span', { class: 'vh-pname' }, r.def.title),
      VH.h('span', { class: 'vh-pcount' }, r.count ? r.count + ' шт.' : ''),
      VH.h('span', { class: 'vh-pdiff ' + (diff == null ? '' : diff < 0 ? 'vh-good' : 'vh-bad') }, diff == null ? '' : (diff > 0 ? '+' : '') + diff + '%'),
      VH.h('span', { class: 'vh-pval' }, r.def.linkOnly ? 'открыть ↗' : r.def.needsKey && !VH.cfg.csfloatKey && r.usd == null ? 'нужен ключ' : (r.usd != null ? (r.p === 'steam' && VH.isEstimate(app, name) ? '≈' : '') + VH.money(r.usd) : '—'))));
    }
    return table;
  };

  VH.core = true;
})();
