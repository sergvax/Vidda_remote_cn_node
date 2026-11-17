const dot = document.getElementById('dot');
const statusText = document.getElementById('statusText');
const statusBtn = document.getElementById('statusBtn');
const refreshBtn = document.getElementById('refreshBtn');
const deviceName = document.getElementById('deviceName');
const ipText = document.getElementById('ipText');
const volText = document.getElementById('volText');
const banner = document.getElementById('banner');
const toastEl = document.getElementById('toast');

const powerModal = document.getElementById('powerModal');
const powerBtn = document.getElementById('powerBtn');
const powerCancel = document.getElementById('powerCancel');
const powerConfirm = document.getElementById('powerConfirm');
const wakeBtn = document.getElementById('wakeBtn');

const sourceModal = document.getElementById('sourceModal');
const sourceBtn = document.getElementById('sourceBtn');
const sourceCancel = document.getElementById('sourceCancel');
const sourceHome = document.getElementById('sourceHome');
const sourceList = document.getElementById('sourceList');

const focusBtn = document.getElementById('focusBtn');

const favoritesSection = document.getElementById('favoritesSection');
const favGrid = document.getElementById('favGrid');
const favEdit = document.getElementById('favEdit');

const volumeRange = document.getElementById('volumeRange');

const appsModal = document.getElementById('appsModal');
const appsBtn = document.getElementById('appsBtn');
const appsCancel = document.getElementById('appsCancel');
const appsRefresh = document.getElementById('appsRefresh');
const appsList = document.getElementById('appsList');

const connectModal = document.getElementById('connectModal');
const ipInput = document.getElementById('ipInput');
const autoFind = document.getElementById('autoFind');
const manualConnect = document.getElementById('manualConnect');
const connectCancel = document.getElementById('connectCancel');

const screenModal = document.getElementById('screenModal');
const screenBtn = document.getElementById('screenBtn');
const screenClose = document.getElementById('screenClose');
const screenRefresh = document.getElementById('screenRefresh');
const screenImg = document.getElementById('screenImg');
const screenStatus = document.getElementById('screenStatus');
const screenHint = document.getElementById('screenHint');

let toastTimer = null;
let lastStatus = null;
let lastBannerHidden = null;
let screenUrl = null;
let screenBusy = false;
let connectPrompted = false;

let favorites = [];
let favoritesSignature = '';
let currentApps = [];
let volumeBusy = false;
let volumeTimer = null;
let volumeDragging = false;
let volumeEditedAt = 0;

const VOLUME_STORAGE_KEY = 'vidda.volume';
const VOLUME_MAX = 12;

function buzz(ms = 8) {
  try { navigator.vibrate?.(ms); } catch { /* ignore */ }
}

let audioCtx = null;

/** Короткий тихий клик для обратной связи на кнопках пульта. */
function playClick() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(720, now);
    osc.frequency.exponentialRampToValueAtTime(380, now + 0.045);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.04, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.07);
  } catch {
    /* звук не критичен */
  }
}

function toast(message, type = '') {
  toastEl.textContent = message;
  toastEl.className = `toast ${type}`;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3200);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function sendKey(key, silent = false) {
  if (!silent) {
    buzz();
    playClick();
  }
  try {
    await api('/api/key', { method: 'POST', body: JSON.stringify({ key }) });
  } catch (err) {
    toast(err.message, 'error');
    setStatus({ mqttConnected: false });
  }
}

/* ---------- volume slider ---------- */

function initialVolume() {
  const raw = localStorage.getItem(VOLUME_STORAGE_KEY);
  if (raw !== null) {
    const stored = Number(raw);
    if (Number.isFinite(stored)) {
      return Math.max(0, Math.min(VOLUME_MAX, Math.round(stored)));
    }
  }
  return 6;
}

function setVolumeUI(value, persist = false) {
  const v = Math.max(0, Math.min(VOLUME_MAX, Math.round(Number(value) || 0)));
  volumeRange.value = String(v);
  const percent = (v / VOLUME_MAX) * 100;
  volumeRange.style.setProperty('--fill', `${percent}%`);
  if (persist) {
    try { localStorage.setItem(VOLUME_STORAGE_KEY, String(v)); } catch { /* ignore */ }
  }
  return v;
}

function syncVolume(info) {
  if (volumeDragging) return;
  if (Date.now() - volumeEditedAt < 1500) return;
  if (typeof info.volume === 'number') setVolumeUI(info.volume, true);
}

function scheduleVolume(value) {
  clearTimeout(volumeTimer);
  volumeTimer = setTimeout(() => applyVolume(value), 220);
}

