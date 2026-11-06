'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const inspect = require('../src/shared/inspect.js');
const fees = require('../src/shared/fees.js');
const currency = require('../src/shared/currency.js');

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('inspect: обёрнутый формат без стикеров', () => {
  const d = inspect.decodeHex('00180720DA03280638FBEE88F90340B2026BC03C96');
  assert.equal(d.defindex, 7);
  assert.equal(d.paintindex, 474);
  assert.equal(d.paintseed, 306);
  assert.equal(d.rarity, 6);
  close(d.paintwear, 0.6336590647697449);
});

test('inspect: обёрнутый формат со стикерами', () => {
  const d = inspect.decodeHex('00180720C80A280638A4E1F5FB03409A0562040800104C62040801104C62040802104C62040803104C6D4F5E30');
  assert.equal(d.paintindex, 1352);
  assert.equal(d.paintseed, 666);
  close(d.paintwear, 0.99);
  assert.deepEqual(d.stickers.map((s) => [s.slot, s.stickerId]), [[0, 76], [1, 76], [2, 76], [3, 76]]);
});

test('inspect: неверная контрольная сумма отклоняется', () => {
  assert.equal(inspect.decodeHex('00180720DA03280638FBEE88F90340B2026BC03C97'), null);
});

test('inspect: маскированная ссылка (XOR) со стикерами и брелоком', () => {
  const link = 'steam://rungame/730/76561202255233023/+csgo_econ_action_preview%20CBDB3F0B6C6170CAD3F4EB60C2E3C9FBC7F3607D7A3DC88B29C8A9CEC3CADB5F80A9CEC3CBDB2289A9CEC3C8DB7381A9CEC3CFDB5F81A3484B4B4BC7BBC369CADDC3CBDB98F67323398B8E554C76F5869D456F8B9352CE341D4900';
  const d = inspect.decodeLink(link);
  assert.equal(d.itemid, '50286157940');
  assert.equal(d.defindex, 63);
  assert.equal(d.paintindex, 1195);
  assert.equal(d.paintseed, 482);
  close(d.paintwear, 0.3991330564);
  assert.deepEqual(d.stickers.map((s) => s.stickerId), [9620, 8553, 9528, 9492]);
  assert.equal(d.keychains.length, 1);
  assert.equal(d.keychains[0].stickerId, 83);
  assert.equal(d.keychains[0].highlightReel, 665);
  close(d.keychains[0].offsetX, 7.5909080505, 1e-5);
});

test('inspect: префикс steam://run и стикер-предмет', () => {
  const d = inspect.decodeLink('steam://run/730//+csgo_econ_action_preview%203E2EEEE3AEC23526391E3E163E0E3A5C3B363E2E9A3A567A4E287F466EAE');
  assert.equal(d.itemid, '3213110992');
  assert.equal(d.paintwear, undefined);
  assert.deepEqual(d.stickers.map((s) => s.stickerId), [548]);
});

test('inspect: живая ссылка с маркета Steam (AK-47 | Redline FT)', () => {
  // снято с steamcommunity.com 06.11.2026: asset_properties seed=434, float=0.326670229434967041
  const d = inspect.decodeHex('8A9A126D5334408B928DAA1088A28FBA8EB25808177F89CA3889E88582889A0BAFB7A2DD0EB7CF2ABC88B6E285FA8206BC2379');
  assert.ok(d, 'декодировано');
  assert.equal(d.defindex, 7);
  assert.equal(d.paintseed, 434);
  close(d.paintwear, 0.326670229434967041, 1e-7);
  assert.equal(d.stickers.length, 1);
});

test('inspect: подстановка %propid:6% и чтение свойств', () => {
  const props = [
    { propertyid: 1, int_value: '434' },
    { propertyid: 2, float_value: '0.326670229434967041' },
    { propertyid: 6, string_value: 'ABCD' }
  ];
  assert.equal(inspect.resolveLink('steam://run/730//+csgo_econ_action_preview%20%propid:6%', { properties: props }),
    'steam://run/730//+csgo_econ_action_preview%20ABCD');
  const p = inspect.readProperties(props);
  assert.equal(p.paintseed, 434);
  close(p.paintwear, 0.32667);
  assert.equal(p.inspectHex, 'ABCD');
});

test('inspect: износ и фазы', () => {
  assert.equal(inspect.wearOf(0.069).short, 'FN');
  assert.equal(inspect.wearOf(0.07).short, 'MW');
  assert.equal(inspect.wearOf(0.3266).short, 'FT');
  assert.equal(inspect.wearOf(0.99).short, 'BS');
  assert.equal(inspect.phaseOf(415), 'Ruby');
  assert.equal(inspect.phaseOf(568), 'Emerald');
  assert.equal(inspect.phaseOf(7), null);
});

test('fees: совпадают с реальным лотом Steam', () => {
  // лот: price(receive)=2839, steam_fee=141, publisher_fee=283, покупатель платит $32.63
  const f = fees.feesForReceive(2839);
  assert.equal(f.steam, 141);
  assert.equal(f.publisher, 283);
  assert.equal(f.pay, 3263);
  assert.equal(fees.receiveFromPay(3263), 2839);
  const g = fees.feesForReceive(19075);
  assert.equal(g.steam, 953);
  assert.equal(g.publisher, 1907);
});

test('fees: минимальные суммы и перебивание', () => {
  assert.equal(fees.payFromReceive(1), 3);
  assert.equal(fees.receiveFromPay(3), 1);
  assert.equal(fees.receiveFromPay(2), 0);
  const r = fees.undercut(3263, 1);
  assert.ok(fees.payFromReceive(r) <= 3262);
  for (let pay = 3; pay < 5000; pay += 7) {
    const rec = fees.receiveFromPay(pay);
    assert.ok(fees.payFromReceive(rec) <= pay, `pay ${pay}`);
    assert.ok(fees.payFromReceive(rec + 1) > pay, `pay ${pay} max`);
  }
});

test('currency: парсинг строк Steam', () => {
  assert.equal(currency.parse('2667,21 руб.'), 2667.21);
  assert.equal(currency.parse('$32.63 USD'), 32.63);
  assert.equal(currency.parse('1 234,56€'), 1234.56);
  assert.equal(currency.parse('$1,234.56'), 1234.56);
  assert.equal(currency.parse('1.234,56€'), 1234.56);
  assert.equal(currency.parse('12 345 ₸'), 12345);
  assert.equal(currency.parse('—'), null);
});

test('currency: конвертация и формат', () => {
  const rates = { RUB: 80, EUR: 0.9 };
  assert.equal(currency.convert(10, 'USD', 'RUB', rates), 800);
  close(currency.convert(800, 'RUB', 'EUR', rates), 9);
  assert.equal(currency.convert(1, 'USD', 'XXX', rates), null);
  assert.equal(currency.format(32.63, 'USD'), '$32.63');
  assert.ok(currency.format(2667.21, 'RUB').endsWith('₽'));
  assert.equal(currency.codeOf(5), 'RUB');
  assert.equal(currency.idOf('KZT'), 37);
});
