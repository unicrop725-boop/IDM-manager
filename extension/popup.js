document.addEventListener("DOMContentLoaded", async () => {
  const toggle = document.getElementById("intercept-toggle");
  const fileTypesInput = document.getElementById("file-types-input");
  const minSizeInput = document.getElementById("min-size-input");
  const grabBtn = document.getElementById("grab-tab-btn");

  const data = await chrome.storage.local.get({
    enabled: true,
    fileTypes: ["zip", "rar", "7z", "iso", "exe", "msi", "mp4", "mkv", "mp3", "pdf", "apk", "tar", "gz"],
    minSizeBytes: 0,
  });

  toggle.checked = data.enabled;
  fileTypesInput.value = data.fileTypes.join(", ");
  minSizeInput.value = Math.round(data.minSizeBytes / 1024) || "";

  toggle.addEventListener("change", () => {
    chrome.storage.local.set({ enabled: toggle.checked });
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

  grabBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "GRAB_CURRENT_TAB_URL" }, (resp) => {
      if (resp && resp.url) {
        chrome.runtime.sendMessage({
          type: "DOWNLOAD_MEDIA",
          url: resp.url,
          fileName: resp.title ? `${resp.title}.html` : undefined,
        });
        window.close();
      }
    });
  });
});
