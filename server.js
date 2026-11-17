/**
 * Локальный пульт для проектора Vidda / Hisense.
 *
 * Управление идёт по встроенному MQTT-брокеру проектора (порт 36669).
 * Топик команд: /remoteapp/tv/hiservice_cmd/<clientId>/actions/<action>
 * clientId — произвольный идентификатор: проектор отвечает под тем, который
 * указан в топике. UDN из DLNA больше не нужен.
 *
 * Подтверждённые действия:
 *  - sendkey       payload: KEY_* (см. ALLOWED_KEYS)
 *  - changesource  payload: HDMI_1, HDMI_2, ...
 *  - startapp      payload: {"package":"..."}
 *  - setvolume     payload: число
 *  - setmute       payload: true / false
 *  - playcontrol   payload: PLAY / PAUSE / FAST_FORWORD / FAST_BACKWORD
 *  - screenshot    ответ: /remoteapp/mobile/<clientId>/hiservice/data/screenshot
 *  - getapplist    ответ: .../hiservice/data/getapplist
 *
 * Включение: Wake-on-LAN (обычный KEY_POWER только выключает).
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import dgram from 'node:dgram';
import net from 'node:net';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import mqtt from 'mqtt';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const CONFIG_FILE = path.join(__dirname, 'config.json');

const HTTP_PORT = Number(process.env.PORT || 3000);
const MQTT_PORT = Number(process.env.VIDDA_PORT || 36669);
const MQTT_USER = process.env.VIDDA_USER || 'hisenseservice';
const MQTT_PASS = process.env.VIDDA_PASS || 'multimqttservice';

/**
 * Входы по умолчанию. Проектор принимает строковые идентификаторы
 * HDMI_1…HDMI_4 / LIVETV / VGA (проверено: HDMI_1, HDMI_2).
 * Список можно переопределить в config.json.
 */
const DEFAULT_SOURCES = [
  { id: 'HDMI_1', name: 'HDMI 1' },
  { id: 'HDMI_2', name: 'HDMI 2' },
];

/**
 * Разрешённые кнопки — защита от подстановки произвольного топика.
 *
 * Имена сверены с таблицей клавиш Vidda (WeShare/assets/keycode.xml).
 * На этом проекторе подтверждены: навигация, OK, RETURNS, HOME, MENU,
 * VOLUMEUP/DOWN, MUTE, POWER, SETTING, цифры.
 */
const ALLOWED_KEYS = new Set([
  'KEY_POWER',
  'KEY_UP', 'KEY_DOWN', 'KEY_LEFT', 'KEY_RIGHT',
  'KEY_OK',
  'KEY_RETURNS', 'KEY_BACKS',
  'KEY_HOME', 'KEY_MENU',
  'KEY_VOLUMEUP', 'KEY_VOLUMEDOWN', 'KEY_MUTE',
  'KEY_SETTING',
  'KEY_CHANNELUP', 'KEY_CHANNELDOWN',
  'KEY_INFO', 'KEY_STAR',
  'KEY_VOICECONTROL', 'KEY_RESTS',
  'KEY_ALTERNATES', 'KEY_POUND',
  ...Array.from({ length: 10 }, (_, i) => `KEY_${i}`),
]);

const PLAY_CONTROL = new Set(['PLAY', 'PAUSE', 'FAST_FORWORD', 'FAST_BACKWORD']);

const state = {
  ip: process.env.VIDDA_IP || null,
  clientId: process.env.VIDDA_CLIENT_ID || null,
  name: 'Vidda',
  model: null,
  macs: [],
  sources: [...DEFAULT_SOURCES],
  mqttConnected: false,
  lastError: null,
  discovering: false,
  discoveryMethod: null,
  statetype: null,
  lastState: null,
  currentApp: null,
  volume: null,
  muted: null,
  screenshotOk: null,
  screenshotAt: null,
  apps: [],
  lastSource: null,
};

let mqttClient = null;
let pendingShot = null;
let shotInFlight = null;
let lastShot = null;
let pendingApps = null;
let appsInFlight = null;

/**
 * Старые sourceid из протокола VIDAA → строковые входы hiservice.
 * Оставляем только входы, которые реально переключаются на проекторе.
 */
const LEGACY_SOURCE_IDS = {
  '3': 'HDMI_1',
  '4': 'HDMI_2',
};

