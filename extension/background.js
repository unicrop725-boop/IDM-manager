// FlowGet Browser Integration - Service Worker (Manifest V3)

importScripts("shared.js");

const DEFAULT_SETTINGS = FLOWGET_DEFAULTS;

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
const FORMATS_URL = "http://127.0.0.1:21588/api/formats";
const PING_URL = "http://127.0.0.1:21588/api/ping";
const SHOW_URL = "http://127.0.0.1:21588/api/show";

// Track Alt-key status per tab
const altKeyHeldPerTab = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "ALT_KEY_STATE" && sender.tab?.id) {
    altKeyHeldPerTab.set(sender.tab.id, message.isHeld);
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "GET_FORMATS") {
    // Ask the app which qualities this video offers (it resolves the page with yt-dlp).
    const lookup = () =>
      fetch(FORMATS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: message.url }),
      }).then((r) => r.json());
    lookup()
      .catch(async () => {
        // The app is closed: open it (if the user allows that), then ask again.
        if (await ensureAppRunning()) return lookup();
        throw new Error("offline");
      })
      .then((data) => sendResponse(data))
      .catch(() => sendResponse({ ok: false, error: "FlowGet is not running. Open the app and try again.", offline: true }));
    return true;
  }

  if (message.type === "GET_STREAMS") {
    const tabId = sender.tab?.id ?? message.tabId;
    streamUpdates
      .then(() => chrome.storage.session.get(`streams:${tabId}`))
      .then((r) => sendResponse({ streams: r[`streams:${tabId}`] || [] }))
      .catch(() => sendResponse({ streams: [] }));
    return true;
  }

  if (message.type === "GET_HEALTH") {
    // Cached result of the periodic health check, plus how many grabbed downloads are waiting for the app.
    Promise.all([readHealth(), getPending()])
      .then(([health, pending]) => sendResponse({ health, pending: pending.length }))
      .catch(() => sendResponse({ health: { online: null }, pending: 0 }));
    return true;
  }

  if (message.type === "FLUSH_PENDING") {
    flushPending()
      .then((sent) => sendResponse({ sent }))
      .catch(() => sendResponse({ sent: 0 }));
    return true;
  }

  if (message.type === "OPEN_APP") {
    // From the popup's "Open FlowGet" button: start the app, or bring it to the front when it is already running.
    (async () => {
      if (await isAppUp()) {
        await fetch(SHOW_URL).catch(() => {});
        sendResponse({ ok: true, started: false });
      } else {
        sendResponse({ ok: await ensureAppRunning({ force: true }), started: true });
      }
    })();
    return true;
  }

  if (message.type === "DOWNLOAD_MEDIA") {
    handleDirectDownload({
      url: message.url,
      fileName: message.fileName,
      quality: message.quality,
      referer: sender.tab?.url || message.referer || "",
      tabId: sender.tab?.id,
    }).then((r) => sendResponse({ ok: Boolean(r), queued: r === "queued" }));
    return true;
  }

  if (message.type === "DOWNLOAD_BATCH") {
    const items = Array.isArray(message.items) ? message.items : [];
    Promise.all(
      items.map((item) =>
        handleDirectDownload({
          url: item.url,
          fileName: item.fileName,
          referer: sender.tab?.url || message.referer || "",
          tabId: sender.tab?.id,
        }),
      ),
    ).then((results) => sendResponse({ ok: results.length > 0 && results.every(Boolean) }));
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
// Installing or reloading the extension does not add its script to tabs that are already open (they would need a
// refresh). Add it right away, so the new buttons appear without reloading every page.
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
    for (const tab of tabs) {
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["shared.js", "content.js"] }).catch(() => {});
    }
  } catch {
    /* tabs the extension may not touch (store pages, PDF viewer) are skipped */
  }
});

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

// URLs handed back to the browser because FlowGet could not be reached; they must not be captured a second time.
const handedBack = new Set();

