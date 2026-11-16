/**
 * Локальный пульт для проектора Vidda / Hisense.
 *
 * Управление идёт по встроенному MQTT-брокеру проектора (порт 36669).
 * Топик команд: /remoteapp/tv/hiservice_cmd/<clientId>/actions/sendkey
 * clientId — это UDN устройства из DLNA-описания без "uuid:" и дефисов
 * (32 hex-символа).
 *
 * Дополнительно:
 *  - скриншот экрана:  .../actions/screenshot -> /remoteapp/mobile/<clientId>/hiservice/data/screenshot
 *  - смена входа:      /remoteapp/tv/ui_service/<clientId>/actions/changesource
 *  - включение:        Wake-on-LAN (обычный KEY_POWER только выключает)
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import dgram from 'node:dgram';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import mqtt from 'mqtt';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const CONFIG_FILE = path.join(__dirname, 'config.json');

const HTTP_PORT = Number(process.env.PORT || 3000);
const MQTT_PORT = Number(process.env.VIDDA_PORT || 36669);
const MQTT_USER = process.env.VIDDA_USER || 'hisenseservice';
const MQTT_PASS = process.env.VIDDA_PASS || 'multimqttservice';

/** Входы по умолчанию. sourceid — из протокола VIDAA. */
const DEFAULT_SOURCES = [
  { id: '3', name: 'HDMI 1' },
  { id: '4', name: 'HDMI 2' },
  { id: '0', name: 'ТВ' },
];

/**
 * Разрешённые кнопки — защита от подстановки произвольного топика.
 *
 * Подтверждено на этом проекторе: базовая навигация, громкость, меню,
 * KEY_SETTING (открывает настройки проектора).
 * Экспериментально: KEY_AUTOFOCUS, KEY_FAVORITE.
 */
const ALLOWED_KEYS = new Set([
  'KEY_POWER',
  'KEY_UP', 'KEY_DOWN', 'KEY_LEFT', 'KEY_RIGHT',
  'KEY_OK', 'KEY_OK_LONG_PRESS',
  'KEY_MENU', 'KEY_RETURNS', 'KEY_EXIT', 'KEY_HOME',
  'KEY_VOLUMEUP', 'KEY_VOLUMEDOWN', 'KEY_MUTE', 'KEY_MUTE_LONG_PRESS',
  'KEY_SETTING', 'KEY_AUTOFOCUS', 'KEY_FAVORITE',
  'KEY_JUBAO', 'KEY_APPS', 'KEY_LIVE',
  'KEY_PLAY', 'KEY_PAUSE', 'KEY_STOP', 'KEY_FORWARDS', 'KEY_BACK',
  'KEY_CHANNELUP', 'KEY_CHANNELDOWN', 'KEY_SUBTITLE',
  ...Array.from({ length: 10 }, (_, i) => `KEY_${i}`),
]);

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
  statetype: null,
  lastState: null,
  currentApp: null,
  volume: null,
  muted: null,
  screenshotOk: null,
  screenshotAt: null,
};

let mqttClient = null;
let pendingShot = null;
let shotInFlight = null;
let lastShot = null;

// ---------------------------------------------------------------------------
// Конфигурация
// ---------------------------------------------------------------------------