async function applyVolume(value) {
  clearTimeout(volumeTimer);
  if (volumeBusy) {
    scheduleVolume(value);
    return;
  }
  const v = setVolumeUI(value, true);
  volumeBusy = true;
  playClick();
  try {
    const info = await api('/api/volume', {
      method: 'POST',
      body: JSON.stringify({ value: v }),
    });
    if (lastStatus) lastStatus.volume = info.volume;
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    volumeBusy = false;
  }
}

volumeRange.addEventListener('input', () => {
  volumeEditedAt = Date.now();
  setVolumeUI(volumeRange.value);
  if (!volumeDragging) scheduleVolume(volumeRange.value);
});
volumeRange.addEventListener('pointerdown', () => { volumeDragging = true; });
const endVolumeDrag = () => { volumeDragging = false; };
volumeRange.addEventListener('pointerup', endVolumeDrag);
volumeRange.addEventListener('pointercancel', endVolumeDrag);
volumeRange.addEventListener('change', () => {
  volumeDragging = false;
  volumeEditedAt = Date.now();
  applyVolume(volumeRange.value);
});
volumeRange.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    volumeEditedAt = Date.now();
    applyVolume(volumeRange.value);
  }
});

setVolumeUI(initialVolume());

/* ---------- long press ---------- */

const repeatTimers = new Map();

function startRepeat(button) {
  const key = button.dataset.key;
  if (!key) return;
  sendKey(key);

  if (button.dataset.repeat !== '1') return;

  const entry = { delay: null, interval: null };
  entry.delay = setTimeout(() => {
    entry.interval = setInterval(() => sendKey(key, true), 130);
  }, 380);

  repeatTimers.set(button, entry);
}

function stopRepeat(button) {
  const entry = repeatTimers.get(button);
  if (!entry) return;
  if (entry.delay) clearTimeout(entry.delay);
  if (entry.interval) clearInterval(entry.interval);
  repeatTimers.delete(button);
}

document.querySelectorAll('[data-key]').forEach((button) => {
  let activePointer = null;

  button.addEventListener('pointerdown', (e) => {
    if (activePointer !== null) return;
    activePointer = e.pointerId;
    button.classList.add('pressed');
    startRepeat(button);
  });

  const release = () => {
    if (activePointer === null) return;
    activePointer = null;
    button.classList.remove('pressed');
    stopRepeat(button);
  };

  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('pointerleave', release);
  button.addEventListener('contextmenu', (e) => e.preventDefault());
});

window.addEventListener('pointerup', () => {
  document.querySelectorAll('.key.pressed').forEach((b) => {
    b.classList.remove('pressed');
    stopRepeat(b);
  });
});

/* ---------- keyboard ---------- */

const KEYBOARD_MAP = {
  ArrowUp: 'KEY_UP',
  ArrowDown: 'KEY_DOWN',
  ArrowLeft: 'KEY_LEFT',
  ArrowRight: 'KEY_RIGHT',
  Enter: 'KEY_OK',
  ' ': 'KEY_OK',
  Backspace: 'KEY_RETURNS',
  Escape: 'KEY_RETURNS',
  '+': 'KEY_VOLUMEUP',
  '=': 'KEY_VOLUMEUP',
  '-': 'KEY_VOLUMEDOWN',
  '_': 'KEY_VOLUMEDOWN',
  h: 'KEY_HOME',
  m: 'KEY_MENU',
  s: 'KEY_SETTING',
  p: 'KEY_POWER',
};

function anyModalOpen() {
  return (
    !powerModal.hidden ||
    !sourceModal.hidden ||
    !connectModal.hidden ||
    !appsModal.hidden ||
    !screenModal.hidden
  );
}

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.key === 'Escape' && anyModalOpen()) {
    closeModals();
    return;
  }
  if (anyModalOpen()) return;

  if (e.target instanceof HTMLElement && (e.target.tagName === 'INPUT' || e.target.isContentEditable)) {
    return;
  }

  if (e.key === 'i' || e.key === 'I') { openSources(); return; }
  if (e.key === 'a' || e.key === 'A') { openApps(); return; }
  if (e.key === 'c' || e.key === 'C') { openScreen(); return; }
  if (e.key === 'f' || e.key === 'F') { runAutoFocus(); return; }
  if (e.key === 'v' || e.key === 'V') { volumeRange.focus(); return; }

  const key = KEYBOARD_MAP[e.key];
  if (!key) return;
  e.preventDefault();
  if (key === 'KEY_POWER') {
    openPower();
    return;
  }
  sendKey(key);
});

/* ---------- status ---------- */

