const childProcess = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const readline = require("node:readline");
const { WebSocketServer } = require("ws");

const root = __dirname;
const overlayDir = path.join(root, "overlay");
const settingsPath = path.join(root, "settings.json");
const port = Number(process.env.PORT || 47863);

const defaultSettings = {
  fontFamily: "",
  fontSize: 58,
  align: "center",
  accentColor: "#42f5c8",
  pendingColor: "#ffffff",
  pendingOpacity: 0.5,
  dimOpacity: 0.58,
  metaOpacity: 0.78,
  shadowOpacity: 0.72,
  showMeta: true,
  rhythmMode: "natural"
};

const state = {
  media: null,
  lyric: {
    status: "idle",
    source: "",
    songId: null,
    songName: "",
    artistName: "",
    lines: [],
    mode: "none",
    message: "Waiting for NetEase Cloud Music"
  },
  bridge: {
    status: "waiting",
    lastSeen: 0,
    source: "",
    diagnostics: null
  },
  settings: readSettings(),
  error: "",
  updatedAt: Date.now()
};

const lyricCache = new Map();
let loadingKey = "";
let bridgeProgressLastSeen = 0;
let bridgeHeartbeatLastSeen = 0;
let mediaPlaybackProbe = null;
let bridgeMotion = {
  key: "",
  positionMs: 0,
  capturedAt: 0,
  stationarySince: 0
};
let fontCache = {
  fonts: [],
  scannedAt: 0
};

function readSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    return normalizeSettings(parsed);
  } catch {
    return { ...defaultSettings };
  }
}

function normalizeSettings(value) {
  const fontFamily = String(value?.fontFamily || "").trim().slice(0, 160);
  const fontSize = numberInRange(value?.fontSize, 24, 96, defaultSettings.fontSize);
  const pendingOpacity = numberInRange(value?.pendingOpacity, 0, 1, defaultSettings.pendingOpacity);
  const dimOpacity = numberInRange(value?.dimOpacity, 0, 1, defaultSettings.dimOpacity);
  const metaOpacity = numberInRange(value?.metaOpacity, 0, 1, defaultSettings.metaOpacity);
  const shadowOpacity = numberInRange(value?.shadowOpacity, 0, 1, defaultSettings.shadowOpacity);
  const align = ["left", "center", "right"].includes(value?.align) ? value.align : defaultSettings.align;
  const rhythmMode = ["natural", "even"].includes(value?.rhythmMode) ? value.rhythmMode : defaultSettings.rhythmMode;
  return {
    fontFamily,
    fontSize,
    align,
    accentColor: hexColor(value?.accentColor, defaultSettings.accentColor),
    pendingColor: hexColor(value?.pendingColor, defaultSettings.pendingColor),
    pendingOpacity,
    dimOpacity,
    metaOpacity,
    shadowOpacity,
    showMeta: typeof value?.showMeta === "boolean" ? value.showMeta : defaultSettings.showMeta,
    rhythmMode
  };
}

function numberInRange(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function hexColor(value, fallback) {
  const text = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
}

function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  fs.writeFileSync(settingsPath, JSON.stringify(normalized, null, 2));
  state.settings = normalized;
  state.updatedAt = Date.now();
  broadcast();
  return normalized;
}

function fallbackFonts() {
  return [
    { name: "Microsoft YaHei UI", label: "微软雅黑 UI", englishName: "Microsoft YaHei UI", source: "fallback" },
    { name: "Microsoft YaHei", label: "微软雅黑", englishName: "Microsoft YaHei", source: "fallback" },
    { name: "SimHei", label: "黑体", englishName: "SimHei", source: "fallback" },
    { name: "SimSun", label: "宋体", englishName: "SimSun", source: "fallback" },
    { name: "KaiTi", label: "楷体", englishName: "KaiTi", source: "fallback" },
    { name: "DengXian", label: "等线", englishName: "DengXian", source: "fallback" },
    { name: "Arial", label: "Arial", englishName: "Arial", source: "fallback" },
    { name: "Segoe UI", label: "Segoe UI", englishName: "Segoe UI", source: "fallback" }
  ];
}

function looksMojibake(value) {
  const text = String(value || "");
  if (!text.trim()) return true;
  return /[�]/.test(text) || /[΢ܛ]/.test(text);
}

