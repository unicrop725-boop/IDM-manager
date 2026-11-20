// FlowGet Content Script - Instant Link Click Interception, Media Detector & Alt-Key Tracker

(() => {
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
    "zip", "rar", "7z", "iso", "exe", "msi", "mp4", "mkv", "mp3", "pdf", "apk", "tar", "gz", "bz2", "bin"
  ];

  document.addEventListener("click", (e) => {
    const link = e.target.closest("a");
    if (!link || !link.href) return;

    // Holding Alt skips capture
    if (e.altKey || isAltHeld) {
      return;
    }

    const url = link.href;
    const urlWithoutQuery = url.split("?")[0].toLowerCase();
    const hasDownloadAttr = link.hasAttribute("download");
    const matchesExtension = DOWNLOAD_EXTENSIONS.some((ext) => urlWithoutQuery.endsWith(`.${ext}`));

    if (hasDownloadAttr || matchesExtension) {
      e.preventDefault();
      e.stopPropagation();

      const suggestedName = link.getAttribute("download") || urlWithoutQuery.split("/").pop() || "";
      console.log("[FlowGet Content] Intercepted click on download link:", url);

      chrome.runtime.sendMessage({
        type: "DOWNLOAD_MEDIA",
        url: url,
        fileName: suggestedName,
      });
    }
  }, true);

  // 3. Media Detector & Floating Video Grabber
  function setupVideoGrabber() {
    const videos = document.querySelectorAll("video");
    videos.forEach((video) => {
      if (video.dataset.flowgetAttached) return;
      video.dataset.flowgetAttached = "true";

      const rect = video.getBoundingClientRect();
      if (rect.width < 120 || rect.height < 80) return;

      const btn = document.createElement("div");
      btn.className = "flowget-video-grabber-btn";
      btn.innerHTML = `
        <div style="
          position: absolute;
          top: 10px;
          right: 10px;
          z-index: 2147483647;
          background: linear-gradient(135deg, #8B5CF6 0%, #2DD4BF 100%);
          color: white;
          padding: 6px 12px;
          border-radius: 20px;
          font-family: system-ui, -apple-system, sans-serif;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          box-shadow: 0 4px 14px rgba(0,0,0,0.4);
          display: flex;
          align-items: center;
          gap: 6px;
          transition: transform 0.15s ease, opacity 0.15s ease;
          user-select: none;
        ">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <span>Download Video</span>
        </div>
      `;

      if (video.parentElement && video.parentElement.style.position !== "relative" && video.parentElement.style.position !== "absolute") {
        video.parentElement.style.position = "relative";
      }

      const targetParent = video.parentElement || document.body;
      targetParent.appendChild(btn);

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        showQualityPicker(video, btn);
      });
    });
  }

  function showQualityPicker(video, anchor) {
    const existing = document.getElementById("flowget-quality-menu");
    if (existing) existing.remove();

    const mediaSrc = video.currentSrc || video.src || "";
    const isHls = mediaSrc.includes(".m3u8");
    const isDash = mediaSrc.includes(".mpd");

    const menu = document.createElement("div");
    menu.id = "flowget-quality-menu";
    menu.style.cssText = `
      position: absolute;
      top: 40px;
      right: 10px;
      z-index: 2147483647;
      background: #16161A;
      border: 1px solid #2A2A32;
      border-radius: 12px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
      padding: 6px;
      width: 170px;
      color: #F4F4F5;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 11px;
    `;

    const qualities = [
      { label: "1080p (Full HD)", res: "1080p" },
      { label: "720p (HD)", res: "720p" },
      { label: "480p (SD)", res: "480p" },
      { label: "Audio Only (MP3)", res: "audio" },
    ];

    let itemsHtml = `<div style="padding: 4px 8px; font-weight: 600; font-size: 10px; color: #A1A1AA; text-transform: uppercase;">Select Quality</div>`;
    qualities.forEach((q) => {
      itemsHtml += `
        <div class="flowget-quality-item" data-res="${q.res}" style="
          padding: 6px 8px;
          border-radius: 6px;
          cursor: pointer;
          display: flex;
          justify-content: space-between;
          align-items: center;
          transition: background 0.1s;
        ">
          <span>${q.label}</span>
          ${isHls ? '<span style="font-size: 9px; color: #2DD4BF;">HLS</span>' : ""}
          ${isDash ? '<span style="font-size: 9px; color: #8B5CF6;">DASH</span>' : ""}
        </div>
      `;
    });

    menu.innerHTML = itemsHtml;
    anchor.appendChild(menu);

    menu.querySelectorAll(".flowget-quality-item").forEach((item) => {
      item.addEventListener("mouseenter", () => (item.style.background = "#26262E"));
      item.addEventListener("mouseleave", () => (item.style.background = "transparent"));
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        const res = item.getAttribute("data-res");
        const docTitle = document.title || "video";
        const cleanName = docTitle.replace(/[/\\?%*:|"<>]/g, "_") + `_${res}.mp4`;

        chrome.runtime.sendMessage({
          type: "DOWNLOAD_MEDIA",
          url: mediaSrc || window.location.href,
          fileName: cleanName,
        });

        menu.remove();
      });
    });

    const closeListener = (e) => {
      if (!menu.contains(e.target) && !anchor.contains(e.target)) {
        menu.remove();
        document.removeEventListener("click", closeListener);
      }
    };
    setTimeout(() => document.addEventListener("click", closeListener), 10);
  }

  setInterval(setupVideoGrabber, 1500);
  setTimeout(setupVideoGrabber, 500);

  // 4. Batch Links Scraper
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
      font-family: system-ui, -apple-system, sans-serif;
    `;

    modal.innerHTML = `
      <div style="
        width: 600px;
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
              <input type="checkbox" checked data-url="${l}" style="accent-color: #8B5CF6;" />
              <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 520px;">${l}</span>
            </label>
          `).join("")}
        </div>
        <div style="padding: 12px 16px; border-top: 1px solid #2A2A32; display: flex; justify-content: flex-end; gap: 8px;">
          <button id="flowget-batch-cancel" style="padding: 6px 14px; border-radius: 8px; background: #26262E; color: #F4F4F5; border: none; cursor: pointer; font-size: 12px;">Cancel</button>
          <button id="flowget-batch-submit" style="padding: 6px 16px; border-radius: 8px; background: linear-gradient(135deg, #8B5CF6 0%, #2DD4BF 100%); color: white; border: none; cursor: pointer; font-weight: 600; font-size: 12px;">Download Selected</button>
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