// ---------------------------------------------------------------------------
// Конфигурация
// ---------------------------------------------------------------------------

function randomId(prefix = 'vidda_remote') {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

/**
 * clientId нужен только как идентификатор в топиках. Проектор принимает
 * произвольный clientId (проверено: KEY_SETTING и screenshot работают),
 * поэтому UDN из DLNA больше не обязателен.
 */
function ensureClientId() {
  if (!state.clientId) {
    state.clientId = randomId();
    return true;
  }
  return false;
}

async function loadConfig() {
  let migrated = false;
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf8');
    const cfg = JSON.parse(raw);
    if (!process.env.VIDDA_IP && cfg.ip) state.ip = cfg.ip;
    if (!process.env.VIDDA_CLIENT_ID && cfg.clientId) state.clientId = cfg.clientId;
    if (cfg.name) state.name = cfg.name;
    if (cfg.model) state.model = cfg.model;
    if (Array.isArray(cfg.macs) && cfg.macs.length) state.macs = cfg.macs;
    if (Array.isArray(cfg.sources) && cfg.sources.length) {
      const sources = cfg.sources
        .map((source) => {
          const id = String(source.id ?? '');
          if (/^\d+$/.test(id)) {
            migrated = true;
            const mapped = LEGACY_SOURCE_IDS[id];
            return mapped ? { id: mapped, name: source.name || mapped } : null;
          }
          return source;
        })
        .filter((source) => source && source.id);
      if (sources.length) state.sources = sources;
    }
  } catch {
    // первый запуск — конфига ещё нет
  }
  ensureClientId();
  if (migrated) await saveConfig();
}

async function saveConfig() {
  const cfg = {
    ip: state.ip,
    clientId: state.clientId,
    name: state.name,
    model: state.model,
    macs: state.macs,
    sources: state.sources,
  };
  await fs.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2)).catch(() => {});
}

// ---------------------------------------------------------------------------
// SSDP-обнаружение
// ---------------------------------------------------------------------------

function ssdpSearch(timeoutMs = 3500) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const locations = new Set();

    const messages = [
      'urn:schemas-upnp-org:device:MediaRenderer:1',
      'ssdp:all',
    ].map((st) =>
      Buffer.from(
        'M-SEARCH * HTTP/1.1\r\n' +
          'HOST: 239.255.255.250:1900\r\n' +
          'MAN: "ssdp:discover"\r\n' +
          'MX: 2\r\n' +
          `ST: ${st}\r\n\r\n`
      )
    );

    socket.on('message', (msg) => {
      const text = msg.toString('utf8');
      const match = text.match(/^location:\s*(.+)$/im);
      if (match) locations.add(match[1].trim());
    });

    socket.on('error', () => {});
    socket.bind(() => {
      try {
        socket.setBroadcast(true);
        for (const message of messages) {
          socket.send(message, 1900, '239.255.255.250');
        }
      } catch {
        /* ignore */
      }
    });

    setTimeout(() => {
      try { socket.close(); } catch { /* ignore */ }
      resolve([...locations]);
    }, timeoutMs);
  });
}

async function fetchDescription(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function parseDescription(xml) {
  const pick = (re) => {
    const m = xml.match(re);
    return m ? m[1].trim() : null;
  };

  const friendlyName = pick(/<friendlyName>([^<]*)<\/friendlyName>/i);
  const modelName = pick(/<modelName>([^<]*)<\/modelName>/i);
  const cap = pick(/<modelDescription>([\s\S]*?)<\/modelDescription>/i) || '';

  const ip = cap.match(/\bip=([0-9.]+)/)?.[1] || null;
  const mqttPort = Number(cap.match(/\bmqttport=(\d+)/)?.[1] || 0) || MQTT_PORT;
  const isVidaa =
    /vidda|hisense|hismart|海信/i.test(`${friendlyName || ''} ${modelName || ''}`) ||
    /mqttport=|transport_protocol|vidaa_support/i.test(cap) ||
    /<modelName>\s*HiSmart\s*<\/modelName>/i.test(xml);

  return {
    friendlyName: friendlyName || null,
    modelName: modelName || null,
    ip,
    mqttPort,
    isVidaa,
  };
}

/** SSDP: ищем UPnP-описание и берём IP из LOCATION. */
async function ssdpDiscover(timeoutMs = 3000) {
  const locations = await ssdpSearch(timeoutMs);
  const found = [];

  for (const location of locations) {
    try {
      const xml = await fetchDescription(location);
      const info = parseDescription(xml);
      if (!info.isVidaa) continue;

      let ip = info.ip;
      if (!ip) {
        try {
          ip = new URL(location).hostname;
        } catch {
          /* ignore */
        }
      }
      if (!ip || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) continue;

      found.push({
        ip,
        name: info.friendlyName,
        model: info.modelName,
        method: 'ssdp',
      });
    } catch {
      /* устройство не ответило — пропускаем */
    }
  }

  return found;
}

function localIPv4Interfaces() {
  const result = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) result.push(net);
    }
  }
  return result;
}