function readUtf16Be(buffer, offset, length) {
  const chars = [];
  for (let index = offset; index + 1 < offset + length; index += 2) {
    chars.push(buffer.readUInt16BE(index));
  }
  return String.fromCharCode(...chars).replace(/\0/g, "").trim();
}

function readFontString(buffer, record, stringBase) {
  const offset = stringBase + record.offset;
  if (offset < 0 || offset + record.length > buffer.length) return "";
  if (record.platformId === 0 || record.platformId === 3) {
    return readUtf16Be(buffer, offset, record.length);
  }

  return buffer.toString("latin1", offset, offset + record.length).replace(/\0/g, "").trim();
}

function parseFontNames(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    if (buffer.length < 12) return null;

    const numTables = buffer.readUInt16BE(4);
    let nameOffset = -1;
    for (let index = 0; index < numTables; index += 1) {
      const recordOffset = 12 + index * 16;
      if (recordOffset + 16 > buffer.length) break;
      const tag = buffer.toString("ascii", recordOffset, recordOffset + 4);
      if (tag === "name") {
        nameOffset = buffer.readUInt32BE(recordOffset + 8);
        break;
      }
    }

    if (nameOffset < 0 || nameOffset + 6 > buffer.length) return null;
    const count = buffer.readUInt16BE(nameOffset + 2);
    const stringBase = nameOffset + buffer.readUInt16BE(nameOffset + 4);
    const records = [];

    for (let index = 0; index < count; index += 1) {
      const recordOffset = nameOffset + 6 + index * 12;
      if (recordOffset + 12 > buffer.length) break;
      const record = {
        platformId: buffer.readUInt16BE(recordOffset),
        encodingId: buffer.readUInt16BE(recordOffset + 2),
        languageId: buffer.readUInt16BE(recordOffset + 4),
        nameId: buffer.readUInt16BE(recordOffset + 6),
        length: buffer.readUInt16BE(recordOffset + 8),
        offset: buffer.readUInt16BE(recordOffset + 10)
      };
      if (record.nameId === 1 || record.nameId === 16) records.push(record);
    }

    const zhLanguages = new Set([0x0804, 0x0404, 0x0c04, 0x1004, 0x1404]);
    const englishLanguages = new Set([0x0409, 0x0809, 0x0c09, 0x1009, 0x1409, 0x1809]);
    const names = records
      .map((record) => ({
        nameId: record.nameId,
        languageId: record.languageId,
        text: readFontString(buffer, record, stringBase)
      }))
      .filter((item) => item.text && !looksMojibake(item.text));

    const preferred = (items) => {
      return items.find((item) => item.nameId === 16)?.text || items.find((item) => item.nameId === 1)?.text || "";
    };
    const zhName = preferred(names.filter((item) => zhLanguages.has(item.languageId) || /[\u3400-\u9fff]/.test(item.text)));
    const englishName = preferred(names.filter((item) => englishLanguages.has(item.languageId) && !/[\u3400-\u9fff]/.test(item.text)));
    const anyName = preferred(names);

    return {
      zhName,
      englishName,
      name: englishName || zhName || anyName,
      label: zhName || englishName || anyName
    };
  } catch {
    return null;
  }
}

function registryFontEntries() {
  const script = [
    "$roots = @(",
    "'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',",
    "'HKCU:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'",
    ");",
    "$items = @();",
    "foreach ($root in $roots) {",
    "  $item = Get-ItemProperty -Path $root -ErrorAction SilentlyContinue;",
    "  if ($null -eq $item) { continue }",
    "  foreach ($property in $item.PSObject.Properties) {",
    "    if ($property.Name -match '^PS') { continue }",
    "    $items += [pscustomobject]@{ registryName = $property.Name; file = [string]$property.Value };",
    "  }",
    "}",
    "$items | ConvertTo-Json -Compress"
  ].join(" ");

  return new Promise((resolve) => {
    childProcess.execFile("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script
    ], {
      cwd: root,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    }, (error, stdout) => {
      if (error) {
        resolve([]);
        return;
      }

      try {
        const parsed = JSON.parse(stdout || "[]");
        resolve(Array.isArray(parsed) ? parsed : [parsed]);
      } catch {
        resolve([]);
      }
    });
  });
}

function normalizeFontFilePath(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (path.isAbsolute(text)) return text;
  return path.join(process.env.WINDIR || "C:\\Windows", "Fonts", text);
}

