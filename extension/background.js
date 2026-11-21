// FlowGet Browser Integration - Service Worker (Manifest V3)

const DEFAULT_SETTINGS = {
  enabled: true,
  minSizeBytes: 0,
  fileTypes: ["zip", "rar", "7z", "iso", "exe", "msi", "mp4", "mkv", "mp3", "pdf", "apk", "tar", "gz", "bz2", "bin"],
};

// Pages where the page itself is the thing to download (the app resolves it with yt-dlp).
const VIDEO_PAGE_PATTERNS = [
  "*://*.youtube.com/watch*",
  "*://*.youtube.com/shorts/*",
  "*://youtu.be/*",
  "*://*.vimeo.com/*",
  "*://*.dailymotion.com/video/*",
  "*://*.facebook.com/*/videos/*",
  "*://*.facebook.com/watch*",
  "*://*.instagram.com/reel/*",
  "*://*.instagram.com/p/*",
  "*://*.tiktok.com/*/video/*",
  "*://*.twitter.com/*/status/*",
  "*://x.com/*/status/*",
];

const NATIVE_HOST_NAME = "com.flowget.app";
const LOCAL_IPC_URL = "http://127.0.0.1:21588/api/download";

// Track Alt-key status per tab
const altKeyHeldPerTab = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "ALT_KEY_STATE" && sender.tab?.id) {
    altKeyHeldPerTab.set(sender.tab.id, message.isHeld);
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "DOWNLOAD_MEDIA") {
    handleDirectDownload({
      url: message.url,
      fileName: message.fileName,
      referer: sender.tab?.url || "",
      tabId: sender.tab?.id,
    });
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "DOWNLOAD_BATCH") {
    if (Array.isArray(message.items)) {
      for (const item of message.items) {
        handleDirectDownload({
          url: item.url,
          fileName: item.fileName,
          referer: sender.tab?.url || "",
          tabId: sender.tab?.id,
        });
      }
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "GRAB_CURRENT_TAB_URL") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab || !activeTab.url) {
        sendResponse({ error: "No active tab" });
        return;
      }
      const cookies = await getCookiesForUrl(activeTab.url);
      sendResponse({ url: activeTab.url, cookies, title: activeTab.title });
    });
    return true;
  }
});

// Setup context menus
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "flowget_download_link",
    title: "Download with FlowGet",
    contexts: ["link", "image", "video", "audio"],
  });

  // On video pages (YouTube, Vimeo, ...) right-clicking the page offers the video itself.
  chrome.contextMenus.create({
    id: "flowget_download_page_video",
    title: "Download this video with FlowGet",
    contexts: ["page"],
    documentUrlPatterns: VIDEO_PAGE_PATTERNS,
  });

  chrome.contextMenus.create({
    id: "flowget_download_all",
    title: "Download all links on this page",
    contexts: ["page"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "flowget_download_link") {
    const targetUrl = info.linkUrl || info.srcUrl || info.pageUrl;
    if (targetUrl) {
      await handleDirectDownload({
        url: targetUrl,
        referer: tab?.url || info.pageUrl || "",
        tabId: tab?.id,
      });
    }
  } else if (info.menuItemId === "flowget_download_page_video") {
    const pageUrl = info.pageUrl || tab?.url;
    if (pageUrl) {
      await handleDirectDownload({ url: pageUrl, referer: pageUrl, tabId: tab?.id });
    }
  } else if (info.menuItemId === "flowget_download_all" && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "TRIGGER_BATCH_SCRAPER" }).catch(() => {});
  }
});

// Intercept browser downloads
chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  (async () => {
    try {
      const settings = await getSettings();
      if (!settings.enabled) return;

      // 1. Skip if user held Alt key while clicking
      const isAltHeld = downloadItem.tabId ? altKeyHeldPerTab.get(downloadItem.tabId) : false;
      if (isAltHeld) {
        return;
      }

      // 2. Check minimum size requirement (if known)
      if (downloadItem.fileSize > 0 && downloadItem.fileSize < settings.minSizeBytes) {
        return;
      }

      // 3. Check enabled file types
      const fileName = downloadItem.filename || "";
      const extMatch = fileName.match(/\.([a-zA-Z0-9]+)$/);
      const ext = extMatch ? extMatch[1].toLowerCase() : "";

      const shouldIntercept = settings.fileTypes.includes(ext) || downloadItem.mime?.includes("octet-stream");
      if (!shouldIntercept) {
        return;
      }

      // Cancel the browser's download
      chrome.downloads.cancel(downloadItem.id).catch(() => {});

      // Extract cookies and referer
      const cookies = await getCookiesForUrl(downloadItem.url);

      const payload = {
        action: "add_download",
        url: downloadItem.url,
        fileName: fileName || undefined,
        saveDir: undefined,
        cookies: cookies,
        referer: downloadItem.referrer || "",
        userAgent: navigator.userAgent,
        mime: downloadItem.mime || undefined,
        totalSize: downloadItem.fileSize > 0 ? downloadItem.fileSize : undefined,
      };

      await sendToFlowGet(payload);
    } catch (err) {
      console.warn("[FlowGet] Interception error:", err);
    }
  })();

  // Let browser process normally if not cancelled
  return false;
});

/** Small confirmation on the toolbar icon: green tick when FlowGet took the link, red "!" when it did not. */
function showResult(ok) {
  try {
    chrome.action.setBadgeBackgroundColor({ color: ok ? "#16a34a" : "#dc2626" });
    chrome.action.setBadgeText({ text: ok ? "OK" : "!" });
    chrome.action.setTitle({
      title: ok ? "Sent to FlowGet" : "FlowGet is not running - open the app and try again",
    });
    setTimeout(() => {
      chrome.action.setBadgeText({ text: "" });
      chrome.action.setTitle({ title: "FlowGet Download Integration" });
    }, 3500);
  } catch {
    /* badge is only a courtesy */
  }
}

async function handleDirectDownload({ url, fileName, referer, tabId }) {
  const cookies = await getCookiesForUrl(url);
  const payload = {
    action: "add_download",
    url: url,
    fileName: fileName || undefined,
    cookies: cookies,
    referer: referer || "",
    userAgent: navigator.userAgent,
  };
  const result = await sendToFlowGet(payload);
  showResult(Boolean(result));
}

async function getCookiesForUrl(targetUrl) {
  try {
    const cookies = await chrome.cookies.getAll({ url: targetUrl });
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  } catch {
    return "";
  }
}

async function sendToFlowGet(payload) {
  // Try local loopback IPC first (fastest, sub-millisecond)
  try {
    const resp = await fetch(LOCAL_IPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (resp.ok) {
      return await resp.json();
    }
  } catch {
    // Fallback to Native Messaging Host
  }

  try {
    return await new Promise((resolve, reject) => {
      chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, payload, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
  } catch (e) {
    console.warn("[FlowGet] Could not connect to FlowGet app via IPC or Native Messaging:", e);
  }
}

async function getSettings() {
  const data = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...data };
}