function broadcastAddresses() {
  const list = new Set(['255.255.255.255']);
  for (const iface of localIPv4Interfaces()) {
    list.add(`${iface.address.split('.').slice(0, 3).join('.')}.255`);
  }
  return [...list];
}

const UDP_DISCOVERY_PORT = 36671;

/** UDP-broadcast Hisense на порт 36671 (на случай, если SSDP выключен). */
function udpDiscover(timeoutMs = 2200) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const found = new Map();
    const local = new Set(localIPv4Interfaces().map((i) => i.address));
    const messages = [
      JSON.stringify({ request: 'discover' }),
      JSON.stringify({ request: 'discover', device: 'phone', version: '1.0' }),
      'HiSmart:discover',
      '{}',
    ];

    socket.on('message', (msg, rinfo) => {
      if (local.has(rinfo.address)) return;
      const text = msg.toString('utf8').trim();
      let data = {};
      try {
        data = JSON.parse(text);
      } catch {
        /* не JSON */
      }
      const name = data.devicename || data.name || data.device_name || null;
      const model = data.model || data.model_name || null;
      const mac = data.mac || data.macaddress || null;
      const looksVidaa =
        name || model || /hisense|vidda|hismart|海信/i.test(text);
      if (!looksVidaa) return;
      found.set(rinfo.address, {
        ip: rinfo.address,
        name,
        model,
        mac,
        method: 'udp',
      });
    });

    socket.on('error', () => {});
    let bound = false;

    const send = () => {
      for (const target of broadcastAddresses()) {
        for (const body of messages) {
          try {
            socket.send(Buffer.from(body), UDP_DISCOVERY_PORT, target);
          } catch {
            /* ignore */
          }
        }
      }
    };

    const start = () => {
      try { socket.setBroadcast(true); } catch { /* ignore */ }
      send();
    };

    // Если 36671 занят другим приложением — слушаем на произвольном порту.
    socket.once('error', () => {
      if (!bound) {
        try {
          socket.bind(0, () => {
            bound = true;
            start();
          });
        } catch {
          /* ignore */
        }
      }
    });

    socket.bind(UDP_DISCOVERY_PORT, () => {
      bound = true;
      start();
    });

    setTimeout(() => {
      try { socket.close(); } catch { /* ignore */ }
      resolve([...found.values()]);
    }, timeoutMs);
  });
}

function portOpen(ip, port, timeoutMs = 400) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: ip, port });
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/** Сканируем локальные /24 на открытый MQTT-порт проектора. */
async function scanForMqtt(timeoutMs = 9000) {
  const hosts = new Set();
  const own = new Set();
  for (const iface of localIPv4Interfaces()) {
    own.add(iface.address);
    const prefix = iface.address.split('.').slice(0, 3).join('.');
    for (let i = 1; i <= 254; i += 1) {
      const host = `${prefix}.${i}`;
      if (host !== iface.address) hosts.add(host);
    }
  }

  const list = [...hosts];
  const open = [];
  let index = 0;
  const deadline = Date.now() + timeoutMs;

  const worker = async () => {
    while (index < list.length && Date.now() < deadline) {
      const host = list[index];
      index += 1;
      if (await portOpen(host, MQTT_PORT, 400)) open.push(host);
    }
  };

  await Promise.all(Array.from({ length: 64 }, worker));
  return open;
}

/**
 * Проверяем, что по IP действительно проектор: подключаемся к MQTT
 * и ждём ответ sendcastinfo на getcastinfo. Заодно получаем MAC для WoL.
 */