function addFont(fontsByName, font) {
  const name = String(font?.name || "").trim();
  const label = String(font?.label || name).trim();
  if (!name || !label || looksMojibake(name) || looksMojibake(label)) return;
  if (fontsByName.has(name.toLowerCase())) return;
  fontsByName.set(name.toLowerCase(), {
    name,
    label,
    englishName: String(font.englishName || name).trim() || name,
    zhName: String(font.zhName || "").trim(),
    source: font.source || "system"
  });
}

function scanSystemFonts() {
  if (fontCache.fonts.length && Date.now() - fontCache.scannedAt < 60000) {
    return Promise.resolve(fontCache);
  }

  return registryFontEntries().then((entries) => {
    const fontsByName = new Map();
    for (const fallback of fallbackFonts()) addFont(fontsByName, fallback);

    for (const entry of entries) {
      const filePath = normalizeFontFilePath(entry.file);
      const parsed = filePath ? parseFontNames(filePath) : null;
      if (parsed?.name) {
        addFont(fontsByName, {
          ...parsed,
          englishName: parsed.englishName || parsed.name,
          source: "font-file"
        });
        continue;
      }

      const registryName = String(entry.registryName || "")
        .replace(/\s*\((TrueType|OpenType|Type 1)\)\s*$/i, "")
        .trim();
      addFont(fontsByName, {
        name: registryName,
        label: registryName,
        englishName: registryName,
        source: "registry"
      });
    }

    const fonts = [...fontsByName.values()]
      .sort((a, b) => a.label.localeCompare(b.label, "zh-Hans-CN"));
    fontCache = {
      fonts,
      scannedAt: Date.now()
    };
    return fontCache;
  });
}

function corsHeaders(extra = {}) {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
    ...extra
  };
}

function sendJson(res, code, body) {
  const payload = code === 204 ? "" : JSON.stringify(body);
  res.writeHead(code, corsHeaders({ "content-type": "application/json; charset=utf-8" }));
  res.end(payload);
}

function readJsonBody(req, limitBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > limitBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
  }[ext] || "application/octet-stream";
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (requestUrl.pathname === "/state") {
    sendJson(res, 200, state);
    return;
  }

  if (requestUrl.pathname === "/api/bridge/status") {
    sendJson(res, 200, state.bridge);
    return;
  }

  if (requestUrl.pathname === "/api/fonts") {
    scanSystemFonts()
      .then((result) => sendJson(res, 200, result))
      .catch((error) => sendJson(res, 500, { fonts: fallbackFonts(), error: error.message }));
    return;
  }

  if (requestUrl.pathname === "/api/settings") {
    if (req.method === "GET") {
      sendJson(res, 200, state.settings);
      return;
    }

    if (req.method === "POST") {
      readJsonBody(req)
        .then((payload) => sendJson(res, 200, saveSettings(payload)))
        .catch((error) => sendJson(res, 400, { ok: false, error: error.message }));
      return;
    }
  }

  if (requestUrl.pathname === "/api/bridge-heartbeat" && req.method === "POST") {
    readJsonBody(req)
      .then((payload) => sendJson(res, 200, handleBridgeHeartbeat(payload)))
      .catch((error) => sendJson(res, 400, { ok: false, error: error.message }));
    return;
  }

  if (requestUrl.pathname === "/api/player-state" && req.method === "POST") {
    readJsonBody(req)
      .then((payload) => sendJson(res, 200, handleBridgeState(payload)))
      .catch((error) => sendJson(res, 400, { ok: false, error: error.message }));
    return;
  }

  if (requestUrl.pathname === "/api/shutdown" && req.method === "POST") {
    sendJson(res, 200, { ok: true, message: "NetEase OBS Lyrics service is shutting down" });
    shutdownService();
    return;
  }

  let filePath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  filePath = path.normalize(decodeURIComponent(filePath)).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = path.join(overlayDir, filePath);

  if (!absolutePath.startsWith(overlayDir)) {
    res.writeHead(403, corsHeaders());
    res.end("Forbidden");
    return;
  }

  fs.readFile(absolutePath, (err, data) => {
    if (err) {
      res.writeHead(404, corsHeaders());
      res.end("Not found");
      return;
    }

    res.writeHead(200, corsHeaders({ "content-type": contentType(absolutePath) }));
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: "/ws" });

