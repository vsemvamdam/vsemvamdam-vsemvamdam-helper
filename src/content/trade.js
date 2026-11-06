/*
 * vsemvamdam-helper — трейды.
 *  /tradeoffer/new/, /tradeoffer/<id>/ — окно обмена: цены на предметах, суммы сторон, разница.
 *  /tradeoffers/ — список офферов: стоимость обеих сторон, профит, принять/отклонить,
 *                  сортировка по выгоде, «принять все подарки».
 */
(function () {
  'use strict';
  const VH = globalThis.VH;
  const h = VH.h;

  const isWindow = /^\/tradeoffer\/(new|\d+)/.test(location.pathname);
  const isList = /\/tradeoffers(\/sent)?\/?$/.test(location.pathname);
  if (!isWindow && !isList) return;

  function sideValue(models) {
    let usd = 0; let unknown = 0; let n = 0;
    for (const it of models) {
      n += it.amount || 1;
      const p = VH.priceOf(it.appid, it.name);
      if (p != null) usd += p * (it.amount || 1); else unknown++;
    }
    return { usd, unknown, n };
  }

  function deltaView(give, get) {
    const d = get.usd - give.usd;
    const pct = give.usd > 0 ? d / give.usd * 100 : (get.usd > 0 ? 100 : 0);
    return h('span', { class: 'vh-delta ' + (d >= 0 ? 'vh-good' : 'vh-bad') },
      (d >= 0 ? '+' : '−') + VH.money(Math.abs(d)) + (give.usd > 0 ? ` (${Math.abs(pct) > 999 ? (d >= 0 ? '>+999' : '<−999') : (d >= 0 ? '+' : '') + pct.toFixed(1)}%)` : ''));
  }

  async function pricesFor(models) {
    const byApp = {};
    for (const it of models) (byApp[it.appid] = byApp[it.appid] || new Set()).add(it.name);
    await Promise.all(Object.entries(byApp).map(([app, names]) => VH.loadPrices(Number(app), [...names])));
  }

  /* ======================= окно обмена ======================= */
  function tradeWindow() {
    let bar = null;

    function models(sel) {
      return [...document.querySelectorAll(sel)].map((el) => VH.itemFromEl(el)).filter(Boolean);
    }

    async function update() {
      const all = [...document.querySelectorAll('.item[data-vh-key]')];
      const allModels = all.map((el) => [el, VH.itemFromEl(el)]).filter(([, m]) => m);
      await pricesFor(allModels.map(([, m]) => m));
      if (VH.cfg.tradeValues) for (const [el, m] of allModels) VH.decorateCard(el, m);
      const give = sideValue(models('#your_slots .item[data-vh-key]'));
      const get = sideValue(models('#their_slots .item[data-vh-key]'));
      if (!bar || !bar.isConnected) {
        bar = h('div', { class: 'vh-trade-sum' });
        const anchor = document.querySelector('.trade_area') || document.querySelector('#trade_area') || document.querySelector('.trade_partner_header');
        if (!anchor || !anchor.parentElement) return;
        anchor.parentElement.insertBefore(bar, anchor);
      }
      bar.textContent = '';
      bar.append(h('span', { class: 'vh-logo' }, 'vh'),
        h('span', {}, 'Вы отдаёте: ', h('b', {}, VH.money(give.usd)), ` · ${give.n} шт.`, give.unknown ? h('span', { class: 'vh-mutetext' }, ` · без цены: ${give.unknown}`) : ''),
        h('span', {}, 'Вы получаете: ', h('b', {}, VH.money(get.usd)), ` · ${get.n} шт.`, get.unknown ? h('span', { class: 'vh-mutetext' }, ` · без цены: ${get.unknown}`) : ''),
        h('span', {}, 'Итог: ', deltaView(give, get)),
        h('span', { class: 'vh-mutetext' }, 'по ' + VH.settings.PROVIDERS[VH.cfg.mainProvider].title));
      if (give.n && !get.n) bar.append(h('span', { class: 'vh-bad' }, '⚠ вы ничего не получаете'));
    }

    let busy = false;
    const run = async () => { if (busy) return; busy = true; try { await update(); } finally { busy = false; } };
    VH.onPage('annotated', run);
    VH.observe(document.body, run, 500);
    document.addEventListener('vh:settings', run);
    run();
  }

  /* ======================= список офферов ======================= */
  /** Индекс закрывающей скобки для JSON-объекта, начинающегося в s[from]. */
  function matchBrace(s, from) {
    let depth = 0; let inStr = false; let esc = false;
    for (let i = from; i < s.length; i++) {
      const c = s[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return i;
    }
    return -1;
  }

  const classCache = new Map();
  async function classInfo(app, classid, instanceid) {
    const key = `${app}_${classid}_${instanceid}`;
    if (classCache.has(key)) return classCache.get(key);
    const p = (async () => {
      const r = await fetch(`/economy/itemclasshover/${app}/${classid}/${instanceid || 0}?content_only=1&l=english`, { credentials: 'include' });
      const t = await r.text();
      const i = t.indexOf('BuildHover(');
      if (i < 0) return null;
      const start = t.indexOf('{', i);
      const end = matchBrace(t, start);
      if (start < 0 || end < 0) return null;
      try { return JSON.parse(t.slice(start, end + 1)); } catch (e) { return null; }
    })();
    classCache.set(key, p);
    return p;
  }

  async function offerItems(container) {
    const out = [];
    for (const el of container ? container.querySelectorAll('.trade_item') : []) {
      const ei = el.getAttribute('data-economy-item') || '';
      // форматы: classinfo/730/classid/instanceid  или  730/2/assetid/ownerid
      let m = ei.match(/classinfo\/(\d+)\/(\d+)\/?(\d+)?/);
      let d = null;
      if (m) d = await classInfo(m[1], m[2], m[3]);
      else if ((m = ei.match(/^(\d+)\/(\d+)\/(\d+)/))) d = null;
      if (!d) continue;
      const it = VH.itemFromJson({ appid: d.appid, contextid: d.contextid || '2', assetid: '', amount: 1 }, d, []);
      const amt = el.querySelector('.item_currency_amount, .trade_item_amount');
      if (amt) it.amount = parseInt(amt.textContent.replace(/\D/g, ''), 10) || 1;
      out.push([el, it]);
    }
    return out;
  }

  function partnerSteamId(offer) {
    const av = offer.querySelector('.tradeoffer_partner [data-miniprofile]');
    const acc = av && av.getAttribute('data-miniprofile');
    return acc ? (76561197960265728n + BigInt(acc)).toString() : '';
  }

  async function acceptOffer(id, partner) {
    const { json } = await VH.post(`https://steamcommunity.com/tradeoffer/${id}/accept`,
      { serverid: 1, tradeofferid: id, partner, captcha: '' }, `https://steamcommunity.com/tradeoffer/${id}/`);
    if (json && (json.tradeid || json.needs_mobile_confirmation || json.needs_email_confirmation)) {
      return json.needs_mobile_confirmation ? 'confirm' : json.needs_email_confirmation ? 'email' : 'ok';
    }
    throw new Error((json && json.strError) || 'Steam не принял оффер');
  }

  async function declineOffer(id) {
    const { status, json } = await VH.post(`https://steamcommunity.com/tradeoffer/${id}/decline`, {});
    if (status !== 200 || (json && json.strError)) throw new Error((json && json.strError) || 'не удалось отклонить');
  }

  async function tradeList() {
    const sent = /\/sent/.test(location.pathname);
    const offers = [...document.querySelectorAll('.tradeoffer[id^="tradeofferid_"]')];
    const results = [];
    for (const offer of offers) {
      const id = offer.id.replace('tradeofferid_', '');
      const primary = await offerItems(offer.querySelector('.tradeoffer_items.primary'));
      const secondary = await offerItems(offer.querySelector('.tradeoffer_items.secondary'));
      const mine = sent ? primary : secondary;
      const theirs = sent ? secondary : primary;
      await pricesFor([...mine, ...theirs].map(([, m]) => m));
      for (const [el, m] of [...mine, ...theirs]) VH.decorateCard(el, m);
      const give = sideValue(mine.map(([, m]) => m));
      const get = sideValue(theirs.map(([, m]) => m));
      const active = !!offer.querySelector('.tradeoffer_footer_actions a, .tradeoffer_footer_actions .whiteLink') && !offer.querySelector('.tradeoffer_items_banner');
      const bar = h('div', { class: 'vh-offer-bar' },
        h('span', { class: 'vh-logo' }, 'vh'),
        h('span', {}, 'Получаете ', h('b', {}, VH.money(get.usd)), get.unknown ? h('span', { class: 'vh-mutetext' }, ` (+${get.unknown} без цены)`) : ''),
        h('span', {}, 'Отдаёте ', h('b', {}, VH.money(give.usd)), give.unknown ? h('span', { class: 'vh-mutetext' }, ` (+${give.unknown} без цены)`) : ''),
        h('span', {}, 'Итог ', deltaView(give, get)));
      if (!sent && active) {
        const partner = partnerSteamId(offer);
        const acc = VH.btn(mine.length ? 'Принять' : 'Принять подарок', async () => {
          if (mine.length && !confirm(`Принять оффер? Вы отдаёте ${mine.length} шт. (~${VH.money(give.usd)}), получаете ${theirs.length} шт. (~${VH.money(get.usd)}).`)) return;
          acc.disabled = true;
          try {
            const r = await acceptOffer(id, partner);
            VH.toast(r === 'confirm' ? 'Принято — подтвердите в мобильном приложении Steam' : r === 'email' ? 'Принято — подтвердите по почте' : 'Обмен принят', 'good', 6000);
            offer.style.opacity = '.45';
          } catch (e) { VH.toast(e.message, 'bad'); acc.disabled = false; }
        }, 'primary');
        const dec = VH.btn('Отклонить', async () => {
          if (!confirm('Отклонить оффер?')) return;
          dec.disabled = true;
          try { await declineOffer(id); VH.toast('Оффер отклонён'); offer.style.opacity = '.45'; } catch (e) { VH.toast(e.message, 'bad'); dec.disabled = false; }
        }, 'danger');
        bar.append(acc, dec);
      }
      const old = offer.querySelector('.vh-offer-bar');
      if (old) old.remove();
      (offer.querySelector('.tradeoffer_items_ctn') || offer).after(bar);
      results.push({ offer, id, give, get, delta: get.usd - give.usd, gift: !mine.length && theirs.length > 0, active });
    }
    // панель списка
    const head = document.querySelector('.profile_leftcol') || document.querySelector('#BG_bottom .maincontent');
    if (head && results.length) {
      const total = results.reduce((a, r) => a + r.delta, 0);
      const gifts = results.filter((r) => r.gift && r.active && !sent);
      const listBar = h('div', { class: 'vh-trade-sum' }, h('span', { class: 'vh-logo' }, 'vh'),
        h('span', {}, `Офферов: ${results.length} · суммарный итог `), deltaView({ usd: 0 }, { usd: total }),
        VH.btn('Сначала выгодные', () => {
          const parent = results[0].offer.parentElement;
          results.slice().sort((a, b) => b.delta - a.delta).forEach((r) => parent.append(r.offer));
        }),
        gifts.length ? VH.btn(`Принять все подарки (${gifts.length})`, async () => {
          for (const g of gifts) {
            try { await acceptOffer(g.id, partnerSteamId(g.offer)); g.offer.style.opacity = '.45'; } catch (e) { VH.toast(e.message, 'bad'); }
            await VH.sleep(1200);
          }
          VH.toast('Подарки приняты', 'good');
        }, 'primary') : null);
      head.prepend(listBar);
    }
  }

  VH.ready.then(() => {
    if (isWindow) tradeWindow();
    else tradeList();
  });
})();
