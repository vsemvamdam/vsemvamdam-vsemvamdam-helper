/*
 * Настройки по умолчанию и список площадок.
 */
(function (root) {
  'use strict';

  const PROVIDERS = {
    steam: {
      title: 'Steam', short: 'ST', color: '#c7d5e0',
      url: (n, app) => `https://steamcommunity.com/market/listings/${app}/${encodeURIComponent(n)}`
    },
    skinport: {
      title: 'Skinport', short: 'SP', color: '#fa490a', apps: [730, 570, 252490, 440],
      url: (n, app) => `https://skinport.com/${app === 730 ? '' : { 570: 'dota2/', 252490: 'rust/', 440: 'tf2/' }[app] || ''}market?search=${encodeURIComponent(n)}`
    },
    marketcsgo: {
      title: 'Market.CSGO', short: 'TM', color: '#3d8bfd', apps: [730],
      url: (n) => `https://market.csgo.com/ru/?search=${encodeURIComponent(n)}`
    },
    lisskins: {
      title: 'LIS-SKINS', short: 'LS', color: '#9b6bff', apps: [730],
      url: (n) => `https://lis-skins.com/market/csgo/?query=${encodeURIComponent(n)}`
    },
    waxpeer: {
      title: 'Waxpeer', short: 'WP', color: '#56b4ff', apps: [730, 570, 252490, 440],
      url: (n) => `https://waxpeer.com/?search=${encodeURIComponent(n)}`
    },
    csfloat: {
      title: 'CSFloat', short: 'CF', color: '#8fd0ff', apps: [730], needsKey: true,
      url: (n) => `https://csfloat.com/search?market_hash_name=${encodeURIComponent(n)}&sort_by=lowest_price`
    },
    dmarket: {
      title: 'DMarket', short: 'DM', color: '#4ade80', apps: [730], onDemand: true,
      url: (n) => `https://dmarket.com/ingame-items/item-list/csgo-skins?title=${encodeURIComponent(n)}`
    },
    buff163: {
      title: 'BUFF163', short: 'BF', color: '#e0b04f', apps: [730], linkOnly: true,
      url: (n) => `https://buff.163.com/market/csgo#tab=selling&page_num=1&search=${encodeURIComponent(n)}`
    },
    youpin: {
      title: 'YouPin', short: 'YP', color: '#f0c96a', apps: [730], linkOnly: true,
      url: (n) => `https://www.youpin898.com/market/goods-list?keyWords=${encodeURIComponent(n)}`
    }
  };

  // Площадки с массовой выгрузкой цен (одна загрузка на весь каталог)
  const BULK = ['skinport', 'marketcsgo', 'lisskins', 'waxpeer'];

  const DEFAULTS = {
    lang: 'ru',
    currency: 'auto',            // 'auto' = валюта кошелька Steam
    mainProvider: 'steam',       // цена на карточках
    compare: ['steam', 'skinport', 'marketcsgo', 'lisskins', 'waxpeer', 'csfloat', 'dmarket', 'buff163', 'youpin'],
    cards: { price: true, float: true, wear: true, stickers: true, phase: true, lock: true, seed: false },
    inventoryToolbar: true,
    sellStrategy: 'undercut',    // undercut | lowest | median | buyorder | provider
    sellProvider: 'skinport',
    sellPercent: 100,
    undercutStep: 1,             // в минимальных единицах валюты
    sellDelay: 1500,             // мс между лотами при массовой продаже
    confirmBuy: true,
    marketFloats: true,
    marketPageSize: 10,
    tradeValues: true,
    notifyTrades: true,
    pollMinutes: 1,
    storeRegions: ['US', 'RU', 'KZ', 'TR', 'AR', 'UA', 'PL', 'BR', 'IN', 'CN'],
    theme: 'auto'
  };

  function merge(saved) {
    const s = Object.assign({}, DEFAULTS, saved || {});
    s.cards = Object.assign({}, DEFAULTS.cards, (saved && saved.cards) || {});
    if (!Array.isArray(s.compare)) s.compare = DEFAULTS.compare.slice();
    return s;
  }

  const api = { PROVIDERS, BULK, DEFAULTS, merge };
  root.VH = root.VH || {};
  root.VH.settings = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