function setStatus(info) {
  if (info.discovering) {
    dot.className = 'dot';
    statusText.textContent = 'поиск…';
    return;
  }
  if (info.mqttConnected) {
    dot.className = 'dot online';
    statusText.textContent = 'онлайн';
  } else {
    dot.className = 'dot offline';
    statusText.textContent = 'офлайн';
  }
}

function renderFooter(info) {
  volText.textContent = info.muted === true ? 'без звука' : 'локальная сеть';
}

/* ---------- fit to screen ---------- */

let fitQueued = false;

/**
 * Подгоняет пульт под высоту окна, чтобы не появлялась прокрутка.
 * Используется zoom: он, в отличие от transform, меняет layout-размер.
 */
function fitRemote() {
  const remote = document.getElementById('remote');
  if (!remote) return;
  remote.style.zoom = '';
  const available = window.innerHeight - 28;
  const height = remote.getBoundingClientRect().height;
  if (!height) return;
  if (height > available) {
    const scale = Math.max(0.68, available / height);
    remote.style.zoom = String(scale);
  }
}

function scheduleFit() {
  if (fitQueued) return;
  fitQueued = true;
  requestAnimationFrame(() => {
    fitQueued = false;
    fitRemote();
  });
}

window.addEventListener('resize', scheduleFit);
window.visualViewport?.addEventListener('resize', scheduleFit);

async function refreshStatus() {
  try {
    const info = await api('/api/status');
    lastStatus = info;
    setStatus(info);
    if (info.name) deviceName.textContent = info.name;
    ipText.textContent = info.ip || 'IP не найден';
    renderFooter(info);
    renderFavorites(info.favorites || []);
    syncVolume(info);
    if (info.lastError) {
      banner.textContent = info.lastError;
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }
    if (banner.hidden !== lastBannerHidden) {
      lastBannerHidden = banner.hidden;
      scheduleFit();
    }
    if (!info.ip && !info.discovering && info.lastError && !connectPrompted) {
      connectPrompted = true;
      openConnect();
    }
  } catch {
    dot.className = 'dot offline';
    statusText.textContent = 'нет сервера';
    banner.textContent = 'Сервер пульта недоступен. Проверь, что node server.js запущен.';
    banner.hidden = false;
  }
}

async function rediscover() {
  toast('Ищу проектор в сети…');
  dot.className = 'dot';
  statusText.textContent = 'поиск…';
  autoFind.disabled = true;
  try {
    const info = await api('/api/discover', { method: 'POST' });
    if (info.ip) {
      toast(`Найден: ${info.name || 'Vidda'} (${info.ip})`);
      closeModals();
    } else {
      toast(info.lastError || 'Проектор не найден', 'error');
    }
    await refreshStatus();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    autoFind.disabled = false;
  }
}

/* ---------- connect ---------- */

function openConnect() {
  if (lastStatus?.ip) ipInput.value = lastStatus.ip;
  connectModal.hidden = false;
  setTimeout(() => ipInput.focus(), 80);
}

async function manualConnectNow() {
  const ip = ipInput.value.trim();
  if (!ip) {
    toast('Введи IP проектора', 'error');
    ipInput.focus();
    return;
  }

  manualConnect.disabled = true;
  manualConnect.textContent = 'Подключаю…';
  try {
    const info = await api('/api/connect', {
      method: 'POST',
      body: JSON.stringify({ ip }),
    });
    toast(info.mqttConnected ? 'Проектор подключён' : 'IP сохранён, жду соединение');
    closeModals();
    await refreshStatus();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    manualConnect.disabled = false;
    manualConnect.textContent = 'Подключить';
  }
}

statusBtn.addEventListener('click', openConnect);
refreshBtn.addEventListener('click', rediscover);
autoFind.addEventListener('click', rediscover);
manualConnect.addEventListener('click', manualConnectNow);
connectCancel.addEventListener('click', closeModals);
connectModal.addEventListener('click', (e) => {
  if (e.target === connectModal) closeModals();
});
ipInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    manualConnectNow();
  }
});

/* ---------- modal helpers ---------- */

function closeModals() {
  powerModal.hidden = true;
  sourceModal.hidden = true;
  connectModal.hidden = true;
  appsModal.hidden = true;
  closeScreen();
}

/* ---------- power ---------- */

function openPower() {
  powerModal.hidden = false;
}

powerBtn.addEventListener('click', openPower);
powerCancel.addEventListener('click', closeModals);
powerModal.addEventListener('click', (e) => {
  if (e.target === powerModal) closeModals();
});

