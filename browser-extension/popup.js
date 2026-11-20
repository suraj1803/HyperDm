const DEFAULT_CONFIG = {
  enabled: true,
  port: 41920,
  minSizeMb: 0,
};

const statusBadge = document.getElementById("statusBadge");
const statusText = document.getElementById("statusText");
const enabledToggle = document.getElementById("enabledToggle");
const portInput = document.getElementById("portInput");
const minSizeInput = document.getElementById("minSizeInput");
const quickUrl = document.getElementById("quickUrl");
const sendBtn = document.getElementById("sendBtn");
const feedback = document.getElementById("feedback");

async function refreshHealth(port) {
  const res = await chrome.runtime.sendMessage({ type: "checkHealth", port });
  if (res && res.online && res.bridgeEnabled) {
    statusBadge.className = "badge online";
    statusText.textContent = "Connected";
  } else if (res && res.online && !res.bridgeEnabled) {
    statusBadge.className = "badge offline";
    statusText.textContent = "Disabled in App";
  } else {
    statusBadge.className = "badge offline";
    statusText.textContent = "App Offline";
  }
}

async function init() {
  const cfg = await chrome.storage.local.get(DEFAULT_CONFIG);
  enabledToggle.checked = Boolean(cfg.enabled);
  portInput.value = String(cfg.port || 41920);
  minSizeInput.value = String(cfg.minSizeMb || 0);
  await refreshHealth(cfg.port || 41920);
}

enabledToggle.addEventListener("change", async () => {
  await chrome.storage.local.set({ enabled: enabledToggle.checked });
});

portInput.addEventListener("change", async () => {
  const port = Number(portInput.value) || 41920;
  await chrome.storage.local.set({ port });
  await refreshHealth(port);
});

minSizeInput.addEventListener("change", async () => {
  const minSizeMb = Math.max(0, Number(minSizeInput.value) || 0);
  await chrome.storage.local.set({ minSizeMb });
});

sendBtn.addEventListener("click", async () => {
  const url = quickUrl.value.trim();
  if (!url) return;
  feedback.className = "msg";
  feedback.textContent = "Sending to HyperDM...";
  const res = await chrome.runtime.sendMessage({ type: "sendUrl", url });
  if (res && res.ok) {
    feedback.className = "msg ok";
    feedback.textContent = `Started: ${res.task.fileName}`;
    quickUrl.value = "";
  } else {
    feedback.className = "msg err";
    feedback.textContent = res?.error || "Failed to reach HyperDM";
  }
});

void init();
