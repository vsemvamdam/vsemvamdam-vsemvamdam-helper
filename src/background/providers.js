/*
 * Загрузка и разбор цен площадок. Все цены приводятся к USD (доллары, дробные).
 * Таблица = { ts, data: { [market_hash_name]: [цена, количество, steamОценка?] } }
 */
(function (root) {
  'use strict';

  const GAME = { 730: 'csgo', 570: 'dota2', 252490: 'rust', 440: 'tf2' };
  const TTL = { skinport: 30, marketcsgo: 20, lisskins: 30, waxpeer: 20 }; // минут

  async function getJSON(url, init) {
    const r = await fetch(url, Object.assign({ cache: 'no-store', signal: AbortSignal.timeout(30000) }, init || {}));
    if (!r.ok) throw new Error(`${new URL(url).host}: HTTP ${r.status}`);
    return r.json();
  }

  const LOADERS = {
    async skinport(app) {
      const j = await getJSON(`https://api.skinport.com/v1/items?app_id=${app}&currency=USD&tradable=0`, {
        headers: { Accept: 'application/json' }
      });
      const data = {};
      for (const it of j || []) {
        const p = it.min_price ?? it.suggested_price;
        if (p != null) data[it.market_hash_name] = [p, it.quantity || 0];
      }
      return data;
    },
    async marketcsgo(app) {
      if (app !== 730) return {};
      const j = await getJSON('https://market.csgo.com/api/v2/prices/USD.json');
      const data = {};
      for (const it of j.items || []) {
        const p = parseFloat(it.price);
        if (!isNaN(p)) data[it.market_hash_name] = [p, parseInt(it.volume, 10) || 0];
      }
      return data;
    },
    async lisskins(app) {
      if (app !== 730) return {};
      const j = await getJSON('https://lis-skins.com/market_export_json/csgo.json');
      const data = {};
      for (const it of j || []) {
        if (it.price != null) data[it.name] = [Number(it.price), it.count || 0];
      }
      return data;
    },
    async waxpeer(app) {
      const game = GAME[app];
      if (!game) return {};
      const j = await getJSON(`https://api.waxpeer.com/v1/prices?game=${game}&minified=0`);
      const data = {};
      for (const it of j.items || []) {
        // Waxpeer отдаёт цены в тысячных долях доллара
        const p = it.min != null ? it.min / 1000 : null;
        const st = it.steam_price != null ? it.steam_price / 1000 : null;
        data[it.name] = [p, it.count || 0, st];
      }
      return data;
    }
  };

  const memory = {};
  const pending = {};

  async function table(provider, app) {
    const key = `tbl:${provider}:${app}`;
    const ttl = (TTL[provider] || 30) * 60 * 1000;
    const mem = memory[key];
    if (mem && Date.now() - mem.ts < ttl) return mem;
    if (pending[key]) return pending[key];
    pending[key] = (async () => {
      try {
        const stored = (await chrome.storage.local.get(key))[key];
        if (stored && Date.now() - stored.ts < ttl) {
          memory[key] = stored;
          return stored;
        }
        try {
          const data = await LOADERS[provider](app);
          const t = { ts: Date.now(), data };
          memory[key] = t;
          await chrome.storage.local.set({ [key]: t });
          return t;
        } catch (e) {
          // сеть недоступна — отдаём устаревшее, если есть
          if (stored) { memory[key] = stored; return Object.assign({ stale: true, error: String(e.message || e) }, stored); }
          return { ts: 0, data: {}, error: String(e.message || e) };
        }
      } finally {
        delete pending[key];
      }
    })();
    return pending[key];
  }

  /** Цены по списку названий из всех массовых площадок. */
  async function lookup(app, names, providers) {
    const list = (providers || root.VH.settings.BULK).filter((p) => LOADERS[p]);
    const out = { providers: {}, steamEstimate: {}, errors: {}, updated: {} };
    const tables = await Promise.all(list.map((p) => table(p, app).then((t) => [p, t])));
    for (const [p, t] of tables) {
      const res = {};
      for (const n of names) {
        const row = t.data[n];
        if (row && row[0] != null) res[n] = [row[0], row[1]];
        if (p === 'waxpeer' && row && row[2]) out.steamEstimate[n] = row[2];
      }
      out.providers[p] = res;
      out.updated[p] = t.ts;
      if (t.error) out.errors[p] = t.error;
    }
    return out;
  }

  /* ---------- CSFloat (по ключу) ---------- */
  async function csfloat(name, key) {
    if (!key) return { error: 'no-key' };
    const url = `https://csfloat.com/api/v1/listings?market_hash_name=${encodeURIComponent(name)}&sort_by=lowest_price&limit=1&type=buy_now`;
    const j = await getJSON(url, { headers: { Authorization: key } });
    const list = Array.isArray(j) ? j : j.data || [];
    const it = list[0];
    if (!it) return { price: null, count: 0 };
    return { price: it.price / 100, float: it.item && it.item.float_value, url: `https://csfloat.com/item/${it.id}` };
  }

  /* ---------- DMarket (по запросу) ---------- */
  async function dmarket(names) {
    const out = {};
    for (let i = 0; i < names.length; i += 100) {
      const chunk = names.slice(i, i + 100);
      const j = await getJSON('https://api.dmarket.com/marketplace-api/v1/aggregated-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filter: { game: 'a8db', titles: chunk }, limit: String(chunk.length) })
      });
      for (const it of j.aggregatedPrices || []) {
        const offer = it.offerBestPrice && parseFloat(it.offerBestPrice.Amount);
        const order = it.orderBestPrice && parseFloat(it.orderBestPrice.Amount);
        out[it.title] = { price: isNaN(offer) ? null : offer, count: Number(it.offerCount) || 0, buy: isNaN(order) ? null : order };
      }
    }
    return out;
  }

  const api = { table, lookup, csfloat, dmarket, LOADERS, GAME };
  root.VH = root.VH || {};
  root.VH.providers = api;
})(globalThis);
