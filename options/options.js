const WEIGHT_KEYS = ["restricted", "whitelist", "group", "level", "cost"];
const WEIGHT_DEFAULTS = {
  restricted: { trigger: true, value: 100 },
  whitelist: { trigger: true, value: 50 },
  group: { trigger: true, value: 50 },
  level: { trigger: true, value: 20 },
  cost: { trigger: true, value: 1 }
};

function load() {
  chrome.storage.sync.get(
    [...WEIGHT_KEYS, "autoScore", "autoStart", "minScore", "minLevel", "requiredTypes", "pointFloor", "goLinkTarget", "activeHours", "aggressiveMode"],
    function (cfg) {
      WEIGHT_KEYS.forEach((k) => {
        const w = cfg[k] || WEIGHT_DEFAULTS[k];
        document.getElementById(`w-${k}-on`).checked = !!w.trigger;
        document.getElementById(`w-${k}-val`).value = w.value;
      });
      document.getElementById("minScore").value = cfg.minScore || 0;
      document.getElementById("minLevel").value = cfg.minLevel || 0;
      const rt = cfg.requiredTypes || { restricted: false, whitelist: false, group: false, mode: "any" };
      document.getElementById("rt-restricted").checked = !!rt.restricted;
      document.getElementById("rt-whitelist").checked = !!rt.whitelist;
      document.getElementById("rt-group").checked = !!rt.group;
      document.getElementById("rt-mode").value = rt.mode || "any";
      document.getElementById("pointFloor").value = cfg.pointFloor || 0;
      document.getElementById("goLinkTarget").value = cfg.goLinkTarget || "wishlist";
      document.getElementById("opt-autoScore").checked = !!(cfg.autoScore && cfg.autoScore.trigger);
      document.getElementById("opt-autoStart").checked = !!(cfg.autoStart && cfg.autoStart.trigger);
      const ah = cfg.activeHours || { start: 600, end: 120 };
      document.getElementById("activeStart").value = minToHHMM(ah.start);
      document.getElementById("activeEnd").value = minToHHMM(ah.end);
      document.getElementById("opt-aggressive").checked = !!(cfg.aggressiveMode && cfg.aggressiveMode.trigger);
    }
  );
}

function minToHHMM(min) {
  const h = String(Math.floor(((min % 1440) + 1440) % 1440 / 60)).padStart(2, "0");
  const m = String(((min % 60) + 60) % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function hhmmToMin(v) {
  const [h, m] = (v || "0:0").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function saveActiveHours() {
  chrome.storage.sync.set({
    activeHours: {
      start: hhmmToMin(document.getElementById("activeStart").value),
      end: hhmmToMin(document.getElementById("activeEnd").value)
    }
  });
}

function saveWeight(key) {
  chrome.storage.sync.set({
    [key]: {
      trigger: document.getElementById(`w-${key}-on`).checked,
      value: document.getElementById(`w-${key}-val`).value
    }
  });
}

function saveRequiredTypes() {
  chrome.storage.sync.set({
    requiredTypes: {
      restricted: document.getElementById("rt-restricted").checked,
      whitelist: document.getElementById("rt-whitelist").checked,
      group: document.getElementById("rt-group").checked,
      mode: document.getElementById("rt-mode").value
    }
  });
}

WEIGHT_KEYS.forEach((k) => {
  document.getElementById(`w-${k}-on`).addEventListener("change", () => saveWeight(k));
  document.getElementById(`w-${k}-val`).addEventListener("change", () => saveWeight(k));
});

["rt-restricted", "rt-whitelist", "rt-group", "rt-mode"].forEach((id) => {
  document.getElementById(id).addEventListener("change", saveRequiredTypes);
});

document.getElementById("minScore").addEventListener("change", (e) =>
  chrome.storage.sync.set({ minScore: Number(e.target.value) || 0 }));
document.getElementById("minLevel").addEventListener("change", (e) =>
  chrome.storage.sync.set({ minLevel: Number(e.target.value) || 0 }));
document.getElementById("pointFloor").addEventListener("change", (e) =>
  chrome.storage.sync.set({ pointFloor: Number(e.target.value) || 0 }));
document.getElementById("goLinkTarget").addEventListener("change", (e) =>
  chrome.storage.sync.set({ goLinkTarget: e.target.value }));
document.getElementById("opt-autoScore").addEventListener("change", (e) =>
  chrome.storage.sync.set({ autoScore: { trigger: e.target.checked } }));
document.getElementById("opt-autoStart").addEventListener("change", (e) =>
  chrome.storage.sync.set({ autoStart: { trigger: e.target.checked } }));
document.getElementById("activeStart").addEventListener("change", saveActiveHours);
document.getElementById("activeEnd").addEventListener("change", saveActiveHours);
document.getElementById("opt-aggressive").addEventListener("change", (e) =>
  chrome.storage.sync.set({ aggressiveMode: { trigger: e.target.checked } }));

document.getElementById("resetTotal").addEventListener("click", () => {
  chrome.storage.sync.set({ totalEnterGiveaway: 0 });
});

document.getElementById("resetDefault").addEventListener("click", () => {
  fetch(chrome.runtime.getURL("defaultSchema.json"))
    .then((res) => res.json())
    .then((data) => { chrome.storage.sync.set(data, () => location.reload()); })
    .catch((err) => console.error("restore defaults failed", err));
});

load();
