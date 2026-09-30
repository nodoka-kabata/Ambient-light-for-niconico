const KEY = "ambientSettings";
const defaults = { enabled: true, mode: "glow", blur: 34, spread: 1.18, fade: 250, brightness: 100, contrast: 100, saturation: 100, backgroundBrightness: 65, backgroundStrength: 35 };
const fields = Object.fromEntries(["enabled", "mode", "blur", "spread", "fade", "brightness", "contrast", "saturation", "backgroundBrightness", "backgroundStrength"].map(id => [id, document.getElementById(id)]));
const status = document.getElementById("status");
const fullOnly = document.querySelectorAll("[data-full-only]");
let saveTimer;

function show(settings) {
  fields.enabled.checked = settings.enabled;
  fields.mode.value = settings.mode;
  for (const element of fullOnly) element.hidden = settings.mode !== "full";
  for (const name of ["blur", "spread", "fade", "brightness", "contrast", "saturation", "backgroundBrightness", "backgroundStrength"]) {
    fields[name].value = settings[name];
    fields[name].nextElementSibling.value = name === "spread"
      ? `${Math.round(settings[name] * 100)}%`
      : name === "fade" ? `${settings[name]} ms`
      : ["brightness", "contrast", "saturation", "backgroundBrightness", "backgroundStrength"].includes(name) ? `${settings[name]}%`
      : `${settings[name]} px`;
  }
}

chrome.storage.sync.get(KEY, result => show({ ...defaults, ...(result[KEY] || {}) }));

function readSettings() {
  return {
    enabled: fields.enabled.checked,
    mode: fields.mode.value,
    blur: Number(fields.blur.value),
    spread: Number(fields.spread.value),
    fade: Number(fields.fade.value),
    brightness: Number(fields.brightness.value),
    contrast: Number(fields.contrast.value),
    saturation: Number(fields.saturation.value),
    backgroundBrightness: Number(fields.backgroundBrightness.value),
    backgroundStrength: Number(fields.backgroundStrength.value)
  };
}

function saveSettings(settings) {
  clearTimeout(saveTimer);
  show(settings);
  chrome.storage.sync.set({ [KEY]: settings }, () => {
    status.textContent = chrome.runtime.lastError ? "設定を保存できませんでした" : "保存しました";
  });
}

function save() {
  const settings = readSettings();
  show(settings);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveSettings(settings), 300);
}

for (const field of Object.values(fields)) {
  field.addEventListener("input", save);
  field.addEventListener("change", () => saveSettings(readSettings()));
}
