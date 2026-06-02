(function () {
  "use strict";

  const endpoint = "http://127.0.0.1:47863/api/player-state";
  const heartbeatEndpoint = "http://127.0.0.1:47863/api/bridge-heartbeat";
  const intervalMs = 200;
  let lastPayloadKey = "";
  let lastSendAt = 0;
  let lastHeartbeatAt = 0;
  let lastNativeSnapshot = null;
  let tickInFlight = false;

  function toMs(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.round(number * 1000)) : 0;
  }

  function parseClock(value) {
    const parts = String(value || "").trim().split(":").map(Number);
    if (parts.length < 2 || parts.some((part) => !Number.isFinite(part))) return null;
    let seconds = 0;
    for (const part of parts) seconds = seconds * 60 + part;
    return seconds * 1000;
  }

  function readDocumentTitle() {
    const rawTitle = String(document.title || "").trim();
    const title = rawTitle
      .replace(/\s*[-\u2013\u2014]\s*NetEase Cloud Music.*$/i, "")
      .replace(/\s*[-\u2013\u2014]\s*\u7F51\u6613\u4E91\u97F3\u4E50.*$/i, "")
      .trim();
    const parts = title.split(/\s+[-\u2013\u2014]\s+/);
    if (parts.length >= 2) {
      return {
        title: parts.slice(0, -1).join(" - ").trim(),
        artist: parts[parts.length - 1].trim()
      };
    }
    return { title, artist: "" };
  }

  function readAudioElement() {
    const mediaElements = Array.from(document.querySelectorAll("audio,video"));
    const usable = mediaElements
      .filter((element) => Number.isFinite(element.currentTime) && element.duration > 0)
      .sort((a, b) => {
        const aScore = (a.paused ? 0 : 2) + (a.currentTime > 0 ? 1 : 0);
        const bScore = (b.paused ? 0 : 2) + (b.currentTime > 0 ? 1 : 0);
        return bScore - aScore;
      })[0];

    if (!usable) return null;

    return {
      positionMs: toMs(usable.currentTime),
      durationMs: toMs(usable.duration),
      paused: Boolean(usable.paused),
      pausedReliable: true,
      progressSource: "html-media-element"
    };
  }

  function readDomClock() {
    const text = document.body ? document.body.innerText || "" : "";
    const matches = Array.from(text.matchAll(/(\d{1,2}:\d{2}(?::\d{2})?)\s*[/\u952d\u6e31]\s*(\d{1,2}:\d{2}(?::\d{2})?)/g));
    const candidates = matches
      .map((match) => ({
        positionMs: parseClock(match[1]),
        durationMs: parseClock(match[2])
      }))
      .filter((item) => item.positionMs !== null && item.durationMs !== null && item.durationMs > 0 && item.positionMs <= item.durationMs + 1000)
      .sort((a, b) => b.durationMs - a.durationMs);

    if (!candidates.length) return null;

    return {
      ...candidates[0],
      paused: null,
      pausedReliable: false,
      progressSource: "dom-clock"
    };
  }

  function safeJson(value) {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch (error) {
      return String(value).slice(0, 1000);
    }
  }

  function decodeStorageValue(value) {
    if (!value) return null;
    const decoders = [
      () => window.channel && window.channel.deSerialData && window.channel.deSerialData(value),
      () => window.channel && window.channel.deData && window.channel.deData(value),
      () => window.channel && window.channel.oldLocalStorageData && window.channel.oldLocalStorageData(value)
    ];
    for (const decode of decoders) {
      try {
        const result = decode();
        if (result !== undefined && result !== null && result !== "") {
          return typeof result === "string" ? safeJson(result) : result;
        }
      } catch (error) {
        // Try the next decoder.
      }
    }
    return safeJson(value);
  }

  function safeKeys(value) {
    try {
      if (!value) return [];
      return Object.getOwnPropertyNames(value).slice(0, 80);
    } catch (error) {
      return [`<error:${error.message}>`];
    }
  }

  function pausedFromObject(value) {
    if (typeof value !== "object") return null;

    const entries = Array.isArray(value)
      ? value.map((item, index) => [String(index), item])
      : Object.entries(value);

    for (const [rawKey, rawValue] of entries) {
      const key = String(rawKey || "").toLowerCase();
      if (/^(paused|pause|ispause|ispaused)$/.test(key)) {
        if (typeof rawValue === "boolean") return rawValue;
        if (Number(rawValue) === 1) return true;
        if (Number(rawValue) === 0) return false;
        if (/pause|paused|stop|stopped/i.test(String(rawValue))) return true;
      }

      if (/^(playing|isplaying)$/.test(key)) {
        if (typeof rawValue === "boolean") return !rawValue;
        if (Number(rawValue) === 1) return false;
        if (Number(rawValue) === 0) return true;
      }

      if (/^(playingstate|playstate|status|state)$/.test(key)) {
        if (Number(rawValue) === 0) return true;
        if (Number(rawValue) === 1 || Number(rawValue) === 2) return false;
        const text = String(rawValue || "").toLowerCase();
        if (/pause|paused|stop|stopped/.test(text)) return true;
        if (/play|playing/.test(text)) return false;
      }
    }

    return null;
  }

  function readMediaSessionPaused() {
    try {
      const playbackState = navigator.mediaSession && navigator.mediaSession.playbackState;
      if (playbackState === "paused") return true;
      if (playbackState === "playing") return false;
    } catch (error) {
      // Some clients expose MediaSession partially.
    }
    return null;
  }

  function collectObjects(value, depth = 0, output = []) {
    if (!value || typeof value !== "object" || depth > 4) return output;
    output.push(value);
    for (const child of Object.values(value)) {
      if (child && typeof child === "object") collectObjects(child, depth + 1, output);
    }
    return output;
  }

  function firstText(objects, keys) {
    const wanted = new Set(keys.map((key) => key.toLowerCase()));
    for (const object of objects) {
      for (const [rawKey, rawValue] of Object.entries(object)) {
        if (!wanted.has(String(rawKey).toLowerCase())) continue;
        const text = String(rawValue || "").trim();
        if (text) return text;
      }
    }
    return "";
  }

  function firstNumber(objects, keys, durationMs = 0) {
    const wanted = new Set(keys.map((key) => key.toLowerCase()));
    for (const object of objects) {
      for (const [rawKey, rawValue] of Object.entries(object)) {
        const key = String(rawKey).toLowerCase();
        if (!wanted.has(key)) continue;
        const number = Number(rawValue);
        if (!Number.isFinite(number) || number < 0) continue;
        if (/progress/.test(key) && number > 0 && number <= 1) continue;

        const ms = number > 10000 ? Math.round(number) : Math.round(number * 1000);
        if (durationMs > 0 && ms > durationMs + 2000) continue;
        return ms;
      }
    }
    return 0;
  }

  function nativeArtists(objects) {
    for (const object of objects) {
      const value = object.artists || object.artist || object.ar;
      if (Array.isArray(value)) {
        const text = artistNames(value);
        if (text) return text;
      }
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  }

  function nativeSongId(objects) {
    return firstText(objects, ["trackId", "resourceTrackId", "resourceId", "onlineResourceId", "id", "songId"]);
  }

  function normalizeNativeProgress(value, source) {
    const objects = collectObjects(value);
    if (!objects.length) return null;

    const durationMs = firstNumber(objects, ["duration", "resourceDuration", "dt", "totalTime", "total"]);
    const positionMs = firstNumber(objects, [
      "currentTime",
      "playTime",
      "playedTime",
      "currentPosition",
      "currentMs",
      "curTime",
      "elapsed",
      "progress"
    ], durationMs);

    if (!positionMs || !durationMs) return null;

    const paused = pausedFromObject(objects[0]);
    return {
      positionMs,
      durationMs,
      paused,
      pausedReliable: paused !== null,
      progressSource: source,
      songId: nativeSongId(objects),
      title: firstText(objects, ["name", "title", "resourceName"]),
      artist: nativeArtists(objects),
      album: firstText(objects, ["albumName", "album"])
    };
  }

  function summarizeNative(value) {
    const objects = collectObjects(value).slice(0, 8);
    return objects.map((object) => {
      const summary = {};
      for (const [key, rawValue] of Object.entries(object).slice(0, 24)) {
        if (rawValue === null || rawValue === undefined) {
          summary[key] = rawValue;
        } else if (typeof rawValue === "object") {
          summary[key] = Array.isArray(rawValue) ? `[array:${rawValue.length}]` : "[object]";
        } else {
          summary[key] = String(rawValue).slice(0, 120);
        }
      }
      return summary;
    });
  }

  async function callBetterNcmApi(name) {
    const api = window.betterncm && window.betterncm.ncm;
    if (!api || typeof api[name] !== "function") return null;
    const value = api[name]();
    return value && typeof value.then === "function" ? await value : value;
  }

  async function readBetterNcmProgress() {
    const attempts = [];
    for (const name of ["getPlaying", "getPlayingSong"]) {
      try {
        const value = await callBetterNcmApi(name);
        attempts.push({
          api: name,
          capturedAt: Date.now(),
          sample: summarizeNative(value)
        });
        lastNativeSnapshot = { capturedAt: Date.now(), attempts };
        const progress = normalizeNativeProgress(value, `betterncm.ncm.${name}`);
        if (progress) return progress;
      } catch (error) {
        attempts.push({
          api: name,
          capturedAt: Date.now(),
          error: error.message
        });
        lastNativeSnapshot = { capturedAt: Date.now(), attempts };
      }
    }
    return null;
  }

  function readLocalStorageProgress() {
    const candidates = ["playingInfo", "lastPlaying"];
    for (const key of candidates) {
      const value = decodeStorageValue(localStorage.getItem(key));
      const queue = Array.isArray(value) ? value : [value];
      for (const item of queue.filter(Boolean)) {
        const current = item.current || item.track || item.song || item.data || item;
        const position = current.position ?? current.currentTime ?? current.progress ?? current.playTime ?? item.position ?? item.currentTime ?? item.progress ?? item.playTime ?? item.current;
        const duration = current.duration ?? current.resourceDuration ?? current.dt ?? item.duration ?? item.resourceDuration ?? item.dt;
        if (Number.isFinite(Number(position)) && Number.isFinite(Number(duration))) {
          const paused = pausedFromObject(item);
          return {
            positionMs: Number(position) > 10000 ? Number(position) : Math.round(Number(position) * 1000),
            durationMs: Number(duration) > 10000 ? Number(duration) : Math.round(Number(duration) * 1000),
            paused,
            pausedReliable: paused !== null,
            progressSource: `localStorage:${key}`,
            songId: current.trackId || current.resourceId || current.id || item.trackId || item.resourceId || item.id || ""
          };
        }
      }
    }
    return null;
  }

  function artistNames(value) {
    const artists = Array.isArray(value) ? value : [];
    return artists
      .map((artist) => (artist && typeof artist === "object" ? artist.name : artist))
      .filter(Boolean)
      .join(" / ");
  }

  function readLocalStorageMeta() {
    const playingInfo = decodeStorageValue(localStorage.getItem("playingInfo")) || {};
    const current = playingInfo.curTrack || (playingInfo.curPlaying && playingInfo.curPlaying.track) || {};
    const title = playingInfo.resourceName || current.name || "";
    const artist = artistNames(playingInfo.resourceArtists) || artistNames(current.artists || current.ar);
    const paused = pausedFromObject(playingInfo);
    return {
      title,
      artist,
      album: current.album ? current.album.name || current.album.albumName || "" : "",
      songId: playingInfo.resourceTrackId || current.id || playingInfo.onlineResourceId || "",
      paused,
      pausedReliable: paused !== null
    };
  }

  function readMeta() {
    const storageMeta = readLocalStorageMeta();
    const titleMeta = readDocumentTitle();
    const titleIsGeneric = !titleMeta.title || /^(NetEase Cloud Music|\u7F51\u6613\u4E91\u97F3\u4E50)$/.test(titleMeta.title);
    return {
      title: storageMeta.title || (titleIsGeneric ? "" : titleMeta.title),
      artist: storageMeta.artist || titleMeta.artist,
      album: storageMeta.album || "",
      songId: storageMeta.songId || "",
      paused: storageMeta.paused,
      pausedReliable: storageMeta.pausedReliable
    };
  }

  function diagnostics(progress) {
    const mediaElements = Array.from(document.querySelectorAll("audio,video"));
    const bodyText = document.body ? document.body.innerText || "" : "";
    const clockMatches = Array.from(bodyText.matchAll(/(\d{1,2}:\d{2}(?::\d{2})?)\s*[/\u952d\u6e31]\s*(\d{1,2}:\d{2}(?::\d{2})?)/g));
    const localStorageKeys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (/player|audio|music|track|song|ncm|orpheus|store|play/i.test(key)) {
        localStorageKeys.push(key);
      }
    }

    return {
      href: location.href,
      title: document.title,
      readyState: document.readyState,
      bodyTextLength: bodyText.length,
      audioVideoCount: mediaElements.length,
      audioVideo: mediaElements.slice(0, 5).map((element) => ({
        tag: element.tagName,
        currentTime: Number.isFinite(element.currentTime) ? element.currentTime : null,
        duration: Number.isFinite(element.duration) ? element.duration : null,
        paused: Boolean(element.paused),
        src: element.currentSrc || element.src || ""
      })),
      clockMatches: clockMatches.slice(0, 5).map((match) => match[0]),
      localStorageKeys: localStorageKeys.slice(0, 80),
      knownTypes: {
        legacyNativeCmder: typeof window.legacyNativeCmder,
        channel: typeof window.channel,
        APP_CONF: typeof window.APP_CONF,
        betterncm: typeof window.betterncm,
        betterncmNative: typeof window.betterncm_native,
        loadedPlugins: typeof window.loadedPlugins
      },
      objectKeys: {
        legacyNativeCmder: safeKeys(window.legacyNativeCmder),
        channel: safeKeys(window.channel),
        APP_CONF: safeKeys(window.APP_CONF),
        betterncm: safeKeys(window.betterncm),
        betterncmNcm: safeKeys(window.betterncm && window.betterncm.ncm),
        betterncmNative: safeKeys(window.betterncm_native)
      },
      storageValues: {
        playingInfo: decodeStorageValue(localStorage.getItem("playingInfo")),
        lastPlaying: decodeStorageValue(localStorage.getItem("lastPlaying")),
        lyricStore: decodeStorageValue(localStorage.getItem("lyricStore"))
      },
      nativeApi: lastNativeSnapshot,
      progressSource: progress ? progress.progressSource : "",
      capturedAt: Date.now()
    };
  }

  function payloadKey(payload) {
    return [
      payload.title,
      payload.artist,
      payload.playbackStatus,
      Math.floor(payload.positionMs / 100),
      Math.floor(payload.durationMs / 1000),
      payload.progressSource
    ].join("|");
  }

  function inferPlayback(progress, meta) {
    if (progress.progressSource === "html-media-element" && progress.pausedReliable && progress.paused !== null) {
      return { paused: Boolean(progress.paused), reliable: true };
    }
    if (progress.pausedReliable && progress.paused !== null) {
      return { paused: Boolean(progress.paused), reliable: true };
    }
    if (meta.pausedReliable && meta.paused !== null) {
      return { paused: Boolean(meta.paused), reliable: true };
    }
    if (progress.paused === true) return { paused: true, reliable: Boolean(progress.pausedReliable) };
    if (meta.paused === true) return { paused: true, reliable: Boolean(meta.pausedReliable) };

    const mediaSessionPaused = readMediaSessionPaused();
    if (mediaSessionPaused !== null) return { paused: mediaSessionPaused, reliable: true };

    return { paused: false, reliable: false };
  }

  async function sendState(payload) {
    const key = payloadKey(payload);
    const now = Date.now();
    if (key === lastPayloadKey && now - lastSendAt < 900) return;

    lastPayloadKey = key;
    lastSendAt = now;

    try {
      await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      // The OBS service may not be running yet. Keep retrying quietly.
    }
  }

  async function sendHeartbeat(progress) {
    const now = Date.now();
    if (now - lastHeartbeatAt < 1000) return;
    lastHeartbeatAt = now;
    try {
      await fetch(heartbeatEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(diagnostics(progress))
      });
    } catch (error) {
      // The OBS service may not be running yet. Keep retrying quietly.
    }
  }

  async function tick() {
    if (tickInFlight) return;
    tickInFlight = true;
    try {
      const progress = readAudioElement() || await readBetterNcmProgress() || readDomClock() || readLocalStorageProgress();
      sendHeartbeat(progress);
      if (!progress) return;
      const meta = readMeta();
      const playback = inferPlayback(progress, meta);
      sendState({
        title: progress.title || meta.title,
        artist: progress.artist || meta.artist,
        album: progress.album || meta.album,
        songId: progress.songId || meta.songId || "",
        positionMs: progress.positionMs,
        durationMs: progress.durationMs,
        playbackStatus: playback.paused ? "Paused" : "Playing",
        paused: playback.paused,
        pausedReliable: playback.reliable,
        progressSource: progress.progressSource,
        capturedAt: Date.now()
      });
    } finally {
      tickInFlight = false;
    }
  }

  function start() {
    setInterval(tick, intervalMs);
    tick();
    console.log("[NetEase OBS Lyrics Bridge] started");
  }

  if (window.plugin && typeof window.plugin.onLoad === "function") {
    window.plugin.onLoad(start);
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