// Intercept browser downloads
chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  (async () => {
    try {
      // Visible in chrome://extensions > FlowGet > "service worker" > Console: proves the extension saw this download.
      console.log("[FlowGet] browser download seen:", (downloadItem.url || "").slice(0, 160), "| name:", downloadItem.filename, "| type:", downloadItem.mime, "| size:", downloadItem.fileSize);
      if (handedBack.delete(downloadItem.url)) return;

      const settings = await getSettings();
      if (!settings.enabled) return;

      // Only normal web addresses can be fetched by FlowGet; blob:, data: and file: downloads stay with the browser.
      if (!/^(https?|ftp):/i.test(downloadItem.url || "")) {
        console.log("[FlowGet] left to the browser: not a normal web address (blob:/data:/file:)");
        return;
      }

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

      const shouldIntercept =
        settings.captureAll !== false || settings.fileTypes.includes(ext) || downloadItem.mime?.includes("octet-stream");
      if (!shouldIntercept) {
        return;
      }

      console.log("[FlowGet] taking over this download");
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

      const result = await sendToFlowGet(payload);
      const delivered = Boolean(result && !result.rejected);
      showResult(delivered);
      if (delivered) {
        notifyStarted(payload);
      } else {
        // FlowGet could not be reached, started or refused it: give the download back to the browser so nothing is lost.
        handedBack.add(downloadItem.url);
        chrome.downloads.download({ url: downloadItem.url }).catch(() => handedBack.delete(downloadItem.url));
        notifyProblem(
          result && result.rejected ? "FlowGet could not take this download" : "FlowGet is not running",
          "The browser is downloading " + nameFromPayload(payload) + " itself. Open FlowGet to use it next time.",
        );
      }
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
    // Afterwards show the number of waiting downloads again, or nothing.
    setTimeout(() => getPending().then((p) => updateWaitingBadge(p.length)).catch(() => updateWaitingBadge(0)), 3500);
  } catch {
    /* badge is only a courtesy */
  }
}

/** A link to a file (it ends in an extension), as opposed to a web page that needs yt-dlp to find the video. */
function isDirectFileUrl(url) {
  try {
    const u = new URL(url);
    return /^(https?|ftp):$/.test(u.protocol) && /\.[a-z0-9]{2,5}$/i.test(u.pathname);
  } catch {
    return false;
  }
}

/** Lets the browser download `url` itself (FlowGet's capture is skipped once for it). False when it cannot. */
function handBackToBrowser(url) {
  if (!/^(https?|ftp):/i.test(url || "")) return false;
  handedBack.add(url);
  chrome.downloads.download({ url }).catch(() => handedBack.delete(url));
  return true;
}

async function handleDirectDownload({ url, fileName, referer, tabId, quality }) {
  const cookies = await getCookiesForUrl(url);
  const payload = {
    action: "add_download",
    url: url,
    fileName: fileName || undefined,
    cookies: cookies,
    referer: referer || "",
    userAgent: navigator.userAgent,
  };
  // Video quality chosen in the page menu (height / fps / audio only); the app starts the download itself.
  if (quality && typeof quality === "object") {
    if (Number.isInteger(quality.height)) payload.mediaHeight = quality.height;
    if (Number.isInteger(quality.fps)) payload.mediaFps = quality.fps;
    if (quality.audioOnly === true) {
      payload.mediaAudioOnly = true;
      payload.convertTo = "mp3";
    }
  }
  const result = await sendToFlowGet(payload);
  if (result && !result.rejected) {
    showResult(true);
    notifyStarted(payload);
    return true;
  }
  showResult(false);
  if (result && result.rejected) {
    // The click was already taken from the browser, so give the download back: a refused link must not be lost.
    handBackToBrowser(url);
    notifyProblem("FlowGet could not start this download", (result.error || "The app refused the link.") + " The browser is downloading it instead.");
    return false;
  }
  // The app cannot be reached (it is closed and could not be started, or is not installed). A plain file link is given
  // back to the browser so the user still gets the file; waiting for an app that may never open would swallow every
  // click. Video-page links (resolved by the app with yt-dlp) have no browser fallback, so those wait for FlowGet.
  if (!quality && isDirectFileUrl(url) && handBackToBrowser(url)) {
    notifyProblem("FlowGet is not running", `${nameFromPayload(payload)} is downloading in the browser instead. Open FlowGet to use it next time.`);
    return "browser";
  }
  const waiting = await queuePayload(payload);
  notifyProblem(
    "FlowGet is not running",
    `${nameFromPayload(payload)} is waiting. It starts as soon as FlowGet opens (${waiting} waiting). Click to open FlowGet.`,
  );
  return "queued";
}

async function getCookiesForUrl(targetUrl) {
  try {
    const cookies = await chrome.cookies.getAll({ url: targetUrl });
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  } catch {
    return "";
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Streaming playlists the page loads (what IDM lists as "416p / 640p / 960p ...") ----
// Players such as Pinterest's play a blob: video, so the page address is all the video element reveals. The player
// itself fetches an HLS (.m3u8) or DASH (.mpd) playlist, which lists every quality; note those requests per tab.
const STREAM_PATH = /\.(m3u8|mpd)$/i;

// Updates run one after another: a player asks for its master and variant playlists at almost the same moment, and two
// overlapping read-modify-write updates would lose one of them.
let streamUpdates = Promise.resolve();
function queueStreamUpdate(task) {
  streamUpdates = streamUpdates.then(task).catch(() => {});
  return streamUpdates;
}

function rememberStream(tabId, url) {
  return queueStreamUpdate(async () => {
    const key = `streams:${tabId}`;
    const current = (await chrome.storage.session.get(key))[key] || [];
    const next = [url, ...current.filter((u) => u !== url)].slice(0, 10);
    await chrome.storage.session.set({ [key]: next });
  });
}

function forgetStreams(tabId) {
  return queueStreamUpdate(() => chrome.storage.session.remove(`streams:${tabId}`));
}

// Only playlist requests wake this worker (the URL filter), not every request the page makes.
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    try {
      if (STREAM_PATH.test(new URL(details.url).pathname)) rememberStream(details.tabId, details.url);
    } catch {
      /* not a URL we can read */
    }
  },
  { urls: ["*://*/*.m3u8*", "*://*/*.mpd*"] },
);

// A new page (or a single-page-app move to another video) starts with a clean list.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url) forgetStreams(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => forgetStreams(tabId));

// ---- Reliability: health check, auto-reconnect, waiting downloads and notifications ----

const HEALTH_ALARM = "flowget-health";
const PENDING_KEY = "pending";
const PENDING_MAX = 50;
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

async function readHealth() {
  return (await chrome.storage.session.get("health")).health || { online: null };
}

/**
 * Is the app answering? Runs every 30 seconds (and whenever the worker wakes). When the app comes back after being
 * away, downloads that were waiting for it are sent. The result is kept for the popup.
 */
async function checkHealth() {
  const previous = await readHealth();
  let up = await isAppUp();
  if (!up) {
    await sleep(700); // one quick second look: a single missed answer is not an outage
    up = await isAppUp();
  }
  const now = Date.now();
  const health = { online: up, checkedAt: now, since: previous.online === up ? previous.since || now : now };
  await chrome.storage.session.set({ health });
  if (up && (await getPending()).length) await flushPending();
  return health;
}

function scheduleHealthChecks() {
  try {
    // Only create it when missing: creating it again on every wake-up would keep postponing the next check.
    chrome.alarms.get(HEALTH_ALARM, (alarm) => {
      if (!alarm) chrome.alarms.create(HEALTH_ALARM, { delayInMinutes: 0.1, periodInMinutes: 0.5 });
    });
  } catch (e) {
    console.warn("[FlowGet] Could not schedule the health check", e);
  }
}
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEALTH_ALARM) checkHealth().catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  scheduleHealthChecks();
  checkHealth().catch(() => {});
});
chrome.runtime.onInstalled.addListener(() => {
  scheduleHealthChecks();
  checkHealth().catch(() => {});
});
scheduleHealthChecks();

