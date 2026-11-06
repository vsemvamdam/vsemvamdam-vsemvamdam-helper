/*
 * vsemvamdam-Steam-Helper — фоновый сервис-воркер.
 */
importScripts(
  '../shared/currency.js',
  '../shared/fees.js',
  '../shared/settings.js',
  './providers.js',
  './steam.js',
  './trades.js'
);

const { providers, steam, trades } = VH;

async function getSettings() {
  const [{ settings }, { secrets }] = await Promise.all([chrome.storage.sync.get('settings'), chrome.storage.local.get('secrets')]);
  return Object.assign(VH.settings.merge(settings), secrets || {});
}

async function scheduleAlarms() {
  const s = await getSettings();
  await chrome.alarms.clear('trades');
  chrome.alarms.create('trades', { periodInMinutes: Math.max(1, Number(s.pollMinutes) || 1), delayInMinutes: 0.1 });
}

chrome.runtime.onInstalled.addListener(async (details) => {
  const { settings } = await chrome.storage.sync.get('settings');
  if (!settings) await chrome.storage.sync.set({ settings: VH.settings.DEFAULTS });
  await scheduleAlarms();
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(scheduleAlarms);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) scheduleAlarms();
});

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === 'trades') trades.poll(await getSettings()).catch(() => {});
});

chrome.notifications.onClicked.addListener((id) => {
  if (id.startsWith('offer:')) {
    chrome.tabs.create({ url: `https://steamcommunity.com/tradeoffer/${id.slice(6)}/` });
  } else {
    chrome.tabs.create({ url: 'https://steamcommunity.com/my/tradeoffers/' });
  }
  chrome.notifications.clear(id);
});

const handlers = {
  async prices({ app, names, providers: list }) {
    return providers.lookup(Number(app) || 730, names || [], list);
  },
  async steamPrice({ app, name, currencyId, priority }) {
    return steam.priceOverview(Number(app) || 730, name, currencyId || 1, priority);
  },
  async orders({ app, name, currencyId, country }) {
    return steam.orders(Number(app) || 730, name, currencyId || 1, country);
  },
  async csfloat({ name }) {
    const s = await getSettings();
    return providers.csfloat(name, s.csfloatKey);
  },
  async dmarket({ names }) {
    return providers.dmarket(names || []);
  },
  async rates() {
    return steam.rates();
  },
  async search({ query, app }) {
    return steam.search(query, app);
  },
  async regional({ appid, regions }) {
    return steam.regionalPrices(appid, regions);
  },
  async tradesState() {
    return (await chrome.storage.local.get('trades')).trades || null;
  },
  async tradesPoll() {
    return trades.poll(await getSettings());
  },
  async refreshTables({ app }) {
    const keys = VH.settings.BULK.map((p) => `tbl:${p}:${app || 730}`);
    await chrome.storage.local.remove(keys);
    return true;
  },
  async queueSize() {
    return steam.queue.size;
  },
  async openOptions() {
    chrome.runtime.openOptionsPage();
    return true;
  }
};

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const fn = handlers[msg && msg.type];
  if (!fn) return false;
  Promise.resolve()
    .then(() => fn(msg))
    .then((data) => reply({ ok: true, data }))
    .catch((e) => reply({ ok: false, error: String((e && e.message) || e) }));
  return true; // ответ асинхронный
});