powerConfirm.addEventListener('click', () => {
  closeModals();
  sendKey('KEY_POWER');
  toast('Команда выключения отправлена');
});

wakeBtn.addEventListener('click', async () => {
  closeModals();
  buzz(20);
  playClick();
  try {
    const info = await api('/api/wake', { method: 'POST' });
    toast(`Wake-on-LAN отправлен (${info.sent.length})`);
  } catch (err) {
    toast(err.message, 'error');
  }
});

/* ---------- sources ---------- */

function sourceName(source) {
  return source.name || `Вход ${source.id}`;
}

async function sendSource(source) {
  playClick();
  try {
    await api('/api/source', {
      method: 'POST',
      body: JSON.stringify({ id: source.id }),
    });
    toast(`Переключаю: ${sourceName(source)}`);
    closeModals();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderSources() {
  const sources = lastStatus?.sources?.length ? lastStatus.sources : [
    { id: 'HDMI_1', name: 'HDMI 1' },
    { id: 'HDMI_2', name: 'HDMI 2' },
  ];
  const current = lastStatus?.lastSource;
  sourceList.innerHTML = '';
  for (const source of sources) {
    const button = document.createElement('button');
    button.className = 'source-item';
    if (current !== undefined && current !== null && String(current) === String(source.id)) {
      button.classList.add('active');
    }
    const label = document.createElement('span');
    label.textContent = sourceName(source);
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.innerHTML = '<use href="#i-input"/>';
    button.append(label, icon);
    button.addEventListener('click', () => sendSource(source));
    sourceList.append(button);
  }
}

function openSources() {
  renderSources();
  sourceModal.hidden = false;
}

sourceBtn.addEventListener('click', openSources);
sourceCancel.addEventListener('click', closeModals);
sourceHome.addEventListener('click', () => {
  closeModals();
  sendKey('KEY_HOME');
  toast('Домашний экран: выбери HDMI в боковой панели');
});
sourceModal.addEventListener('click', (e) => {
  if (e.target === sourceModal) closeModals();
});

/* ---------- favorites ---------- */

function hashHue(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

function avatarLetter(app) {
  const source = String(app.name || app.package || '?').trim();
  const char = [...source].find((c) => /[\p{L}\p{N}]/u.test(c));
  return (char || '?').toUpperCase();
}

function isFavorite(packageName) {
  return favorites.some((item) => item.package === packageName);
}

function renderFavorites(list, force = false) {
  favorites = Array.isArray(list) ? list : favorites;
  const signature = favorites.map((item) => `${item.package}|${item.name}`).join('~');
  if (!force && signature === favoritesSignature) return;
  favoritesSignature = signature;

  favGrid.innerHTML = '';
  favoritesSection.hidden = favorites.length === 0;

  for (const app of favorites) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fav-app';
    button.title = app.name || app.package;

    const avatar = document.createElement('span');
    avatar.className = 'fav-avatar';
    avatar.style.setProperty('--hue', String(hashHue(app.package)));
    avatar.textContent = avatarLetter(app);

    const label = document.createElement('span');
    label.className = 'fav-label';
    label.textContent = app.name || app.package;

    button.append(avatar, label);
    button.addEventListener('click', () => launchApp(app));
    favGrid.append(button);
  }

  scheduleFit();
}

async function toggleFavorite(app, button) {
  playClick();
  const next = !isFavorite(app.package);
  try {
    const info = await api('/api/favorites', {
      method: 'POST',
      body: JSON.stringify({ package: app.package, favorite: next }),
    });
    button.classList.toggle('on', Boolean(info.favorite));
    const label = info.favorite ? 'Убрать из избранного' : 'В избранное';
    button.setAttribute('aria-label', label);
    button.title = label;
    if (lastStatus) lastStatus.favorites = info.favorites;
    renderFavorites(info.favorites || [], true);
    toast(
      info.favorite
        ? `В избранном: ${app.name || app.package}`
        : `Убрано из избранного: ${app.name || app.package}`
    );
  } catch (err) {
    toast(err.message, 'error');
  }
}

favEdit.addEventListener('click', openApps);

/* ---------- apps ---------- */

let appsBusy = false;

function renderApps(apps) {
  currentApps = apps;
  appsList.innerHTML = '';
  if (!apps.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Проектор не вернул список приложений.';
    appsList.append(empty);
    return;
  }
  for (const app of apps) {
    const row = document.createElement('div');
    row.className = 'app-row';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'source-item app-item';
    const meta = document.createElement('span');
    meta.className = 'app-meta';
    const name = document.createElement('span');
    name.className = 'app-name';
    name.textContent = app.name || app.package;
    const pkg = document.createElement('span');
    pkg.className = 'app-pkg';
    pkg.textContent = app.package;
    meta.append(name, pkg);
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.innerHTML = '<use href="#i-apps"/>';
    button.append(meta, icon);
    button.addEventListener('click', () => launchApp(app));

    const star = document.createElement('button');
    star.type = 'button';
    const on = isFavorite(app.package);
    const starLabel = on ? 'Убрать из избранного' : 'В избранное';
    star.className = `fav-toggle${on ? ' on' : ''}`;
    star.setAttribute('aria-label', starLabel);
    star.title = starLabel;
    const starIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    starIcon.innerHTML = '<use href="#i-star"/>';
    star.append(starIcon);
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(app, star);
    });

    row.append(button, star);
    appsList.append(row);
  }
}

