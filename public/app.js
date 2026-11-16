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
let screenUrl = null;
let screenBusy = false;
let connectPrompted = false;

function buzz(ms = 8) {
  try { navigator.vibrate?.(ms); } catch { /* ignore */ }
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

async function sendKey(key) {
  buzz();
  try {
    await api('/api/key', { method: 'POST', body: JSON.stringify({ key }) });
  } catch (err) {
    toast(err.message, 'error');
    setStatus({ mqttConnected: false });
  }
}

/* ---------- long press ---------- */

const repeatTimers = new Map();

function startRepeat(button) {
  const key = button.dataset.key;
  if (!key) return;
  sendKey(key);

  if (button.dataset.repeat !== '1') return;

  const entry = { delay: null, interval: null };
  entry.delay = setTimeout(() => {
    entry.interval = setInterval(() => sendKey(key), 130);
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
  f: 'KEY_AUTOFOCUS',
  p: 'KEY_POWER',
};

function anyModalOpen() {
  return (
    !powerModal.hidden ||
    !sourceModal.hidden ||
    !connectModal.hidden ||
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

  if (e.key === 'i' || e.key === 'I') { openSources(); return; }
  if (e.key === 'c' || e.key === 'C') { openScreen(); return; }

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
  if (typeof info.volume === 'number') {
    volText.textContent = info.muted ? 'без звука' : `громкость ${info.volume}`;
  } else if (info.muted === true) {
    volText.textContent = 'без звука';
  } else {
    volText.textContent = 'локальная сеть';
  }
}

async function refreshStatus() {
  try {
    const info = await api('/api/status');
    lastStatus = info;
    setStatus(info);
    if (info.name) deviceName.textContent = info.name;
    ipText.textContent = info.ip || 'IP не найден';
    renderFooter(info);
    if (info.lastError) {
      banner.textContent = info.lastError;
      banner.hidden = false;
    } else {
      banner.hidden = true;
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
    { id: '3', name: 'HDMI 1' },
    { id: '4', name: 'HDMI 2' },
    { id: '0', name: 'ТВ' },
  ];
  const current = lastStatus?.lastState?.sourceid;
  sourceList.innerHTML = '';
  for (const source of sources) {
    const button = document.createElement('button');
    button.className = 'source-item';
    if (current !== undefined && String(current) === String(source.id)) {
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

window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshStatus();
});
