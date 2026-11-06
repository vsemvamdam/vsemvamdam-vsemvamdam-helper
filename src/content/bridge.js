/*
 * vsemvamdam-helper — мост в «мир страницы» (world: MAIN).
 * Читает глобальные объекты Steam (g_steamID, g_rgListingInfo, rgItem у предметов…)
 * и передаёт их изолированным скриптам расширения через postMessage.
 * Ничего не отправляет наружу и не меняет поведение Steam.
 */
(function () {
  'use strict';
  if (window.__vhBridge) return;
  window.__vhBridge = true;

  const ISO = 'vh-iso';
  const MAIN = 'vh-main';

  function pick(obj, keys) {
    const o = {};
    for (const k of keys) if (obj && obj[k] !== undefined) o[k] = obj[k];
    return o;
  }

  function resolveInspect(template, props, assetid, owner, listingid) {
    if (!template) return '';
    return String(template)
      .replace(/%propid:(\d+)%/g, (_, id) => {
        const p = (props || []).find((x) => String(x.propertyid) === id);
        return p ? (p.string_value ?? p.int_value ?? p.float_value ?? '') : '';
      })
      .replace(/%assetid%/g, assetid || '')
      .replace(/%owner_steamid%/g, owner || '')
      .replace(/%listingid%/g, listingid || '');
  }

  function richDescriptions(d) {
    return (d.descriptions || [])
      .filter((x) => x && (x.name === 'sticker_info' || x.name === 'keychain_info' || /sticker_info|keychain_info/.test(x.value || '')))
      .map((x) => ({ name: x.name, value: x.value }));
  }

  function lockText(d) {
    const all = [].concat(d.owner_descriptions || [], d.descriptions || []);
    const hit = all.find((x) => x && /After|после|Trade Protected|защищ/i.test(x.value || ''));
    return hit ? String(hit.value).replace(/<[^>]+>/g, '').trim() : '';
  }

  /* ---------- аннотация предметов ---------- */
  const done = new WeakMap();
  let scanTimer = 0;

  function ownerFor(el) {
    try {
      if (window.UserYou && el.closest('#your_slots')) return window.UserYou.strSteamId;
      if (window.UserThem && el.closest('#their_slots')) return window.UserThem.strSteamId;
      const inv = window.g_ActiveInventory;
      const o = inv && (inv.owner || inv.m_owner);
      if (o && o.strSteamId) return o.strSteamId;
      if (window.g_ActiveUser) return window.g_ActiveUser.strSteamId;
    } catch (e) { /* ignore */ }
    return '';
  }

  function annotate(el) {
    const r = el.rgItem;
    if (!r || done.get(el) === r) return false;
    const d = r.description || r;
    if (!d || (!d.market_hash_name && !d.name)) return false;
    const appid = r.appid || d.appid;
    const contextid = r.contextid || d.contextid;
    const assetid = r.assetid || r.id || d.id || '';
    const props = r.asset_properties || d.asset_properties || r.properties || [];
    const owner = ownerFor(el);
    const actions = d.actions || d.market_actions || [];
    const inspectTpl = (actions.find((a) => /csgo_econ_action_preview/.test(a.link || '')) || {}).link;
    const ds = el.dataset;
    ds.vhKey = `${appid}_${contextid}_${assetid}`;
    ds.vhName = d.market_hash_name || d.name || '';
    ds.vhDisplay = d.name || '';
    ds.vhType = d.type || '';
    ds.vhColor = d.name_color || '';
    ds.vhIcon = d.icon_url || '';
    ds.vhTradable = d.tradable ? '1' : '0';
    ds.vhMarketable = d.marketable ? '1' : '0';
    ds.vhCommodity = d.commodity ? '1' : '0';
    ds.vhAmount = String(r.amount || 1);
    ds.vhCacheExp = d.cache_expiration || '';
    ds.vhLock = lockText(d);
    ds.vhInspect = inspectTpl ? resolveInspect(inspectTpl, props, assetid, owner) : '';
    ds.vhProps = JSON.stringify((props || []).map((p) => pick(p, ['propertyid', 'int_value', 'float_value', 'string_value'])));
    ds.vhRich = JSON.stringify(richDescriptions(d));
    ds.vhNametag = (d.fraudwarnings || []).join(' ').slice(0, 200);
    done.set(el, r);
    return true;
  }

  function scan() {
    scanTimer = 0;
    let n = 0;
    const els = document.querySelectorAll('.item, .trade_item, .inventory_item_link');
    for (const el of els) if (annotate(el.classList.contains('inventory_item_link') ? el.parentElement || el : el)) n++;
    if (n) window.postMessage({ source: MAIN, event: 'annotated', count: n }, '*');
  }

  function scheduleScan() {
    if (!scanTimer) scanTimer = setTimeout(scan, 120);
  }

  const mo = new MutationObserver(scheduleScan);
  function startObserver() {
    mo.observe(document.documentElement, { childList: true, subtree: true });
    scheduleScan();
    // rgItem иногда присваивается после вставки элемента — подстрахуемся
    let ticks = 0;
    const iv = setInterval(() => { scheduleScan(); if (++ticks > 40) clearInterval(iv); }, 1500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserver);
  else startObserver();

  /* ---------- методы по запросу ---------- */
  const methods = {
    state() {
      const inv = window.g_ActiveInventory;
      return {
        steamId: window.g_steamID || null,
        sessionId: window.g_sessionID || null,
        lang: window.g_strLanguage || null,
        country: window.g_strCountryCode || null,
        wallet: window.g_rgWalletInfo ? pick(window.g_rgWalletInfo, ['wallet_currency', 'wallet_country', 'wallet_balance', 'wallet_fee_percent', 'wallet_publisher_fee_percent_default']) : null,
        inventory: inv ? {
          appid: inv.appid, contextid: inv.contextid,
          owner: (inv.owner && inv.owner.strSteamId) || (inv.m_owner && inv.m_owner.strSteamId) || null
        } : null,
        activeUser: window.g_ActiveUser ? window.g_ActiveUser.strSteamId : null,
        tradePartner: window.UserThem ? window.UserThem.strSteamId : (window.g_ulTradePartnerSteamID || null),
        isTradeOffer: !!window.g_bTradeOffer,
        profile: window.g_rgProfileData ? pick(window.g_rgProfileData, ['steamid', 'personaname', 'url']) : null,
        pubFee: window.g_fPubFee_Rate != null ? Number(window.g_fPubFee_Rate) : null
      };
    },
    listings() {
      const info = window.g_rgListingInfo || {};
      const assets = window.g_rgAssets || {};
      const out = [];
      for (const id of Object.keys(info)) {
        const li = info[id];
        const a = li.asset || {};
        const full = (((assets[a.appid] || {})[a.contextid] || {})[a.id]) || {};
        const props = full.asset_properties || [];
        const tpl = ((a.market_actions || full.market_actions || []).find((x) => /csgo_econ_action_preview/.test(x.link || '')) || {}).link;
        out.push({
          listingid: li.listingid || id,
          price: li.price, fee: li.fee, currencyid: li.currencyid,
          converted_price: li.converted_price, converted_fee: li.converted_fee,
          converted_currencyid: li.converted_currencyid,
          publisher_fee_percent: li.publisher_fee_percent,
          asset: {
            appid: a.appid, contextid: a.contextid, id: a.id,
            name: full.market_hash_name || '', display: full.name || '', color: full.name_color || '',
            inspect: tpl ? resolveInspect(tpl, props, a.id, '', id) : '',
            props: props.map((p) => pick(p, ['propertyid', 'int_value', 'float_value', 'string_value'])),
            rich: richDescriptions(full)
          }
        });
      }
      return out;
    },
    setMarketPageSize({ size, target }) {
      const name = target === 'mylistings' ? 'g_oMyListings' : 'g_oSearchResults';
      const s = window[name];
      if (!s || typeof s.GoToPage !== 'function') return false;
      s.m_cPageSize = Number(size) || 10;
      s.GoToPage(0, true);
      return true;
    },
    rescan() {
      scan();
      return true;
    },
    reloadInventory() {
      try {
        const inv = window.g_ActiveInventory;
        if (inv && typeof inv.ReloadInventory === 'function') { inv.ReloadInventory(); return true; }
      } catch (e) { /* ignore */ }
      return false;
    }
  };

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || ev.data.source !== ISO) return;
    const { id, method, args } = ev.data;
    let result;
    let error;
    try {
      result = methods[method] ? methods[method](args || {}) : undefined;
      if (!methods[method]) error = 'unknown method ' + method;
    } catch (e) {
      error = String(e && e.message || e);
    }
    window.postMessage({ source: MAIN, id, result, error }, '*');
  });
})();