async function loadApps() {
  if (appsBusy) return;
  appsBusy = true;
  appsRefresh.disabled = true;
  appsList.innerHTML = '';
  const hint = document.createElement('p');
  hint.textContent = 'Запрашиваю список приложений…';
  appsList.append(hint);
  try {
    const info = await api('/api/apps');
    renderApps(info.apps || []);
  } catch (err) {
    appsList.innerHTML = '';
    const error = document.createElement('p');
    error.textContent = err.message;
    appsList.append(error);
  } finally {
    appsBusy = false;
    appsRefresh.disabled = false;
  }
}

async function launchApp(app) {
  playClick();
  try {
    await api('/api/app', {
      method: 'POST',
      body: JSON.stringify({ package: app.package }),
    });
    toast(`Запускаю: ${app.name || app.package}`);
    closeModals();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openApps() {
  appsModal.hidden = false;
  loadApps();
}

appsBtn.addEventListener('click', openApps);
appsRefresh.addEventListener('click', loadApps);
appsCancel.addEventListener('click', closeModals);
appsModal.addEventListener('click', (e) => {
  if (e.target === appsModal) closeModals();
});

/* ---------- autofocus ---------- */

let focusBusy = false;

async function runAutoFocus() {
  if (focusBusy) return;
  focusBusy = true;
  focusBtn.classList.add('pressed');
  buzz(14);
  playClick();
  toast('Автофокус: открываю меню проектора…');
  try {
    await api('/api/focus', { method: 'POST' });
    toast('Автофокус запущен');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    focusBtn.classList.remove('pressed');
    focusBusy = false;
  }
}

focusBtn.addEventListener('click', runAutoFocus);

/* ---------- projector screen ---------- */

function screenSetHint(text, isError = false) {
  screenHint.textContent = text;
  screenHint.classList.toggle('error', isError);
  screenHint.hidden = false;
  screenImg.hidden = true;
}

async function loadScreen() {
  if (screenBusy) return;
  screenBusy = true;
  screenStatus.textContent = 'запрашиваю снимок…';
  try {
    const res = await fetch(`/api/screenshot?fresh=1&t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    if (screenUrl) URL.revokeObjectURL(screenUrl);
    screenUrl = URL.createObjectURL(blob);
    screenImg.src = screenUrl;
    screenImg.hidden = false;
    screenHint.hidden = true;
    const time = new Date().toLocaleTimeString('ru-RU');
    screenStatus.textContent = `обновлено в ${time} • нажми «Обновить»`;
  } catch (err) {
    const note = /пустой|не прислал|503|504/.test(err.message)
      ? 'Проектор сейчас не отдаёт скриншот. Попробуй ещё раз через несколько секунд.'
      : err.message;
    screenStatus.textContent = 'нет изображения';
    screenSetHint(note, true);
  } finally {
    screenBusy = false;
  }
}

function openScreen() {
  screenModal.hidden = false;
  loadScreen();
}

function closeScreen() {
  screenModal.hidden = true;
  if (screenUrl) {
    URL.revokeObjectURL(screenUrl);
    screenUrl = null;
  }
  screenImg.removeAttribute('src');
  screenImg.hidden = true;
  screenHint.hidden = false;
  screenHint.textContent = 'Проектор ещё не прислал изображение';
  screenHint.classList.remove('error');
}

screenBtn.addEventListener('click', openScreen);
screenClose.addEventListener('click', closeScreen);
screenRefresh.addEventListener('click', loadScreen);
screenModal.addEventListener('click', (e) => {
  if (e.target === screenModal) closeScreen();
});

/* ---------- start ---------- */

refreshStatus();
setInterval(refreshStatus, 3000);

window.addEventListener('load', scheduleFit);
setTimeout(scheduleFit, 300);

window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    refreshStatus();
    scheduleFit();
  }
});