function shutdownService() {
  setTimeout(() => {
    for (const client of wss.clients) {
      try {
        client.close(1001, "service shutdown");
      } catch {
        // Ignore sockets that are already closing.
      }
    }

    wss.close(() => {
      server.close(() => process.exit(0));
    });

    setTimeout(() => process.exit(0), 1200).unref();
  }, 100).unref();
}

function broadcast() {
  const payload = JSON.stringify({ type: "state", state });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  }
}

wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "state", state }));
});

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\uFF08(].*?[\uFF09)]/g, "")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function cleanTitle(value) {
  return String(value || "")
    .replace(/\s*[-\u2013\u2014]\s*(live|karaoke|remix|cover).*$/i, "")
    .replace(/[\uFF08(](live|karaoke|remix|cover).*?[\uFF09)]/gi, "")
    .trim();
}

function trackKey(media) {
  if (!media) return "";
  if (media.songId) return `id:${media.songId}`;
  if (!media.title) return "";
  return `${cleanTitle(media.title)}::${media.artist || ""}`.toLowerCase();
}

function formBody(params) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) body.set(key, value);
  return body;
}

async function neteaseFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: "application/json,text/plain,*/*",
      "content-type": "application/x-www-form-urlencoded",
      referer: "https://music.163.com/",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    throw new Error(`NetEase HTTP ${response.status}`);
  }

  return response.json();
}

function scoreSong(song, media) {
  const wantedTitle = normalizeText(cleanTitle(media.title));
  const wantedArtist = normalizeText(media.artist);
  const songTitle = normalizeText(song.name);
  const songArtists = normalizeText((song.artists || song.ar || []).map((artist) => artist.name).join(""));
  let score = 0;

  if (songTitle === wantedTitle) score += 80;
  else if (songTitle.includes(wantedTitle) || wantedTitle.includes(songTitle)) score += 35;

  if (wantedArtist && songArtists.includes(wantedArtist)) score += 50;
  else if (wantedArtist && wantedArtist.includes(songArtists)) score += 20;

  const duration = Number(song.duration || song.dt || 0);
  if (media.durationMs && duration) {
    const diff = Math.abs(duration - media.durationMs);
    if (diff < 1500) score += 30;
    else if (diff < 5000) score += 12;
  }

  return score;
}

async function searchSong(media) {
  const title = cleanTitle(media.title);
  const query = [title, media.artist].filter(Boolean).join(" ");
  const data = await neteaseFetch("https://music.163.com/api/search/get/web?csrf_token=", {
    method: "POST",
    body: formBody({ s: query, type: "1", offset: "0", limit: "12" })
  });
  const songs = data?.result?.songs || [];
  if (!songs.length) return null;

  return songs
    .map((song) => ({ song, score: scoreSong(song, media) }))
    .sort((a, b) => b.score - a.score)[0].song;
}

async function fetchLyric(songId) {
  const url = `https://music.163.com/api/song/lyric?id=${encodeURIComponent(songId)}&lv=1&kv=1&tv=-1&yv=1&ytv=1`;
  const primary = await neteaseFetch(url);
  if (lyricPayloadHasText(primary)) return primary;

  const fallbackUrl = `https://music.163.com/api/song/lyric?id=${encodeURIComponent(songId)}&lv=-1&kv=-1&tv=-1&rv=-1`;
  const fallback = await neteaseFetch(fallbackUrl);
  return lyricPayloadHasText(fallback) ? fallback : primary;
}

function lyricPayloadHasText(data) {
  return Boolean(
    data?.yrc?.lyric ||
    data?.yrc?.lyricContent ||
    data?.lrc?.lyric ||
    data?.romalrc?.lyric ||
    data?.klyric?.lyric ||
    data?.tlyric?.lyric
  );
}

function parseTimeTag(minutes, seconds, millis = "0") {
  const ms = millis.length === 2 ? Number(millis) * 10 : Number(millis.padEnd(3, "0").slice(0, 3));
  return Number(minutes) * 60000 + Number(seconds) * 1000 + ms;
}

function parseJsonLyricLine(line) {
  try {
    const item = JSON.parse(line);
    if (typeof item.t !== "number" || !Array.isArray(item.c)) return null;
    const text = item.c.map((part) => part.tx || "").join("").trim();
    if (!text) return null;
    return { startMs: item.t, text };
  } catch {
    return null;
  }
}

