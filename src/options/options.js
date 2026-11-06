'use strict';
const P = VH.settings.PROVIDERS;
const C = VH.currency;
let cfg = VH.settings.merge();

function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}

let saveT = 0;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(async () => {
    await chrome.storage.sync.set({ settings: cfg });
    const s = document.getElementById('saved');
    s.textContent = 'Сохранено ' + new Date().toLocaleTimeString('ru-RU');
  }, 250);
}

const set = (path, v) => {
  const parts = path.split('.');
  let o = cfg;
  while (parts.length > 1) o = o[parts.shift()];
  o[parts[0]] = v;
  if (path === 'theme') applyTheme();
  save();
};
const get = (path) => path.split('.').reduce((o, k) => o[k], cfg);

function toggle(path) {
  const i = el('input', { type: 'checkbox', checked: !!get(path) });
  i.addEventListener('change', () => set(path, i.checked));
  return el('label', { class: 'switch' }, i, el('span'));
}
function select(path, options, num) {
  const s = el('select', {}, options.map(([v, l]) => el('option', { value: v, selected: String(get(path)) === String(v) }, l)));
  s.addEventListener('change', () => set(path, num ? Number(s.value) : s.value));
  return s;
}
function input(path, attrs, num) {
  const i = el('input', Object.assign({ value: get(path) ?? '' }, attrs || {}));
  i.addEventListener('input', () => set(path, num ? Number(i.value) : i.value.trim()));
  return i;
}
function secretInput(name) {
  const i = el('input', { type: 'password', placeholder: 'не задан', autocomplete: 'off' });
  chrome.storage.local.get('secrets').then(({ secrets }) => { i.value = (secrets && secrets[name]) || ''; });
  let t = 0;
  i.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const { secrets } = await chrome.storage.local.get('secrets');
      await chrome.storage.local.set({ secrets: Object.assign({}, secrets, { [name]: i.value.trim() }) });
      document.getElementById('saved').textContent = 'Ключ сохранён';
    }, 300);
  });
  return i;
}
const item = (title, hint, control, narrow) => el('div', { class: 'item' }, el('div', { class: 't' }, el('b', {}, title), hint ? el('small', {}, hint) : null), el('div', { class: 'c' + (narrow ? ' narrow' : '') }, control));

