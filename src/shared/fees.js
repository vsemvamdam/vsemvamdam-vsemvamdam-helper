/*
 * Комиссии торговой площадки Steam.
 * Все суммы — в минимальных единицах валюты (центы / копейки).
 *  - receive: сколько получает продавец
 *  - pay: сколько платит покупатель
 * Steam: 5% (минимум 1), издатель (для CS2 — 10%, минимум 1).
 */
(function (root) {
  'use strict';

  const DEFAULTS = { steamFee: 0.05, publisherFee: 0.10, minFee: 1 };

  function feesForReceive(receive, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    receive = Math.max(0, Math.floor(receive));
    const steam = Math.floor(Math.max(receive * o.steamFee, o.minFee));
    const publisher = o.publisherFee > 0 ? Math.floor(Math.max(receive * o.publisherFee, o.minFee)) : 0;
    return { receive, steam, publisher, fee: steam + publisher, pay: receive + steam + publisher };
  }

  /** Сколько получит продавец, если покупатель платит `pay`. */
  function receiveFromPay(pay, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    pay = Math.floor(pay);
    if (pay <= 2) return 0;
    let r = Math.floor(pay / (1 + o.steamFee + o.publisherFee));
    // подстройка: максимальный receive, при котором pay(receive) <= pay
    while (r > 0 && feesForReceive(r, o).pay > pay) r--;
    while (feesForReceive(r + 1, o).pay <= pay) r++;
    return Math.max(0, r);
  }

  /** Цена для покупателя, если продавец хочет получить `receive`. */
  function payFromReceive(receive, opts) {
    return feesForReceive(receive, opts).pay;
  }

  /** Перебить минимальную цену: на шаг дешевле для покупателя. */
  function undercut(lowestPay, step, opts) {
    const target = Math.max(3, Math.floor(lowestPay) - (step == null ? 1 : step));
    return receiveFromPay(target, opts);
  }

  const api = { feesForReceive, receiveFromPay, payFromReceive, undercut, DEFAULTS };
  root.VH = root.VH || {};
  root.VH.fees = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
