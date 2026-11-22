// FlowGet Extension Popup Controller

document.addEventListener("DOMContentLoaded", async () => {
  // Tab Elements
  const tabSniffer = document.getElementById("tab-sniffer");
  const tabSettings = document.getElementById("tab-settings");
  const panelSniffer = document.getElementById("panel-sniffer");
  const panelSettings = document.getElementById("panel-settings");

  // Sniffer UI
  const siteDomainLabel = document.getElementById("site-domain-label");
  const siteItemsCount = document.getElementById("site-items-count");
  const snifferCount = document.getElementById("sniffer-count");
  const detectedContainer = document.getElementById("detected-media-container");
  const downloadAllBtn = document.getElementById("download-all-btn");
  const grabBtn = document.getElementById("grab-tab-btn");
  const filterPills = document.querySelectorAll(".filter-pill");

  // Settings UI
  const interceptToggle = document.getElementById("intercept-toggle");
  const autosuggestToggle = document.getElementById("autosuggest-toggle");
  const fileTypesInput = document.getElementById("file-types-input");
  const minSizeInput = document.getElementById("min-size-input");

  let allDetectedItems = [];
  let currentFilter = "all";

  // Tab switching
  tabSniffer.addEventListener("click", () => {
    tabSniffer.classList.add("active");
    tabSettings.classList.remove("active");
    panelSniffer.style.display = "flex";
    panelSettings.style.display = "none";
  });

  tabSettings.addEventListener("click", () => {
    tabSettings.classList.add("active");
    tabSniffer.classList.remove("active");
    panelSettings.style.display = "flex";
    panelSniffer.style.display = "none";
  });

  // Load saved settings
  const settings = await chrome.storage.local.get({
    enabled: true,
    autoSuggestBarEnabled: true,
    fileTypes: ["zip", "rar", "7z", "iso", "exe", "msi", "mp4", "mkv", "mp3", "pdf", "apk", "tar", "gz"],
    minSizeBytes: 0,
  });

  interceptToggle.checked = settings.enabled;
  autosuggestToggle.checked = settings.autoSuggestBarEnabled;
  fileTypesInput.value = settings.fileTypes.join(", ");
  minSizeInput.value = Math.round(settings.minSizeBytes / 1024) || "";

  interceptToggle.addEventListener("change", () => {
    chrome.storage.local.set({ enabled: interceptToggle.checked });
  });

  autosuggestToggle.addEventListener("change", () => {
    chrome.storage.local.set({ autoSuggestBarEnabled: autosuggestToggle.checked });
  });

  fileTypesInput.addEventListener("change", () => {
    const list = fileTypesInput.value
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    chrome.storage.local.set({ fileTypes: list });
  });

  minSizeInput.addEventListener("change", () => {
    const kb = parseInt(minSizeInput.value, 10) || 0;
    chrome.storage.local.set({ minSizeBytes: kb * 1024 });
  });

  // Query active tab for detected media and downloads
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab && activeTab.url) {
    try {
      const urlObj = new URL(activeTab.url);
      siteDomainLabel.textContent = urlObj.hostname;
    } catch {
      siteDomainLabel.textContent = activeTab.title || "Active Page";
    }

    // Ask content script for detected media on this page
    chrome.tabs.sendMessage(activeTab.id, { type: "SCAN_PAGE_MEDIA" }, (response) => {
      if (chrome.runtime.lastError || !response || !Array.isArray(response.items)) {
        renderFallbackPageItem(activeTab);
        return;
      }

      allDetectedItems = response.items;
      updateMediaDisplay();
    });
  } else {
    renderEmpty("No active webpage detected");
  }

  function renderFallbackPageItem(tab) {
    allDetectedItems = [
      {
        title: tab.title || "Current Webpage",
        url: tab.url,
        type: "video",
        ext: "mp4/stream",
        size: "Auto Stream Grab",
      },
    ];
    updateMediaDisplay();
  }

  function updateMediaDisplay() {
    siteItemsCount.textContent = `${allDetectedItems.length} found`;
    snifferCount.textContent = allDetectedItems.length;

    const filtered = allDetectedItems.filter((item) => {
      if (currentFilter === "all") return true;
      return item.type === currentFilter;
    });

    if (filtered.length === 0) {
      renderEmpty("No media matching filter");
      return;
    }

    detectedContainer.innerHTML = "";
    filtered.forEach((item) => {
      const card = document.createElement("div");
      card.className = "media-item";

      const badgeClass = `badge-${item.type || "doc"}`;
      const extLabel = (item.ext || item.type || "file").toUpperCase();

      card.innerHTML = `
        <div class="media-left">
          <span class="media-type-badge ${badgeClass}">${extLabel}</span>
          <div class="media-details">
            <span class="media-title" title="${escapeHtml(item.title || item.url)}">${escapeHtml(item.title || item.url)}</span>
            <div class="media-meta">
              <span>${item.size || "Direct Link"}</span>
            </div>
          </div>
        </div>
        <button class="download-mini-btn" data-url="${escapeHtml(item.url)}" data-filename="${escapeHtml(item.fileName || item.title || "")}">
          <span>Download</span>
        </button>
      `;

      card.querySelector(".download-mini-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        const targetUrl = item.url;
        const targetName = item.fileName || item.title;
        chrome.runtime.sendMessage({
          type: "DOWNLOAD_MEDIA",
          url: targetUrl,
          fileName: targetName,
        });
        window.close();
      });

      detectedContainer.appendChild(card);
    });
  }

  function renderEmpty(msg) {
    detectedContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📂</div>
        <div style="font-weight: 600;">${escapeHtml(msg)}</div>
        <div style="font-size: 11px;">You can still click "Grab Current Page URL" to inspect media streams with yt-dlp.</div>
      </div>
    `;
    siteItemsCount.textContent = "0 items";
    snifferCount.textContent = "0";
  }

  // Filter Pill clicks
  filterPills.forEach((pill) => {
    pill.addEventListener("click", () => {
      filterPills.forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      currentFilter = pill.getAttribute("data-filter");
      updateMediaDisplay();
    });
  });

  // Download All
  downloadAllBtn.addEventListener("click", () => {
    if (allDetectedItems.length === 0 && activeTab && activeTab.url) {
      chrome.runtime.sendMessage({
        type: "DOWNLOAD_MEDIA",
        url: activeTab.url,
        fileName: activeTab.title ? `${activeTab.title}.mp4` : undefined,
      });
      window.close();
      return;
    }

    chrome.runtime.sendMessage({
      type: "DOWNLOAD_BATCH",
      items: allDetectedItems.map((item) => ({
        url: item.url,
        fileName: item.fileName || item.title,
      })),
    });
    window.close();
  });

  // Grab Current Page URL
  grabBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "GRAB_CURRENT_TAB_URL" }, (resp) => {
      if (resp && resp.url) {
        chrome.runtime.sendMessage({
          type: "DOWNLOAD_MEDIA",
          url: resp.url,
          fileName: resp.title ? `${resp.title}.mp4` : undefined,
        });
        window.close();
      }
    });
  });

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
});
