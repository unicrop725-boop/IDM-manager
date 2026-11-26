// FlowGet Content Script - Universal Media Detector, Auto-Suggest Sniffer & Alt-Key Tracker

(() => {
  // The script can be injected again (after the extension is reloaded): only one copy may run per page.
  if (window.__FLOWGET_CONTENT_V12__) return;
  window.__FLOWGET_CONTENT_V12__ = true;

  // After a reload, tabs that were already open keep the buttons of the OLD script on the page (that script can no
  // longer talk to the extension, so they do nothing). Remove those leftovers before drawing the new ones.
  document
    .querySelectorAll(".flowget-video-grabber-btn, #flowget-quality-menu, #flowget-auto-suggest-widget, #flowget-batch-modal")
    .forEach((n) => n.remove());

  // An older copy of this script that is still alive on the page (it survives an extension reload) keeps adding its
  // own buttons to videos it has not marked yet; those buttons can no longer reach the extension. Mark every video as
  // handled and remove such buttons, now and on every tick.
  function silenceOldCopies() {
    document.querySelectorAll(".flowget-video-grabber-btn").forEach((n) => n.remove());
    document.querySelectorAll("video:not([data-flowget-attached])").forEach((v) => v.setAttribute("data-flowget-attached", "1"));
  }
  silenceOldCopies();

  document.documentElement.setAttribute('data-flowget-active', 'true');
  window.__FLOWGET_EXTENSION_ACTIVE__ = true;

  // 1. Alt-Key Tracking (Holding Alt while clicking skips download capture)
  let isAltHeld = false;
  window.addEventListener("keydown", (e) => {
    if (e.key === "Alt" && !isAltHeld) {
      isAltHeld = true;
      chrome.runtime.sendMessage({ type: "ALT_KEY_STATE", isHeld: true }).catch(() => {});
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.key === "Alt" && isAltHeld) {
      isAltHeld = false;
      chrome.runtime.sendMessage({ type: "ALT_KEY_STATE", isHeld: false }).catch(() => {});
    }
  });

  window.addEventListener("blur", () => {
    if (isAltHeld) {
      isAltHeld = false;
      chrome.runtime.sendMessage({ type: "ALT_KEY_STATE", isHeld: false }).catch(() => {});
    }
  });

  // 2. Instant Download Link Click Interceptor
  const DOWNLOAD_EXTENSIONS = [
    "zip", "rar", "7z", "iso", "exe", "msi", "mp4", "mkv", "mp3", "pdf", "apk", "tar", "gz", "bz2", "bin",
    "flac", "wav", "aac", "webm", "avi", "mov", "docx", "xlsx", "dmg", "pkg"
  ];

  // What the user chose in the popup (shared.js has the defaults): whether to capture, and which file types.
  const captureSettings = { enabled: FLOWGET_DEFAULTS.enabled, captureAll: FLOWGET_DEFAULTS.captureAll, fileTypes: new Set(FLOWGET_DEFAULT_TYPES) };
  function applyCaptureSettings(values) {
    if (typeof values.enabled === "boolean") captureSettings.enabled = values.enabled;
    if (typeof values.captureAll === "boolean") captureSettings.captureAll = values.captureAll;
    if (Array.isArray(values.fileTypes)) captureSettings.fileTypes = new Set(values.fileTypes);
  }
  try {
    chrome.storage.local.get({ enabled: FLOWGET_DEFAULTS.enabled, captureAll: FLOWGET_DEFAULTS.captureAll, fileTypes: FLOWGET_DEFAULT_TYPES }).then(applyCaptureSettings);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      const next = {};
      if (changes.enabled) next.enabled = changes.enabled.newValue;
      if (changes.captureAll) next.captureAll = changes.captureAll.newValue;
      if (changes.fileTypes) next.fileTypes = changes.fileTypes.newValue;
      applyCaptureSettings(next);
    });
  } catch {
    /* extension was reloaded; the defaults stay in force */
  }

  function extensionOf(name) {
    const m = /\.([a-z0-9]{1,8})$/i.exec(name || "");
    return m ? m[1].toLowerCase() : "";
  }

  document.addEventListener("click", (e) => {
    const link = e.target.closest("a");
    if (!link || !link.href) return;

    // Capture switched off, or Alt held: let the browser download normally
    if (!captureSettings.enabled || e.altKey || isAltHeld) {
      return;
    }

    const url = link.href;
    const urlWithoutQuery = url.split("?")[0].split("#")[0].toLowerCase();
    const suggestedName = link.getAttribute("download") || urlWithoutQuery.split("/").pop() || "";
    // Only the file types the user picked are captured, whether the link says "download" or just ends in the extension.
    const ext = extensionOf(link.getAttribute("download")) || extensionOf(urlWithoutQuery);

    // A link that says "download" (like the Download buttons on Behance) is taken whatever its file type, when "capture every download" is on.
    const isDownloadLink = captureSettings.captureAll && link.hasAttribute("download") && /^https?:/i.test(url);
    if ((ext && captureSettings.fileTypes.has(ext)) || isDownloadLink) {
      e.preventDefault();
      e.stopPropagation();

      console.log("[FlowGet Content] Intercepted click on download link:", url);

      chrome.runtime.sendMessage({
        type: "DOWNLOAD_MEDIA",
        url: url,
        fileName: suggestedName,
      });
    }
  }, true);

  // Shared helpers for the widgets injected into pages.
  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  const FLOWGET_GLYPH =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/></svg>';
  const WIDGET_FONT = '"Outfit", "Segoe UI", system-ui, -apple-system, sans-serif';

  // 3. Universal Webpage Resource Scanner
  function scanPageResources() {
    const items = [];
    const seenUrls = new Set();

    function addResource(res) {
      if (!res.url || seenUrls.has(res.url)) return;
      seenUrls.add(res.url);
      items.push(res);
    }

    // Check if the page itself is a media platform (YouTube, Vimeo, Reels, TikTok, Twitter/X, SoundCloud, etc.)
    const loc = window.location.href;
    const isMediaSite = /youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|pinterest\.[a-z.]+\/pin\/|instagram\.com\/(p|reel)|tiktok\.com|twitter\.com\/.*\/status|x\.com\/.*\/status|facebook\.com.*(video|watch)|soundcloud\.com|reddit\.com/i.test(loc);
    if (isMediaSite) {
      addResource({
        title: document.title || "Video Stream",
        url: loc,
        type: "video",
        ext: "mp4/stream",
        size: "HD Stream / yt-dlp",
      });
    }

    // A visible <video> whose source is a blob: the page itself is what gets downloaded.
    if (!isMediaSite) {
      for (const vid of document.querySelectorAll("video")) {
        const r = vid.getBoundingClientRect();
        if (r.width >= 120 && r.height >= 80) {
          addResource({ title: document.title || "Video on this page", url: loc, type: "video", ext: "stream", size: "Video on this page" });
          break;
        }
      }
    }

    // Scan all <video> elements
    document.querySelectorAll("video").forEach((vid) => {
      const src = vid.currentSrc || vid.src;
      if (src && !src.startsWith("blob:")) {
        addResource({
          title: document.title || "HTML5 Video",
          url: src,
          type: "video",
          ext: src.includes(".m3u8") ? "hls" : src.includes(".mpd") ? "dash" : "mp4",
          size: "Video Stream",
        });
      }
      vid.querySelectorAll("source").forEach((s) => {
        if (s.src) {
          addResource({
            title: document.title || "HTML5 Source",
            url: s.src,
            type: "video",
            ext: "mp4",
            size: "Video Source",
          });
        }
      });
    });

    // Scan all <audio> elements
    document.querySelectorAll("audio").forEach((aud) => {
      const src = aud.currentSrc || aud.src;
      if (src && !src.startsWith("blob:")) {
        addResource({
          title: document.title || "Audio Track",
          url: src,
          type: "audio",
          ext: "mp3",
          size: "Audio Stream",
        });
      }
    });

    // Scan all downloadable <a> links
    document.querySelectorAll("a[href]").forEach((a) => {
      const href = a.href;
      if (!href || href.startsWith("javascript:") || href.startsWith("#")) return;
      const cleanHref = href.split("?")[0].toLowerCase();

      for (const ext of DOWNLOAD_EXTENSIONS) {
        if (cleanHref.endsWith(`.${ext}`)) {
          let type = "doc";
          if (["mp4", "mkv", "webm", "avi", "mov"].includes(ext)) type = "video";
          else if (["mp3", "wav", "flac", "aac"].includes(ext)) type = "audio";
          else if (["zip", "rar", "7z", "tar", "gz", "bz2", "iso", "dmg"].includes(ext)) type = "archive";

          const linkText = (a.innerText || "").trim();
          const fileName = cleanHref.split("/").pop() || `file.${ext}`;
          addResource({
            title: linkText && linkText.length < 50 ? linkText : fileName,
            url: href,
            fileName: fileName,
            type: type,
            ext: ext,
            size: `.${ext.toUpperCase()} File`,
          });
          break;
        }
      }
    });

    return items;
  }

  // Listen for popup request to scan page media
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "SCAN_PAGE_MEDIA") {
      const items = scanPageResources();
      sendResponse({ items });
      return true;
    }
  });

  // 4. Smart Auto-Suggest Floating Widget on Webpages
  let autoSuggestBar = null;
  let autoSuggestSignature = "";
  let hasUserDismissedBar = false;

  function removeAutoSuggestBar() {
    if (autoSuggestBar) autoSuggestBar.remove();
    autoSuggestBar = null;
    autoSuggestSignature = "";
  }

  async function updateAutoSuggestBar() {
    if (hasUserDismissedBar) return;

    const data = await chrome.storage.local.get({ autoSuggestBarEnabled: true });
    if (!data.autoSuggestBarEnabled) {
      removeAutoSuggestBar();
      return;
    }

    const resources = scanPageResources();
    if (resources.length === 0) {
      removeAutoSuggestBar();
      return;
    }

    // The page is rescanned every couple of seconds; only rebuild the bar when what it shows has changed.
    const signature = resources.map((r) => r.url).join("|");
    if (autoSuggestBar && autoSuggestBar.isConnected && signature === autoSuggestSignature) return;
    autoSuggestSignature = signature;

    if (!autoSuggestBar) {
      autoSuggestBar = document.createElement("div");
      autoSuggestBar.id = "flowget-auto-suggest-widget";
      autoSuggestBar.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 2147483646;
        font-family: ${WIDGET_FONT};
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 8px;
        user-select: none;
      `;
      document.body.appendChild(autoSuggestBar);
    }

    const videoCount = resources.filter((r) => r.type === "video").length;
    const otherCount = resources.length - videoCount;

    let summaryText = `${resources.length} file${resources.length > 1 ? "s" : ""}`;
    if (videoCount > 0 && otherCount > 0) {
      summaryText = `${videoCount} video${videoCount > 1 ? "s" : ""}, ${otherCount} file${otherCount > 1 ? "s" : ""}`;
    } else if (videoCount > 0) {
      summaryText = `${videoCount} video${videoCount > 1 ? "s" : ""}`;
    }

    autoSuggestBar.innerHTML = `
      <div id="flowget-pill-main" role="button" tabindex="0" style="
        background: #16161A;
        border: 1px solid #2A2A32;
        border-radius: 16px;
        padding: 8px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.45), 0 0 0 1px rgba(254,210,79,0.18);
        color: #F4F4F5;
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 12px;
        cursor: pointer;
      ">
        <div style="
          width: 30px;
          height: 30px;
          border-radius: 10px;
          background: #B2D959;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #15200A;
        ">${FLOWGET_GLYPH}</div>
        <div style="display: flex; flex-direction: column; line-height: 1.25;">
          <span style="font-weight: 600; font-size: 12px; color: #F4F4F5;">Download with FlowGet</span>
          <span style="font-size: 11px; color: #A1A1AA;">Found ${escapeHtml(summaryText)}</span>
        </div>
        <button id="flowget-bar-download-all" style="
          padding: 7px 13px;
          border-radius: 10px;
          background: #B2D959;
          border: none;
          color: #15200A;
          font-family: inherit;
          font-weight: 600;
          font-size: 12px;
          cursor: pointer;
          margin-left: 4px;
        ">Download all</button>
        <button id="flowget-bar-dismiss" aria-label="Dismiss" title="Dismiss" style="
          background: none;
          border: none;
          color: #71717A;
          cursor: pointer;
          font-size: 15px;
          line-height: 1;
          padding: 4px 6px;
          border-radius: 8px;
        ">✕</button>
      </div>
    `;

    const downloadAllBtn = autoSuggestBar.querySelector("#flowget-bar-download-all");
    const dismissBtn = autoSuggestBar.querySelector("#flowget-bar-dismiss");
    const pillMain = autoSuggestBar.querySelector("#flowget-pill-main");

    downloadAllBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      downloadAllBtn.textContent = "Sending…";
      let ok = false;
      try {
        const reply = await chrome.runtime.sendMessage({
          type: "DOWNLOAD_BATCH",
          items: resources.map((r) => ({ url: r.url, fileName: r.fileName || undefined })),
        });
        ok = Boolean(reply && reply.ok);
      } catch {
        ok = false;
      }
      downloadAllBtn.textContent = ok ? "Sent ✓" : "App not running";
      setTimeout(() => {
        if (ok) {
          hasUserDismissedBar = true;
          removeAutoSuggestBar();
        } else {
          downloadAllBtn.textContent = "Download all";
        }
      }, 1600);
    });

    dismissBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      hasUserDismissedBar = true;
      removeAutoSuggestBar();
    });

    pillMain.addEventListener("click", () => {
      openBatchModal();
    });
    pillMain.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openBatchModal();
      }
    });
  }

  // 5. Floating "Download Video" button + quality menu
  //
  // One overlay lives at the very top of the page (inside a shadow root, so site CSS cannot touch it) and follows
  // the biggest visible <video>. It is deliberately NOT placed inside the site's player markup: players such as
  // Pinterest's re-render their DOM, stack transparent layers above their children and swallow clicks.
  //
  // Clicking it opens a menu of the real qualities the video offers (looked up by the FlowGet app), with the best
  // all-round choice marked "Recommended". Picking a row sends exactly that quality to the app.
  const VIDEO_PAGE_LINK = /\/(pin|watch|video|videos|reel|reels|shorts|status|clip)\b/i;
  const FORMATS_CACHE_MS = 5 * 60 * 1000;

  const grabberCss = `
    :host { all: initial; }
    .anchor { position: fixed; left: 0; top: 0; width: 0; height: 0; pointer-events: none; will-change: transform; }
    .stack { position: absolute; right: 0; top: 0; display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
    .stack.up { top: auto; bottom: 0; flex-direction: column-reverse; }
    .stack.up .hint { top: auto; bottom: calc(100% + 10px); }
    .stack.up .hint::before { display: none; }
    .pill { position: relative; pointer-events: none; }
    .ctl { position: absolute; top: -11px; right: -7px; display: flex; gap: 5px; pointer-events: auto; transition: opacity .15s ease, transform .15s ease; }
    .pill.compact .ctl { opacity: 0; transform: scale(.85); }
    .pill.compact:hover .ctl, .pill.compact:focus-within .ctl, .pill[data-help="true"] .ctl { opacity: 1; transform: none; }
    .mini {
      width: 22px; height: 22px; padding: 0; border: 0; border-radius: 50%; cursor: pointer; display: grid; place-items: center;
      background: #16161A; color: #F4F4F5; font: 700 12px/1 ${WIDGET_FONT};
      box-shadow: 0 4px 12px rgba(0,0,0,.5), 0 0 0 2px rgba(255,255,255,.92); transition: transform .12s ease, background .12s ease;
    }
    .mini:hover { background: #000; transform: scale(1.14); }
    .mini:focus-visible { outline: 2px solid #FED24F; outline-offset: 2px; }
    .mini svg { width: 9px; height: 9px; fill: none; stroke: currentColor; stroke-width: 2.6; stroke-linecap: round; }
    .btn {
      pointer-events: auto; position: relative; overflow: hidden; display: flex; align-items: center; gap: 9px;
      padding: 7px 16px 7px 7px; border: 0; border-radius: 9999px; cursor: pointer; white-space: nowrap;
      color: #15200A; font: 600 13px/1 ${WIDGET_FONT}; letter-spacing: .2px;
      background: #B2D959;
      box-shadow: 0 8px 24px rgba(0,0,0,.5), 0 0 0 2px rgba(255,255,255,.9);
      animation: pulse 2s ease-out infinite;
      transition: transform .15s ease, filter .15s ease;
    }
    .btn.compact { padding: 7px; }
    .btn.compact[data-state="idle"] .label { display: none; }
    .btn:hover { transform: scale(1.06); filter: brightness(1.08); }
    .btn:active { transform: scale(.97); }
    .btn:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
    .btn::after {
      content: ""; position: absolute; top: 0; bottom: 0; width: 40%; left: -60%;
      background: linear-gradient(100deg, transparent, rgba(255,255,255,.45), transparent);
      transform: skewX(-20deg); animation: shine 3.2s ease-in-out infinite;
    }
    .icon { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: rgba(255,255,255,.25); }
    .icon svg { width: 15px; height: 15px; animation: bounce 1.1s ease-in-out infinite; }
    .btn[data-state="sending"], .btn[data-state="ok"], .btn[data-state="error"], .btn[data-open="true"] { animation: none; }
    .btn[data-state="sending"] .icon svg, .btn[data-state="ok"] .icon svg, .btn[data-state="error"] .icon svg, .btn[data-open="true"] .icon svg { animation: none; }
    .btn[data-state="sending"]::after, .btn[data-state="ok"]::after, .btn[data-state="error"]::after, .btn[data-open="true"]::after { display: none; }
    .btn[data-state="ok"] { background: #7EC151; }
    .btn[data-state="error"] { background: #DC2626; }

    .hint {
      position: absolute; top: calc(100% + 10px); right: 0; pointer-events: none; width: max-content; max-width: 230px; margin-right: calc(var(--hx, 0px) * -1); padding: 9px 12px; border-radius: 12px;
      background: #16161A; color: #F4F4F5; font: 500 12px/1.35 ${WIDGET_FONT};
      box-shadow: 0 8px 24px rgba(0,0,0,.45); border: 1px solid #2A2A32;
      opacity: 0; transform: translateY(-4px); transition: opacity .3s ease, transform .3s ease;
    }
    .hint[data-show="true"] { opacity: 1; transform: none; }
    .hint::before {
      content: ""; position: absolute; top: -6px; right: calc(15px + var(--hx, 0px)); width: 10px; height: 10px; background: #16161A;
      border-left: 1px solid #2A2A32; border-top: 1px solid #2A2A32; transform: rotate(45deg);
    }

    .panel {
      pointer-events: auto; width: 300px; max-width: calc(100vw - 24px); overflow: hidden; border-radius: 16px;
      background: #16161A; color: #F4F4F5; border: 1px solid #2A2A32; font: 500 13px/1.3 ${WIDGET_FONT};
      box-shadow: 0 18px 48px rgba(0,0,0,.6); transform: translateX(var(--px, 0px));
    }
    .panel[hidden] { display: none; }
    .help { width: 290px; }
    .hbody { padding: 12px 14px 14px; color: #D4D4D8; font-size: 12.5px; line-height: 1.5; }
    .hbody p { margin: 0 0 8px; }
    .hbody b { color: #fff; font-weight: 650; }
    .hbody ul { margin: 0 0 12px; padding-left: 18px; color: #A1A1AA; }
    .hbody li { margin: 0 0 4px; }
    .hbtns { display: flex; gap: 8px; }
    .hbtns button { flex: 1; padding: 9px 10px; border: 1px solid #2A2A32; border-radius: 10px; background: #1E1E24; color: #F4F4F5; font: 600 12px ${WIDGET_FONT}; cursor: pointer; }
    .hbtns button:hover { background: #26262E; border-color: #FED24F; }
    .hnote { margin-top: 10px; font-size: 11px; color: #8A8A94; }
    .head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 8px 10px 14px; border-bottom: 1px solid #2A2A32; }
    .head .t { font-weight: 700; font-size: 13.5px; }
    .head .s { margin-top: 2px; font-size: 11px; color: #A1A1AA; max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .x { width: 28px; height: 28px; border: 0; border-radius: 8px; background: transparent; color: #A1A1AA; font-size: 14px; cursor: pointer; }
    .x:hover { background: #26262E; color: #fff; }
    .body { max-height: min(52vh, 340px); overflow-y: auto; padding: 8px; overscroll-behavior: contain; }
    .row {
      width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 0 0 6px; padding: 9px 11px;
      border: 1px solid #2A2A32; border-radius: 12px; background: #1E1E24; color: inherit; font: inherit; text-align: left; cursor: pointer;
      transition: border-color .12s ease, background .12s ease;
    }
    .row:last-child { margin-bottom: 0; }
    .row:hover, .row:focus-visible { background: #26262E; border-color: #FED24F; outline: none; }
    .row.rec { border-color: #7EC151; background: rgba(178,217,89,.16); }
    .row .q { font-weight: 650; font-size: 13.5px; display: flex; align-items: center; gap: 8px; }
    .row .m { margin-top: 3px; font-size: 11px; color: #A1A1AA; }
    .row .z { font-size: 12px; color: #D4D4D8; white-space: nowrap; }
    .tag { padding: 2px 7px; border-radius: 9999px; background: #B2D959; color: #15200A; font-size: 9.5px; font-weight: 700; letter-spacing: .3px; text-transform: uppercase; }
    .msg { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 18px 12px; text-align: center; color: #A1A1AA; font-size: 12.5px; }
    .msg b { color: #F4F4F5; font-weight: 600; }
    .spin { width: 22px; height: 22px; border-radius: 50%; border: 3px solid #2A2A32; border-top-color: #7EC151; animation: spin .8s linear infinite; }
    .go { padding: 9px 14px; border: 0; border-radius: 10px; background: #B2D959; color: #15200A; font: 650 12.5px ${WIDGET_FONT}; cursor: pointer; }
    .go:hover { filter: brightness(1.1); }
    .foot { display: block; width: 100%; padding: 10px 14px; border: 0; border-top: 1px solid #2A2A32; background: transparent; color: #A1A1AA; font: 500 12px ${WIDGET_FONT}; text-align: center; cursor: pointer; }
    .foot:hover { color: #fff; background: #1E1E24; }

    @keyframes pulse {
      0% { box-shadow: 0 8px 24px rgba(0,0,0,.5), 0 0 0 2px rgba(255,255,255,.9), 0 0 0 0 rgba(254,210,79,.75); }
      70% { box-shadow: 0 8px 24px rgba(0,0,0,.5), 0 0 0 2px rgba(255,255,255,.9), 0 0 0 14px rgba(254,210,79,0); }
      100% { box-shadow: 0 8px 24px rgba(0,0,0,.5), 0 0 0 2px rgba(255,255,255,.9), 0 0 0 0 rgba(254,210,79,0); }
    }
    @keyframes bounce { 0%, 100% { transform: translateY(-1.5px); } 50% { transform: translateY(2.5px); } }
    @keyframes shine { 0%, 55% { left: -60%; } 100% { left: 130%; } }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      .btn, .btn::after, .icon svg, .spin { animation: none !important; }
      .btn, .hint, .row { transition: none; }
    }
  `;

  const grabber = {
    host: null, anchor: null, btn: null, label: null, hint: null, panel: null, panelTitle: null, panelSub: null, panelBody: null,
    stack: null, slot: null, pointer: { x: -1, y: -1 }, video: null, target: null, open: false, helpOpen: false, pill: null, help: null, busy: false, hintShown: false, hintTimer: 0, formats: new Map(),
  };

  function buildGrabber() {
    const host = document.createElement("div");
    host.id = "flowget-video-grabber";
    host.style.cssText = "all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;";
    // An open root lets the window-level handlers below see which inner element was used (composedPath).
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>${grabberCss}</style>
      <div class="anchor"><div class="stack">
        <div class="pill">
          <button class="btn" type="button" data-action="toggle" data-state="idle" aria-haspopup="true" aria-label="Download this video with FlowGet">
            <span class="icon">${FLOWGET_GLYPH}</span><span class="label">Download Video</span>
          </button>
          <div class="ctl">
            <button class="mini" type="button" data-action="help" aria-label="What is this button?" title="What is this?">?</button>
            <button class="mini" type="button" data-action="dismiss" aria-label="Hide this button" title="Hide this button"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7"/></svg></button>
          </div>
        </div>
        <div class="hint" role="status">Click to choose a quality and download</div>
        <div class="panel help" hidden role="dialog" aria-label="About the FlowGet video button">
          <div class="head">
            <div><div class="t">About this button</div></div>
            <button class="x" type="button" data-action="help-close" aria-label="Close">✕</button>
          </div>
          <div class="hbody">
            <p><b>Download Video</b> appears on videos. Click it, pick a quality, and FlowGet downloads the video using many connections at once.</p>
            <ul>
              <li>The FlowGet app must be installed on this PC.</li>
              <li>The <b>✕</b> hides the button on this page until you reload it.</li>
              <li>Videos protected by DRM, such as paid streaming services, cannot be downloaded.</li>
            </ul>
            <div class="hbtns">
              <button type="button" data-action="hide-page">Hide on this page</button>
              <button type="button" data-action="hide-always">Turn off everywhere</button>
            </div>
            <div class="hnote">Turn it back on any time in the FlowGet extension: Video download button.</div>
          </div>
        </div>
        <div class="panel" hidden role="dialog" aria-label="FlowGet video download">
          <div class="head">
            <div><div class="t">Download this video</div><div class="s"></div></div>
            <button class="x" type="button" data-action="close" aria-label="Close">✕</button>
          </div>
          <div class="body"></div>
          <button class="foot" type="button" data-action="more">Open in FlowGet for more options</button>
        </div>
      </div></div>
    `;
    grabber.host = host;
    grabber.anchor = root.querySelector(".anchor");
    grabber.stack = root.querySelector(".stack");
    grabber.btn = root.querySelector(".btn");
    grabber.pill = root.querySelector(".pill");
    grabber.help = root.querySelector(".help");
    grabber.label = root.querySelector(".label");
    grabber.hint = root.querySelector(".hint");
    grabber.panel = root.querySelector(".panel:not(.help)");
    grabber.panelSub = root.querySelector(".s");
    grabber.panelBody = root.querySelector(".body");
    grabber.btn.addEventListener("mouseenter", () => grabber.hint.setAttribute("data-show", "false"));
  }

  // Events are handled at window level in the capture phase rather than on the elements themselves. Players
  // commonly stop propagation on window/document in the capture phase, which would hide a click from a listener
  // on the button; a listener on the same node (window) still runs. Events from inside the shadow root are
  // retargeted to the host element, so `e.target === grabber.host` means "the user used our overlay".
  function actionElement(e) {
    for (const n of e.composedPath()) {
      if (n.nodeType === 1 && n.dataset && n.dataset.action) return n;
    }
    return null;
  }

  for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "dblclick", "contextmenu", "touchstart"]) {
    window.addEventListener(
      type,
      (e) => {
        if (grabber.host && e.target === grabber.host) e.stopPropagation();
        else if (type === "pointerdown" && (grabber.open || grabber.helpOpen)) { setPanelOpen(false); setHelpOpen(false); } // click elsewhere closes the menu
      },
      true,
    );
  }
  window.addEventListener(
    "click",
    (e) => {
      if (!grabber.host || e.target !== grabber.host) return;
      e.preventDefault();
      e.stopPropagation();
      const el = actionElement(e);
      if (!el) return;
      const d = el.dataset;
      switch (d.action) {
        case "toggle":
          onToggle();
          break;
        case "close":
          setPanelOpen(false);
          break;
        case "help":
          setHelpOpen(!grabber.helpOpen);
          break;
        case "help-close":
          setHelpOpen(false);
          break;
        case "dismiss":
        case "hide-page":
          dismissGrabber();
          break;
        case "hide-always":
          try {
            chrome.storage.local.set({ videoButtonEnabled: false });
          } catch {
            /* extension was reloaded */
          }
          dismissGrabber();
          break;
        case "pick":
          sendDownload({
            height: Number(d.height) || undefined,
            fps: Number(d.fps) || undefined,
            audioOnly: d.audio === "1",
          });
          break;
        case "best":
        case "more":
          sendDownload(null);
          break;
      }
    },
    true,
  );
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && (grabber.open || grabber.helpOpen)) { setPanelOpen(false); setHelpOpen(false); }
    },
    true,
  );

  function setGrabberState(state, text) {
    grabber.btn.dataset.state = state;
    grabber.label.textContent = text;
  }

  function setHelpOpen(open) {
    grabber.helpOpen = open;
    if (grabber.help) grabber.help.hidden = !open;
    if (grabber.pill) grabber.pill.dataset.help = String(open);
    if (open) {
      setPanelOpen(false);
      grabber.hint.setAttribute("data-show", "false");
    }
  }

  // The person hid the button: it stays away on this page until it is reloaded (or for good when they chose that).
  let videoButtonEnabled = true;
  let grabberDismissed = false;
  function dismissGrabber() {
    grabberDismissed = true;
    hideGrabber();
  }
  function hideGrabber() {
    if (grabber.open) setPanelOpen(false);
    if (grabber.helpOpen) setHelpOpen(false);
    grabber.video = null;
    grabber.slot = null;
    if (grabber.host && grabber.host.isConnected) grabber.host.remove();
  }
  try {
    chrome.storage.local.get({ videoButtonEnabled: FLOWGET_DEFAULTS.videoButtonEnabled }).then((v) => {
      videoButtonEnabled = v.videoButtonEnabled !== false;
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.videoButtonEnabled) {
        videoButtonEnabled = changes.videoButtonEnabled.newValue !== false;
        if (videoButtonEnabled) grabberDismissed = false; // turned back on from the popup: show it again right away
        scheduleGrabberUpdate();
      }
    });
  } catch {
    /* extension was reloaded; the default (shown) stays in force */
  }

  function setPanelOpen(open) {
    grabber.open = open;
    grabber.panel.hidden = !open;
    grabber.btn.dataset.open = String(open);
    grabber.btn.setAttribute("aria-expanded", String(open));
    if (open) {
      grabber.hint.setAttribute("data-show", "false");
      if (grabber.helpOpen) setHelpOpen(false);
    }
  }

  /** What to hand to the app: a direct file when the page exposes one, otherwise the page the video lives on. */
  function videoTarget(video) {
    const src = video.currentSrc || video.src || "";
    if (/^https?:/i.test(src) && !/\.(m3u8|mpd)(\?|$)/i.test(src)) {
      const name = (document.title || "video").replace(/[\\/?%*:|"<>]/g, "_").trim().slice(0, 120);
      return { url: src, fileName: `${name || "video"}.mp4`, direct: true };
    }
    // Blob/HLS/DASH players (Pinterest, YouTube, ...): the app resolves the page itself with yt-dlp.
    const link = video.closest("a[href]");
    if (link && /^https?:/i.test(link.href) && VIDEO_PAGE_LINK.test(new URL(link.href).pathname)) {
      return { url: link.href };
    }
    return { url: window.location.href };
  }

  function onToggle() {
    if (grabber.busy || !grabber.video) return;
    if (grabber.open) {
      setPanelOpen(false);
      return;
    }
    grabber.target = videoTarget(grabber.video);
    if (grabber.target.direct) {
      // A plain file link: nothing to choose, download it.
      sendDownload(null);
      return;
    }
    setPanelOpen(true);
    showFormats();
  }

  // ---- menu content ----
  function heightLabel(h) {
    if (h >= 4320) return `${h}p 8K`;
    if (h >= 2160) return `${h}p 4K`;
    if (h >= 1440) return `${h}p 2K`;
    if (h >= 1080) return `${h}p FHD`;
    if (h >= 720) return `${h}p HD`;
    return `${h}p`;
  }

  function formatBytes(n) {
    if (!n || n <= 0) return "";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return `~${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
  }

  function formatDuration(secs) {
    if (!secs || secs <= 0) return "";
    const s = Math.round(secs);
    const m = Math.floor(s / 60);
    return m >= 60
      ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
      : `${m}:${String(s % 60).padStart(2, "0")}`;
  }

  function h(tag, className, text, attrs) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    if (attrs) for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }

  function showMessage(title, detail, buttonText) {
    const box = h("div", "msg");
    box.append(h("b", "", title));
    if (detail) box.append(h("span", "", detail));
    if (buttonText) box.append(h("button", "go", buttonText, { type: "button", "data-action": "best" }));
    grabber.panelBody.replaceChildren(box);
  }

  const hasQualities = (d) => Boolean(d && d.ok && Array.isArray(d.videoOptions) && d.videoOptions.length);

  async function askFormats(url) {
    try {
      return await chrome.runtime.sendMessage({ type: "GET_FORMATS", url });
    } catch {
      return { ok: false, error: "The extension was updated. Reload this page and try again." };
    }
  }

  function pageTitleName() {
    const name = (document.title || "video").replace(/[\\/?%*:|"<>]/g, "_").trim().slice(0, 120);
    return `${name || "video"}.mp4`;
  }

  async function showFormats() {
    const url = grabber.target.url;
    grabber.panelSub.textContent = "";
    const cached = grabber.formats.get(url);
    if (cached && Date.now() - cached.at < FORMATS_CACHE_MS) {
      if (cached.streamUrl) grabber.target = { url: cached.streamUrl, fileName: pageTitleName() };
      renderFormats(cached.data);
      return;
    }
    const box = h("div", "msg");
    box.append(h("div", "spin"), h("span", "", "Reading the available qualities…"));
    grabber.panelBody.replaceChildren(box);

    let data = await askFormats(url);
    if (!grabber.open || !grabber.target || grabber.target.url !== url) return; // closed or moved on meanwhile

    let streamUrl = null;
    if (!hasQualities(data) && !(data && data.offline)) {
      // The page address could not be read (some sites use pin/video links the downloader does not know). The player
      // itself loaded a streaming playlist listing every quality: use that, the way IDM does.
      let streams = [];
      try {
        streams = ((await chrome.runtime.sendMessage({ type: "GET_STREAMS" })) || {}).streams || [];
      } catch {
        streams = [];
      }
      for (const candidate of streams.slice(0, 3)) {
        const attempt = await askFormats(candidate);
        if (!grabber.open || !grabber.target || grabber.target.url !== url) return;
        if (hasQualities(attempt)) {
          data = attempt;
          streamUrl = candidate;
          break;
        }
      }
    }

    if (hasQualities(data)) {
      grabber.formats.set(url, { at: Date.now(), data, streamUrl });
      if (streamUrl) grabber.target = { url: streamUrl, fileName: pageTitleName() };
      renderFormats(data);
    } else if (data && data.offline) {
      showMessage("FlowGet isn't running", "Open the FlowGet app, then try again.");
    } else if (data && data.error === "not a video page") {
      showMessage("Qualities aren't available here", "FlowGet can still download this video at its best quality.", "Download best quality");
    } else {
      showMessage("Couldn't list the qualities", (data && data.error) || "Try again, or let FlowGet pick the best quality.", "Download best quality");
    }
  }

  // Quality picker modal / renderer (1080p, 720p, 480p, audio only)
  const showQualityPicker = renderFormats;

  function renderFormats(data) {
    const options = data.videoOptions;
    const heights = [...new Set(options.map((o) => o.height))].sort((a, b) => b - a);
    // Recommended: the best picture up to 1080p (sharp, plays everywhere, sensible size) at its highest frame rate.
    const recHeight = heights.find((v) => v <= 1080) ?? heights[0];
    const recFps = Math.max(...options.filter((o) => o.height === recHeight).map((o) => o.fps));

    const meta = [formatDuration(data.duration)].filter(Boolean).join(" · ");
    grabber.panelSub.textContent = meta || `${options.length} quality option${options.length === 1 ? "" : "s"}`;

    const rows = [];
    for (const o of options.slice(0, 10)) {
      const rec = o.height === recHeight && o.fps === recFps;
      const row = h("button", rec ? "row rec" : "row", undefined, {
        type: "button",
        "data-action": "pick",
        "data-height": String(o.height),
        "data-fps": String(o.fps),
      });
      const left = h("div");
      const q = h("div", "q", heightLabel(o.height));
      if (rec) q.append(h("span", "tag", "Recommended"));
      left.append(q, h("div", "m", `${o.fps} fps · MP4`));
      row.append(left, h("div", "z", formatBytes(o.fileSizeApprox)));
      rows.push(row);
    }
    if (data.hasAudio) {
      const row = h("button", "row", undefined, { type: "button", "data-action": "pick", "data-audio": "1" });
      const left = h("div");
      left.append(h("div", "q", "Audio only"), h("div", "m", "MP3 · best sound quality"));
      row.append(left, h("div", "z", ""));
      rows.push(row);
    }
    grabber.panelBody.replaceChildren(...rows);
  }

  // ---- sending ----
  async function sendDownload(quality) {
    if (grabber.busy || !grabber.target) return;
    grabber.busy = true;
    setPanelOpen(false);
    const target = grabber.target;
    setGrabberState("sending", "Sending…");
    let ok = false;
    let queued = false;
    try {
      const reply = await chrome.runtime.sendMessage({
        type: "DOWNLOAD_MEDIA",
        url: target.url,
        fileName: target.fileName,
        quality: quality || undefined,
      });
      ok = Boolean(reply && reply.ok);
      queued = Boolean(reply && reply.queued);
    } catch {
      ok = false;
    }
    setGrabberState(
      ok ? "ok" : "error",
      queued ? "Waiting for FlowGet…" : ok ? "Sent to FlowGet ✓" : "Open the FlowGet app",
    );
    setTimeout(() => {
      grabber.busy = false;
      setGrabberState("idle", "Download Video");
    }, 2200);
  }

  function visibleRect(el) {
    const r = el.getBoundingClientRect();
    const left = Math.max(r.left, 0);
    const top = Math.max(r.top, 0);
    const right = Math.min(r.right, window.innerWidth);
    const bottom = Math.min(r.bottom, window.innerHeight);
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  function usableVideos() {
    const list = [];
    for (const v of document.querySelectorAll("video")) {
      const vr = visibleRect(v);
      if (vr.width < 120 || vr.height < 80) continue;
      const cs = getComputedStyle(v);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      list.push({ video: v, vr, area: vr.width * vr.height });
    }
    return list;
  }

  /** The video the button belongs to: the open menu's video, else the one under the pointer, else the biggest. */
  function pickVideo() {
    const list = usableVideos();
    if (list.length === 0) return null;
    const current = grabber.video && list.find((c) => c.video === grabber.video);
    if (grabber.open && current) return current;

    const { x, y } = grabber.pointer;
    const under = list
      .filter((c) => x >= c.vr.left && x <= c.vr.right && y >= c.vr.top && y <= c.vr.bottom)
      .sort((p, q) => p.area - q.area)[0]; // innermost when videos are nested
    if (under) return under;
    if (current) return current;
    return list.sort((p, q) => q.area - p.area)[0];
  }

  // Where the button sits inside the video. Sites and other extensions draw their own things over a video (Pinterest:
  // board picker, Save, Visit site; IDM: its "Download this video" bar), so the top edge is scanned for a free
  // gap, starting at the centre like IDM's own bar. If the full button does not fit, the round icon is used on the
  // top edge before the bottom edge is considered.
  const BAND_STEP = 6;
  const EDGE = 10;

  function isBlocking(el, video) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest('button, [role="button"], [role="menuitem"], [role="slider"], input, select, textarea, summary')) return true;
    const link = el.closest("a[href]");
    return Boolean(link && !link.contains(video)); // the pin's own link wraps the video; other links are controls
  }

  /** A small box drawn over the video by someone else (IDM's bar, another extension's badge, a site label). */
  function isForeignOverlay(el, videoArea) {
    if (el.id === "flowget-video-grabber" || el.id === "flowget-auto-suggest-widget") return false;
    const r = el.getBoundingClientRect();
    // Big layers (a site's click-catching shield, a modal) cover the whole video and are not something to avoid.
    return r.width > 0 && r.height > 0 && r.width * r.height < videoArea * 0.35;
  }

  function pointBlocked(x, y, video, videoArea) {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el === grabber.host) continue;
      if (el === video || el.contains(video)) return false; // everything below the video itself does not matter
      if (isBlocking(el, video) || isForeignOverlay(el, videoArea)) return true;
    }
    return false;
  }

  /**
   * A horizontal strip of the video. `blockedAt(x)` says whether someone else's control is drawn at that x,
   * looking at a few heights across the strip. Answers are remembered, so only the columns that candidate spots
   * actually cover are ever tested.
   */
  function scanBand(vr, top, hgt, video) {
    const videoArea = vr.width * vr.height;
    const ys = [top + 2, top + hgt * 0.35, top + hgt * 0.65, top + hgt - 2];
    const memo = new Map();
    return {
      x0: vr.left,
      blockedAt(c) {
        if (memo.has(c)) return memo.get(c);
        const x = vr.left + c * BAND_STEP;
        let blocked = false;
        if (x >= 0 && x < window.innerWidth) {
          for (const y of ys) {
            if (y >= 0 && y < window.innerHeight && pointBlocked(x, y, video, videoArea)) {
              blocked = true;
              break;
            }
          }
        }
        memo.set(c, blocked);
        return blocked;
      },
    };
  }

  /** True when anything is drawn between `left` and `right` (a little margin each side). */
  function bandHas(map, left, right) {
    const c0 = Math.ceil((left - 3 - map.x0) / BAND_STEP);
    const c1 = Math.floor((right + 3 - map.x0) / BAND_STEP);
    for (let c = Math.max(0, c0); c <= c1; c++) if (map.blockedAt(c)) return true;
    return false;
  }

  /** Both sizes of the button, measured as they are right now. */
  function measureButton() {
    const btn = grabber.btn;
    const was = btn.classList.contains("compact");
    btn.classList.remove("compact");
    const full = { w: btn.offsetWidth || 150, h: btn.offsetHeight || 40 };
    btn.classList.add("compact");
    const compact = { w: btn.offsetWidth || 40, h: btn.offsetHeight || 40 };
    btn.classList.toggle("compact", was);
    return { full, compact };
  }

  /** `{ row, variant, offset }` (offset = distance from the video's left edge), or null when no spot is free. */
  function placeButton(vr, video, dims, keep) {
    const rows = [
      { name: "top", top: vr.top + EDGE },
      { name: "bottom", top: vr.bottom - EDGE - dims.full.h },
    ];
    const variants = vr.width < 360 ? ["compact"] : ["full", "compact"];
    const maps = {};
    const mapFor = (row) => (maps[row.name] = maps[row.name] || scanBand(vr, row.top, dims.full.h, video));

    // keep the current spot while it is still free, so the button does not wander
    if (keep) {
      const row = rows.find((r) => r.name === keep.row);
      const w = dims[keep.variant].w;
      const left = vr.left + keep.offset;
      if (row && left >= vr.left && left + w <= vr.right && !bandHas(mapFor(row), left, left + w)) return keep;
    }

    for (const row of rows) {
      for (const variant of variants) {
        const w = dims[variant].w;
        const minX = vr.left + EDGE;
        const maxX = vr.right - EDGE - w;
        if (maxX < minX) continue;
        const center = vr.left + (vr.width - w) / 2;
        const xs = [Math.min(Math.max(center, minX), maxX)];
        for (let d = 16; center - d >= minX || center + d <= maxX; d += 16) {
          if (center - d >= minX) xs.push(center - d);
          if (center + d <= maxX) xs.push(center + d);
        }
        xs.push(minX, maxX);
        for (const x of xs) {
          if (!bandHas(mapFor(row), x, x + w)) return { row: row.name, variant, offset: x - vr.left };
        }
      }
    }
    return null;
  }

  let recomputeSlot = true;

  function updateGrabber() {
    if (!videoButtonEnabled || grabberDismissed) {
      hideGrabber();
      return;
    }
    const fs = document.fullscreenElement;
    const picked = fs && fs.tagName === "VIDEO" ? null : pickVideo(); // a fullscreen <video> cannot host overlays
    if (!picked) {
      // The user is choosing a quality: ride out a momentary glitch (a player re-laying out, a scroll jump) as long
      // as the video is still on the page, instead of pulling the menu away.
      if ((grabber.open || grabber.helpOpen) && grabber.video && grabber.video.isConnected) return;
      grabber.video = null;
      grabber.slot = null;
      if (grabber.host && grabber.host.isConnected) {
        if (grabber.open) setPanelOpen(false);
        if (grabber.helpOpen) setHelpOpen(false);
        grabber.host.remove();
      }
      return;
    }
    const video = picked.video;
    const vr = picked.vr;
    if (!grabber.host) buildGrabber();

    const parent = fs || document.documentElement;
    if (grabber.host.parentNode !== parent) parent.appendChild(grabber.host);

    if (grabber.video !== video) {
      if (grabber.open) setPanelOpen(false); // a different video: the open menu belongs to the old one
      if (grabber.helpOpen) setHelpOpen(false);
      grabber.video = video;
      grabber.slot = null;
      recomputeSlot = true;
      if (!grabber.hintShown) {
        // First video on this page: point at the button for a few seconds so it is obvious what it does.
        grabber.hintShown = true;
        grabber.hint.setAttribute("data-show", "true");
        clearTimeout(grabber.hintTimer);
        grabber.hintTimer = setTimeout(() => grabber.hint.setAttribute("data-show", "false"), 6000);
      }
    }

    // Measure both sizes, then pick where the button goes (and whether it is the full pill or the round icon).
    if (!grabber.open && !grabber.helpOpen && (recomputeSlot || !grabber.slot)) {
      recomputeSlot = false;
      const dims = measureButton();
      grabber.slot = placeButton(vr, video, dims, grabber.slot) || { row: "top", variant: vr.width < 360 ? "compact" : "full", offset: EDGE };
    }
    const slot = grabber.slot;
    grabber.btn.classList.toggle("compact", slot.variant === "compact");
    grabber.pill.classList.toggle("compact", slot.variant === "compact");
    const w = grabber.btn.offsetWidth || 40;
    const hgt = grabber.btn.offsetHeight || 40;
    const up = slot.row === "bottom"; // the menu opens upwards from a button at the bottom
    grabber.stack.classList.toggle("up", up);

    const left = vr.left + slot.offset;
    const rightEdge = left + w;
    const right = Math.min(rightEdge, window.innerWidth - 8);
    const y = up ? vr.bottom - EDGE : vr.top + EDGE;
    grabber.anchor.style.transform = `translate(${Math.round(right)}px, ${Math.round(y)}px)`;
    // keep the 300px menu on screen when the button sits near the left edge
    grabber.panel.style.setProperty("--px", `${Math.max(0, Math.round(8 - (right - 300)))}px`);
    grabber.help.style.setProperty("--px", `${Math.max(0, Math.round(8 - (right - 290)))}px`);
    grabber.hint.style.setProperty("--hx", `${Math.max(0, Math.round(8 - (right - 230)))}px`);
  }

  let grabberFrame = 0;
  function scheduleGrabberUpdate() {
    if (grabberFrame) return;
    grabberFrame = requestAnimationFrame(() => {
      grabberFrame = 0;
      updateGrabber();
    });
  }
  window.addEventListener("scroll", scheduleGrabberUpdate, { capture: true, passive: true });
  window.addEventListener("resize", scheduleGrabberUpdate, { passive: true });
  window.addEventListener(
    "mousemove",
    (e) => {
      grabber.pointer.x = e.clientX;
      grabber.pointer.y = e.clientY;
      scheduleGrabberUpdate();
    },
    { capture: true, passive: true },
  );
  document.addEventListener("fullscreenchange", scheduleGrabberUpdate);

  function setupVideoGrabber() {
    updateGrabber();
    updateAutoSuggestBar();
  }

  // Players load and swap videos after the page is ready, so keep looking.
  setInterval(() => {
    silenceOldCopies();
    recomputeSlot = true; // overlays such as a site's Save button come and go, so re-check where there is room
    scheduleGrabberUpdate();
  }, 300);
  setInterval(updateAutoSuggestBar, 1800);
  setTimeout(setupVideoGrabber, 400);

  // 6. Batch Links Scraper
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "TRIGGER_BATCH_SCRAPER") {
      openBatchModal();
    }
  });

  function openBatchModal() {
    const existing = document.getElementById("flowget-batch-modal");
    if (existing) existing.remove();

    const links = Array.from(document.querySelectorAll("a[href]"))
      .map((a) => {
        try {
          return new URL(a.href, window.location.href).href;
        } catch {
          return null;
        }
      })
      .filter((href) => href && href.startsWith("http"));

    const uniqueLinks = Array.from(new Set(links));

    const modal = document.createElement("div");
    modal.id = "flowget-batch-modal";
    modal.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.7);
      backdrop-filter: blur(4px);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: ${WIDGET_FONT};
    `;

    modal.innerHTML = `
      <div style="
        width: min(600px, 92vw);
        max-height: 80vh;
        background: #16161A;
        border: 1px solid #2A2A32;
        border-radius: 16px;
        box-shadow: 0 20px 40px rgba(0,0,0,0.6);
        color: #F4F4F5;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      ">
        <div style="padding: 16px; border-bottom: 1px solid #2A2A32; display: flex; justify-content: space-between; align-items: center;">
          <div style="font-weight: 600; font-size: 14px;">Download All Links (${uniqueLinks.length} found)</div>
          <button id="flowget-batch-close" style="background: none; border: none; color: #A1A1AA; cursor: pointer; font-size: 16px;">✕</button>
        </div>
        <div id="flowget-batch-list" style="padding: 12px; overflow-y: auto; max-height: 50vh; display: flex; flex-direction: column; gap: 6px;">
          ${uniqueLinks.slice(0, 100).map((l) => `
            <label style="display: flex; align-items: center; gap: 8px; font-size: 11px; color: #A1A1AA; cursor: pointer;">
              <input type="checkbox" checked data-url="${escapeHtml(l)}" style="accent-color: #FED24F;" />
              <span title="${escapeHtml(l)}" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 520px;">${escapeHtml(l)}</span>
            </label>
          `).join("")}
        </div>
        <div style="padding: 12px 16px; border-top: 1px solid #2A2A32; display: flex; justify-content: flex-end; gap: 8px;">
          <button id="flowget-batch-cancel" style="padding: 6px 14px; border-radius: 8px; background: #26262E; color: #F4F4F5; border: none; cursor: pointer; font-size: 12px;">Cancel</button>
          <button id="flowget-batch-submit" style="padding: 6px 16px; border-radius: 8px; background: #B2D959; color: #15200A; border: none; cursor: pointer; font-weight: 600; font-size: 12px;">Download Selected</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector("#flowget-batch-close").onclick = () => modal.remove();
    modal.querySelector("#flowget-batch-cancel").onclick = () => modal.remove();
    modal.querySelector("#flowget-batch-submit").onclick = () => {
      const selected = Array.from(modal.querySelectorAll('input[type="checkbox"]:checked')).map((cb) => ({
        url: cb.getAttribute("data-url"),
      }));
      if (selected.length > 0) {
        chrome.runtime.sendMessage({ type: "DOWNLOAD_BATCH", items: selected });
      }
      modal.remove();
    };
  }
})();