// Downloads grabbed while the app could not be reached. They stay in memory only (session storage), never on disk,
// because they carry the page's cookies; they expire after a day.
let pendingChain = Promise.resolve();
function updatePending(change) {
  const run = pendingChain.then(async () => {
    const stored = (await chrome.storage.session.get(PENDING_KEY))[PENDING_KEY] || [];
    const fresh = stored.filter((item) => Date.now() - item.at < PENDING_TTL_MS);
    const next = await change(fresh);
    await chrome.storage.session.set({ [PENDING_KEY]: next });
    return next;
  });
  pendingChain = run.catch(() => {});
  return run;
}

async function getPending() {
  const stored = (await chrome.storage.session.get(PENDING_KEY))[PENDING_KEY] || [];
  return stored.filter((item) => Date.now() - item.at < PENDING_TTL_MS);
}

/** Remember a download for later; returns how many are waiting now. */
async function queuePayload(payload) {
  const next = await updatePending((cur) => [...cur, { at: Date.now(), payload }].slice(-PENDING_MAX));
  updateWaitingBadge(next.length);
  return next.length;
}

/** Send the waiting downloads. Returns how many the app accepted; the rest stay for the next try. */
async function flushPending() {
  let sent = 0;
  const left = await updatePending(async (cur) => {
    const keep = [];
    for (const item of cur) {
      const result = await postToApp(item.payload, 1);
      if (result && !result.rejected) sent++;
      else if (!result) keep.push(item); // still unreachable: try again later (a refused one is dropped)
    }
    return keep;
  });
  updateWaitingBadge(left.length);
  if (sent) {
    notify(
      "flowget-sent",
      "Downloads sent to FlowGet",
      sent === 1 ? "The waiting download has started." : `${sent} waiting downloads have started.`,
    );
  }
  return sent;
}

