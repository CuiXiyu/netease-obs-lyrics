const params = new URLSearchParams(window.location.search);
const root = document.documentElement;
const meta = document.getElementById("meta");
const song = document.getElementById("song");
const artist = document.getElementById("artist");
const statusEl = document.getElementById("status");
const previousLine = document.getElementById("previousLine");
const currentLine = document.getElementById("currentLine");
const nextLine = document.getElementById("nextLine");

const config = {
  fontSize: params.has("fontSize") ? Number(params.get("fontSize") || 58) : null,
  accent: params.get("accent") || "",
  align: params.get("align") || "",
  fontFamily: params.get("font") || "",
  meta: params.has("meta") ? params.get("meta") !== "0" : null,
  status: params.get("status") === "1",
  smooth: params.get("smooth") !== "0",
  rhythm: params.get("rhythm") || ""
};

let state = null;
let receivedAt = Date.now();
let lastRenderedLineKey = "";
let lastRenderedSecond = -1;
let frameLoopStarted = false;
let currentSweep = null;
let activeBaseFontSize = 58;
let lastLayoutSettingsKey = "";
let pendingFitFrame = 0;
let smoothClock = {
  valid: false,
  trackKey: "",
  source: "",
  basePositionMs: 0,
  baseAt: 0,
  correctionDeltaMs: 0,
  correctionDurationMs: 1,
  correctionStartedAt: 0,
  lastRealPositionMs: null,
  lastRealCapturedAt: 0,
  lastPlaybackStatus: ""
};

applySettings({});
statusEl.classList.toggle("hide", !config.status);

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "state") {
      state = message.state;
      receivedAt = Date.now();
      applySettings(state.settings);
      updateSmoothClock(state.media, receivedAt);
    }
  });

  ws.addEventListener("close", () => {
    setTimeout(connect, 1000);
  });
}

