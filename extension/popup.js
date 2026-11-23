// FlowGet extension popup.

const PING_URL = "http://127.0.0.1:21588/api/ping";

const STORAGE_URL = "http://127.0.0.1:21588/api/storage";

const DEFAULTS = FLOWGET_DEFAULTS;

const $ = (id) => document.getElementById(id);

const ICONS = {
  video: '<path d="m16 13 5.2 3.1a.5.5 0 0 0 .8-.4V8.3a.5.5 0 0 0-.8-.4L16 11"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/>',
  archive: '<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
};

function svg(inner, size = 18, stroke = 2) {
  const ns = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(ns, "svg");
  s.setAttribute("width", size);
  s.setAttribute("height", size);
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", stroke);
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round");
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = inner; // static markup from ICONS only
  return s;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

document.addEventListener("DOMContentLoaded", async () => {
  const state = { items: [], filter: "all", tab: null, appOnline: false };

  // ---------- Tabs ----------
  const tabs = [
    { button: $("tab-found"), panel: $("panel-found") },
    { button: $("tab-settings"), panel: $("panel-settings") },
  ];
  function showTab(index) {
    tabs.forEach((t, i) => {
      t.button.setAttribute("aria-selected", String(i === index));
      t.panel.dataset.active = String(i === index);
    });
  }
  tabs.forEach((t, i) => t.button.addEventListener("click", () => showTab(i)));

  // ---------- Toast ----------
  let toastTimer;
  function toast(text, kind = "ok") {
    const node = $("toast");
    $("toast-text").textContent = text;
    $("toast-glyph").setAttribute("d", kind === "ok" ? "m8 12.5 3 3 5-6" : "M12 8v5m0 3.5h.01");
    node.dataset.kind = kind;
    node.dataset.show = "true";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (node.dataset.show = "false"), 2200);
  }

  // ---------- App connection ----------
  let lastOnline = null;
  let lastStorageAt = 0;

  async function checkApp() {
    const pill = $("status");
    try {
      const resp = await fetch(PING_URL, { cache: "no-store", signal: AbortSignal.timeout(1500) });
      state.appOnline = resp.ok;
    } catch {
      state.appOnline = false;
    }
    pill.dataset.state = state.appOnline ? "online" : "offline";
    // Downloads grabbed while the app was away wait in the background worker; they go out once the app answers.
    let waiting = 0;
    try {
      waiting = ((await chrome.runtime.sendMessage({ type: "GET_HEALTH" })) || {}).pending || 0;
      if (state.appOnline && waiting) {
        chrome.runtime.sendMessage({ type: "FLUSH_PENDING" }).catch(() => {});
        waiting = 0;
      }
    } catch {
      /* the background worker is an older copy: no waiting list */
    }
    $("status-text").textContent = state.appOnline
      ? "App connected"
      : waiting
        ? `App not running · ${waiting} waiting`
        : "App not running";
    pill.title = state.appOnline
      ? "FlowGet is running and ready to receive downloads."
      : waiting
        ? `${waiting} download${waiting === 1 ? " is" : "s are"} waiting. They start as soon as FlowGet opens.`
        : "Open the FlowGet app so downloads can be sent to it.";

    // Refresh the storage card when the connection changes, and now and then while the app is open.
    if (state.appOnline !== lastOnline || (state.appOnline && Date.now() - lastStorageAt > 20000)) {
      lastOnline = state.appOnline;
      lastStorageAt = Date.now();
      refreshStorage();
    }
  }

  // ---------- Storage on this PC ----------
  function fmtBytes(n) {
    const gb = n / 1024 ** 3;
    if (gb >= 1000) return `${(gb / 1024).toFixed(2)} TB`;
    return `${gb >= 100 ? gb.toFixed(0) : gb.toFixed(1)} GB`;
  }

  function showStorage(info, stale) {
    const card = $("storage");
    card.dataset.state = info && !stale ? "online" : "offline";
    $("open-app").hidden = state.appOnline;
    if (!info) {
      $("storage-drive").textContent = "Storage";
      $("storage-free").textContent = "—";
      $("storage-of").textContent = "";
      $("storage-bar").style.width = "0";
      $("storage-note").textContent = "Open FlowGet to see your free space";
      return;
    }
    const used = Math.max(0, info.totalBytes - info.freeBytes);
    const pct = info.totalBytes ? Math.min(100, Math.round((used / info.totalBytes) * 100)) : 0;
    $("storage-drive").textContent = `Drive ${info.drive}`;
    $("storage-free").textContent = fmtBytes(info.freeBytes);
    $("storage-of").textContent = `free of ${fmtBytes(info.totalBytes)}`;
    const bar = $("storage-bar");
    bar.style.width = `${pct}%`;
    bar.dataset.level = pct >= 95 ? "full" : pct >= 85 ? "warn" : "ok";
    const sameDrive = Boolean(info.downloadDir) && info.downloadDir[0].toUpperCase() === String(info.drive)[0].toUpperCase();
    $("storage-note").textContent = stale
      ? "Last known value — FlowGet is closed"
      : sameDrive
        ? `${pct}% used · downloads save to ${info.downloadDir}`
        : `${pct}% used`;
    $("storage-note").title = info.downloadDir || "";
  }

  async function refreshStorage() {
    let info = null;
    if (state.appOnline) {
      try {
        const resp = await fetch(STORAGE_URL, { cache: "no-store", signal: AbortSignal.timeout(10000) });
        const data = await resp.json();
        if (data && data.ok) info = data;
      } catch {
        /* fall back to the last known value */
      }
    }
    if (info) {
      chrome.storage.local.set({ lastStorage: info });
      showStorage(info, false);
    } else {
      const saved = await chrome.storage.local.get("lastStorage");
      showStorage(saved.lastStorage || null, true);
    }
  }

  $("open-app").addEventListener("click", async () => {
    const btn = $("open-app");
    btn.disabled = true;
    $("storage-note").textContent = "Opening FlowGet…";
    try {
      await chrome.runtime.sendMessage({ type: "OPEN_APP" });
    } catch {
      /* the status check below reports the result */
    }
    btn.disabled = false;
    await checkApp();
    if (!state.appOnline) toast("Couldn't open FlowGet. Start it from the Start menu.", "error");
  });

  checkApp();
  setInterval(checkApp, 4000);

  // ---------- Settings ----------
  const settings = await chrome.storage.local.get(DEFAULTS);
  $("intercept-toggle").checked = settings.enabled;
  $("autosuggest-toggle").checked = settings.autoSuggestBarEnabled;
  $("autolaunch-toggle").checked = settings.autoLaunch;
  $("notify-toggle").checked = settings.notifyOnStart;
  $("min-size").value = settings.minSizeBytes ? Math.round(settings.minSizeBytes / 1024) : "";

  $("intercept-toggle").addEventListener("change", (e) => chrome.storage.local.set({ enabled: e.target.checked }));
  $("autosuggest-toggle").addEventListener("change", (e) =>
    chrome.storage.local.set({ autoSuggestBarEnabled: e.target.checked }),
  );
  $("autolaunch-toggle").addEventListener("change", (e) => chrome.storage.local.set({ autoLaunch: e.target.checked }));
  $("notify-toggle").addEventListener("change", (e) => chrome.storage.local.set({ notifyOnStart: e.target.checked }));
  $("min-size").addEventListener("change", (e) => {
    const kb = Math.max(0, parseInt(e.target.value, 10) || 0);
    e.target.value = kb || "";
    chrome.storage.local.set({ minSizeBytes: kb * 1024 });
  });

  // ---------- File types: predefined groups in a dropdown ----------
  const types = new Set(settings.fileTypes);
  const knownTypes = new Set(FLOWGET_FILE_GROUPS.flatMap((g) => g.types));

  function tickSvg(mark) {
    const path = mark === "some" ? "M6 12h12" : "m5 12.5 4.5 4.5L19 7.5";
    return svg(`<path d="${path}"/>`, 11, 3.2);
  }

  function setTypes(next) {
    types.clear();
    next.forEach((t) => types.add(t));
    chrome.storage.local.set({ fileTypes: [...types] });
    renderTypes();
  }

  function renderTypes() {
    const n = types.size;
    const isRecommended = n === FLOWGET_DEFAULT_TYPES.length && FLOWGET_DEFAULT_TYPES.every((t) => types.has(t));
    $("types-summary").textContent =
      n === 0 ? "Nothing selected" : isRecommended ? `Recommended (${n} types)` : `${n} type${n === 1 ? "" : "s"} selected`;

    const custom = [...types].filter((t) => !knownTypes.has(t)).sort();
    const groups = custom.length
      ? [...FLOWGET_FILE_GROUPS, { id: "custom", label: "Added by you", types: custom }]
      : FLOWGET_FILE_GROUPS;

    const body = $("types-groups");
    const scroll = body.scrollTop;
    body.replaceChildren();
    for (const g of groups) {
      const on = g.types.filter((t) => types.has(t)).length;
      const mark = on === 0 ? "off" : on === g.types.length ? "on" : "some";

      const head = el("button", "group-head");
      head.type = "button";
      const tick = el("span", "tick");
      tick.dataset.state = mark;
      tick.append(tickSvg(mark));
      head.append(tick, el("span", "", g.label), el("span", "group-count", `${on}/${g.types.length}`));
      head.addEventListener("click", () => {
        const next = new Set(types);
        g.types.forEach((t) => (mark === "on" ? next.delete(t) : next.add(t)));
        setTypes(next);
      });

      const chips = el("div", "chips");
      for (const t of g.types) {
        const chip = el("button", "tchip", t);
        chip.type = "button";
        chip.setAttribute("aria-pressed", String(types.has(t)));
        chip.addEventListener("click", () => {
          const next = new Set(types);
          next.has(t) ? next.delete(t) : next.add(t);
          setTypes(next);
        });
        chips.append(chip);
      }

      const box = el("div", "group");
      box.append(head, chips);
      body.append(box);
    }
    body.scrollTop = scroll;
  }

  $("types-btn").addEventListener("click", () => {
    const open = $("types-menu").hidden;
    $("types-menu").hidden = !open;
    $("types-btn").setAttribute("aria-expanded", String(open));
    if (open) $("types-btn").scrollIntoView({ block: "start" }); // keep the button in view, the list opens right under it
  });

  document.querySelectorAll("[data-preset]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const preset = btn.dataset.preset;
      if (preset === "recommended") setTypes(FLOWGET_DEFAULT_TYPES);
      else if (preset === "none") setTypes([]);
      else setTypes([...knownTypes, ...[...types].filter((t) => !knownTypes.has(t))]);
    }),
  );

  $("types-add-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("types-custom");
    const ext = input.value.trim().toLowerCase().replace(/^\./, "");
    if (!/^[a-z0-9]{1,10}$/.test(ext)) {
      toast("Use letters and numbers only, e.g. csv", "error");
      return;
    }
    input.value = "";
    setTypes([...types, ext]);
  });

  renderTypes();

  // ---------- Sending to the app ----------
  async function send(message, okText) {
    try {
      const reply = await chrome.runtime.sendMessage({ ...message, referer: state.tab?.url || "" });
      if (reply && reply.ok) {
        toast(okText);
        setTimeout(() => window.close(), 900);
      } else {
        toast("FlowGet isn't running — open the app first", "error");
      }
    } catch {
      toast("Couldn't reach the extension", "error");
    }
  }

  // ---------- Rendering ----------
  function typeOf(item) {
    return ICONS[item.type] ? item.type : "doc";
  }

  function render() {
    const counts = { all: state.items.length, video: 0, audio: 0, doc: 0, archive: 0 };
    state.items.forEach((i) => {
      const t = typeOf(i);
      if (t in counts) counts[t]++;
    });

    $("found-count").textContent = counts.all;
    $("found-count").dataset.zero = String(counts.all === 0);
    $("site-found").textContent =
      counts.all === 0 ? "Nothing to download here" : `${counts.all} downloadable ${counts.all === 1 ? "item" : "items"}`;

    document.querySelectorAll(".chip").forEach((chip) => {
      const f = chip.dataset.filter;
      chip.setAttribute("aria-pressed", String(f === state.filter));
      chip.disabled = f !== "all" && counts[f] === 0;
    });
    if (state.filter !== "all" && counts[state.filter] === 0) state.filter = "all";

    const visible = state.items.filter((i) => state.filter === "all" || typeOf(i) === state.filter);
    const list = $("list");
    list.replaceChildren();

    const downloadAll = $("download-all");
    downloadAll.disabled = visible.length === 0;
    $("download-all-label").textContent =
      visible.length > 1 ? `Download all (${visible.length})` : visible.length === 1 ? "Download" : "Download all";

    if (visible.length === 0) {
      list.append(emptyState());
      return;
    }

    visible.forEach((item) => list.append(row(item)));
  }

  function emptyState() {
    const box = el("div", "empty");
    const art = el("div", "empty-art");
    art.append(svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>', 24));
    box.append(
      art,
      el("div", "empty-title", "No files found"),
      el(
        "div",
        "empty-text",
        "Open a video page or a page with file links. You can also send this page straight to FlowGet below.",
      ),
    );
    return box;
  }

  function row(item) {
    const type = typeOf(item);
    const card = el("div", `item`);

    const icon = el("div", `type-icon type-${type}`);
    icon.append(svg(ICONS[type], 18));

    const body = el("div", "item-body");
    const title = el("div", "item-title", item.title || item.url);
    title.title = item.url;
    const meta = el("div", "item-meta");
    meta.append(el("span", "ext-tag", (item.ext || type).toString()), document.createTextNode(item.size || "Direct link"));
    body.append(title, meta);

    const go = el("button", "icon-btn");
    go.title = "Download with FlowGet";
    go.setAttribute("aria-label", `Download ${item.title || item.url} with FlowGet`);
    go.append(svg('<path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>', 16, 2.6));
    go.addEventListener("click", () =>
      send({ type: "DOWNLOAD_MEDIA", url: item.url, fileName: item.fileName || undefined }, "Sent to FlowGet"),
    );

    card.append(icon, body, go);
    return card;
  }

  document.querySelectorAll(".chip").forEach((chip) =>
    chip.addEventListener("click", () => {
      state.filter = chip.dataset.filter;
      render();
    }),
  );

  $("download-all").addEventListener("click", () => {
    const visible = state.items.filter((i) => state.filter === "all" || typeOf(i) === state.filter);
    if (visible.length === 0) return;
    send(
      { type: "DOWNLOAD_BATCH", items: visible.map((i) => ({ url: i.url, fileName: i.fileName || undefined })) },
      visible.length === 1 ? "Sent to FlowGet" : `Sent ${visible.length} items to FlowGet`,
    );
  });

  $("grab-page").addEventListener("click", () => {
    if (!state.tab?.url || !/^https?:/i.test(state.tab.url)) {
      toast("This page can't be downloaded", "error");
      return;
    }
    send({ type: "DOWNLOAD_MEDIA", url: state.tab.url }, "Page sent to FlowGet");
  });

  // ---------- Extension up to date? ----------
  // Chrome keeps running the code it loaded when the extension was last reloaded, while this popup is read from disk
  // every time. If the two versions differ, the page buttons are stale: reload the extension (one click, no setup).
  try {
    const onDisk = await (await fetch(chrome.runtime.getURL("manifest.json"), { cache: "no-store" })).json();
    if (onDisk.version !== chrome.runtime.getManifest().version) {
      toast("Updating the FlowGet extension…");
      setTimeout(() => chrome.runtime.reload(), 700);
    }
  } catch {
    /* packaged extension: nothing to compare */
  }

  // ---------- Scan the active tab ----------
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tab = tab;

  if (!tab || !tab.url || !/^https?:/i.test(tab.url)) {
    $("site-domain").textContent = tab?.title || "No web page";
    $("grab-page").disabled = true;
    render();
    return;
  }

  try {
    $("site-domain").textContent = new URL(tab.url).hostname.replace(/^www\./, "");
  } catch {
    $("site-domain").textContent = tab.title || "This page";
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "SCAN_PAGE_MEDIA" });
    state.items = Array.isArray(response?.items) ? response.items : [];
  } catch {
    // The page was open before the extension was installed/reloaded, so no content script is listening.
    state.items = [];
  }

  // Streaming playlists the page loaded (HLS / DASH): the real video behind a blob: player.
  try {
    const { streams } = (await chrome.runtime.sendMessage({ type: "GET_STREAMS", tabId: tab.id })) || {};
    for (const url of (streams || []).slice(0, 3)) {
      if (state.items.some((i) => i.url === url)) continue;
      const dash = /\.mpd$/i.test(new URL(url).pathname);
      state.items.push({
        title: tab.title || "Video stream",
        url,
        type: "video",
        ext: dash ? "dash" : "hls",
        size: "Stream playlist",
      });
    }
  } catch {
    /* the background worker is an older copy: no stream list */
  }
  render();
});