function probeProjector(ip, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const cid = randomId('vidda_probe');
    const client = mqtt.connect(`mqtt://${ip}:${MQTT_PORT}`, {
      protocolVersion: 5,
      username: MQTT_USER,
      password: MQTT_PASS,
      clientId: randomId('vidda_probe_srv'),
      keepalive: 20,
      reconnectPeriod: 0,
      connectTimeout: timeoutMs,
      clean: true,
    });

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { client.end(true); } catch { /* ignore */ }
      resolve(result);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);

    client.on('connect', () => {
      client.subscribe(`/remoteapp/mobile/${cid}/hiservice/data/sendcastinfo`, { qos: 0 });
      client.publish(
        `/remoteapp/tv/hiservice_cmd/${cid}/actions/getcastinfo`,
        'GET_CAST_INFO',
        { qos: 0 }
      );
      // Если sendcastinfo не пришёл, но MQTT-соединение есть — это всё равно
      // может быть проектор. Не блокируем ручное подключение.
      setTimeout(() => finish({ mac: null }), 1800);
    });

    client.on('message', (topic, payload) => {
      if (!topic.endsWith('/sendcastinfo')) return;
      let mac = null;
      try {
        mac = JSON.parse(payload.toString('utf8')).btAddress || null;
      } catch {
        /* ignore */
      }
      finish({ mac });
    });

    client.on('error', () => {});
  });
}

async function discover() {
  if (state.discovering) return;
  state.discovering = true;
  state.lastError = null;

  try {
    const [ssdp, udp] = await Promise.all([ssdpDiscover(3000), udpDiscover(2000)]);
    const candidates = [...ssdp, ...udp];

    let best = candidates.find((c) =>
      /vidda|hisense|hismart|海信/i.test(`${c.name || ''} ${c.model || ''}`)
    ) || candidates[0] || null;

    // SSDP/DLNA на некоторых прошивках выключены, а MQTT работает.
    // Тогда ищем открытый порт 36669 в локальной сети и проверяем getcastinfo.
    if (!best) {
      const ips = await scanForMqtt();
      for (const ip of ips) {
        const probe = await probeProjector(ip);
        if (probe) {
          best = { ip, mac: probe.mac, method: 'scan' };
          break;
        }
      }
    }

    if (!best) {
      state.lastError =
        'Проектор не найден. Включи его, проверь, что он в той же Wi-Fi сети, ' +
        'или введи IP вручную (Настройки проектора → Сеть).';
      return;
    }

    state.ip = best.ip;
    if (best.name) state.name = best.name;
    if (best.model) state.model = best.model;
    if (best.mac && !state.macs.length) state.macs = [best.mac];
    state.discoveryMethod = best.method || null;

    await saveConfig();
    ensureClientId();
    connectMqtt();
  } finally {
    state.discovering = false;
  }
}

// ---------------------------------------------------------------------------
// MQTT
// ---------------------------------------------------------------------------

function responseTopics() {
  const cid = state.clientId;
  return [
    `/remoteapp/mobile/${cid}/hiservice/data/#`,
    `/remoteapp/mobile/broadcast/ui_service/state`,
    `/remoteapp/mobile/broadcast/platform_service/actions/volumechange`,
    `/remoteapp/mobile/broadcast/ui_service/volume`,
    `/remoteapp/mobile/broadcast/hiservice/data/appswitch`,
    `/remoteapp/mobile/broadcast/hiservice/data/strState`,
  ];
}

