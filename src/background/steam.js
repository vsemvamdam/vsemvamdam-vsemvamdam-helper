/*
 * Запросы к Steam из фонового воркера: точные цены маркета (с очередью — Steam
 * жёстко ограничивает частоту), заявки на покупку, поиск, региональные цены, курсы.
 */
(function (root) {
  'use strict';

  const SC = 'https://steamcommunity.com';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------- очередь с интервалом и паузой при 429 ---------- */
  function createQueue(interval) {
    const jobs = [];
    let running = false;
    let pauseUntil = 0;
    async function run() {
      if (running) return;
      running = true;
      while (jobs.length) {
        const wait = Math.max(0, pauseUntil - Date.now());
        if (wait) await sleep(wait);
        const job = jobs.shift();
        try {
          job.resolve(await job.fn());
        } catch (e) {
          if (e && e.status === 429) {
            pauseUntil = Date.now() + 60000;
            jobs.unshift(job); // повторим после паузы
            continue;
          }
          job.reject(e);
        }
        await sleep(interval);
      }
      running = false;
    }
    return {
      push(fn, priority) {
        return new Promise((resolve, reject) => {
          const job = { fn, resolve, reject };
          if (priority) jobs.unshift(job); else jobs.push(job);
          run();
        });
      },
      get size() { return jobs.length; }
    };
  }

  const queue = createQueue(3100);

  async function steamFetch(url, asText) {
    const r = await fetch(url, { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(20000) });
    if (r.status === 429) { const e = new Error('Steam: слишком много запросов'); e.status = 429; throw e; }
    if (!r.ok) { const e = new Error('Steam: HTTP ' + r.status); e.status = r.status; throw e; }
    return asText ? r.text() : r.json();
  }

  const inflight = {};
  function cached(key, ttlMin, fn) {
    if (inflight[key]) return inflight[key];
    inflight[key] = (async () => {
      const hit = (await chrome.storage.local.get(key))[key];
      if (hit && Date.now() - hit.ts < ttlMin * 60000) return hit.v;
      const v = await fn();
      await chrome.storage.local.set({ [key]: { ts: Date.now(), v } });
      return v;
    })().finally(() => { delete inflight[key]; });
    return inflight[key];
  }

  /** Минимальная/медианная цена и объём за сутки (в валюте currencyId, основные единицы). */
  function priceOverview(app, name, currencyId, priority) {
    const key = `po:${app}:${currencyId}:${name}`;
    return cached(key, 180, () => queue.push(async () => {
      const j = await steamFetch(`${SC}/market/priceoverview/?appid=${app}&currency=${currencyId}&market_hash_name=${encodeURIComponent(name)}`);
      if (!j || !j.success) return { lowest: null, median: null, volume: 0 };
      const P = root.VH.currency.parse;
      return { lowest: P(j.lowest_price), median: P(j.median_price), volume: parseInt(String(j.volume || '0').replace(/\D/g, ''), 10) || 0 };
    }, priority));
  }

  /** item_nameid нужен для стакана заявок — достаём со страницы лота один раз и храним навсегда. */
  async function nameId(app, name) {
    const key = `nid:${app}:${name}`;
    const hit = (await chrome.storage.local.get(key))[key];
    if (hit) return hit;
    const html = await queue.push(() => steamFetch(`${SC}/market/listings/${app}/${encodeURIComponent(name)}`, true), true);
    const m = html.match(/Market_LoadOrderSpread\(\s*(\d+)\s*\)/);
    if (!m) return null;
    await chrome.storage.local.set({ [key]: m[1] });
    return m[1];
  }

  /** Лучшая заявка на покупку и минимальный лот (в минимальных единицах валюты). */
  async function orders(app, name, currencyId, country) {
    const id = await nameId(app, name);
    if (!id) return { highestBuy: null, lowestSell: null };
    const key = `ord:${currencyId}:${id}`;
    return cached(key, 5, async () => {
      const j = await steamFetch(`${SC}/market/itemordershistogram?country=${country || 'US'}&language=english&currency=${currencyId}&item_nameid=${id}&two_factor=0`);
      const toInt = (v) => (v == null || v === '' ? null : parseInt(v, 10));
      return {
        nameid: id,
        highestBuy: toInt(j.highest_buy_order),
        lowestSell: toInt(j.lowest_sell_order),
        buyOrders: (j.buy_order_graph || []).slice(0, 5).map((r) => [r[0], r[1]]),
        sellOrders: (j.sell_order_graph || []).slice(0, 5).map((r) => [r[0], r[1]])
      };
    });
  }

  /** Поиск по маркету Steam (для попапа). */
  async function search(query, app) {
    const j = await steamFetch(`${SC}/market/search/render/?query=${encodeURIComponent(query)}&start=0&count=10&search_descriptions=0&sort_column=popular&sort_dir=desc&appid=${app || 730}&norender=1`);
    return (j.results || []).map((r) => ({
      name: r.hash_name,
      title: r.name,
      app: r.asset_description && r.asset_description.appid,
      icon: r.asset_description && r.asset_description.icon_url,
      color: r.asset_description && r.asset_description.name_color,
      steamPrice: r.sell_price != null ? r.sell_price / 100 : null,
      steamPriceText: r.sell_price_text,
      listings: r.sell_listings
    }));
  }

  /** Цены игры в разных регионах магазина Steam. */
  async function regionalPrices(appid, regions) {
    const out = {};
    for (const cc of regions) {
      try {
        const v = await cached(`rp:${appid}:${cc}`, 360, async () => {
          const r = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&cc=${cc}&filters=price_overview`, { signal: AbortSignal.timeout(15000) });
          const j = await r.json();
          const d = j && j[appid];
          if (!d || !d.success || !d.data || !d.data.price_overview) return null;
          const p = d.data.price_overview;
          return { currency: p.currency, final: p.final / 100, initial: p.initial / 100, discount: p.discount_percent };
        });
        out[cc] = v;
      } catch (e) {
        out[cc] = null;
      }
      await sleep(250);
    }
    return out;
  }

  /** Курсы валют к USD (кэш 6 часов, два независимых источника). */
  async function rates() {
    return cached('rates', 360, async () => {
      try {
        const j = await (await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(15000) })).json();
        if (j && j.rates) return j.rates;
      } catch (e) { /* следующий источник */ }
      const j = await (await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json', { signal: AbortSignal.timeout(15000) })).json();
      const out = {};
      for (const [k, v] of Object.entries(j.usd || {})) out[k.toUpperCase()] = v;
      return out;
    });
  }

  root.VH = root.VH || {};
  root.VH.steam = { priceOverview, nameId, orders, search, regionalPrices, rates, steamFetch, queue };
})(globalThis);
