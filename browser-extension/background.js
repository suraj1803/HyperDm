const DEFAULT_CONFIG = {
  enabled: true,
  port: 41920,
  minSizeMb: 0,
};

async function getConfig() {
  const stored = await chrome.storage.local.get(DEFAULT_CONFIG);
  return {
    enabled: Boolean(stored.enabled),
    port: Number(stored.port) || 41920,
    minSizeMb: Number(stored.minSizeMb) || 0,
  };
}

async function checkBridgeHealth(port) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: controller.signal,
    });
    if (!resp.ok) return { online: false, bridgeEnabled: false };
    const data = await resp.json();
    return {
      online: data.app === "HyperDM" && data.status === "ok",
      bridgeEnabled: Boolean(data.bridgeEnabled),
      version: data.version,
    };
  } catch {
    return { online: false, bridgeEnabled: false };
  } finally {
    clearTimeout(timeout);
  }
}

async function getCookieHeader(url) {
  try {
    const cookies = await chrome.cookies.getAll({ url });
    if (!cookies || cookies.length === 0) return "";
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  } catch {
    return "";
  }
}

async function sendToHyperDM({ url, fileName, referer, port }) {
  const cookies = await getCookieHeader(url);
  const resp = await fetch(`http://127.0.0.1:${port}/api/downloads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      fileName: fileName || undefined,
      referer: referer || undefined,
      userAgent: navigator.userAgent,
      cookies: cookies || undefined,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(errText || `HTTP ${resp.status}`);
  }
  return resp.json();
}

function extractBaseName(pathStr) {
  if (!pathStr) return undefined;
  const parts = pathStr.split(/[/\\]/);
  return parts[parts.length - 1] || undefined;
}

// Intercept native browser downloads when HyperDM is running
chrome.downloads.onCreated.addListener(async (item) => {
  const url = item.finalUrl || item.url;
  if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) {
    return;
  }

  const config = await getConfig();
  if (!config.enabled) return;

  // Respect minimum file size threshold if size is known
  if (
    config.minSizeMb > 0 &&
    typeof item.totalBytes === "number" &&
    item.totalBytes > 0 &&
    item.totalBytes < config.minSizeMb * 1024 * 1024
  ) {
    return;
  }

  // Only intercept if HyperDM is actually running and bridge is enabled
  const health = await checkBridgeHealth(config.port);
  if (!health.online || !health.bridgeEnabled) {
    return;
  }

  try {
    // Pause/cancel the browser download and hand off to HyperDM
    await chrome.downloads.cancel(item.id);
    await chrome.downloads.erase({ id: item.id });

    await sendToHyperDM({
      url,
      fileName: extractBaseName(item.filename),
      referer: item.referrer,
      port: config.port,
    });
  } catch (err) {
    console.error("HyperDM handoff failed:", err);
  }
});

// Context menu: "Download with HyperDM"
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "hyperdm-download",
      title: "Download with HyperDM",
      contexts: ["link", "image", "video", "audio"],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "hyperdm-download") return;
  const targetUrl = info.linkUrl || info.srcUrl;
  if (!targetUrl || (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://"))) {
    return;
  }

  const config = await getConfig();
  try {
    await sendToHyperDM({
      url: targetUrl,
      referer: tab?.url,
      port: config.port,
    });
  } catch (err) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "HyperDM Not Reachable",
      message: `Make sure HyperDM is running on port ${config.port}. (${err.message})`,
    });
  }
});

// Messages from popup UI
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "checkHealth") {
    getConfig()
      .then((cfg) => checkBridgeHealth(msg.port || cfg.port))
      .then(sendResponse);
    return true;
  }
  if (msg.type === "sendUrl") {
    getConfig()
      .then((cfg) =>
        sendToHyperDM({
          url: msg.url,
          port: cfg.port,
        })
      )
      .then((task) => sendResponse({ ok: true, task }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