function applyTheme() {
  if (cfg.theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = cfg.theme;
}

const SECTIONS = [
  ['main', 'Основное', () => [
    el('div', { class: 'list' },
      item('Валюта', '«Как в Steam» — валюта вашего кошелька', select('currency', [['auto', 'Как в Steam'], ...C.LIST.map((c) => [c, c])])),
      item('Цена на карточках', 'Площадка, чья цена показывается на предметах и в сумме инвентаря',
        select('mainProvider', Object.entries(P).filter(([, d]) => !d.linkOnly && !d.onDemand && !d.needsKey).map(([k, d]) => [k, d.title]))),
      item('Тема настроек и попапа', null, select('theme', [['auto', 'Как в системе'], ['light', 'Светлая'], ['dark', 'Тёмная']])))
  ]],
  ['providers', 'Площадки', () => {
    const grid = el('div', { class: 'providers' });
    for (const [k, d] of Object.entries(P)) {
      const cb = el('input', { type: 'checkbox', checked: cfg.compare.includes(k) });
      cb.addEventListener('change', () => {
        cfg.compare = Object.keys(P).filter((p) => (p === k ? cb.checked : cfg.compare.includes(p)));
        save();
      });
      grid.append(el('label', { class: 'prov' }, cb, el('span', { class: 'dot', style: `background:${d.color}` }), d.title,
        d.linkOnly ? el('small', { class: 'muted' }, ' ссылка') : d.needsKey ? el('small', { class: 'muted' }, ' ключ') : null));
    }
    return [el('p', {}, 'Какие площадки показывать в сравнении цен. BUFF и YouPin — только ссылки (их цены доступны лишь после входа на сайт).'),
      el('div', { class: 'list' }, grid,
        item('Ключ CSFloat API', 'csfloat.com → Профиль → Developers. Хранится только в этом браузере и не синхронизируется', secretInput('csfloatKey')))];
  }],
  ['cards', 'Карточки предметов', () => [
    el('div', { class: 'list' },
      item('Цена', null, toggle('cards.price'), true),
      item('Float', 'Точное значение и метка на шкале износа', toggle('cards.float'), true),
      item('Износ (FN, MW…)', null, toggle('cards.wear'), true),
      item('Наклейки и брелоки', null, toggle('cards.stickers'), true),
      item('Фазы Doppler', null, toggle('cards.phase'), true),
      item('Трейдлок', 'Сколько осталось до возможности обмена', toggle('cards.lock'), true),
      item('Паттерн', 'Номер паттерна в углу карточки', toggle('cards.seed'), true),
      item('Панель над инвентарём', 'Сумма, сортировка, выбор, таблица', toggle('inventoryToolbar'), true))
  ]],
  ['sell', 'Продажа', () => [
    el('div', { class: 'list' },
      item('Цена по умолчанию', null, select('sellStrategy', Object.entries({ undercut: 'Дешевле минимума', lowest: 'По минимуму', median: 'По медиане', buyorder: 'По лучшей заявке', provider: 'От цены площадки' }))),
      item('Шаг перебивания', 'В копейках/центах валюты кошелька', input('undercutStep', { type: 'number', min: 1, step: 1 }, true)),
      item('Площадка для «от цены площадки»', null, select('sellProvider', Object.entries(P).filter(([, d]) => !d.linkOnly && !d.onDemand && !d.needsKey && d.title !== 'Steam').map(([k, d]) => [k, d.title]))),
      item('Процент от цены площадки', 'Например, 110 — на 10% дороже', input('sellPercent', { type: 'number', min: 1, step: 1 }, true)),
      item('Пауза между лотами', 'Миллисекунды. Меньше 1000 — риск временной блокировки Steam', input('sellDelay', { type: 'number', min: 600, step: 100 }, true))),
    el('p', { class: 'note' }, 'Лоты выставляются от вашего имени через обычный интерфейс Steam. Если включено подтверждение, Steam попросит подтвердить их в мобильном приложении.')
  ]],
  ['market', 'Маркет', () => [
    el('div', { class: 'list' },
      item('Float и наклейки у лотов', null, toggle('marketFloats'), true),
      item('Лотов на странице', null, select('marketPageSize', [[10, '10'], [20, '20'], [50, '50'], [100, '100']], true)),
      item('Подтверждать быструю покупку', 'Спрашивать перед покупкой кнопкой «Быстро»', toggle('confirmBuy'), true))
  ]],
  ['trades', 'Трейды', () => [
    el('div', { class: 'list' },
      item('Цены и суммы в окне обмена', null, toggle('tradeValues'), true),
      item('Уведомления о новых офферах', 'С оценкой того, что вы получаете и отдаёте', toggle('notifyTrades'), true),
      item('Проверять каждые', null, select('pollMinutes', [[1, '1 минуту'], [2, '2 минуты'], [5, '5 минут'], [15, '15 минут']], true)))
  ]],
  ['store', 'Магазин', () => {
    const all = ['US', 'RU', 'KZ', 'TR', 'AR', 'UA', 'PL', 'DE', 'GB', 'BR', 'IN', 'CN', 'JP', 'KR', 'CA', 'AU', 'MX'];
    const grid = el('div', { class: 'regions' });
    for (const cc of all) {
      const cb = el('input', { type: 'checkbox', checked: cfg.storeRegions.includes(cc) });
      cb.addEventListener('change', () => { cfg.storeRegions = all.filter((x) => (x === cc ? cb.checked : cfg.storeRegions.includes(x))); save(); });
      grid.append(el('label', {}, cb, cc));
    }
    return [el('p', {}, 'Регионы для таблицы цен на странице игры.'), el('div', { class: 'list' }, grid)];
  }],
  ['data', 'Данные', () => {
    const status = el('span', { class: 'muted' });
    return [el('div', { class: 'list' }, el('div', { class: 'actions' },
      el('button', { class: 'btn', onclick: async () => {
        const all = await chrome.storage.local.get(null);
        const keys = Object.keys(all).filter((k) => /^(tbl|po|ord|rp|rates):?/.test(k));
        await chrome.storage.local.remove(keys);
        status.textContent = `Кэш очищен (${keys.length} записей)`;
      } }, 'Очистить кэш цен'),
      el('button', { class: 'btn', onclick: () => {
        const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' })), download: 'vsemvamdam-helper-settings.json' });
        a.click();
      } }, 'Экспорт настроек'),
      el('button', { class: 'btn', onclick: () => {
        const f = el('input', { type: 'file', accept: 'application/json' });
        f.addEventListener('change', async () => {
          try { cfg = VH.settings.merge(JSON.parse(await f.files[0].text())); await chrome.storage.sync.set({ settings: cfg }); render(); status.textContent = 'Настройки загружены'; } catch (e) { status.textContent = 'Файл не подошёл'; }
        });
        f.click();
      } }, 'Импорт'),
      el('button', { class: 'btn', onclick: async () => { cfg = VH.settings.merge(); await chrome.storage.sync.set({ settings: cfg }); render(); status.textContent = 'Сброшено'; } }, 'Сбросить всё'),
      status),
    el('p', { class: 'note' }, 'Расширение не отправляет ваши данные на свои серверы: цены загружаются напрямую с публичных API площадок, а запросы к Steam идут от вашей сессии в браузере.'))];
  }]
];

function render() {
  applyTheme();
  const nav = document.getElementById('nav');
  const main = document.getElementById('main');
  nav.textContent = '';
  main.textContent = '';
  main.append(el('header', {}, el('h1', {}, 'Настройки'), el('p', { class: 'lead' }, 'Всё сохраняется автоматически и синхронизируется через ваш аккаунт браузера.')));
  for (const [id, title, build] of SECTIONS) {
    nav.append(el('a', { href: '#' + id }, title));
    main.append(el('section', { id }, el('h2', {}, title), ...build()));
  }
  const links = [...nav.querySelectorAll('a')];
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id));
  }, { rootMargin: '-40% 0px -55% 0px' });
  main.querySelectorAll('section').forEach((s) => io.observe(s));
}

(async () => {
  const { settings } = await chrome.storage.sync.get('settings');
  cfg = VH.settings.merge(settings);
  document.getElementById('ver').textContent = 'v' + chrome.runtime.getManifest().version;
  render();
})();