async function loadConfig() {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf8');
    const cfg = JSON.parse(raw);
    if (!process.env.VIDDA_IP && cfg.ip) state.ip = cfg.ip;
    if (!process.env.VIDDA_CLIENT_ID && cfg.clientId) state.clientId = cfg.clientId;
    if (cfg.name) state.name = cfg.name;
    if (cfg.model) state.model = cfg.model;
    if (Array.isArray(cfg.macs) && cfg.macs.length) state.macs = cfg.macs;
    if (Array.isArray(cfg.sources) && cfg.sources.length) state.sources = cfg.sources;
  } catch {
    // первый запуск — конфига ещё нет
  }
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

    const message = Buffer.from(
      'M-SEARCH * HTTP/1.1\r\n' +
        'HOST: 239.255.255.250:1900\r\n' +
        'MAN: "ssdp:discover"\r\n' +
        'MX: 2\r\n' +
        'ST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n'
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
        socket.send(message, 1900, '239.255.255.250');
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

  const udn = pick(/<UDN>\s*uuid:([0-9a-f-]+)\s*<\/UDN>/i);
  const friendlyName = pick(/<friendlyName>([^<]*)<\/friendlyName>/i);
  const modelName = pick(/<modelName>([^<]*)<\/modelName>/i);
  const cap = pick(/<modelDescription>([\s\S]*?)<\/modelDescription>/i) || '';

  const ip = cap.match(/\bip=([0-9.]+)/)?.[1] || null;
  const mqttPort = Number(cap.match(/\bmqttport=(\d+)/)?.[1] || 0) || MQTT_PORT;

  return {
    clientId: udn ? udn.replace(/-/g, '').toLowerCase() : null,
    friendlyName: friendlyName || null,
    modelName: modelName || null,
    ip,
    mqttPort,
  };
}

async function discover() {
  if (state.discovering) return;
  state.discovering = true;
  state.lastError = null;

  try {
    const locations = await ssdpSearch();
    const candidates = [];

    for (const location of locations) {
      try {
        const xml = await fetchDescription(location);
        if (!/mqttport=/i.test(xml)) continue;
        const info = parseDescription(xml);
        if (!info.ip || !info.clientId) continue;
        candidates.push(info);
      } catch {
        /* устройство не ответило — пропускаем */
      }
    }

    if (!candidates.length) {
      state.lastError = 'Проектор не найден в сети (SSDP). Проверь, что он включён и в той же сети.';
      return;
    }

    // Предпочитаем устройство с именем vidda/hisense
    const best =
      candidates.find((c) => /vidda|hisense|海信/i.test(`${c.friendlyName} ${c.modelName}`)) ||
      candidates[0];

    state.ip = best.ip;
    state.clientId = best.clientId;
    state.name = best.friendlyName || 'Vidda';
    state.model = best.modelName || null;

    await saveConfig();
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
    `/remoteapp/mobile/${cid}/hiservice/data/screenshot`,
    `/remoteapp/mobile/broadcast/ui_service/state`,
    `/remoteapp/mobile/broadcast/platform_service/actions/volumechange`,
    `/remoteapp/mobile/broadcast/ui_service/volume`,
    `/remoteapp/mobile/broadcast/hiservice/data/appswitch`,
    `/remoteapp/mobile/broadcast/hiservice/data/strState`,
  ];
}

function connectMqtt() {
  if (!state.ip || !state.clientId) {
    state.lastError = 'Нет IP или client ID — нужно обнаружение.';
    return;
  }

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

function changeSource(sourceId) {
  const source = state.sources.find((s) => String(s.id) === String(sourceId));
  if (!source) {
    throw Object.assign(new Error(`Неизвестный вход: ${sourceId}`), { status: 400 });
  }
  assertConnected();
  const topic = `/remoteapp/tv/ui_service/${state.clientId}/actions/changesource`;
  mqttClient.publish(topic, JSON.stringify({ sourceid: String(source.id) }), { qos: 0 });
  return { topic, source };
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
        lastError: state.lastError,
        statetype: state.statetype,
        currentApp: state.currentApp,
        volume: state.volume,
        muted: state.muted,
        screenshotOk: state.screenshotOk,
        screenshotAt: state.screenshotAt,
        lastState: state.lastState,
      });
    }

    if (url.pathname === '/api/discover' && req.method === 'POST') {
      await discover();
      return json(res, 200, {
        ip: state.ip,
        clientId: state.clientId,
        name: state.name,
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
      connectMqtt();
      return json(res, 200, { ok: true });
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