function connectMqtt() {
  if (!state.ip) {
    state.lastError = 'Нет IP проектора — нужно обнаружение или ручное подключение.';
    return;
  }
  ensureClientId();

  if (mqttClient) {
    try { mqttClient.end(true); } catch { /* ignore */ }
    mqttClient = null;
  }

  const url = `mqtt://${state.ip}:${MQTT_PORT}`;
  mqttClient = mqtt.connect(url, {
    protocolVersion: 5,
    username: MQTT_USER,
    password: MQTT_PASS,
    clientId: `vidda_remote_${Math.random().toString(16).slice(2, 10)}`,
    keepalive: 30,
    reconnectPeriod: 2000,
    connectTimeout: 5000,
    clean: true,
  });

  mqttClient.on('connect', () => {
    state.mqttConnected = true;
    state.lastError = null;
    for (const topic of responseTopics()) {
      mqttClient.subscribe(topic, { qos: 0 });
    }
    // MAC для Wake-on-LAN: проектор отдаёт btAddress в sendcastinfo.
    if (!state.macs.length) {
      mqttClient.publish(
        `/remoteapp/tv/hiservice_cmd/${state.clientId}/actions/getcastinfo`,
        'GET_CAST_INFO',
        { qos: 0 }
      );
    }
    console.log(`[mqtt] подключено к ${url}, clientId=${state.clientId}`);
  });

  mqttClient.on('reconnect', () => {
    state.mqttConnected = false;
  });

  mqttClient.on('close', () => {
    state.mqttConnected = false;
  });

  mqttClient.on('error', (err) => {
    state.lastError = `MQTT: ${err.message}`;
  });

  mqttClient.on('message', handleMessage);
}

function handleMessage(topic, payload) {
  // Скриншот: бинарный JPEG или пустой ответ, если сервис занят.
  if (topic.endsWith('/hiservice/data/screenshot')) {
    if (!pendingShot) return;
    const isJpeg = payload.length > 2 && payload[0] === 0xff && payload[1] === 0xd8;
    if (isJpeg) {
      state.screenshotOk = true;
      state.screenshotAt = Date.now();
      lastShot = { buffer: payload, at: Date.now() };
      pendingShot.resolve(payload);
    } else {
      state.screenshotOk = false;
      pendingShot.reject(
        Object.assign(new Error('Проектор вернул пустой скриншот'), { status: 503 })
      );
    }
    return;
  }

  const text = payload.toString('utf8').trim();

  if (topic.endsWith('/hiservice/data/sendcastinfo')) {
    try {
      const data = JSON.parse(text);
      const mac = data.btAddress || data.mac || null;
      if (mac && !state.macs.includes(mac)) {
        state.macs = [...new Set([...state.macs, mac])];
        saveConfig();
      }
    } catch {
      /* ignore */
    }
    return;
  }

  if (topic.endsWith('/hiservice/data/getapplist')) {
    let apps = [];
    try {
      const data = JSON.parse(text);
      if (Array.isArray(data)) {
        apps = data
          .filter((item) => item && item.package)
          .map((item) => ({
            name: String(item.name || item.package),
            package: String(item.package),
          }))
          .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
      }
    } catch {
      /* ignore */
    }
    state.apps = apps;
    if (pendingApps) {
      pendingApps.resolve(apps);
      pendingApps = null;
    }
    return;
  }

  if (topic.endsWith('/hiservice/data/changesourceresult')) {
    state.lastSource = text || null;
    return;
  }

  if (topic.endsWith('/broadcast/hiservice/data/appswitch')) {
    try {
      const data = JSON.parse(text);
      state.currentApp = data.to || null;
      if (data.to === 'com.meetingroom') state.statetype = 'launcher';
    } catch {
      /* ignore */
    }
    return;
  }

  if (topic.endsWith('/broadcast/ui_service/state')) {
    try {
      const data = JSON.parse(text);
      state.lastState = data;
      if (data.statetype) state.statetype = data.statetype;
      if (typeof data.volume === 'number') state.volume = data.volume;
      if (typeof data.mute === 'boolean') state.muted = data.mute;
    } catch {
      state.lastState = { raw: text };
    }
    return;
  }

  if (topic.endsWith('/volumechange') || topic.endsWith('/ui_service/volume')) {
    let value = Number(text);
    if (!Number.isFinite(value)) {
      try {
        const data = JSON.parse(text);
        value = Number(data.volume ?? data.volume_value ?? data.value);
        if (typeof data.mute === 'boolean') state.muted = data.mute;
      } catch {
        value = NaN;
      }
    }
    if (Number.isFinite(value)) state.volume = value;
    return;
  }

  if (topic.endsWith('/strState') && /volume/i.test(text)) {
    // Некоторые прошивки сообщают только факт показа OSD громкости.
    state.lastState = { ...(state.lastState || {}), osd: text };
  }
}

function assertConnected() {
  if (!mqttClient || !state.mqttConnected) {
    throw Object.assign(new Error('Нет соединения с проектором'), { status: 503 });
  }
}