function parseLrc(raw) {
  const lines = [];
  for (const rawLine of String(raw || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const jsonLine = line.startsWith("{") ? parseJsonLyricLine(line) : null;
    if (jsonLine) {
      lines.push(jsonLine);
      continue;
    }

    const matches = [...line.matchAll(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
    if (!matches.length) continue;
    const text = line.replace(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g, "").trim();
    if (!text) continue;

    for (const match of matches) {
      lines.push({ startMs: parseTimeTag(match[1], match[2], match[3] || "0"), text });
    }
  }

  return lines
    .sort((a, b) => a.startMs - b.startMs)
    .map((line, index, all) => ({
      ...line,
      endMs: all[index + 1]?.startMs || line.startMs + Math.max(2600, Array.from(line.text).length * 260)
    }));
}

function parseYrc(raw) {
  const lines = [];
  for (const rawLine of String(raw || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    const head = line.match(/^\[(\d+),(\d+)\](.*)$/);
    if (!head) continue;

    const lineStart = Number(head[1]);
    const lineDuration = Number(head[2]);
    const body = head[3];
    const words = [];

    for (const match of body.matchAll(/\((\d+),(\d+)(?:,\d+)?\)([^()]*)/g)) {
      const tokenTime = Number(match[1]);
      const duration = Math.max(80, Number(match[2]));
      const startMs = tokenTime >= lineStart ? tokenTime : lineStart + tokenTime;
      const text = match[3];
      if (!text) continue;
      words.push({ startMs, endMs: startMs + duration, text });
    }

    const text = words.map((word) => word.text).join("").trim();
    if (!text) continue;

    lines.push({
      startMs: lineStart,
      endMs: lineStart + Math.max(lineDuration, 300),
      text,
      words
    });
  }

  return lines.sort((a, b) => a.startMs - b.startMs);
}

function withFallbackWords(lines) {
  return lines.map((line) => {
    if (Array.isArray(line.words) && line.words.length) return line;

    const chars = Array.from(line.text);
    const duration = Math.max(500, line.endMs - line.startMs);
    let cursor = line.startMs;
    const words = chars.map((char, index) => {
      const next = index === chars.length - 1
        ? line.endMs
        : line.startMs + Math.round((duration * (index + 1)) / chars.length);
      const word = { startMs: cursor, endMs: Math.max(cursor + 60, next), text: char };
      cursor = next;
      return word;
    });

    return { ...line, words };
  });
}

function artistsOf(song) {
  return (song.artists || song.ar || []).map((artist) => artist.name).filter(Boolean).join(" / ");
}

function songFromBridge(media) {
  if (!media.songId) return null;
  return {
    id: media.songId,
    name: media.title,
    artists: String(media.artist || "")
      .split(/\s*[/,]\s*/)
      .filter(Boolean)
      .map((name) => ({ name }))
  };
}

async function loadLyricsFor(media) {
  const key = trackKey(media);
  if (!key || loadingKey === key) return;
  loadingKey = key;

  if (lyricCache.has(key)) {
    state.lyric = lyricCache.get(key);
    state.updatedAt = Date.now();
    broadcast();
    loadingKey = "";
    return;
  }

  state.lyric = {
    status: "loading",
    source: "",
    songId: null,
    songName: cleanTitle(media.title),
    artistName: media.artist || "",
    lines: [],
    mode: "none",
    message: "Loading lyrics"
  };
  state.updatedAt = Date.now();
  broadcast();

  try {
    const song = songFromBridge(media) || await searchSong(media);
    if (!song) throw new Error("No matching song found");

    const lyricData = await fetchLyric(song.id);
    const yrcLines = parseYrc(lyricData?.yrc?.lyric || lyricData?.yrc?.lyricContent || "");
    const lrcLines = parseLrc(lyricData?.lrc?.lyric || "");
    const baseLines = yrcLines.length ? yrcLines : lrcLines;

    if (!baseLines.length) {
      throw new Error("Song matched, but no usable lyrics were found");
    }

    const lyric = {
      status: "ready",
      source: "netease",
      songId: song.id,
      songName: song.name || cleanTitle(media.title),
      artistName: artistsOf(song) || media.artist || "",
      lines: withFallbackWords(baseLines),
      mode: yrcLines.length ? "word" : "line-fallback",
      message: yrcLines.length ? "Word-level lyrics" : "LRC line lyrics with per-character fallback"
    };

    lyricCache.set(key, lyric);
    state.lyric = lyric;
  } catch (error) {
    state.lyric = {
      status: "error",
      source: "",
      songId: null,
      songName: cleanTitle(media.title),
      artistName: media.artist || "",
      lines: [],
      mode: "none",
      message: error.message
    };
  } finally {
    state.updatedAt = Date.now();
    broadcast();
    loadingKey = "";
  }
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizedText(value) {
  return String(value || "").trim().toLowerCase();
}

function playbackStatusFromPayload(payload, title, artist) {
  const bridgeStatus = payload.playbackStatus || (payload.paused ? "Paused" : "Playing");
  const probe = mediaPlaybackProbe;
  if (!probe) return bridgeStatus;
  if (Date.now() - Number(probe.capturedAt || 0) > 2500) return bridgeStatus;

  const probeStatus = String(probe.playbackStatus || "");
  if (!/^(Playing|Paused)$/i.test(probeStatus)) return bridgeStatus;

  const probeTitle = normalizedText(probe.title);
  const mediaTitle = normalizedText(title);
  const mediaArtist = normalizedText(artist);
  const titleMatches = probeTitle && mediaTitle && (probeTitle === mediaTitle || probeTitle.includes(mediaTitle) || mediaTitle.includes(probeTitle));
  const artistMatches = normalizedText(probe.artist) && mediaArtist && (
    normalizedText(probe.artist) === mediaArtist ||
    mediaArtist.includes(normalizedText(probe.artist)) ||
    normalizedText(probe.artist).includes(mediaArtist)
  );

  return titleMatches || artistMatches ? probeStatus : bridgeStatus;
}

function playbackStatusFromMotion(status, trackKeyValue, positionMs, capturedAt, payload) {
  const normalizedStatus = String(status || "");
  const previous = bridgeMotion;
  const sameTrack = previous.key && previous.key === trackKeyValue;
  const positionDelta = sameTrack ? positionMs - Number(previous.positionMs || 0) : 0;
  const capturedDelta = sameTrack ? capturedAt - Number(previous.capturedAt || 0) : 0;
  const isStationary = sameTrack && Math.abs(positionDelta) <= 100 && capturedDelta > 0;
  const stationarySince = isStationary
    ? Number(previous.stationarySince || previous.capturedAt || capturedAt)
    : 0;
  bridgeMotion = { key: trackKeyValue, positionMs, capturedAt, stationarySince };

  if (payload?.paused === true && payload?.pausedReliable === true) return "Paused";

  if (normalizedStatus !== "Paused") {
    return stationarySince && capturedAt - stationarySince > 1600 ? "Paused" : normalizedStatus;
  }

  if (payload?.pausedReliable === true) return normalizedStatus;
  if (!sameTrack) return normalizedStatus;

  return capturedDelta > 0 && positionDelta > 250 ? "Playing" : normalizedStatus;
}

function handleBridgeState(payload) {
  const positionMs = Number(payload.positionMs);
  if (!Number.isFinite(positionMs) || positionMs < 0) {
    return { ok: false, error: "Invalid positionMs" };
  }

  const payloadTitle = String(payload.title || "").trim();
  const payloadArtist = Array.isArray(payload.artists)
    ? payload.artists.filter(Boolean).join(" / ")
    : String(payload.artist || "").trim();
  const title = payloadTitle && !/^NetEase Cloud Music$|^\u7f51\u6613\u4e91\u97f3\u4e50$/.test(payloadTitle)
    ? payloadTitle
    : String(state.media?.title || "").trim();
  const artist = payloadArtist || String(state.media?.artist || "").trim();
  const capturedAt = numberOrZero(payload.capturedAt) || Date.now();
  const songId = payload.songId || payload.id || state.media?.songId || null;
  const bridgeTrackKey = [songId || "", title || "", artist || "", payload.progressSource || ""].join("|");
  const playbackStatus = playbackStatusFromMotion(
    playbackStatusFromPayload(payload, title, artist),
    bridgeTrackKey,
    positionMs,
    capturedAt,
    payload
  );

  const media = {
    title,
    artist,
    album: String(payload.album || state.media?.album || "").trim(),
    source: "betterncm-bridge",
    playbackStatus,
    paused: playbackStatus === "Paused",
    pausedReliable: payload.pausedReliable === true,
    positionMs,
    durationMs: numberOrZero(payload.durationMs),
    capturedAt,
    positionReliable: true,
    progressSource: payload.progressSource || "betterncm-bridge",
    songId
  };

  bridgeProgressLastSeen = Date.now();
  bridgeHeartbeatLastSeen = bridgeProgressLastSeen;
  state.bridge = {
    status: "connected",
    lastSeen: bridgeProgressLastSeen,
    source: media.progressSource,
    diagnostics: state.bridge.diagnostics
  };
  state.error = "";
  state.media = media;
  state.updatedAt = Date.now();
  broadcast();

  if (media.title || media.songId) {
    loadLyricsFor(media).catch((error) => {
      state.lyric = {
        status: "error",
        source: "",
        songId: null,
        songName: cleanTitle(media.title),
        artistName: media.artist || "",
        lines: [],
        mode: "none",
        message: error.message
      };
      state.updatedAt = Date.now();
      broadcast();
    });
  }

  return { ok: true };
}

function handleBridgeHeartbeat(payload) {
  bridgeHeartbeatLastSeen = Date.now();
  if (state.bridge.status !== "connected") {
    state.bridge.status = "loaded";
  }
  state.bridge.lastSeen = bridgeHeartbeatLastSeen;
  state.bridge.source = payload.progressSource || state.bridge.source || "";
  state.bridge.diagnostics = payload;
  state.updatedAt = Date.now();
  broadcast();
  return { ok: true };
}

function handleMediaLine(line) {
  let payload;
  try {
    payload = JSON.parse(line);
  } catch {
    return;
  }

  if (payload.error) {
    state.error = payload.error;
    state.updatedAt = Date.now();
    broadcast();
    return;
  }

  if (/^(Playing|Paused)$/i.test(String(payload.playbackStatus || ""))) {
    mediaPlaybackProbe = payload;
    if (state.media?.source === "betterncm-bridge") {
      const nextStatus = playbackStatusFromPayload(
        { playbackStatus: state.media.playbackStatus, paused: state.media.playbackStatus === "Paused" },
        state.media.title,
        state.media.artist
      );
      if (nextStatus !== state.media.playbackStatus) {
        state.media = { ...state.media, playbackStatus: nextStatus, capturedAt: Date.now() };
        state.updatedAt = Date.now();
        broadcast();
      }
    }
  }

  if (Date.now() - bridgeProgressLastSeen < 3000) {
    return;
  }

  state.error = "";
  state.media = payload;
  state.updatedAt = Date.now();
  broadcast();

  if (payload.title) {
    loadLyricsFor(payload).catch((error) => {
      state.lyric = {
        status: "error",
        source: "",
        songId: null,
        songName: cleanTitle(payload.title),
        artistName: payload.artist || "",
        lines: [],
        mode: "none",
        message: error.message
      };
      state.updatedAt = Date.now();
      broadcast();
    });
  }
}

function startMediaProbe() {
  const script = path.join(root, "scripts", "media-session.ps1");
  let child;
  try {
    child = childProcess.spawn("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script
    ], {
      cwd: root,
      windowsHide: true
    });
  } catch (error) {
    state.error = `media-session helper could not start: ${error.message}`;
    state.updatedAt = Date.now();
    broadcast();
    setTimeout(startMediaProbe, 8000);
    return;
  }

  readline.createInterface({ input: child.stdout }).on("line", handleMediaLine);

  child.on("error", (error) => {
    state.error = `media-session helper error: ${error.message}`;
    state.updatedAt = Date.now();
    broadcast();
  });

  child.stderr.on("data", (chunk) => {
    state.error = chunk.toString("utf8").trim();
    state.updatedAt = Date.now();
    broadcast();
  });

  child.on("exit", (code) => {
    state.error = `media-session helper exited (${code}); restarting`;
    state.updatedAt = Date.now();
    broadcast();
    setTimeout(startMediaProbe, 2000);
  });
}

server.listen(port, "127.0.0.1", () => {
  console.log(`NetEase OBS Lyrics is running: http://127.0.0.1:${port}`);
  console.log("Add this URL as an OBS Browser Source.");
  startMediaProbe();
});
