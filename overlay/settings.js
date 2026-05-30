const controls = {
  fontSearch: document.getElementById("fontSearch"),
  fontSelect: document.getElementById("fontSelect"),
  fontSize: document.getElementById("fontSize"),
  fontSizeValue: document.getElementById("fontSizeValue"),
  align: document.getElementById("align"),
  accentColor: document.getElementById("accentColor"),
  pendingColor: document.getElementById("pendingColor"),
  pendingOpacity: document.getElementById("pendingOpacity"),
  pendingOpacityValue: document.getElementById("pendingOpacityValue"),
  dimOpacity: document.getElementById("dimOpacity"),
  dimOpacityValue: document.getElementById("dimOpacityValue"),
  metaOpacity: document.getElementById("metaOpacity"),
  metaOpacityValue: document.getElementById("metaOpacityValue"),
  shadowOpacity: document.getElementById("shadowOpacity"),
  shadowOpacityValue: document.getElementById("shadowOpacityValue"),
  showMeta: document.getElementById("showMeta"),
  saveButton: document.getElementById("saveButton"),
  resetButton: document.getElementById("resetButton"),
  shutdownButton: document.getElementById("shutdownButton"),
  status: document.getElementById("status"),
  previewCard: document.getElementById("previewCard"),
  previewMeta: document.getElementById("previewMeta")
};