function sendKey(key) {
  if (!ALLOWED_KEYS.has(key)) {
    throw Object.assign(new Error(`Неизвестная кнопка: ${key}`), { status: 400 });
  }
  assertConnected();
  const topic = `/remoteapp/tv/hiservice_cmd/${state.clientId}/actions/sendkey`;
  mqttClient.publish(topic, key, { qos: 0 });
  return topic;
}

function actionTopic(action) {
  return `/remoteapp/tv/hiservice_cmd/${state.clientId}/actions/${action}`;
}

function changeSource(sourceId) {
  const source = state.sources.find((s) => String(s.id) === String(sourceId));
  if (!source) {
    throw Object.assign(new Error(`Неизвестный вход: ${sourceId}`), { status: 400 });
  }
  assertConnected();
  const topic = actionTopic('changesource');
  // На проверенной прошивке payload — строка HDMI_1…HDMI_4 / LIVETV / VGA,
  // а не JSON {"sourceid":...}.
  mqttClient.publish(topic, String(source.id), { qos: 0 });
  state.lastSource = String(source.id);
  return { topic, source };
}

function startApp(packageName) {
  const pkg = String(packageName || '').trim();
  if (!/^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)+$/.test(pkg)) {
    throw Object.assign(new Error('Некорректное имя пакета'), { status: 400 });
  }
  assertConnected();
  const topic = actionTopic('startapp');
  mqttClient.publish(topic, JSON.stringify({ package: pkg }), { qos: 0 });
  state.currentApp = pkg;
  return { topic, package: pkg };
}

function setVolume(value) {
  const volume = Number(value);
  if (!Number.isFinite(volume) || volume < 0 || volume > 100) {
    throw Object.assign(new Error('Громкость должна быть числом 0…100'), { status: 400 });
  }
  assertConnected();
  const topic = actionTopic('setvolume');
  mqttClient.publish(topic, String(Math.round(volume)), { qos: 0 });
  state.volume = Math.round(volume);
  return { topic, volume: state.volume };
}

function setMute(muted) {
  assertConnected();
  const topic = actionTopic('setmute');
  mqttClient.publish(topic, muted ? 'true' : 'false', { qos: 0 });
  state.muted = Boolean(muted);
  return { topic, muted: state.muted };
}

function playControl(command) {
  const cmd = String(command || '').toUpperCase();
  if (!PLAY_CONTROL.has(cmd)) {
    throw Object.assign(
      new Error(`Неизвестная команда воспроизведения: ${command}`),
      { status: 400 }
    );
  }
  assertConnected();
  const topic = actionTopic('playcontrol');
  mqttClient.publish(topic, cmd, { qos: 0 });
  return { topic, command: cmd };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Автофокус на этой прошивке не имеет отдельного MQTT-действия.
 * Рабочий путь — встроенное меню проектора:
 * KEY_SETTING → RIGHT (войти в список) → DOWN×4 (Auto Focus) → OK.
 */
async function autoFocus() {
  assertConnected();
  const steps = [
    ['KEY_HOME', 900],
    ['KEY_SETTING', 1400],
    ['KEY_RIGHT', 500],
    ['KEY_DOWN', 350],
    ['KEY_DOWN', 350],
    ['KEY_DOWN', 350],
    ['KEY_DOWN', 350],
    ['KEY_OK', 0],
  ];
  for (const [key, delay] of steps) {
    mqttClient.publish(actionTopic('sendkey'), key, { qos: 0 });
    if (delay) await sleep(delay);
  }
  return { sequence: steps.map(([key]) => key) };
}

function requestAppList(timeoutMs = 5000) {
  assertConnected();
  if (appsInFlight) return appsInFlight;

  appsInFlight = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingApps = null;
      reject(Object.assign(new Error('Проектор не прислал список приложений'), { status: 504 }));
    }, timeoutMs);

    pendingApps = {
      resolve: (apps) => {
        clearTimeout(timer);
        resolve(apps);
      },
    };

    mqttClient.publish(actionTopic('getapplist'), '', { qos: 0 });
  }).finally(() => {
    appsInFlight = null;
  });

  return appsInFlight;
}

