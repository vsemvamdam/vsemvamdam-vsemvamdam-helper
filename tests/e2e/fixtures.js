'use strict';
/*
 * Фикстуры для сквозного теста: страницы и ответы, повторяющие реальную
 * разметку и JSON Steam (сняты с steamcommunity.com в ноябре 2026).
 */
const { checksum } = require('../../src/shared/inspect.js');

/* ---------- кодировщик inspect-hex (обёрнутый формат) ---------- */
function varint(n) {
  const out = [];
  let v = BigInt(n);
  do { let b = Number(v & 0x7fn); v >>= 7n; if (v) b |= 0x80; out.push(b); } while (v);
  return out;
}
const floatBits = (f) => { const dv = new DataView(new ArrayBuffer(4)); dv.setFloat32(0, f, true); return dv.getUint32(0, true); };
function field(no, wire, bytes) { return [...varint((no << 3) | wire), ...bytes]; }
function encodeSticker(s) {
  const b = [...field(1, 0, varint(s.slot)), ...field(2, 0, varint(s.id))];
  if (s.wear) { const dv = new DataView(new ArrayBuffer(4)); dv.setFloat32(0, s.wear, true); b.push(...field(3, 5, [...new Uint8Array(dv.buffer)])); }
  return b;
}
function inspectHex({ defindex, paintindex, paintseed, paintwear, rarity = 6, stickers = [] }) {
  let p = [...field(3, 0, varint(defindex)), ...field(4, 0, varint(paintindex)), ...field(5, 0, varint(rarity)),
    ...field(7, 0, varint(floatBits(paintwear))), ...field(8, 0, varint(paintseed))];
  for (const s of stickers) { const e = encodeSticker(s); p = p.concat(field(12, 2, [...varint(e.length), ...e])); }
  const payload = Uint8Array.from(p);
  const crc = checksum(payload);
  const all = [0, ...payload, (crc >>> 24) & 255, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255];
  return all.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

const ME = '76561198000000001';
const PARTNER = '76561198000000099';
const LIVE_HEX = '8A9A126D5334408B928DAA1088A28FBA8EB25808177F89CA3889E88582889A0BAFB7A2DD0EB7CF2ABC88B6E285FA8206BC2379';
const DOPPLER_HEX = inspectHex({ defindex: 507, paintindex: 418, paintseed: 77, paintwear: 0.0123 });
const STICKERED_HEX = inspectHex({ defindex: 7, paintindex: 282, paintseed: 661, paintwear: 0.1712, stickers: [{ slot: 0, id: 4, wear: 0.25 }, { slot: 1, id: 1 }] });

const INSPECT_TPL = 'steam://run/730//+csgo_econ_action_preview%20%propid:6%';
const stickerHtml = (names) => `<br><div id="sticker_info" class="sticker_info" style="border: 2px solid rgb(102, 102, 102); border-radius: 6px; width=100%; margin:4px; padding:8px;"><center>${
  names.map((n) => `<img width=64 height=48 src="https://cdn.steamstatic.com/apps/730/icons/econ/stickers/x/${encodeURIComponent(n)}.png" title="Sticker: ${n}">`).join('')
}<br>Sticker: ${names.join(', ')}</center></div>`;

const DESCS = {
  redline: {
    appid: 730, classid: '7993036958', instanceid: '9171932820', icon_url: 'redline', name: 'AK-47 | Redline', name_color: 'D2D2D2',
    market_hash_name: 'AK-47 | Redline (Field-Tested)', type: 'Classified Rifle', tradable: 1, marketable: 1, commodity: 0,
    actions: [{ link: INSPECT_TPL, name: 'Inspect in Game...' }], market_actions: [{ link: INSPECT_TPL, name: 'Inspect in Game...' }],
    descriptions: [{ type: 'html', value: 'Exterior: Field-Tested', name: 'exterior_wear' }, { type: 'html', value: stickerHtml(['FaZe | 2020 RMR']), name: 'sticker_info' }]
  },
  doppler: {
    appid: 730, classid: '111', instanceid: '0', icon_url: 'karambit', name: '★ Karambit | Doppler', name_color: '8650AC',
    market_hash_name: '★ Karambit | Doppler (Factory New)', type: '★ Covert Knife', tradable: 1, marketable: 1, commodity: 0,
    actions: [{ link: INSPECT_TPL, name: 'Inspect in Game...' }], descriptions: []
  },
  hyper: {
    appid: 730, classid: '222', instanceid: '0', icon_url: 'hyper', name: 'AWP | Asiimov', name_color: 'D2D2D2',
    market_hash_name: 'AWP | Asiimov (Field-Tested)', type: 'Covert Sniper Rifle', tradable: 0, marketable: 0, commodity: 0,
    cache_expiration: new Date(Date.now() + 3 * 86400000).toISOString(),
    owner_descriptions: [{ type: 'html', value: 'Tradable/Marketable After Nov 09, 2026 (7:00:00) GMT', color: 'ff4040' }],
    actions: [{ link: INSPECT_TPL, name: 'Inspect in Game...' }],
    descriptions: [{ type: 'html', value: stickerHtml(['Shooter', 'Titan (Holo) | Katowice 2014']), name: 'sticker_info' }]
  },
  kilowatt: {
    appid: 730, classid: '333', instanceid: '0', icon_url: 'case', name: 'Kilowatt Case', name_color: 'D2D2D2',
    market_hash_name: 'Kilowatt Case', type: 'Base Grade Container', tradable: 1, marketable: 1, commodity: 1, descriptions: []
  }
};

const ASSETS = [
  { assetid: '1001', d: 'redline', props: [{ propertyid: 1, int_value: '434' }, { propertyid: 2, float_value: '0.326670229434967041' }, { propertyid: 6, string_value: LIVE_HEX }] },
  { assetid: '1002', d: 'doppler', props: [{ propertyid: 1, int_value: '77' }, { propertyid: 2, float_value: '0.0123' }, { propertyid: 6, string_value: DOPPLER_HEX }] },
  { assetid: '1003', d: 'hyper', props: [{ propertyid: 1, int_value: '661' }, { propertyid: 2, float_value: '0.1712' }, { propertyid: 6, string_value: STICKERED_HEX }] },
  { assetid: '1004', d: 'kilowatt', props: [] },
  { assetid: '1005', d: 'kilowatt', props: [] }
];

function inventoryJson() {
  return {
    success: 1, total_inventory_count: ASSETS.length, more_items: 0,
    assets: ASSETS.map((a) => ({ appid: 730, contextid: '2', assetid: a.assetid, classid: DESCS[a.d].classid, instanceid: DESCS[a.d].instanceid, amount: '1' })),
    descriptions: Object.values(DESCS),
    asset_properties: ASSETS.filter((a) => a.props.length).map((a) => ({ appid: 730, contextid: '2', assetid: a.assetid, asset_properties: a.props }))
  };
}

const GLOBALS = `
  window.g_steamID = "${ME}"; window.g_sessionID = "sess123"; window.g_strLanguage = "english"; window.g_strCountryCode = "RU";
  window.g_rgWalletInfo = { wallet_currency: 5, wallet_country: "RU", wallet_fee_percent: "0.05", wallet_publisher_fee_percent_default: "0.10", wallet_balance: 100000 };
`;

function inventoryPage() {
  const holders = ASSETS.map((a) => `<div class="itemHolder"><div class="item app730 context2" id="730_2_${a.assetid}"><img src="https://community.fastly.steamstatic.com/economy/image/${DESCS[a.d].icon_url}/96fx96f"><a href="#730_2_${a.assetid}" class="inventory_item_link"></a></div></div>`).join('');
  const rg = ASSETS.map((a) => `document.getElementById('730_2_${a.assetid}').rgItem = { appid: 730, contextid: '2', assetid: '${a.assetid}', amount: 1, description: D['${a.d}'], asset_properties: ${JSON.stringify(a.props)} };`).join('\n');
  return `<!doctype html><html><head><title>Steam Community :: Me :: Inventory</title>
  <style>body{background:#1b2838;color:#c6d4df;font-family:Arial} .inventory_page_left{float:left;width:640px} .inventory_page_right{float:left;width:360px;margin-left:20px}
  .itemHolder{float:left;width:96px;height:96px;margin:4px;background:#222} .item{width:96px;height:96px;position:relative} .item img{width:96px;height:96px} .inventory_item_link{position:absolute;inset:0;display:block}</style></head>
  <body class="flat_page migrated_profile_page inventory_page responsive_page">
  <div class="inventory_page_left"><div class="games_list_tabs"><a class="games_list_tab active" href="#730">Counter-Strike 2</a></div>
    <div id="inventories"><div id="inventory_${ME}_730_2" class="inventory_ctn"><div class="inventory_page">${holders}</div></div></div></div>
  <div class="inventory_page_right"><div id="iteminfo0"></div></div>
  <script>${GLOBALS}
    const D = ${JSON.stringify(DESCS)};
    window.g_ActiveUser = { strSteamId: "${ME}" };
    window.g_ActiveInventory = { appid: 730, contextid: '2', owner: window.g_ActiveUser };
    ${rg}
    document.addEventListener('click', (e) => { const a = e.target.closest('.inventory_item_link'); if (a) { e.preventDefault(); window.__steamSelected = a.parentElement.id; } });
  </script></body></html>`;
}

function listingPage() {
  const lid1 = '6393057183417810717';
  const lid2 = '6393057183417810999';
  const row = (lid, aid, price, hex) => `<div class="market_listing_row market_recent_listing_row listing_${lid}" id="listing_${lid}">
    <div class="market_listing_item_img_container"><img class="market_listing_item_img" src="https://community.fastly.steamstatic.com/economy/image/redline/62fx62f"></div>
    <div class="market_listing_price_listings_block"><div class="market_listing_right_cell market_listing_action_buttons"><div class="market_listing_buy_button">
      <a href="javascript:BuyMarketListing('listing', '${lid}', 730, '2', '${aid}')" class="item_market_action_button btn_green_white_innerfade btn_small"><span>Buy Now</span></a></div></div>
      <div class="market_listing_right_cell market_listing_their_price"><span class="market_table_value"><span class="market_listing_price market_listing_price_with_fee">${price}</span></span></div>
      <div class="market_listing_right_cell"><div class="market_listing_row_action"><a href="steam://run/730//+csgo_econ_action_preview%20${hex}">Inspect in Game...</a></div></div></div>
    <div class="market_listing_item_name_block"><span class="market_listing_item_name economy_item_hoverable" id="listing_${lid}_name">AK-47 | Redline (Field-Tested)</span><br>
      <div class="market_listing_row_details" id="listing_${lid}_details">${stickerHtml(['FaZe | 2020 RMR'])}</div></div><div style="clear: both;"></div></div>`;
  const listing = (lid, aid, conv, fee, hex) => ({
    listingid: lid, price: 19075, fee: 2860, currencyid: 2023, converted_price: conv, converted_fee: fee, converted_currencyid: 2005,
    publisher_fee_percent: '0.100000001490116119', asset: { appid: 730, contextid: '2', id: aid, amount: '1', market_actions: [{ link: INSPECT_TPL, name: 'Inspect' }] }
  });
  const asset = (aid, props) => Object.assign({}, DESCS.redline, { id: aid, contextid: '2', amount: 1, asset_properties: props });
  return `<!doctype html><html><head><title>Steam Community Market :: Listings for AK-47 | Redline (Field-Tested)</title>
  <style>body{background:#1b2838;color:#c6d4df;font-family:Arial;width:1000px}</style></head><body class="responsive_page">
  <div id="mainContents"><div class="market_listing_nav"><a href="/market/search?appid=730">Counter-Strike 2</a></div>
  <div class="market_listing_iteminfo"></div>
  <div id="searchResultsTable"><div class="market_listing_table_header"></div><div id="searchResultsRows">
    ${row(lid1, '54355456920', '2 667,21 pуб.', LIVE_HEX)}${row(lid2, '54355456921', '2 700,00 pуб.', STICKERED_HEX)}
  </div></div></div>
  <script>${GLOBALS}
    window.g_rgListingInfo = ${JSON.stringify({ [lid1]: listing(lid1, '54355456920', 231931, 34790, LIVE_HEX), [lid2]: listing(lid2, '54355456921', 234783, 35217, STICKERED_HEX) })};
    window.g_rgAssets = { 730: { 2: {
      54355456920: ${JSON.stringify(asset('54355456920', ASSETS[0].props))},
      54355456921: ${JSON.stringify(asset('54355456921', [{ propertyid: 1, int_value: '661' }, { propertyid: 2, float_value: '0.1712' }, { propertyid: 6, string_value: STICKERED_HEX }]))}
    } } };
    window.g_oSearchResults = { m_cPageSize: 10, GoToPage(p, f) { window.__pageSize = this.m_cPageSize; } };
    function Market_LoadOrderSpread(id) {} Market_LoadOrderSpread( 7178002 );
  </script></body></html>`;
}

function tradeWindowPage() {
  const item = (side, a) => `<div class="item app730 context2" id="item730_2_${a.assetid}"><img src="x"></div>`;
  return `<!doctype html><html><head><title>Steam Community :: Trade offer</title></head><body>
  <div class="trade_partner_header">Trade with Partner</div>
  <div class="trade_area"><div id="your_slots">${item('you', ASSETS[0])}${item('you', ASSETS[3])}</div><div id="their_slots">${item('them', ASSETS[1])}</div></div>
  <script>${GLOBALS}
    const D = ${JSON.stringify(DESCS)};
    window.g_bTradeOffer = true; window.UserYou = { strSteamId: "${ME}" }; window.UserThem = { strSteamId: "${PARTNER}" };
    document.getElementById('item730_2_1001').rgItem = Object.assign({ id: '1001', appid: 730, contextid: '2', amount: 1, asset_properties: ${JSON.stringify(ASSETS[0].props)} }, D.redline);
    document.getElementById('item730_2_1004').rgItem = Object.assign({ id: '1004', appid: 730, contextid: '2', amount: 1 }, D.kilowatt);
    document.getElementById('item730_2_1002').rgItem = Object.assign({ id: '1002', appid: 730, contextid: '2', amount: 1, asset_properties: ${JSON.stringify(ASSETS[1].props)} }, D.doppler);
  </script></body></html>`;
}

function tradeListPage() {
  const ti = (d) => `<div class="trade_item" style="width:64px;height:64px" data-economy-item="classinfo/730/${DESCS[d].classid}/${DESCS[d].instanceid}"><img src="x"></div>`;
  return `<!doctype html><html><head><title>Steam Community :: Trade Offers</title></head><body>
  <div class="profile_leftcol">
    <div class="tradeoffer" id="tradeofferid_5001">
      <div class="tradeoffer_partner"><div class="playerAvatar online" data-miniprofile="39734371"></div></div>
      <div class="tradeoffer_items_ctn">
        <div class="tradeoffer_items primary"><div class="tradeoffer_items_header">Partner offered:</div>${ti('doppler')}</div>
        <div class="tradeoffer_items secondary"><div class="tradeoffer_items_header">For your:</div>${ti('redline')}${ti('kilowatt')}</div>
      </div>
      <div class="tradeoffer_footer"><div class="tradeoffer_footer_actions"><a class="whiteLink" href="javascript:ShowTradeOffer('5001')">Respond</a></div></div>
    </div>
    <div class="tradeoffer" id="tradeofferid_5002">
      <div class="tradeoffer_partner"><div class="playerAvatar online" data-miniprofile="12345"></div></div>
      <div class="tradeoffer_items_ctn">
        <div class="tradeoffer_items primary">${ti('kilowatt')}</div>
        <div class="tradeoffer_items secondary"></div>
      </div>
      <div class="tradeoffer_footer"><div class="tradeoffer_footer_actions"><a class="whiteLink" href="#">Respond</a></div></div>
    </div>
  </div>
  <script>${GLOBALS}</script></body></html>`;
}

function classHover(d) {
  return `<div id="economy_item_x"></div><script>BuildHover( 'economy_item_6aed58ac1c307',  ${JSON.stringify(DESCS[d])} );
    $('economy_item_6aed58ac1c307').show(); }</script>`;
}

function profilePage() {
  return `<!doctype html><html><head><title>Steam Community :: Partner</title></head><body>
  <div class="profile_content"><div class="profile_rightcol"><div class="profile_badges">Badges</div></div></div>
  <script>${GLOBALS} window.g_rgProfileData = { url: "https://steamcommunity.com/id/me/", steamid: "${ME}", personaname: "Me" };</script></body></html>`;
}

function storePage() {
  return `<!doctype html><html><head><title>Counter-Strike 2 on Steam</title><meta itemprop="priceCurrency" content="RUB"></head><body>
  <div id="game_area_purchase"><div class="game_area_purchase_game">Buy</div></div></body></html>`;
}

const PRICES = {
  'AK-47 | Redline (Field-Tested)': { sp: 29.10, tm: 28.40, ls: 27.95, wx: 28.80, st: 32.63 },
  '★ Karambit | Doppler (Factory New)': { sp: 1150, tm: 1120, ls: 1105, wx: 1135, st: 1290 },
  'AWP | Asiimov (Field-Tested)': { sp: 105, tm: 101, ls: 99.5, wx: 103, st: 118 },
  'Kilowatt Case': { sp: 0.92, tm: 0.88, ls: 0.86, wx: 0.9, st: 1.02 },
  'Sticker | FaZe | 2020 RMR': { sp: 0.11, tm: 0.1, ls: 0.1, wx: 0.1, st: 0.12 },
  'Sticker | Shooter': { sp: 5.5, tm: 5.2, ls: 5.1, wx: 5.3, st: 6.1 },
  'Sticker | Titan (Holo) | Katowice 2014': { sp: 52000, tm: 50000, ls: 49000, wx: 51000, st: 60000 }
};
const N = Object.keys(PRICES);

/** Ответы внешних API (для подмены fetch в сервис-воркере). */
function apiFixtures() {
  return {
    skinport: N.map((n) => ({ market_hash_name: n, min_price: PRICES[n].sp, suggested_price: PRICES[n].sp * 1.05, quantity: 40 })),
    marketcsgo: { success: true, currency: 'USD', items: N.map((n) => ({ market_hash_name: n, volume: '12', price: PRICES[n].tm.toFixed(3) })) },
    lisskins: N.map((n) => ({ name: n, price: PRICES[n].ls, unlocked_price: PRICES[n].ls, url: 'https://lis-skins.com/x', count: 7 })),
    waxpeer: { success: true, items: N.map((n) => ({ name: n, count: 5, min: Math.round(PRICES[n].wx * 1000), steam_price: Math.round(PRICES[n].st * 1000) })) },
    rates: { result: 'success', rates: { USD: 1, RUB: 81.7, EUR: 0.86, KZT: 505 } },
    dmarket: { aggregatedPrices: N.map((n) => ({ title: n, offerBestPrice: { Currency: 'USD', Amount: (PRICES[n].sp * 0.97).toFixed(2) }, offerCount: '3', orderBestPrice: { Currency: 'USD', Amount: (PRICES[n].sp * 0.8).toFixed(2) } })) },
    priceoverview: { success: true, lowest_price: '2667,21 pуб.', median_price: '2574,08 pуб.', volume: '67' },
    histogram: { success: 1, highest_buy_order: '257462', lowest_sell_order: '266721', buy_order_graph: [[2574.62, 5, '']], sell_order_graph: [[2667.21, 1, '']], price_prefix: '', price_suffix: 'pуб.' },
    listingHtml: 'function(){ Market_LoadOrderSpread( 7178002 ); }',
    counts: { notifications: { 1: 2, 2: 0 } },
    asyncconfig: { success: 1, data: { webapi_token: 'tok' } },
    offers: { response: {
      trade_offers_received: [{ tradeofferid: '5001', accountid_other: 39734371, trade_offer_state: 2, time_created: 1, message: '',
        items_to_give: [{ appid: 730, contextid: '2', assetid: '1001', classid: '7993036958', instanceid: '9171932820', amount: '1' }],
        items_to_receive: [{ appid: 730, contextid: '2', assetid: '9', classid: '111', instanceid: '0', amount: '1' }] }],
      descriptions: [DESCS.redline, DESCS.doppler]
    } },
    search: { success: true, total_count: 1, results: [{ name: 'AK-47 | Красная линия (После полевых испытаний)', hash_name: 'AK-47 | Redline (Field-Tested)', sell_listings: 1221, sell_price: 266721, sell_price_text: '2 667,21 pуб.', asset_description: { appid: 730, icon_url: 'redline', name_color: 'D2D2D2' } }] },
    appdetails: { US: { currency: 'USD', final: 1499, initial: 1499, discount_percent: 0 }, RU: { currency: 'RUB', final: 99900, initial: 99900, discount_percent: 0 },
      KZ: { currency: 'KZT', final: 450000, initial: 450000, discount_percent: 0 }, TR: { currency: 'USD', final: 999, initial: 999, discount_percent: 0 } }
  };
}

module.exports = { ME, PARTNER, LIVE_HEX, DOPPLER_HEX, STICKERED_HEX, DESCS, ASSETS, inspectHex, inventoryJson, inventoryPage, listingPage, tradeWindowPage, tradeListPage, classHover, profilePage, storePage, apiFixtures, PRICES };