const defaults = {
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

let fonts = [];
let settings = { ...defaults };

function fontName(font) {
  return typeof font === "string" ? font : String(font?.name || "");
}

function fontLabel(font) {
  if (typeof font === "string") return font;
  const label = String(font?.label || font?.name || "");
  const englishName = String(font?.englishName || font?.name || "");
  return label && englishName && label !== englishName ? `${label} / ${englishName}` : label || englishName;
}

function fontSearchText(font) {
  if (typeof font === "string") return font.toLowerCase();
  return [
    font?.label,
    font?.name,
    font?.englishName,
    font?.zhName
  ].filter(Boolean).join(" ").toLowerCase();
}

function fallbackFontStack(fontFamily) {
  const fallback = "\"Microsoft YaHei UI\", \"Microsoft YaHei\", \"Segoe UI\", sans-serif";
  return fontFamily ? `"${fontFamily.replace(/["\\]/g, "")}", ${fallback}` : fallback;
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

function percent(value) {
  return `${Math.round(clamp01(value) * 100)}%`;
}

function cssColor(value, fallback) {
  const text = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
}

function rgbaColor(value, opacity) {
  const color = cssColor(value, "#ffffff");
  const red = parseInt(color.slice(1, 3), 16);
  const green = parseInt(color.slice(3, 5), 16);
  const blue = parseInt(color.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${clamp01(opacity)})`;
}

function setStatus(text) {
  controls.status.textContent = text || "";
}

function currentFormSettings() {
  return {
    fontFamily: controls.fontSelect.value,
    fontSize: Number(controls.fontSize.value),
    align: controls.align.value,
    accentColor: cssColor(controls.accentColor.value, defaults.accentColor),
    pendingColor: cssColor(controls.pendingColor.value, defaults.pendingColor),
    pendingOpacity: clamp01(controls.pendingOpacity.value),
    dimOpacity: clamp01(controls.dimOpacity.value),
    metaOpacity: clamp01(controls.metaOpacity.value),
    shadowOpacity: clamp01(controls.shadowOpacity.value),
    showMeta: controls.showMeta.checked,
    rhythmMode: settings.rhythmMode || defaults.rhythmMode
  };
}

function applyForm(nextSettings) {
  settings = { ...defaults, ...nextSettings };
  controls.fontSize.value = settings.fontSize;
  controls.align.value = settings.align;
  controls.accentColor.value = settings.accentColor;
  controls.pendingColor.value = settings.pendingColor;
  controls.pendingOpacity.value = settings.pendingOpacity;
  controls.dimOpacity.value = settings.dimOpacity;
  controls.metaOpacity.value = settings.metaOpacity;
  controls.shadowOpacity.value = settings.shadowOpacity;
  controls.showMeta.checked = settings.showMeta;
  renderFonts(settings.fontFamily);
  updatePreview();
}

function renderFonts(preferred = controls.fontSelect.value || settings.fontFamily) {
  const query = controls.fontSearch.value.trim().toLowerCase();
  const filtered = fonts.filter((font) => fontSearchText(font).includes(query));
  const filteredNames = filtered.map(fontName);

  controls.fontSelect.replaceChildren();
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "默认字体";
  controls.fontSelect.appendChild(defaultOption);

  for (const font of filtered) {
    const name = fontName(font);
    const option = document.createElement("option");
    option.value = name;
    option.textContent = fontLabel(font);
    option.style.fontFamily = fallbackFontStack(name);
    controls.fontSelect.appendChild(option);
  }

  controls.fontSelect.value = filteredNames.includes(preferred) ? preferred : "";
  updatePreview();
}

function updatePreview() {
  const value = currentFormSettings();
  controls.fontSizeValue.textContent = `${value.fontSize}px`;
  controls.pendingOpacityValue.textContent = percent(value.pendingOpacity);
  controls.dimOpacityValue.textContent = percent(value.dimOpacity);
  controls.metaOpacityValue.textContent = percent(value.metaOpacity);
  controls.shadowOpacityValue.textContent = percent(value.shadowOpacity);

  controls.previewCard.style.setProperty("--preview-font", fallbackFontStack(value.fontFamily));
  controls.previewCard.style.setProperty("--preview-size", `${value.fontSize}px`);
  controls.previewCard.style.setProperty("--preview-align", value.align);
  controls.previewCard.style.setProperty("--preview-accent", value.accentColor);
  controls.previewCard.style.setProperty("--preview-pending", rgbaColor(value.pendingColor, value.pendingOpacity));
  controls.previewCard.style.setProperty("--preview-dim", `rgba(255, 255, 255, ${value.dimOpacity})`);
  controls.previewCard.style.setProperty("--preview-meta", `rgba(255, 255, 255, ${value.metaOpacity})`);
  controls.previewCard.style.setProperty("--preview-shadow", `0 3px 14px rgba(0, 0, 0, ${value.shadowOpacity})`);
  controls.previewCard.style.setProperty("--preview-current-shadow", `0 2px 8px rgba(0, 0, 0, ${value.shadowOpacity})`);
  controls.previewMeta.classList.toggle("hide", !value.showMeta);
}

async function load() {
  setStatus("正在扫描字体");
  const [settingsResponse, fontsResponse] = await Promise.all([
    fetch("/api/settings"),
    fetch("/api/fonts")
  ]);
  const loadedSettings = await settingsResponse.json();
  const fontPayload = await fontsResponse.json();
  fonts = Array.isArray(fontPayload.fonts) ? fontPayload.fonts : [];
  applyForm(loadedSettings);
  setStatus(`已扫描 ${fonts.length} 个字体`);
}

async function save(nextSettings) {
  controls.saveButton.disabled = true;
  controls.resetButton.disabled = true;
  try {
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(nextSettings)
    });
    const saved = await response.json();
    applyForm(saved);
    setStatus("已保存，歌词预览会实时更新");
  } finally {
    controls.saveButton.disabled = false;
    controls.resetButton.disabled = false;
  }
}

async function shutdownService() {
  if (!window.confirm("确定要关闭 OBS 歌词服务吗？关闭后预览页和 OBS 浏览器源会停止更新。")) return;

  controls.shutdownButton.disabled = true;
  setStatus("正在关闭 OBS 歌词服务");
  try {
    await fetch("/api/shutdown", { method: "POST" });
    setStatus("服务已关闭。需要使用 Start OBS Lyrics.cmd 或 Setup and Start.cmd 重新启动。");
  } catch (error) {
    setStatus(`关闭失败：${error.message}`);
    controls.shutdownButton.disabled = false;
  }
}

controls.fontSearch.addEventListener("input", () => renderFonts());
for (const key of [
  "fontSelect",
  "fontSize",
  "align",
  "accentColor",
  "pendingColor",
  "pendingOpacity",
  "dimOpacity",
  "metaOpacity",
  "shadowOpacity",
  "showMeta"
]) {
  controls[key].addEventListener("input", updatePreview);
  controls[key].addEventListener("change", updatePreview);
}

controls.saveButton.addEventListener("click", () => save(currentFormSettings()));
controls.resetButton.addEventListener("click", () => save(defaults));
controls.shutdownButton.addEventListener("click", shutdownService);

load().catch((error) => {
  setStatus(error.message);
});