function fontStack(fontFamily) {
  const fallback = "\"Microsoft YaHei UI\", \"Microsoft YaHei\", \"PingFang SC\", \"Noto Sans CJK SC\", sans-serif";
  const clean = String(fontFamily || "").replace(/["\\]/g, "").trim();
  return clean ? `"${clean}", ${fallback}` : fallback;
}

function applyFont(fontFamily) {
  root.style.setProperty("--font-family", fontStack(fontFamily));
}

function applySettings(settings) {
  const fontSize = Number(config.fontSize || settings?.fontSize || 58);
  const align = config.align || settings?.align || "center";
  const accent = config.accent || settings?.accentColor || "#42f5c8";
  const pendingColor = settings?.pendingColor || "#ffffff";
  const pendingOpacity = settings?.pendingOpacity ?? 0.5;
  const dimOpacity = settings?.dimOpacity ?? 0.58;
  const metaOpacity = settings?.metaOpacity ?? 0.78;
  const shadowOpacity = settings?.shadowOpacity ?? 0.72;
  const showMeta = config.meta ?? settings?.showMeta ?? true;
  const boundedFontSize = Math.min(96, Math.max(24, fontSize));
  const layoutSettingsKey = [
    boundedFontSize,
    align,
    config.fontFamily || settings?.fontFamily || ""
  ].join("|");

  activeBaseFontSize = boundedFontSize;
  applyFont(config.fontFamily || settings?.fontFamily || "");
  root.style.setProperty("--font-size", `${boundedFontSize}px`);
  root.style.setProperty("--align", align);
  root.style.setProperty("--accent", cssColor(accent, "#42f5c8"));
  root.style.setProperty("--pending", rgbaColor(pendingColor, pendingOpacity, "rgba(255, 255, 255, 0.5)"));
  root.style.setProperty("--dim", `rgba(255, 255, 255, ${clamp01(dimOpacity)})`);
  root.style.setProperty("--meta", `rgba(255, 255, 255, ${clamp01(metaOpacity)})`);
  root.style.setProperty("--shadow", `0 3px 14px rgba(0, 0, 0, ${clamp01(shadowOpacity)})`);
  root.style.setProperty("--current-shadow", `0 2px 8px rgba(0, 0, 0, ${clamp01(shadowOpacity)})`);
  meta.classList.toggle("hide", !showMeta);

  if (layoutSettingsKey !== lastLayoutSettingsKey) {
    currentLine.style.removeProperty("--current-font-size");
    scheduleCurrentFit();
    lastLayoutSettingsKey = layoutSettingsKey;
  }
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

function cssColor(value, fallback) {
  const text = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
}

function rgbaColor(value, opacity, fallback) {
  const color = cssColor(value, "");
  if (!color) return fallback;
  const red = parseInt(color.slice(1, 3), 16);
  const green = parseInt(color.slice(3, 5), 16);
  const blue = parseInt(color.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${clamp01(opacity)})`;
}

function playbackIsPlaying(media) {
  return String(media?.playbackStatus || "").toLowerCase() === "playing";
}

function mediaTrackKey(media) {
  return [
    media?.songId || "",
    media?.title || "",
    media?.artist || "",
    media?.durationMs || 0
  ].join("|");
}

function resetSmoothClock(media, now, realPositionMs, trackKey) {
  smoothClock = {
    valid: true,
    trackKey,
    source: media?.progressSource || "",
    basePositionMs: realPositionMs,
    baseAt: now,
    correctionDeltaMs: 0,
    correctionDurationMs: 1,
    correctionStartedAt: now,
    lastRealPositionMs: realPositionMs,
    lastRealCapturedAt: Number(media?.capturedAt || now),
    lastPlaybackStatus: media?.playbackStatus || ""
  };
}

function smoothPositionAt(now, media) {
  if (!smoothClock.valid) return Number(media?.positionMs || 0);
  if (!config.smooth || !playbackIsPlaying(media)) return Number(media?.positionMs || 0);
  if (now - receivedAt > 2200) return Number(media?.positionMs || 0);

  const elapsed = Math.max(0, now - smoothClock.baseAt);
  const duration = Number(media?.durationMs || 0);
  const correctionElapsed = Math.max(0, now - smoothClock.correctionStartedAt);
  const correctionProgress = Math.min(1, correctionElapsed / Math.max(1, smoothClock.correctionDurationMs || 1));
  const easedProgress = correctionProgress * correctionProgress * (3 - 2 * correctionProgress);
  const projected = smoothClock.basePositionMs + elapsed + smoothClock.correctionDeltaMs * easedProgress;
  return duration > 0 ? Math.min(projected, duration) : projected;
}

function updateSmoothClock(media, now) {
  if (!media || !media.positionReliable) {
    smoothClock.valid = false;
    return;
  }

  const realPositionMs = Number(media.positionMs || 0);
  const trackKey = mediaTrackKey(media);
  const source = media.progressSource || "";
  const playbackStatus = media.playbackStatus || "";
  const capturedAt = Number(media.capturedAt || now);
  const isPlaying = playbackIsPlaying(media);
  const visualPositionMs = smoothPositionAt(now, media);

  if (!config.smooth || !isPlaying) {
    resetSmoothClock(media, now, realPositionMs, trackKey);
    return;
  }

  const isNewTrack = !smoothClock.valid || smoothClock.trackKey !== trackKey || smoothClock.source !== source;
  const playbackChanged = smoothClock.lastPlaybackStatus !== playbackStatus;
  const previousRealPositionMs = smoothClock.lastRealPositionMs;
  const previousCapturedAt = smoothClock.lastRealCapturedAt || 0;
  const realDeltaMs = previousRealPositionMs === null ? 0 : realPositionMs - previousRealPositionMs;
  const capturedDeltaMs = previousCapturedAt ? capturedAt - previousCapturedAt : 0;
  const realAnchorChanged = previousRealPositionMs === null || Math.abs(realDeltaMs) > 250;
  const driftMs = realPositionMs - visualPositionMs;

  if (isNewTrack || playbackChanged) {
    resetSmoothClock(media, now, realPositionMs, trackKey);
    return;
  }

  if (!realAnchorChanged) {
    smoothClock.lastPlaybackStatus = playbackStatus;
    return;
  }

  const isBackwardSeek = realDeltaMs < -1000;
  const isForwardSeek = realDeltaMs > 6000 && driftMs > 2500;
  const anchorIsStale = capturedDeltaMs <= 0;

  if (isBackwardSeek || isForwardSeek) {
    resetSmoothClock(media, now, realPositionMs, trackKey);
    return;
  }

  if (anchorIsStale) {
    smoothClock.lastPlaybackStatus = playbackStatus;
    return;
  }

  smoothClock.basePositionMs = visualPositionMs;
  smoothClock.baseAt = now;
  smoothClock.correctionDeltaMs = Math.abs(driftMs) < 650 ? 0 : Math.max(0, driftMs - 250);
  smoothClock.correctionDurationMs = Math.max(6000, Math.min(14000, Math.abs(smoothClock.correctionDeltaMs) * 12));
  smoothClock.correctionStartedAt = now;
  smoothClock.lastRealPositionMs = realPositionMs;
  smoothClock.lastRealCapturedAt = capturedAt;
  smoothClock.lastPlaybackStatus = playbackStatus;
}

function mediaPositionMs() {
  const media = state?.media;
  if (!media) return 0;
  if (!media.positionReliable) return null;
  return smoothPositionAt(Date.now(), media);
}

function activeIndex(lines, positionMs) {
  if (!lines?.length) return -1;
  let low = 0;
  let high = lines.length - 1;
  let answer = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lines[mid].startMs <= positionMs) {
      answer = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return answer;
}

function textOf(line) {
  return line?.text || "";
}

function renderPlain(element, text) {
  element.textContent = text || "";
}

function textUnits(text) {
  return Math.max(1, Array.from(String(text || "")).reduce((total, char) => {
    return total + (/\s/.test(char) ? 0.35 : 1);
  }, 0));
}

function charTimeWeight(char, previousChar, nextChar) {
  if (/\s/.test(char)) return 0.38;
  if (/[，,、]/.test(char)) return 0.55;
  if (/[。！？!?；;]/.test(char)) return 0.78;
  if (/[:：]/.test(char)) return 0.5;
  if (/[）)\]】》〉"']/u.test(char)) return 0.42;
  if (/[（(\[【《〈"']/u.test(char)) return 0.38;
  if (/[a-z0-9]/i.test(char)) return /[a-z0-9]/i.test(previousChar || "") || /[a-z0-9]/i.test(nextChar || "") ? 0.58 : 0.82;
  return 1;
}

function naturalFallbackWords(line) {
  const chars = Array.from(String(line.text || ""));
  if (!chars.length) {
    return [{ startMs: line.startMs, endMs: line.endMs, text: "" }];
  }

  const duration = Math.max(1, Number(line.endMs || 0) - Number(line.startMs || 0));
  const startOffsetRatio = 0;
  const endHoldRatio = chars.length >= 12 ? 0.05 : 0.03;
  const usableDuration = Math.max(1, duration * (1 - startOffsetRatio - endHoldRatio));
  const weights = chars.map((char, index) => charTimeWeight(char, chars[index - 1], chars[index + 1]));
  const totalWeight = Math.max(0.01, weights.reduce((total, weight) => total + weight, 0));
  let cursor = Number(line.startMs || 0) + duration * startOffsetRatio;

  return chars.map((char, index) => {
    const next = index === chars.length - 1
      ? Number(line.endMs || cursor + 1) - duration * endHoldRatio
      : cursor + usableDuration * (weights[index] / totalWeight);
    const word = {
      startMs: Math.round(cursor),
      endMs: Math.round(Math.max(cursor + 20, next)),
      text: char
    };
    cursor = next;
    return word;
  });
}

function fallbackWords(line, rhythmMode) {
  if (rhythmMode === "even" && Array.isArray(line.words) && line.words.length) {
    return line.words;
  }
  return naturalFallbackWords(line);
}

function sweepSegments(line, mode, rhythmMode) {
  const words = mode === "word" && Array.isArray(line.words) && line.words.length
    ? line.words
    : fallbackWords(line, rhythmMode);
  let cursor = 0;
  const segments = [];

  for (const word of words) {
    const units = textUnits(word.text);
    const startMs = Number(word.startMs ?? line.startMs);
    const endMs = Math.max(startMs + 1, Number(word.endMs ?? line.endMs));
    segments.push({
      startMs,
      endMs,
      fromUnits: cursor,
      toUnits: cursor + units
    });
    cursor += units;
  }

  return {
    lineStartMs: Number(line.startMs || segments[0]?.startMs || 0),
    lineEndMs: Number(line.endMs || segments[segments.length - 1]?.endMs || 0),
    totalUnits: Math.max(1, cursor),
    segments
  };
}

function renderCurrent(line, mode) {
  currentLine.replaceChildren();
  currentSweep = null;
  if (!line) {
    currentLine.style.removeProperty("--current-font-size");
    currentLine.textContent = state?.lyric?.message || "Waiting for NetEase Cloud Music";
    return;
  }

  const text = line.text || "";
  const sweep = document.createElement("span");
  const pending = document.createElement("span");
  const doneMask = document.createElement("span");
  const done = document.createElement("span");

  sweep.className = "sweep";
  pending.className = "sweep-text sweep-pending";
  doneMask.className = "sweep-done-mask";
  done.className = "sweep-text sweep-done";
  pending.textContent = text;
  done.textContent = text;
  doneMask.setAttribute("aria-hidden", "true");
  doneMask.append(done);

  sweep.append(pending, doneMask);
  currentLine.appendChild(sweep);

  currentSweep = {
    element: sweep,
    pending,
    doneMask,
    done,
    ...sweepSegments(line, mode, config.rhythm || state?.settings?.rhythmMode || "natural")
  };
  fitCurrentLine();
}

function scheduleCurrentFit() {
  if (pendingFitFrame) return;
  pendingFitFrame = requestAnimationFrame(() => {
    pendingFitFrame = 0;
    fitCurrentLine();
  });
}

function fitCurrentLine() {
  if (!currentSweep?.element) return;

  currentLine.style.setProperty("--current-font-size", `${activeBaseFontSize}px`);

  const availableWidth = Math.max(1, currentLine.clientWidth);
  const naturalWidth = Math.max(currentSweep.element.scrollWidth, currentSweep.element.getBoundingClientRect().width);
  if (naturalWidth > availableWidth) {
    const fittedSize = Math.max(20, Math.floor(activeBaseFontSize * (availableWidth / naturalWidth)));
    currentLine.style.setProperty("--current-font-size", `${fittedSize}px`);
  }
}

function updateCurrentProgress(positionMs) {
  if (!currentSweep) return;

  let filledUnits = positionMs >= currentSweep.lineEndMs ? currentSweep.totalUnits : 0;
  if (positionMs > currentSweep.lineStartMs && positionMs < currentSweep.lineEndMs) {
    for (const segment of currentSweep.segments) {
      if (positionMs >= segment.endMs) {
        filledUnits = segment.toUnits;
        continue;
      }

      if (positionMs <= segment.startMs) {
        filledUnits = segment.fromUnits;
      } else {
        const segmentProgress = (positionMs - segment.startMs) / Math.max(1, segment.endMs - segment.startMs);
        filledUnits = segment.fromUnits + (segment.toUnits - segment.fromUnits) * segmentProgress;
      }
      break;
    }
  }

  const progress = Math.max(0, Math.min(1, filledUnits / currentSweep.totalUnits));
  const sweepWidth = currentSweep.element.getBoundingClientRect().width;
  currentSweep.element.style.setProperty("--line-progress", `${(progress * 100).toFixed(3)}%`);
  currentSweep.element.style.setProperty("--line-progress-px", `${(sweepWidth * progress).toFixed(3)}px`);
}

function renderNoReliableProgress(media, lyric) {
  song.textContent = media.title || lyric.songName || "Waiting";
  artist.textContent = media.artist || lyric.artistName || "NetEase Cloud Music";
  previousLine.textContent = "";
  currentLine.textContent = media.title
    ? "Song detected, but no real playback progress is available"
    : "Waiting for NetEase Cloud Music";
  nextLine.textContent = "";
  currentSweep = null;
  statusEl.textContent = state.error || "Install and enable the BetterNCM bridge plugin for real progress";
}

function renderFrame() {
  if (!state) {
    requestAnimationFrame(renderFrame);
    return;
  }

  const media = state.media || {};
  const lyric = state.lyric || {};
  const lines = lyric.lines || [];
  const position = mediaPositionMs();

  if (position === null) {
    renderNoReliableProgress(media, lyric);
    requestAnimationFrame(renderFrame);
    return;
  }

  const index = activeIndex(lines, position);
  const active = index >= 0 ? lines[index] : null;
  const rhythmMode = config.rhythm || state?.settings?.rhythmMode || "natural";
  const lineKey = `${lyric.songId || ""}:${lyric.mode || ""}:${rhythmMode}:${index}:${active?.startMs || ""}:${active?.text || ""}`;
  const second = Math.floor(position / 1000);

  if (lineKey !== lastRenderedLineKey) {
    renderCurrent(active, lyric.mode);
    renderPlain(previousLine, textOf(lines[index - 1]));
    renderPlain(nextLine, textOf(lines[index + 1]));
    lastRenderedLineKey = lineKey;
  }

  updateCurrentProgress(position);

  if (second !== lastRenderedSecond) {
    song.textContent = media.title || lyric.songName || "Waiting";
    artist.textContent = media.artist || lyric.artistName || "NetEase Cloud Music";
    statusEl.textContent = state.error || lyric.message || "";
    lastRenderedSecond = second;
  }

  requestAnimationFrame(renderFrame);
}

function startRenderLoop() {
  if (frameLoopStarted) return;
  frameLoopStarted = true;
  requestAnimationFrame(renderFrame);
}

connect();
startRenderLoop();

window.addEventListener("resize", scheduleCurrentFit);