function requestScreenshot(timeoutMs = 6000) {
  assertConnected();
  if (shotInFlight) return shotInFlight;

  shotInFlight = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingShot = null;
      state.screenshotOk = false;
      reject(Object.assign(new Error('Проектор не прислал скриншот'), { status: 504 }));
    }, timeoutMs);

    pendingShot = {
      resolve: (buffer) => {
        clearTimeout(timer);
        pendingShot = null;
        resolve(buffer);
      },
      reject: (err) => {
        clearTimeout(timer);
        pendingShot = null;
        reject(err);
      },
    };

    const topic = `/remoteapp/tv/hiservice_cmd/${state.clientId}/actions/screenshot`;
    mqttClient.publish(topic, '', { qos: 0 });
  }).finally(() => {
    shotInFlight = null;
  });

  return shotInFlight;
}

// ---------------------------------------------------------------------------
// Wake-on-LAN
// ---------------------------------------------------------------------------

function magicPacket(mac) {
  const hex = mac.replace(/[^0-9a-f]/gi, '');
  if (hex.length !== 12) throw new Error(`Некорректный MAC: ${mac}`);
  const bytes = Buffer.from(hex, 'hex');
  const packet = Buffer.alloc(6 + 16 * 6, 0xff);
  for (let i = 0; i < 16; i += 1) bytes.copy(packet, 6 + i * 6);
  return packet;
}

function subnetBroadcast(ip) {
  if (!ip || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return null;
  return `${ip.split('.').slice(0, 3).join('.')}.255`;
}

async function wake() {
  if (!state.macs.length) {
    throw Object.assign(
      new Error('В config.json не заданы MAC-адреса для Wake-on-LAN (поле "macs")'),
      { status: 400 }
    );
  }

  const targets = new Set(['255.255.255.255']);
  const local = subnetBroadcast(state.ip);
  if (local) targets.add(local);

  // Если IP проектора неизвестен, пробуем широковещательные адреса интерфейсов.
  if (!state.ip) {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const net of list || []) {
        if (net.family === 'IPv4' && !net.internal) {
          targets.add(`${net.address.split('.').slice(0, 3).join('.')}.255`);
        }
      }
    }
  }

  const sent = [];
  for (const mac of state.macs) {
    const packet = magicPacket(mac);
    for (const target of targets) {
      for (const port of [9, 7]) {
        await new Promise((resolve) => {
          const socket = dgram.createSocket('udp4');
          socket.once('error', () => { try { socket.close(); } catch {} resolve(); });
          socket.bind(() => {
            try {
              socket.setBroadcast(true);
              socket.send(packet, port, target, () => {
                try { socket.close(); } catch {}
                resolve();
              });
            } catch {
              try { socket.close(); } catch {}
              resolve();
            }
          });
        });
        sent.push(`${mac} -> ${target}:${port}`);
      }
    }
  }
  return sent;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function binary(res, status, type, buffer) {
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': buffer.length,
    'Cache-Control': 'no-store',
  });
  res.end(buffer);
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4096) throw new Error('too big');
  }
  if (!raw) return {};
  return JSON.parse(raw);
}

