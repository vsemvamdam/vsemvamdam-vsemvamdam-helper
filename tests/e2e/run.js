#!/usr/bin/env node
'use strict';
/*
 * Сквозной тест: настоящее расширение в Chrome + страницы-фикстуры Steam.
 * Запуск: npm run e2e  (нужны Google Chrome и пакет playwright)
 *   CHROME=/path/to/chrome — свой браузер, SHOTS=dir — куда сохранить скриншоты.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert/strict');
const fx = require('./fixtures');
const fees = require('../../src/shared/fees.js');

let playwright;
try { playwright = require('playwright'); } catch (e) { playwright = require('/opt/npm-tools/node_modules/playwright'); }

const EXT = path.resolve(__dirname, '..', '..');
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'vh-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const posts = [];
const errors = [];
let passed = 0;
async function step(name, fn) {
  const t = Date.now();
  try { await fn(); passed++; console.log(`  ✓ ${name} (${Date.now() - t} мс)`); } catch (e) { console.log(`  ✗ ${name}\n    ${e.stack || e}`); process.exitCode = 1; }
}

(async () => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-profile-'));
  const ctx = await playwright.chromium.launchPersistentContext(userDir, {
    executablePath: process.env.CHROME || '/usr/bin/google-chrome',
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--disable-features=DisableLoadExtensionCommandLineSwitch', '--headless=new', '--lang=ru'],
    viewport: { width: 1280, height: 900 }
  });

  /* ---------- маршруты страниц ---------- */
  const html = (body) => ({ status: 200, contentType: 'text/html; charset=utf-8', body });
  const json = (o) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    if (req.url().startsWith('chrome-extension://')) return route.continue();
    const u = new URL(req.url());
    const p = u.pathname;
    if (/steamstatic\.com|cdn\.steamstatic/.test(u.host)) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (u.host === 'steamcommunity.com') {
      if (req.method() === 'POST') {
        posts.push({ url: req.url(), body: Object.fromEntries(new URLSearchParams(req.postData() || '')), referer: req.headers().referer });
        if (p === '/market/sellitem/') return route.fulfill(json({ success: true, requires_confirmation: 1, needs_mobile_confirmation: true }));
        if (p.startsWith('/market/buylisting/')) return route.fulfill(json({ wallet_info: { success: 1, wallet_balance: '1' } }));
        if (/\/tradeoffer\/\d+\/accept/.test(p)) return route.fulfill(json({ tradeid: '777', needs_mobile_confirmation: true }));
        if (/\/tradeoffer\/\d+\/decline/.test(p)) return route.fulfill(json({ tradeofferid: '1' }));
        return route.fulfill(json({ success: false }));
      }
      if (p === `/profiles/${fx.ME}/inventory/`) return route.fulfill(html(fx.inventoryPage()));
      if (p === `/inventory/${fx.ME}/730/2`) return route.fulfill(json(fx.inventoryJson()));
      if (p.startsWith('/market/listings/730/')) return route.fulfill(html(fx.listingPage()));
      if (p.startsWith('/tradeoffer/new')) return route.fulfill(html(fx.tradeWindowPage()));
      if (p === `/profiles/${fx.ME}/tradeoffers/`) return route.fulfill(html(fx.tradeListPage()));
      if (p.startsWith('/economy/itemclasshover/730/')) {
        const cls = p.split('/')[4];
        const d = Object.keys(fx.DESCS).find((k) => fx.DESCS[k].classid === cls);
        return route.fulfill(html(fx.classHover(d)));
      }
      if (p === '/id/me' || p === '/id/me/') return route.fulfill(html(fx.profilePage()));
      if (p === '/market/priceoverview/') return route.fulfill(json(fx.apiFixtures().priceoverview));
      return route.fulfill({ status: 404, body: 'nf' });
    }
    if (u.host === 'store.steampowered.com' && p.startsWith('/app/730')) return route.fulfill(html(fx.storePage()));
    return route.fulfill({ status: 404, body: 'blocked in test' });
  });

  /* ---------- сервис-воркер: подменяем fetch внешних API ---------- */
  let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = sw.url().split('/')[2];
  sw.on('console', (m) => { if (m.type() === 'error') errors.push('sw: ' + m.text()); });
  const stubSW = async () => {
  sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  await sw.evaluate((F) => {
    const ok = (o) => new Response(typeof o === 'string' ? o : JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    self.__calls = [];
    self.fetch = async (input) => {
      const url = String(input && input.url ? input.url : input);
      self.__calls.push(url);
      const u = new URL(url);
      if (u.host === 'api.skinport.com') return ok(F.skinport);
      if (u.host === 'market.csgo.com') return ok(F.marketcsgo);
      if (u.host === 'lis-skins.com') return ok(F.lisskins);
      if (u.host === 'api.waxpeer.com') return ok(F.waxpeer);
      if (u.host === 'open.er-api.com') return ok(F.rates);
      if (u.host === 'api.dmarket.com') return ok(F.dmarket);
      if (u.pathname === '/market/priceoverview/') return ok(F.priceoverview);
      if (u.pathname === '/market/itemordershistogram') return ok(F.histogram);
      if (u.pathname.startsWith('/market/listings/')) return ok(F.listingHtml);
      if (u.pathname === '/actions/GetNotificationCounts') return ok(F.counts);
      if (u.pathname === '/pointssummary/ajaxgetasyncconfig') return ok(F.asyncconfig);
      if (u.pathname.startsWith('/IEconService/GetTradeOffers')) return ok(F.offers);
      if (u.pathname === '/market/search/render/') return ok(F.search);
      if (u.pathname === '/api/appdetails') {
        const cc = u.searchParams.get('cc');
        const po = F.appdetails[cc];
        return ok({ 730: po ? { success: true, data: { price_overview: po } } : { success: false } });
      }
      return new Response('not found', { status: 404 });
    };
  }, fx.apiFixtures());
  };
  await stubSW();
  await sw.evaluate(() => chrome.storage.local.clear());

  async function open(url, name) {
    await stubSW();
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(name + ': ' + m.text()); });
    page.on('pageerror', (e) => errors.push(name + ' pageerror: ' + e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(url);
    return page;
  }
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true });

  console.log('Сквозной тест vsemvamdam-helper');

  /* ================= инвентарь ================= */
  const inv = await open(`https://steamcommunity.com/profiles/${fx.ME}/inventory/#730_2`, 'inventory');
  await step('инвентарь: панель с общей стоимостью', async () => {
    await inv.waitForFunction(() => /5 шт/.test((document.querySelector('.vh-toolbar .vh-total') || {}).textContent || ''), null, { timeout: 20000 });
    const total = await inv.textContent('.vh-toolbar .vh-total');
    assert.match(total, /₽/);
    assert.match(total, /5 шт/);
  });
  await step('инвентарь: float, фаза, трейдлок и цена на карточках', async () => {
    await inv.waitForSelector('[id="730_2_1001"] .vh-card .vh-price', { timeout: 15000 });
    assert.equal(await inv.textContent('[id="730_2_1001"] .vh-float'), '0.3267');
    assert.equal(await inv.textContent('[id="730_2_1001"] .vh-wear'), 'FT');
    assert.equal(await inv.textContent('[id="730_2_1002"] .vh-phase'), 'P1');
    assert.match(await inv.textContent('[id="730_2_1003"] .vh-lock'), /🔒\d+д/);
    assert.equal(await inv.locator('[id="730_2_1003"] .vh-card-stickers img').count(), 2);
    assert.match(await inv.textContent('[id="730_2_1004"] .vh-price'), /₽/);
  });
  await step('инвентарь: панель предмета — float, наклейки, сравнение площадок', async () => {
    await inv.click('[id="730_2_1001"] .inventory_item_link');
    await inv.waitForSelector('.inventory_page_right .vh-detail .vh-prices .vh-price-row', { timeout: 15000 });
    const d = await inv.textContent('.vh-detail');
    assert.match(d, /0\.32667022943/);
    assert.match(d, /Паттерн/);
    assert.match(d, /434/);
    assert.match(d, /Skinport/);
    assert.match(d, /LIS-SKINS/);
    assert.equal(await inv.evaluate(() => window.__steamSelected), '730_2_1001', 'клик доходит до Steam');
    await inv.waitForSelector('.vh-detail .vh-sellbox input', { timeout: 15000 });
    await inv.waitForFunction(() => { const r = document.querySelector('.vh-detail .vh-price-row .vh-pval'); return r && /₽/.test(r.textContent) && !/≈/.test(r.textContent); }, null, { timeout: 15000 });
  });
  await step('инвентарь: быстрая продажа отправляет верную цену', async () => {
    await inv.waitForFunction(() => { const i = document.querySelector('.vh-detail .vh-sellbox input'); return i && i.value; }, null, { timeout: 15000 });
    await inv.fill('.vh-detail .vh-sellbox input >> nth=0', '2667.20');
    await inv.dispatchEvent('.vh-detail .vh-sellbox input >> nth=0', 'input');
    const before = posts.length;
    await inv.click('.vh-detail .vh-btn.vh-primary');
    await inv.waitForFunction((n) => true, before);
    for (let i = 0; i < 50 && posts.length === before; i++) await inv.waitForTimeout(100);
    const post = posts[posts.length - 1];
    assert.ok(post && post.url.endsWith('/market/sellitem/'), 'был запрос sellitem');
    assert.equal(post.body.assetid, '1001');
    assert.equal(post.body.sessionid, 'sess123');
    assert.equal(Number(post.body.price), fees.receiveFromPay(266720));
    assert.match(post.referer || '', /inventory/);
    await inv.waitForSelector('[id="730_2_1001"].vh-sold', { timeout: 5000 });
  });
  await shot(inv, 'inventory');
  await step('инвентарь: режим выбора и массовая продажа', async () => {
    await inv.click('.vh-toolbar .vh-selbtn');
    await inv.click('[id="730_2_1004"] .inventory_item_link');
    await inv.click('[id="730_2_1005"] .inventory_item_link');
    await inv.waitForSelector('.vh-selbar');
    assert.match(await inv.textContent('.vh-selbar'), /Выбрано 2/);
    await inv.click('.vh-selbar .vh-btn.vh-primary');
    await inv.waitForSelector('.vh-modal .vh-table tbody tr');
    await inv.waitForFunction(() => { const i = document.querySelector('.vh-modal .vh-table tbody input'); return i && i.value; }, null, { timeout: 20000 });
    await shot(inv, 'mass-sell');
    const before = posts.length;
    await inv.click('.vh-modal-foot .vh-btn.vh-primary');
    for (let i = 0; i < 100 && posts.length < before + 2; i++) await inv.waitForTimeout(100);
    const sells = posts.slice(before).filter((p) => p.url.endsWith('/sellitem/'));
    assert.equal(sells.length, 2);
    assert.deepEqual(sells.map((s) => s.body.assetid).sort(), ['1004', '1005']);
    await inv.click('.vh-modal .vh-x');
  });
  await step('инвентарь: таблица-менеджер с сортировкой и фильтром', async () => {
    await inv.click('.vh-selbar .vh-btn:last-child');
    await inv.click('.vh-toolbar >> text=Таблица');
    await inv.waitForSelector('.vh-modal .vh-table tbody tr');
    assert.equal(await inv.locator('.vh-modal .vh-table tbody tr').count(), 5);
    const first = await inv.textContent('.vh-modal .vh-table tbody tr:first-child');
    assert.match(first, /Karambit/, 'по умолчанию сортировка по цене');
    await inv.fill('.vh-modal .vh-filters input.vh-input', 'case');
    assert.equal(await inv.locator('.vh-modal .vh-table tbody tr').count(), 2);
    await shot(inv, 'manager');
    await inv.click('.vh-modal .vh-x');
  });
  await step('инвентарь: сортировка карточек по цене', async () => {
    await inv.selectOption('.vh-toolbar select >> nth=1', 'price-desc');
    const ids = await inv.$$eval('.itemHolder .item', (els) => els.map((e) => e.id));
    assert.equal(ids[0], '730_2_1002');
  });

  /* ================= маркет ================= */
  const mk = await open('https://steamcommunity.com/market/listings/730/AK-47%20%7C%20Redline%20%28Field-Tested%29', 'market');
  await step('маркет: панель цен и калькулятор', async () => {
    await mk.waitForSelector('.vh-market-panel .vh-price-row', { timeout: 15000 });
    await mk.waitForFunction(() => /Лучшая заявка/.test(document.querySelector('.vh-market-panel').textContent), null, { timeout: 15000 });
    const t = await mk.textContent('.vh-market-panel');
    assert.match(t, /Комиссия Steam/);
    assert.match(t, /Спред/);
  });
  await step('маркет: float, паттерн и наклейки у лотов', async () => {
    await mk.waitForSelector('#listing_6393057183417810717 .vh-listing-extra', { timeout: 15000 });
    const t = await mk.textContent('#listing_6393057183417810717 .vh-listing-extra');
    assert.match(t, /0\.3266702294/);
    assert.match(t, /#434/);
    const t2 = await mk.textContent('#listing_6393057183417810999 .vh-listing-extra');
    assert.match(t2, /0\.1712/);
  });
  await step('маркет: сортировка лотов по float', async () => {
    await mk.selectOption('.vh-market-panel select >> nth=2', 'asc');
    const ids = await mk.$$eval('#searchResultsRows .market_listing_row', (els) => els.map((e) => e.id));
    assert.equal(ids[0], 'listing_6393057183417810999');
  });
  await step('маркет: быстрая покупка', async () => {
    const before = posts.length;
    await mk.click('#listing_6393057183417810717 .vh-qbuy');
    for (let i = 0; i < 50 && posts.length === before; i++) await mk.waitForTimeout(100);
    const b = posts[posts.length - 1];
    assert.match(b.url, /buylisting\/6393057183417810717$/);
    assert.equal(b.body.subtotal, '231931');
    assert.equal(b.body.fee, '34790');
    assert.equal(b.body.total, String(231931 + 34790));
    assert.equal(b.body.currency, '5');
  });
  await shot(mk, 'market');

  /* ================= трейды ================= */
  const tw = await open(`https://steamcommunity.com/tradeoffer/new/?partner=39734371`, 'trade-window');
  await step('окно обмена: суммы сторон и итог', async () => {
    await tw.waitForSelector('.vh-trade-sum b', { timeout: 15000 });
    await tw.waitForFunction(() => /Итог/.test(document.querySelector('.vh-trade-sum').textContent), null, { timeout: 15000 });
    const t = await tw.textContent('.vh-trade-sum');
    assert.match(t, /Вы отдаёте/);
    assert.match(t, /\+/);
    await tw.waitForSelector('[id="item730_2_1002"] .vh-price');
  });
  await shot(tw, 'trade-window');

  const tl = await open(`https://steamcommunity.com/profiles/${fx.ME}/tradeoffers/`, 'trade-list');
  await step('список офферов: оценка и принятие', async () => {
    await tl.waitForSelector('#tradeofferid_5001 .vh-offer-bar', { timeout: 20000 });
    const t = await tl.textContent('#tradeofferid_5001 .vh-offer-bar');
    assert.match(t, /Получаете/);
    assert.match(t, /\+/);
    await tl.waitForFunction(() => document.querySelectorAll('#tradeofferid_5001 .tradeoffer_items.secondary .trade_item .vh-price').length === 2, null, { timeout: 10000 });
    const before = posts.length;
    await tl.click('#tradeofferid_5001 .vh-offer-bar .vh-btn.vh-primary');
    for (let i = 0; i < 50 && posts.length === before; i++) await tl.waitForTimeout(100);
    const a = posts[posts.length - 1];
    assert.match(a.url, /tradeoffer\/5001\/accept$/);
    assert.equal(a.body.partner, (76561197960265728n + 39734371n).toString());
    assert.equal(a.body.tradeofferid, '5001');
    assert.match(a.referer || '', /tradeoffer\/5001\/$/);
    assert.match(await tl.textContent('.vh-trade-sum'), /Принять все подарки \(1\)/);
  });
  await shot(tl, 'trade-list');

  /* ================= профиль, магазин ================= */
  const pf = await open('https://steamcommunity.com/id/me/', 'profile');
  await step('профиль: SteamID и стоимость инвентаря', async () => {
    await pf.waitForSelector('.vh-profile-box', { timeout: 15000 });
    assert.match(await pf.textContent('.vh-profile-box'), new RegExp(fx.ME));
    await pf.click('.vh-profile-box .vh-btn');
    await pf.waitForFunction(() => /предметов/.test(document.querySelector('.vh-profile-box').textContent), null, { timeout: 15000 });
  });
  const st = await open('https://store.steampowered.com/app/730/', 'store');
  await step('магазин: цены в регионах', async () => {
    await st.waitForSelector('.vh-region tr', { timeout: 20000 });
    assert.ok(await st.locator('.vh-region tr').count() >= 3);
  });
  await shot(st, 'store');

  /* ================= попап и фон ================= */
  await stubSW(); // воркер мог перезапуститься за время теста
  const pp = await open(`chrome-extension://${extId}/src/popup/popup.html`, 'popup');
  await pp.setViewportSize({ width: 380, height: 640 });
  await step('попап: трейды и проверка цены', async () => {
    await pp.click('#refresh');
    try {
      await pp.waitForFunction(() => /активных/.test(document.querySelector('#tradeBody').textContent), null, { timeout: 15000 });
    } catch (e) { throw new Error('tradeBody: ' + await pp.textContent('#tradeBody')); }
    await pp.fill('#q', 'redline');
    await pp.waitForSelector('.res', { timeout: 10000 });
    await pp.click('.res');
    await pp.waitForSelector('.detail .prow', { timeout: 10000 });
    assert.ok(await pp.locator('.detail .prow').count() >= 5);
  });
  await shot(pp, 'popup');
  await step('фон: значок с числом офферов', async () => {
    const text = await sw.evaluate(() => chrome.action.getBadgeText({}));
    assert.equal(text, '2');
  });

  const real = errors.filter((e) => !/net::ERR|favicon|404/.test(e));
  await step('без ошибок в консоли', async () => { assert.deepEqual(real, []); });
  console.log(`\nГотово: ${passed} проверок пройдено. Скриншоты: ${SHOTS}`);
  await ctx.close();
})().catch((e) => { console.error(e); process.exit(1); });
