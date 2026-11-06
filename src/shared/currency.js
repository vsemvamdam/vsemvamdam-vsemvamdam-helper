/*
 * Валюты Steam (ECurrencyCode) и форматирование сумм.
 */
(function (root) {
  'use strict';

  // id: [код, символ, символ-префикс?, без дробной части?]
  const STEAM = {
    1: ['USD', '$', true, false], 2: ['GBP', '£', true, false], 3: ['EUR', '€', false, false],
    4: ['CHF', 'CHF', true, false], 5: ['RUB', '₽', false, false], 6: ['PLN', 'zł', false, false],
    7: ['BRL', 'R$', true, false], 8: ['JPY', '¥', true, true], 9: ['NOK', 'kr', false, false],
    10: ['IDR', 'Rp', true, true], 11: ['MYR', 'RM', true, false], 12: ['PHP', '₱', true, false],
    13: ['SGD', 'S$', true, false], 14: ['THB', '฿', true, false], 15: ['VND', '₫', false, true],
    16: ['KRW', '₩', true, true], 17: ['TRY', '₺', false, false], 18: ['UAH', '₴', false, true],
    19: ['MXN', 'Mex$', true, false], 20: ['CAD', 'CDN$', true, false], 21: ['AUD', 'A$', true, false],
    22: ['NZD', 'NZ$', true, false], 23: ['CNY', '¥', true, false], 24: ['INR', '₹', true, true],
    25: ['CLP', 'CLP$', true, true], 26: ['PEN', 'S/.', true, false], 27: ['COP', 'COL$', true, true],
    28: ['ZAR', 'R', true, false], 29: ['HKD', 'HK$', true, false], 30: ['TWD', 'NT$', true, true],
    31: ['SAR', 'SR', false, false], 32: ['AED', 'AED', false, false], 34: ['ARS', 'ARS$', true, false],
    35: ['ILS', '₪', true, false], 37: ['KZT', '₸', false, true], 38: ['KWD', 'KD', false, false],
    39: ['QAR', 'QR', false, false], 40: ['CRC', '₡', true, true], 41: ['UYU', '$U', true, true]
  };

  const BY_CODE = {};
  for (const id of Object.keys(STEAM)) BY_CODE[STEAM[id][0]] = Number(id);

  function codeOf(id) { return (STEAM[id] || STEAM[1])[0]; }
  function idOf(code) { return BY_CODE[code] || 1; }

  function info(code) {
    const id = idOf(code);
    const s = STEAM[id] || STEAM[1];
    return { id, code: s[0], symbol: s[1], prefix: s[2], whole: s[3] };
  }

  /** Форматирует сумму в основных единицах (например, 12.5 -> «$12.50», «950 ₽»). */
  function format(amount, code, opts) {
    if (amount == null || isNaN(amount)) return '—';
    const i = info(code || 'USD');
    const o = opts || {};
    const big = Math.abs(amount) >= 1000;
    const digits = o.digits != null ? o.digits : (i.whole || (big && i.code === 'RUB') ? 0 : 2);
    const locale = i.prefix ? 'en-US' : 'ru-RU';
    const n = Number(amount).toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })
      .replace(/ /g, ' ');
    if (o.compact) return i.prefix ? i.symbol + n : n + i.symbol;
    return i.prefix ? i.symbol + n : n + ' ' + i.symbol;
  }

  /** Парсит строку цены Steam («2667,21 руб.», «$32.63 USD», «1 234,56€») в число. */
  function parse(text) {
    if (text == null) return null;
    let s = String(text).replace(/[^\d.,-]/g, '').replace(/^[.,]+|[.,]+$/g, '');
    if (!s) return null;
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > -1 && lastDot > -1) {
      if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (lastComma > -1) {
      const decimals = s.length - lastComma - 1;
      s = decimals === 3 && s.indexOf(',') === lastComma ? s.replace(',', '') : s.replace(/,/g, '.');
    }
    s = s.replace(/\.(?=.*\.)/g, '');
    const v = parseFloat(s);
    return isNaN(v) ? null : v;
  }

  /** Перевод между валютами по таблице курсов относительно USD ({RUB: 81.2, ...}). */
  function convert(amount, from, to, rates) {
    if (amount == null || isNaN(amount)) return null;
    if (!from || !to || from === to) return amount;
    const rf = from === 'USD' ? 1 : rates && rates[from];
    const rt = to === 'USD' ? 1 : rates && rates[to];
    if (!rf || !rt) return null;
    return (amount / rf) * rt;
  }

  const LIST = Object.keys(STEAM).map((id) => STEAM[id][0]);

  const api = { STEAM, LIST, codeOf, idOf, info, format, parse, convert };
  root.VH = root.VH || {};
  root.VH.currency = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