async function serveStatic(req, res, urlPath) {
  const rel = decodeURIComponent(urlPath === '/' ? '/index.html' : urlPath);
  const full = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!full.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const data = await fs.readFile(full);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    // SPA fallback
    try {
      const index = await fs.readFile(path.join(PUBLIC_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(index);
    } catch {
      res.writeHead(404).end('Not found');
    }
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (url.pathname === '/api/status' && req.method === 'GET') {
      return json(res, 200, {
        name: state.name,
        model: state.model,
        ip: state.ip,
        clientId: state.clientId,
        macs: state.macs,
        sources: state.sources,
        mqttConnected: state.mqttConnected,
        discovering: state.discovering,
        discoveryMethod: state.discoveryMethod,
        lastError: state.lastError,
        statetype: state.statetype,
        currentApp: state.currentApp,
        volume: state.volume,
        muted: state.muted,
        screenshotOk: state.screenshotOk,
        screenshotAt: state.screenshotAt,
        lastState: state.lastState,
        lastSource: state.lastSource,
        appsCount: state.apps.length,
      });
    }

    if (url.pathname === '/api/discover' && req.method === 'POST') {
      await discover();
      return json(res, 200, {
        ip: state.ip,
        clientId: state.clientId,
        name: state.name,
        method: state.discoveryMethod,
        lastError: state.lastError,
      });
    }

    if (url.pathname === '/api/key' && req.method === 'POST') {
      const body = await readBody(req);
      const key = String(body.key || '');
      const topic = sendKey(key);
      return json(res, 200, { ok: true, key, topic });
    }

    if (url.pathname === '/api/source' && req.method === 'POST') {
      const body = await readBody(req);
      const result = changeSource(body.id ?? body.source);
      return json(res, 200, { ok: true, ...result });
    }

    if (url.pathname === '/api/apps' && req.method === 'GET') {
      try {
        const apps = await requestAppList();
        return json(res, 200, { apps });
      } catch (err) {
        if (state.apps.length) {
          return json(res, 200, { apps: state.apps, cached: true });
        }
        return json(res, err.status || 503, { error: err.message });
      }
    }

    if (url.pathname === '/api/app' && req.method === 'POST') {
      const body = await readBody(req);
      const result = startApp(body.package);
      return json(res, 200, { ok: true, ...result });
    }

    if (url.pathname === '/api/volume' && req.method === 'POST') {
      const body = await readBody(req);
      const result = setVolume(body.value ?? body.volume);
      return json(res, 200, { ok: true, ...result });
    }

    if (url.pathname === '/api/mute' && req.method === 'POST') {
      const body = await readBody(req);
      const result = setMute(Boolean(body.muted ?? body.value));
      return json(res, 200, { ok: true, ...result });
    }

    if (url.pathname === '/api/play' && req.method === 'POST') {
      const body = await readBody(req);
      const result = playControl(body.command ?? body.action);
      return json(res, 200, { ok: true, ...result });
    }

    if (url.pathname === '/api/focus' && req.method === 'POST') {
      const result = await autoFocus();
      return json(res, 200, { ok: true, ...result });
    }

    if (url.pathname === '/api/wake' && req.method === 'POST') {
      const sent = await wake();
      return json(res, 200, { ok: true, sent });
    }

    if (url.pathname === '/api/screenshot' && req.method === 'GET') {
      const fresh = url.searchParams.has('fresh');
      if (!fresh && lastShot && Date.now() - lastShot.at < 1500) {
        return binary(res, 200, 'image/jpeg', lastShot.buffer);
      }
      try {
        const buffer = await requestScreenshot();
        return binary(res, 200, 'image/jpeg', buffer);
      } catch (err) {
        return json(res, err.status || 503, { error: err.message });
      }
    }

    if (url.pathname === '/api/connect' && req.method === 'POST') {
      const body = await readBody(req);
      const ip = String(body.ip || '').trim();

      if (ip) {
        const valid =
          /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) &&
          ip.split('.').every((part) => Number(part) <= 255);
        if (!valid) {
          return json(res, 400, { error: 'Некорректный IP-адрес' });
        }

        const probe = await probeProjector(ip, 4500);
        if (!probe) {
          return json(res, 400, {
            error:
              'По этому IP проектор не отвечает по MQTT. Проверь адрес и что проектор включён.',
          });
        }

        state.ip = ip;
        state.discoveryMethod = 'manual';
        state.lastError = null;
        if (probe.mac && !state.macs.length) state.macs = [probe.mac];
        await saveConfig();
      }

      if (!state.ip) {
        return json(res, 400, { error: 'Не указан IP проектора' });
      }

      ensureClientId();
      connectMqtt();
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return json(res, 200, {
        ok: true,
        ip: state.ip,
        mqttConnected: state.mqttConnected,
        lastError: state.lastError,
      });
    }

    if (url.pathname.startsWith('/api/')) {
      return json(res, 404, { error: 'not found' });
    }

    return serveStatic(req, res, url.pathname);
  } catch (err) {
    return json(res, err.status || 500, { error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Старт
// ---------------------------------------------------------------------------

await loadConfig();

server.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`Пульт Vidda: http://localhost:${HTTP_PORT}`);
  if (state.ip && state.clientId) {
    connectMqtt();
  } else {
    discover().then(() => {
      if (!state.mqttConnected && state.ip && state.clientId) connectMqtt();
    });
  }
});

process.on('SIGINT', () => {
  try { mqttClient?.end(true); } catch { /* ignore */ }
  process.exit(0);
});