function updateWaitingBadge(count) {
  try {
    if (count > 0) {
      chrome.action.setBadgeBackgroundColor({ color: "#d97706" });
      chrome.action.setBadgeText({ text: String(count) });
      chrome.action.setTitle({ title: `${count} download${count === 1 ? "" : "s"} waiting for FlowGet - open the app` });
    } else {
      chrome.action.setBadgeText({ text: "" });
      chrome.action.setTitle({ title: "FlowGet Download Integration" });
    }
  } catch {
    /* the badge is only a courtesy */
  }
}

function nameFromPayload(payload) {
  let name = payload.fileName;
  if (!name) {
    try {
      const u = new URL(payload.url);
      name = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() || "") || u.hostname;
    } catch {
      name = "the download";
    }
  }
  if (payload.mediaAudioOnly) name += " (audio)";
  else if (payload.mediaHeight) name += ` (${payload.mediaHeight}p)`;
  return name;
}

function notify(id, title, message) {
  try {
    chrome.notifications.create(id, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title,
      message,
    });
  } catch {
    /* notifications may be blocked by the system; the toolbar badge still shows the result */
  }
}

/** "Download started" - on by default, can be switched off in the popup. */
async function notifyStarted(payload) {
  if (!(await getSettings()).notifyOnStart) return;
  notify("", "Download started in FlowGet", nameFromPayload(payload));
}

/** Problems always show: they need the user to do something. */
function notifyProblem(title, message) {
  notify("flowget-problem", title, message);
}

// Clicking a notification brings FlowGet forward, or starts it.
chrome.notifications.onClicked.addListener(async (id) => {
  chrome.notifications.clear(id);
  if (await isAppUp()) fetch(SHOW_URL).catch(() => {});
  else ensureAppRunning({ force: true });
});

async function isAppUp() {
  try {
    const r = await fetch(PING_URL, { cache: "no-store", signal: AbortSignal.timeout(1200) });
    return r.ok;
  } catch {
    return false;
  }
}

/** Ask the browser to open flowget:// (the app registers that link with Windows each time it starts). */
async function openFlowGetLink() {
  try {
    const tab = await chrome.tabs.create({ url: "flowget://start", active: true });
    // The tab only exists to hand the link to Windows; close it again.
    setTimeout(() => chrome.tabs.remove(tab.id).catch(() => {}), 2500);
  } catch (e) {
    console.warn("[FlowGet] Could not open flowget://", e);
  }
}

let launching = null;

/** True once the app answers. Starts it when it is closed, if the user has "open FlowGet automatically" on. */
async function ensureAppRunning({ force = false } = {}) {
  if (await isAppUp()) return true;
  if (!force && !(await getSettings()).autoLaunch) return false;
  if (!launching) {
    launching = (async () => {
      await openFlowGetLink();
      for (let i = 0; i < 40; i++) {
        await sleep(500);
        if (await isAppUp()) return true;
      }
      return false;
    })().finally(() => {
      launching = null;
    });
  }
  return launching;
}

/**
 * Send a download to the app. Returns the app's answer, `{ ok: false, rejected: true }` when the app was reached but
 * refused the request (retrying cannot help), or `null` when it could not be reached. Short outages (the app is just
 * restarting) are retried a few times with growing pauses.
 */
async function postToApp(payload, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const resp = await fetch(LOCAL_IPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000),
      });
      if (resp.ok) return await resp.json();
      if (resp.status >= 400 && resp.status < 500) {
        let error = "";
        try {
          error = (await resp.json()).error || "";
        } catch {
          /* no body */
        }
        return { ok: false, rejected: true, error };
      }
    } catch {
      /* not reachable */
    }
    if (i < attempts - 1) await sleep(400 * 2 ** i);
  }
  return null;
}

async function sendToFlowGet(payload) {
  const result = await deliverToFlowGet(payload);
  if (result && !result.rejected) {
    // The app is reachable: anything that was waiting for it can go now.
    getPending()
      .then((p) => (p.length ? flushPending() : 0))
      .catch(() => {});
  }
  return result;
}

async function deliverToFlowGet(payload) {
  // 1. Local loopback IPC: fastest, used whenever the app is already running.
  let result = await postToApp(payload);
  if (result) return result;

  // 2. Native messaging host, if the user registered it (it also starts the app by itself).
  try {
    result = await new Promise((resolve, reject) => {
      chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, payload, (response) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(response);
      });
    });
    if (result) return result;
  } catch {
    /* host not installed */
  }

  // 3. Open the app through its flowget:// link, wait for it, and deliver the download.
  if (await ensureAppRunning()) return postToApp(payload);
  console.warn("[FlowGet] Could not reach the FlowGet app.");
}

async function getSettings() {
  const data = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...data };
}
