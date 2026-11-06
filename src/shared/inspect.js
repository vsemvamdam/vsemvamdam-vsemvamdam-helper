/*
 * vsemvamdam-Steam-Helper — декодер inspect-ссылок CS2.
 *
 * С марта 2026 года inspect-ссылки CS2 содержат данные предмета прямо в себе:
 * hex-полезная нагрузка = protobuf CEconItemPreviewDataBlock.
 *   - «обёрнутый» формат: 0x00 + payload + CRC (4 байта)
 *   - «маскированный» формат: все байты XOR с первым байтом
 * Формат описан в открытой библиотеке csfloat/cs-inspect-serializer (MIT).
 * Здесь — собственная реализация без зависимостей.
 */
(function (root) {
  'use strict';

  const WEAR = [
    { max: 0.07, short: 'FN', ru: 'Прямо с завода', en: 'Factory New' },
    { max: 0.15, short: 'MW', ru: 'Немного поношенное', en: 'Minimal Wear' },
    { max: 0.38, short: 'FT', ru: 'После полевых испытаний', en: 'Field-Tested' },
    { max: 0.45, short: 'WW', ru: 'Поношенное', en: 'Well-Worn' },
    { max: 1.01, short: 'BS', ru: 'Закалённое в боях', en: 'Battle-Scarred' }
  ];

  // paintindex -> фаза Doppler / Gamma Doppler
  const PHASES = {
    415: 'Ruby', 416: 'Sapphire', 417: 'Black Pearl',
    418: 'Phase 1', 419: 'Phase 2', 420: 'Phase 3', 421: 'Phase 4',
    568: 'Emerald', 569: 'Phase 1', 570: 'Phase 2', 571: 'Phase 3', 572: 'Phase 4',
    617: 'Black Pearl', 618: 'Phase 2', 619: 'Sapphire',
    852: 'Phase 1', 853: 'Phase 2', 854: 'Phase 3', 855: 'Phase 4',
    1119: 'Emerald', 1120: 'Phase 1', 1121: 'Phase 2', 1122: 'Phase 3', 1123: 'Phase 4'
  };

  // Схема полей protobuf: номер поля -> [имя, тип]
  // типы: u = varint (uint32), u64 = varint (uint64 -> BigInt), i = int32, f = float32 (fixed32),
  //       s = string, m = вложенное сообщение Sticker (repeated)
  const ROOT_FIELDS = {
    1: ['accountid', 'u'], 2: ['itemid', 'u64'], 3: ['defindex', 'u'], 4: ['paintindex', 'u'],
    5: ['rarity', 'u'], 6: ['quality', 'u'], 7: ['paintwear', 'u'], 8: ['paintseed', 'u'],
    9: ['killeaterscoretype', 'u'], 10: ['killeatervalue', 'u'], 11: ['customname', 's'],
    12: ['stickers', 'm'], 13: ['inventory', 'u'], 14: ['origin', 'u'], 15: ['questid', 'u'],
    16: ['dropreason', 'u'], 17: ['musicindex', 'u'], 18: ['entindex', 'i'], 19: ['petindex', 'u'],
    20: ['keychains', 'm'], 21: ['style', 'u'], 22: ['variations', 'm'], 23: ['upgrade_level', 'u']
  };
  const STICKER_FIELDS = {
    1: ['slot', 'u'], 2: ['stickerId', 'u'], 3: ['wear', 'f'], 4: ['scale', 'f'], 5: ['rotation', 'f'],
    6: ['tintId', 'u'], 7: ['offsetX', 'f'], 8: ['offsetY', 'f'], 9: ['offsetZ', 'f'],
    10: ['pattern', 'u'], 11: ['highlightReel', 'u'], 12: ['wrappedSticker', 'u']
  };
  const REPEATED = { stickers: 1, keychains: 1, variations: 1 };

  function hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  function u32ToFloat(u) {
    const dv = new DataView(new ArrayBuffer(4));
    dv.setUint32(0, u >>> 0, true);
    return dv.getFloat32(0, true);
  }

  function parseMessage(bytes, schema) {
    const msg = {};
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let pos = 0;

    function varint() {
      let result = 0n;
      let shift = 0n;
      for (;;) {
        if (pos >= bytes.length) throw new Error('varint overflow');
        const b = bytes[pos++];
        result |= BigInt(b & 0x7f) << shift;
        if (!(b & 0x80)) break;
        shift += 7n;
        if (shift > 70n) throw new Error('varint too long');
      }
      return result;
    }

    while (pos < bytes.length) {
      const key = Number(varint());
      const field = key >>> 3;
      const wire = key & 7;
      const def = schema[field];
      let value;
      if (wire === 0) {
        value = varint();
      } else if (wire === 1) {
        if (pos + 8 > bytes.length) throw new Error('fixed64 overflow');
        value = dv.getBigUint64(pos, true);
        pos += 8;
      } else if (wire === 2) {
        const len = Number(varint());
        if (pos + len > bytes.length) throw new Error('length overflow');
        value = bytes.subarray(pos, pos + len);
        pos += len;
      } else if (wire === 5) {
        if (pos + 4 > bytes.length) throw new Error('fixed32 overflow');
        value = dv.getUint32(pos, true);
        pos += 4;
      } else {
        throw new Error('unsupported wire type ' + wire);
      }
      if (!def) continue; // неизвестное поле — пропускаем
      const [name, type] = def;
      let v;
      switch (type) {
        case 'u': v = Number(BigInt.asUintN(32, BigInt(value))); break;
        case 'u64': v = BigInt.asUintN(64, BigInt(value)); break;
        case 'i': v = Number(BigInt.asIntN(32, BigInt(value))); break;
        case 'f': v = u32ToFloat(Number(value)); break;
        case 's': v = new TextDecoder().decode(value); break;
        case 'm': v = parseMessage(value, STICKER_FIELDS); break;
        default: v = value;
      }
      if (REPEATED[name]) (msg[name] = msg[name] || []).push(v);
      else msg[name] = v;
    }
    return msg;
  }

  // CRC32 (IEEE), как в пакете crc-32: возвращает знаковое 32-битное число
  let CRC_TABLE = null;
  function crc32(bytes) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Int32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        CRC_TABLE[n] = c;
      }
    }
    let crc = -1;
    for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
    return crc ^ -1;
  }

  function checksum(payload) {
    const buf = new Uint8Array(payload.length + 1);
    buf.set(payload, 1);
    const crc = crc32(buf);
    return (((crc & 0xffff) ^ (payload.byteLength * crc)) & 0xffffffff) >>> 0;
  }

  function normalize(raw) {
    const out = Object.assign({ stickers: [], keychains: [], variations: [] }, raw);
    if (raw.paintwear !== undefined) out.paintwear = u32ToFloat(raw.paintwear);
    if (out.itemid !== undefined) out.itemid = out.itemid.toString();
    return out;
  }

  function hasData(m) {
    return m.itemid !== undefined || m.defindex !== undefined || m.paintindex !== undefined ||
      m.paintseed !== undefined || (m.stickers && m.stickers.length) || (m.keychains && m.keychains.length);
  }

  /** Декодирует hex-полезную нагрузку. Возвращает объект или null. */
  function decodeHex(hex) {
    try {
      hex = String(hex || '').trim();
      if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 || hex.length < 10) return null;
      let bytes = hexToBytes(hex);
      if (bytes[0] === 0) {
        const payload = bytes.subarray(1, bytes.length - 4);
        const dv = new DataView(bytes.buffer);
        const expected = dv.getUint32(bytes.length - 4, false);
        if (expected !== checksum(payload)) return null;
        const m = normalize(parseMessage(payload, ROOT_FIELDS));
        return hasData(m) ? m : null;
      }
      const key = bytes[0];
      bytes = bytes.map((b) => b ^ key);
      if (bytes[0] !== 0) return null;
      const m = normalize(parseMessage(bytes.subarray(1, bytes.length - 4), ROOT_FIELDS));
      return hasData(m) ? m : null;
    } catch (e) {
      return null;
    }
  }

  /** Достаёт hex из inspect-ссылки (steam://run/730//+csgo_econ_action_preview%20HEX). */
  function extractHex(link) {
    if (!link) return null;
    let s = String(link).trim();
    try { s = decodeURIComponent(s); } catch (e) { /* оставляем как есть */ }
    const m = s.match(/csgo_econ_action_preview\s+([0-9A-F]+)\s*$/i);
    return m ? m[1] : null;
  }

  function decodeLink(link) {
    const hex = extractHex(link);
    return hex ? decodeHex(hex) : null;
  }

  /** Подставляет плейсхолдеры (%propid:6%, %assetid%, %owner_steamid%) в шаблон ссылки. */
  function resolveLink(template, ctx) {
    if (!template) return null;
    const props = ctx.properties || [];
    return String(template)
      .replace(/%propid:(\d+)%/g, (_, id) => {
        const p = props.find((x) => String(x.propertyid) === id);
        if (!p) return '';
        return p.string_value ?? p.int_value ?? p.float_value ?? '';
      })
      .replace(/%assetid%/g, ctx.assetid || '')
      .replace(/%owner_steamid%/g, ctx.owner || '')
      .replace(/%listingid%/g, ctx.listingid || '');
  }

  /** Свойства asset_properties -> удобный объект. */
  function readProperties(props) {
    const out = {};
    for (const p of props || []) {
      const id = Number(p.propertyid);
      const v = p.float_value ?? p.int_value ?? p.string_value;
      if (id === 1) out.paintseed = Number(v);
      else if (id === 2) out.paintwear = Number(v);
      else if (id === 6) out.inspectHex = String(v);
      else if (id === 5) out.label = String(v);
      else out['prop' + id] = v;
    }
    return out;
  }

  function wearOf(f) {
    if (typeof f !== 'number' || isNaN(f)) return null;
    return WEAR.find((w) => f < w.max) || WEAR[WEAR.length - 1];
  }

  function phaseOf(paintindex) {
    return PHASES[paintindex] || null;
  }

  const api = { decodeHex, decodeLink, extractHex, resolveLink, readProperties, wearOf, phaseOf, WEAR, PHASES, checksum };
  root.VH = root.VH || {};
  root.VH.inspect = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
