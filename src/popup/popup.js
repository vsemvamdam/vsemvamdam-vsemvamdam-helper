'use strict';
const C = VH.currency;
const P = VH.settings.PROVIDERS;
const $ = (s) => document.querySelector(s);

let cfg = VH.settings.merge();
let rates = null;
let code = 'USD';

function send(type, payload) {
  return new Promise((resolve, reject) => chrome.runtime.sendMessage(Object.assign({ type }, payload || {}), (r) => {
    if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
    r && r.ok ? resolve(r.data) : reject(new Error(r ? r.error : 'нет ответа'));
  }));
}

function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null) continue;
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}

const money = (usd) => {
  if (usd == null) return '—';
  const v = C.convert(usd, 'USD', code, rates);
  return v == null ? C.format(usd, 'USD') : C.format(v, code);
};

async function init() {
  const [{ settings }, { wallet }] = await Promise.all([chrome.storage.sync.get('settings'), chrome.storage.local.get('wallet')]);
  cfg = VH.settings.merge(settings);
  code = cfg.currency && cfg.currency !== 'auto' ? cfg.currency : (wallet && wallet.currency) || 'USD';
  if (cfg.theme !== 'auto') document.documentElement.dataset.theme = cfg.theme;
  $('#ver').textContent = 'v' + chrome.runtime.getManifest().version + ' · ' + code;
  $('#foot').textContent = 'Цены: ' + P[cfg.mainProvider].title + ' · данные площадок обновляются каждые 20–30 минут';
  try { rates = await send('rates'); } catch (e) { rates = null; }
  loadTrades();
}

async function loadTrades(force) {
  const body = $('#tradeBody');
  try {
    const st = force ? await send('tradesPoll') : (await send('tradesState')) || await send('tradesPoll');
    body.textContent = '';
    if (!st || st.loggedIn === false) {
      body.append(el('div', { class: 'muted' }, 'Войдите в Steam в этом браузере — тогда здесь появятся офферы и уведомления.'));
      return;
    }
    body.append(el('div', { class: 'big num' }, String(st.count || 0)), el('div', { class: 'muted' }, st.count ? 'активных входящих' : 'новых офферов нет'));
    for (const o of (st.offers || []).slice(0, 6)) {
      const d = (o.getUsd || 0) - (o.giveUsd || 0);
      body.append(el('a', { class: 'offer', href: `https://steamcommunity.com/tradeoffer/${o.id}/`, target: '_blank' },
        el('span', {}, o.give.length ? `${o.get.length} за ${o.give.length}` : `подарок · ${o.get.length} шт.`),
        el('span', { class: 'num ' + (d >= 0 ? 'good' : 'bad') }, (d >= 0 ? '+' : '−') + money(Math.abs(d)))));
    }
    if (st.checked) body.append(el('div', { class: 'muted', style: 'font-size:11px;margin-top:6px' }, 'Проверено ' + new Date(st.checked).toLocaleTimeString('ru-RU')));
  } catch (e) {
    body.textContent = 'Не удалось проверить: ' + e.message;
  }
}

let t = 0;
let seq = 0;
$('#q').addEventListener('input', () => {
  clearTimeout(t);
  t = setTimeout(search, 350);
});

async function search() {
  const q = $('#q').value.trim();
  const box = $('#results');
  if (q.length < 2) { box.textContent = ''; return; }
  const my = ++seq;
  box.textContent = '';
  box.append(el('div', { class: 'muted' }, 'Ищу на маркете Steam…'));
  try {
    const list = await send('search', { query: q, app: 730 });
    if (my !== seq) return;
    box.textContent = '';
    if (!list.length) { box.append(el('div', { class: 'muted' }, 'Ничего не найдено')); return; }
    for (const r of list) {
      const row = el('div', { class: 'res' },
        r.icon ? el('img', { src: `https://community.fastly.steamstatic.com/economy/image/${r.icon}/62fx62f` }) : el('span'),
        el('div', { class: 'n' }, r.color ? el('span', { class: 'dot', style: `background:#${r.color};margin-right:6px` }) : null, r.name),
        el('div', { class: 'p' }, r.steamPriceText || ''));
      row.addEventListener('click', () => toggleDetail(row, r));
      box.append(row);
    }
  } catch (e) {
    box.textContent = 'Ошибка: ' + e.message;
  }
}

async function toggleDetail(row, r) {
  const next = row.nextElementSibling;
  if (next && next.classList.contains('detail')) { next.remove(); row.classList.remove('open'); return; }
  row.classList.add('open');
  const d = el('div', { class: 'detail' }, el('div', { class: 'muted' }, 'Загружаю цены площадок…'));
  row.after(d);
  const app = r.app || 730;
  try {
    const res = await send('prices', { app, names: [r.name] });
    const rows = [];
    for (const p of cfg.compare) {
      const def = P[p];
      if (!def || (def.apps && !def.apps.includes(app))) continue;
      let usd = null; let count = null;
      if (p === 'steam') usd = res.steamEstimate[r.name] ?? null;
      else if (res.providers[p] && res.providers[p][r.name]) [usd, count] = res.providers[p][r.name];
      rows.push({ p, def, usd, count });
    }
    if (app === 730 && cfg.compare.includes('dmarket')) {
      try { const dm = (await send('dmarket', { names: [r.name] }))[r.name]; const x = rows.find((y) => y.p === 'dmarket'); if (x && dm) { x.usd = dm.price; x.count = dm.count; } } catch (e) { /* нет данных */ }
    }
    const best = Math.min(...rows.filter((x) => x.usd != null && x.p !== 'steam').map((x) => x.usd));
    d.textContent = '';
    for (const x of rows) {
      d.append(el('a', { class: 'prow' + (x.usd === best ? ' best' : ''), href: x.def.url(r.name, app), target: '_blank' },
        el('span', { class: 'dot', style: `background:${x.def.color}` }), el('span', {}, x.def.title),
        el('span', { class: 'c' }, x.count ? x.count + ' шт.' : ''),
        el('span', { class: 'v' }, x.def.linkOnly ? '↗' : (x.p === 'steam' && x.usd != null ? '≈' : '') + money(x.usd))));
    }
  } catch (e) {
    d.textContent = 'Ошибка: ' + e.message;
  }
}

$('#openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('#refresh').addEventListener('click', () => { $('#tradeBody').textContent = 'Проверяю…'; loadTrades(true); });
init();
$('#q').focus();
