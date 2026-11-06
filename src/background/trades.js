/*
 * Фоновая проверка трейд-офферов: счётчик на значке, уведомления о новых офферах
 * с оценкой стоимости (через веб-токен вашей сессии Steam, без API-ключа).
 */
(function (root) {
  'use strict';

  const SC = 'https://steamcommunity.com';

  async function notificationCounts() {
    const r = await fetch(`${SC}/actions/GetNotificationCounts`, { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    if (!j || !j.notifications) return null;
    return { offers: Number(j.notifications['1'] || 0), raw: j.notifications };
  }

  async function webToken() {
    const key = 'webtoken';
    const hit = (await chrome.storage.session.get(key))[key];
    if (hit && Date.now() - hit.ts < 30 * 60000) return hit.v;
    const r = await fetch(`${SC}/pointssummary/ajaxgetasyncconfig`, { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(20000) });
    const j = await r.json().catch(() => null);
    const v = j && j.data && j.data.webapi_token;
    if (v) await chrome.storage.session.set({ [key]: { ts: Date.now(), v } });
    return v || null;
  }

  /** Активные входящие офферы с описаниями предметов. */
  async function receivedOffers() {
    const token = await webToken();
    if (!token) return null;
    const url = 'https://api.steampowered.com/IEconService/GetTradeOffers/v1/?get_received_offers=1&active_only=1' +
      '&get_descriptions=1&language=english&access_token=' + encodeURIComponent(token);
    const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    const j = await r.json();
    const resp = j.response || {};
    const desc = {};
    for (const d of resp.descriptions || []) desc[`${d.classid}_${d.instanceid}`] = d;
    const mapItems = (list) => (list || []).map((it) => {
      const d = desc[`${it.classid}_${it.instanceid}`] || {};
      return { appid: Number(it.appid), name: d.market_hash_name || d.name || '?', amount: Number(it.amount || 1) };
    });
    return (resp.trade_offers_received || [])
      .filter((o) => o.trade_offer_state === 2) // активный
      .map((o) => ({
        id: o.tradeofferid,
        partner: o.accountid_other,
        message: o.message || '',
        created: o.time_created,
        give: mapItems(o.items_to_give),
        get: mapItems(o.items_to_receive)
      }));
  }

  async function valueOf(items) {
    let usd = 0;
    let unknown = 0;
    const byApp = {};
    for (const it of items) (byApp[it.appid] = byApp[it.appid] || []).push(it);
    for (const [app, list] of Object.entries(byApp)) {
      const names = [...new Set(list.map((i) => i.name))];
      const res = await root.VH.providers.lookup(Number(app), names, ['waxpeer', 'skinport']);
      for (const it of list) {
        const p = res.steamEstimate[it.name] ?? (res.providers.skinport[it.name] || [])[0];
        if (p != null) usd += p * it.amount; else unknown++;
      }
    }
    return { usd, unknown };
  }

  async function poll(settings) {
    const counts = await notificationCounts().catch(() => null);
    const state = (await chrome.storage.local.get('trades')).trades || { count: 0, seen: [] };
    if (!counts) {
      await chrome.action.setBadgeText({ text: '' });
      state.loggedIn = false;
      await chrome.storage.local.set({ trades: state });
      return state;
    }
    state.loggedIn = true;
    state.count = counts.offers;
    state.checked = Date.now();
    await chrome.action.setBadgeBackgroundColor({ color: '#2f2f2f' });
    await chrome.action.setBadgeText({ text: counts.offers ? String(counts.offers) : '' });

    if (counts.offers > 0) {
      const offers = await receivedOffers().catch(() => null);
      if (offers) {
        for (const o of offers) {
          const [give, get] = await Promise.all([valueOf(o.give), valueOf(o.get)]);
          o.giveUsd = give.usd; o.getUsd = get.usd; o.unknown = give.unknown + get.unknown;
        }
        const fresh = offers.filter((o) => !state.seen.includes(o.id));
        state.offers = offers;
        if (settings.notifyTrades) {
          for (const o of fresh.slice(0, 5)) {
            const gift = o.give.length === 0;
            chrome.notifications.create('offer:' + o.id, {
              type: 'basic',
              iconUrl: chrome.runtime.getURL('icons/icon128.png'),
              title: gift ? 'Подарок в трейде' : 'Новый трейд-оффер',
              message: `Получаете: ${o.get.length} шт. (~$${o.getUsd.toFixed(2)})\nОтдаёте: ${o.give.length} шт. (~$${o.giveUsd.toFixed(2)})`,
              priority: 1
            });
          }
        }
        state.seen = [...new Set([...state.seen, ...offers.map((o) => o.id)])].slice(-200);
      }
    } else {
      state.offers = [];
    }
    await chrome.storage.local.set({ trades: state });
    return state;
  }

  root.VH = root.VH || {};
  root.VH.trades = { poll, notificationCounts, receivedOffers };
})(globalThis);
