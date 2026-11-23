import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { api, errorText } from "./api";
import { TitleBar } from "./components/TitleBar";
import { BackgroundLayer } from "./components/BackgroundLayer";
import { MenuBar } from "./components/MenuBar";
import { Sidebar, type SidebarFilter } from "./components/Sidebar";
import { sidebarCategory } from "./format";
import { Toolbar } from "./components/Toolbar";
import { DownloadTable, type SortField, type SortOrder } from "./components/DownloadTable";
import { FooterBar } from "./components/FooterBar";
import { ContextMenu, type ContextMenuPosition } from "./components/ContextMenu";
import { DownloadProgressModal } from "./components/DownloadProgressModal";
import { DiskCleanerModal } from "./components/DiskCleanerModal";
import { SpeedTestModal } from "./components/SpeedTestModal";
import { PropertiesModal } from "./components/PropertiesModal";
import { PremiumCard } from "./components/PremiumCard";
import { ClipboardPopup } from "./components/ClipboardPopup";
import { getVideoSite } from "./utils/videoUrl";
import { isImageDrop, liquidImageFromDrop, setLiquidImage } from "./utils/liquidImage";
import { DropTargetWidget } from "./components/DropTargetWidget";
import AddDownloadModal from "./components/AddDownloadModal";
import BatchDownloadModal from "./components/BatchDownloadModal";
import ImportExportModal from "./components/ImportExportModal";
import TrustedSites from "./components/TrustedSites";
import { TRUSTED_SITES } from "./data/trustedSites";
import { SafetyConfirmModal, needsConfirmation } from "./components/SafetyConfirmModal";
import SiteGrabberModal from "./components/SiteGrabberModal";
import QueueModal from "./components/QueueModal";
import CategoryModal from "./components/CategoryModal";
import SettingsModal from "./components/SettingsModal";
import BandwidthModal from "./components/BandwidthModal";
import StatisticsModal from "./components/StatisticsModal";
import ShareModal from "./components/ShareModal";
import LicenseModal from "./components/LicenseModal";
import UpdateModal from "./components/UpdateModal";
import { cleanFileName } from "./utils/smartNaming";
import { recordCrashReport } from "./utils/crashReporter";
import { setLanguage as updateI18nLanguage } from "./i18n";
import type {
  AdapterInfo,
  BandwidthEffective,
  Category,
  DownloadInfo,
  ProgressEvent,
  QueueInfo,
  SafetyReport,
  Settings,
  ToolsProgress,
  TrialAndLicenseStatus,
} from "./types";

export default function App() {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    return (localStorage.getItem("flowget_theme") as "dark" | "light") || "dark";
  });

  const [downloads, setDownloads] = useState<Record<string, DownloadInfo>>({});
  const [categories, setCategories] = useState<Category[]>([]);
  const [queues, setQueues] = useState<QueueInfo[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [_adapters, setAdapters] = useState<AdapterInfo[]>([]);

  // Filtering & Selection
  const [filter, setFilter] = useState<SidebarFilter>({ type: "all" });
  const [searchQuery, setSearchQuery] = useState("");
  // The search box stays instant while the (possibly long) list is filtered a moment later.
  const deferredQuery = useDeferredValue(searchQuery);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Sorting
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  // Modals & Popups
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [quickAddUrl, setQuickAddUrl] = useState("");
  const [capturedMeta, setCapturedMeta] = useState<{
    fileName?: string;
    cookies?: string;
    referer?: string;
    userAgent?: string;
  }>({});
  const [clipboardCandidateUrl, setClipboardCandidateUrl] = useState<string | null>(null);
  const [showDropWidget] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [isSiteGrabberOpen, setIsSiteGrabberOpen] = useState(false);
  const [isDiskCleanerOpen, setIsDiskCleanerOpen] = useState(false);
  const [isSpeedTestOpen, setIsSpeedTestOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  // Safety check results per download, what the bandwidth rules decide now, and a file waiting for "open anyway".
  const [safety, setSafety] = useState<Record<string, SafetyReport>>({});
  const [bandwidth, setBandwidth] = useState<BandwidthEffective | null>(null);
  const [pendingOpen, setPendingOpen] = useState<DownloadInfo | null>(null);
  const [isBandwidthOpen, setIsBandwidthOpen] = useState(false);
  const [isStatisticsOpen, setIsStatisticsOpen] = useState(false);
  const [shareDownload, setShareDownload] = useState<DownloadInfo | null>(null);
  const [licenseStatus, setLicenseStatus] = useState<TrialAndLicenseStatus | null>(null);
  const [isLicenseModalOpen, setIsLicenseModalOpen] = useState(false);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [showPremiumCard, setShowPremiumCard] = useState(false);
  const [activeProgressModalId, setActiveProgressModalId] = useState<string | null>(null);
  const [propertiesDownload, setPropertiesDownload] = useState<DownloadInfo | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<ContextMenuPosition | null>(null);
  const [queueModalTarget, setQueueModalTarget] = useState<QueueInfo | null | "new">(null);
  const [categoryModalTarget, setCategoryModalTarget] = useState<Category | null | "new">(null);

  const [_error, setError] = useState<string | null>(null);

  // Apply theme to document
  useEffect(() => {
    localStorage.setItem("flowget_theme", theme);
    if (theme === "light") {
      document.documentElement.classList.add("light");
    } else {
      document.documentElement.classList.remove("light");
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  };

  // Request notification permissions
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      const [dlList, catList, qList, sett, adp, lic] = await Promise.all([
        api.getDownloads(),
        api.getCategories(),
        api.getQueues(),
        api.getSettings(),
        api.getAdapters(),
        api.getLicenseStatus(),
      ]);
      setDownloads(Object.fromEntries(dlList.map((d) => [d.id, d])));
      setCategories(catList);
      setQueues(qList);
      setSettings(sett);
      setAdapters(adp);
      setLicenseStatus(lic);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  // Initial load
  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // URL View parameter handler for documentation screenshots & testing
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const view = params.get("view");
    if (!view) return;

    if (view === "main_light") {
      setTheme("light");
    } else if (view === "main_dark") {
      setTheme("dark");
    } else if (view === "add_modal") {
      setIsAddModalOpen(true);
    } else if (view === "progress_modal") {
      setActiveProgressModalId("dl-1");
    } else if (view === "context_menu") {
      const target = downloads["dl-1"] || Object.values(downloads)[0];
      if (target) {
        setContextMenuPos({ x: 380, y: 150, download: target });
      }
    } else if (view === "disk_cleaner") {
      setIsDiskCleanerOpen(true);
    } else if (view === "speed_test") {
      setIsSpeedTestOpen(true);
    } else if (view === "properties") {
      const target = downloads["dl-1"] || Object.values(downloads)[0];
      if (target) {
        setPropertiesDownload(target);
      }
    } else if (view === "premium_card") {
      setShowPremiumCard(true);
    } else if (view === "settings") {
      setIsSettingsOpen(true);
    } else if (view === "bandwidth") {
      setIsBandwidthOpen(true);
    } else if (view === "statistics") {
      setIsStatisticsOpen(true);
    } else if (view === "share") {
      const target = downloads["dl-1"] || Object.values(downloads)[0];
      if (target) setShareDownload(target);
    } else if (view === "license") {
      setIsLicenseModalOpen(true);
    } else if (view === "update") {
      setIsUpdateModalOpen(true);
    }
  }, [downloads]);

  // Anonymous Crash Reporter (Opt-In)
  useEffect(() => {
    const handleErr = (e: ErrorEvent) => {
      recordCrashReport(e.error || e.message, false);
    };
    const handleRejection = (e: PromiseRejectionEvent) => {
      recordCrashReport(e.reason || "Unhandled Promise Rejection", false);
    };
    window.addEventListener("error", handleErr);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleErr);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  // Safety reports, bandwidth state and tool installs
  useEffect(() => {
    api.getSafetyReports().then((list) => setSafety(Object.fromEntries(list.map((r) => [r.id, r])))).catch(() => {});
    api.getBandwidthState().then((s) => setBandwidth(s.effective)).catch(() => {});
    const un = [
      listen<SafetyReport>("safety-updated", ({ payload }) => setSafety((cur) => ({ ...cur, [payload.id]: payload }))),
      listen<BandwidthEffective>("bandwidth-state", ({ payload }) => setBandwidth(payload)),
      // yt-dlp / ffmpeg are installed on first use: say so, with progress, instead of looking stuck.
      listen<ToolsProgress>("tools-progress", ({ payload: p }) => {
        if (p.stage === "downloading") {
          const pct = p.total > 0 ? ` ${Math.round((p.downloaded / p.total) * 100)}%` : "";
          setNotice(`Installing ${p.tool}…${pct}`);
        } else if (p.stage === "done") {
          setNotice(`${p.tool} is ready.`);
        } else if (p.stage === "error") {
          setNotice(`Could not install ${p.tool}: ${p.message}`);
        } else if (p.message) {
          setNotice(p.message);
        }
      }),
    ];
    return () => {
      un.forEach((p) => p.then((fn) => fn()));
    };
  }, []);

  // Event pump
  useEffect(() => {
    const unlisten: Promise<UnlistenFn>[] = [
      listen<ProgressEvent>("download-progress", ({ payload: p }) => {
        setDownloads((cur) => {
          const d = cur[p.id];
          if (!d) return cur;
          return {
            ...cur,
            [p.id]: {
              ...d,
              downloaded: p.downloaded,
              totalSize: p.total ?? d.totalSize,
              speedBps: p.speedBps,
              etaSecs: p.etaSecs,
              segments: p.segments,
              note: p.note,
              protocol: p.protocol,
              liveConnections: p.connections,
              adapters: p.adapters,
            },
          };
        });
      }),
      listen<DownloadInfo>("download-updated", ({ payload: d }) => {
        setDownloads((cur) => {
          const prev = cur[d.id];
          // Show notification if just completed
          if (prev && prev.state !== "completed" && d.state === "completed") {
            if ("Notification" in window && Notification.permission === "granted") {
              try {
                new Notification("Download Complete", {
                  body: d.fileName,
                  icon: "/icons/128x128.png",
                });
              } catch {}
            }
          }
          return { ...cur, [d.id]: d };
        });
      }),
      listen<string>("download-removed", ({ payload: id }) => {
        setDownloads((cur) => {
          const { [id]: _gone, ...rest } = cur;
          return rest;
        });
        setSelectedIds((cur) => {
          const next = new Set(cur);
          next.delete(id);
          return next;
        });
        if (activeProgressModalId === id) {
          setActiveProgressModalId(null);
        }
      }),
      listen<QueueInfo>("queue-updated", ({ payload: q }) => {
        setQueues((cur) => cur.map((item) => (item.id === q.id ? q : item)));
      }),
      listen<any>("browser-download-captured", ({ payload }) => {
        // quality already chosen in the browser's video menu: start straight away
        if (
          payload.url &&
          (getVideoSite(payload.url) || /\.(m3u8|mpd)(\?|#|$)/i.test(payload.url)) &&
          (payload.mediaHeight || payload.mediaFps || payload.mediaAudioOnly || payload.convertTo)
        ) {
          api
            .addDownload({
              url: payload.url,
              fileName: payload.fileName || undefined,
              referer: payload.referer || undefined,
              userAgent: payload.userAgent || undefined,
              cookies: payload.cookies || undefined,
              mediaHeight: payload.mediaHeight || undefined,
              mediaFps: payload.mediaFps || undefined,
              mediaAudioOnly: payload.mediaAudioOnly || undefined,
              convertTo: payload.convertTo || undefined,
            })
            .then(() => refreshAll())
            .catch((e) => setNotice(typeof e === "string" ? e : e?.message || "Could not start the video download."));
          return;
        }
        // a video page sent from the browser menu: open the quality picker instead of the file dialog
        if (payload.url && getVideoSite(payload.url)) {
          window.dispatchEvent(new CustomEvent("flowget-fill-url", { detail: payload.url }));
          return;
        }
        setQuickAddUrl(payload.url || "");
        setCapturedMeta({
          fileName: payload.fileName || "",
          cookies: payload.cookies || "",
          referer: payload.referer || "",
          userAgent: payload.userAgent || "",
        });
        setIsAddModalOpen(true);
      }),
    ];

    const openDownloadsFolderHandler = () => {
      const defaultDir = settings?.downloadDir || "C:\\Downloads";
      api.openFolder(defaultDir).catch(() => {});
    };
    window.addEventListener("open-downloads-folder", openDownloadsFolderHandler);

    return () => {
      unlisten.forEach((p) => p.then((fn) => fn()));
      window.removeEventListener("open-downloads-folder", openDownloadsFolderHandler);
    };
  }, [settings, activeProgressModalId]);

  // Copied links are detected by the backend (system-wide, even while FlowGet is in the background)
  useEffect(() => {
    const un = listen<{ url: string; kind: string }>("clipboard-url", ({ payload }) => {
      setClipboardCandidateUrl(payload.url);
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  // The prompt goes away by itself if you ignore it
  useEffect(() => {
    if (!clipboardCandidateUrl) return;
    const t = setTimeout(() => setClipboardCandidateUrl(null), 30000);
    return () => clearTimeout(t);
  }, [clipboardCandidateUrl]);

  // Sync active language from settings
  useEffect(() => {
    if (settings?.language) {
      updateI18nLanguage(settings.language as any);
    }
  }, [settings?.language]);

  // Battery Saver monitor (Phase 7: pause downloads when laptop battery < 20%)
  useEffect(() => {
    if (settings && settings.batterySaver === false) return;
    if (typeof navigator === "undefined" || !("getBattery" in navigator)) return;

    let batteryInstance: any = null;

    const checkBattery = (battery: any) => {
      if (!battery.charging && battery.level < 0.20) {
        const activeIds = Object.values(downloads)
          .filter((d) => d.state === "downloading" || d.state === "probing")
          .map((d) => d.id);
        if (activeIds.length > 0) {
          activeIds.forEach((id) => api.pause(id).catch(() => {}));
          if ("Notification" in window && Notification.permission === "granted") {
            try {
              new Notification("FlowGet Battery Saver", {
                body: "Paused active downloads because laptop battery is below 20%.",
              });
            } catch {}
          }
        }
      }
    };

    (navigator as any)
      .getBattery()
      .then((battery: any) => {
        batteryInstance = battery;
        checkBattery(battery);
        battery.addEventListener("levelchange", () => checkBattery(battery));
        battery.addEventListener("chargingchange", () => checkBattery(battery));
      })
      .catch(() => {});

    return () => {
      if (batteryInstance) {
        try {
          batteryInstance.removeEventListener("levelchange", () => {});
          batteryInstance.removeEventListener("chargingchange", () => {});
        } catch {}
      }
    };
  }, [settings?.batterySaver, downloads]);

  // A short message at the bottom of the window (used for dropped pictures)
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const useDroppedPicture = async (dt: DataTransfer) => {
    if ((settings?.background ?? "flow") !== "liquid") {
      setNotice('Dropped pictures are used as the background when "Liquid" is chosen in Settings. Nothing was downloaded.');
      return;
    }
    const result = await liquidImageFromDrop(dt);
    if (!result) return;
    if ("error" in result) {
      setNotice(result.error);
      return;
    }
    setLiquidImage(result.dataUrl);
    setNotice("Liquid background updated.");
  };

  const handleWindowDrop = (e: React.DragEvent) => {
    e.preventDefault();
    // Pictures (files or image links) are never downloads: they only ever change the background.
    if (isImageDrop(e.dataTransfer)) {
      void useDroppedPicture(e.dataTransfer);
      return;
    }
    // Local files are not downloads either.
    if (e.dataTransfer.files.length > 0 && !(e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain"))) {
      return;
    }
    let droppedUrl = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    if (!droppedUrl) {
      const html = e.dataTransfer.getData("text/html");
      const match = html.match(/href=["'](https?:\/\/[^"']+)["']/i);
      if (match) droppedUrl = match[1];
    }
    if (droppedUrl && droppedUrl.trim().startsWith("http")) {
      handleQuickAdd(droppedUrl.trim());
    }
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+N -> Add URL
      if ((e.ctrlKey || e.metaKey) && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        setQuickAddUrl("");
        setIsAddModalOpen(true);
        return;
      }

      // Ctrl+F -> Focus Search
      if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        const input = document.getElementById("global-search-input") as HTMLInputElement | null;
        if (input) {
          input.focus();
          input.select();
        }
        return;
      }

      // Ctrl+A -> Select All
      if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
        // If not in an input or textarea
        const activeTag = document.activeElement?.tagName.toLowerCase();
        if (activeTag !== "input" && activeTag !== "textarea") {
          e.preventDefault();
          setSelectedIds(new Set(filteredAndSortedDownloads.map((d) => d.id)));
          return;
        }
      }

      // Delete -> Remove selected
      if (e.key === "Delete" || e.key === "Backspace") {
        const activeTag = document.activeElement?.tagName.toLowerCase();
        if (activeTag !== "input" && activeTag !== "textarea" && selectedIds.size > 0) {
          e.preventDefault();
          handleDeleteSelected();
          return;
        }
      }

      // Space -> Pause / Resume selected
      if (e.key === " ") {
        const activeTag = document.activeElement?.tagName.toLowerCase();
        if (activeTag !== "input" && activeTag !== "textarea" && selectedIds.size > 0) {
          e.preventDefault();
          handleTogglePauseSelected();
          return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIds, downloads]);

  // Filtering downloads
  const filteredDownloads = useMemo(() => {
    let list = Object.values(downloads);

    // Sidebar filter
    if (filter.type === "category") {
      list = list.filter((d) => sidebarCategory(d) === filter.name);
    } else if (filter.type === "status") {
      if (filter.status === "unfinished") {
        list = list.filter((d) => d.state !== "completed" && d.state !== "failed");
      } else if (filter.status === "finished") {
        list = list.filter((d) => d.state === "completed" || d.state === "failed");
      }
    }

    // Search query
    // Every word must match somewhere in the name, address or category (so "holiday mp4" finds holiday.mp4).
    const words = deferredQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length) {
      list = list.filter((d) => {
        const hay = `${d.fileName} ${d.url} ${d.category || ""} ${sidebarCategory(d)}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      });
    }

    return list;
  }, [downloads, filter, deferredQuery]);

  // How many downloads each sidebar entry holds (one pass, only when the list changes).
  const sidebarCounts = useMemo(() => {
    const counts: Record<string, number> = { all: 0, unfinished: 0, finished: 0, trusted: TRUSTED_SITES.length };
    for (const d of Object.values(downloads)) {
      counts.all += 1;
      if (d.state === "completed" || d.state === "failed") counts.finished += 1;
      else counts.unfinished += 1;
      const cat = sidebarCategory(d);
      if (cat) counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  }, [downloads]);

  // Sorting downloads
  const filteredAndSortedDownloads = useMemo(() => {
    const list = [...filteredDownloads];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name":
          cmp = a.fileName.localeCompare(b.fileName);
          break;
        case "size":
          cmp = (a.totalSize || 0) - (b.totalSize || 0);
          break;
        case "status":
          cmp = a.state.localeCompare(b.state);
          break;
        case "eta":
          cmp = (a.etaSecs || 9999999) - (b.etaSecs || 9999999);
          break;
        case "date":
          cmp = (a.createdAt || 0) - (b.createdAt || 0);
          break;
      }
      return sortOrder === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filteredDownloads, sortField, sortOrder]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder(field === "name" ? "asc" : "desc");
    }
  };

  // Speed totals
  const { totalDownloadBps, totalUploadBps } = useMemo(() => {
    let dl = 0;
    Object.values(downloads).forEach((d) => {
      if (d.state === "downloading") {
        dl += d.speedBps || 0;
      }
    });
    // Upload is estimated proportional to network traffic control
    const ul = Math.round(dl * 0.08) + (dl > 0 ? 1024 * 50 : 0);
    return { totalDownloadBps: dl, totalUploadBps: ul };
  }, [downloads]);

  // Selection logic
  const handleToggleSelect = (id: string, shiftKey: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (!shiftKey && next.size === 0) {
          next.add(id);
        } else {
          next.add(id);
        }
      }
      return next;
    });
  };

  const handleToggleSelectAll = () => {
    if (selectedIds.size === filteredAndSortedDownloads.length && filteredAndSortedDownloads.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredAndSortedDownloads.map((d) => d.id)));
    }
  };

  // Row double-click
  /** Open a finished file, asking first when it looks risky (programs, disguised names, VirusTotal hits). */
  const openChecked = (d: DownloadInfo, onFail?: () => void) => {
    if (needsConfirmation(safety[d.id])) {
      setPendingOpen(d);
      return;
    }
    api.openFile(d.filePath).catch(() => onFail?.());
  };

  const handleRowDoubleClick = (d: DownloadInfo) => {
    if (d.state === "completed" && d.filePath) {
      openChecked(d, () => setActiveProgressModalId(d.id));
    } else {
      setActiveProgressModalId(d.id);
    }
  };

  // Toolbar Actions
  const selectedDownloads = useMemo(() => {
    return filteredAndSortedDownloads.filter((d) => selectedIds.has(d.id));
  }, [filteredAndSortedDownloads, selectedIds]);

  const canResumeSelected = selectedDownloads.some(
    (d) => d.state === "paused" || d.state === "queued" || d.state === "failed" || d.state === "waitingForNetwork"
  );
  const canPauseSelected = selectedDownloads.some(
    (d) => d.state === "downloading" || d.state === "probing"
  );

  const handleResumeSelected = async () => {
    for (const d of selectedDownloads) {
      if (d.state === "paused" || d.state === "queued" || d.state === "failed") {
        await api.resume(d.id).catch(() => {});
      }
    }
  };

  const handlePauseSelected = async () => {
    for (const d of selectedDownloads) {
      if (d.state === "downloading" || d.state === "probing") {
        await api.pause(d.id).catch(() => {});
      }
    }
  };

  const handleTogglePauseSelected = async () => {
    if (canPauseSelected) {
      await handlePauseSelected();
    } else if (canResumeSelected) {
      await handleResumeSelected();
    }
  };

  const handleResumeAll = async () => {
    for (const d of Object.values(downloads)) {
      if (d.state === "paused" || d.state === "queued") {
        await api.resume(d.id).catch(() => {});
      }
    }
  };

  const handlePauseAll = async () => {
    for (const d of Object.values(downloads)) {
      if (d.state === "downloading" || d.state === "probing") {
        await api.pause(d.id).catch(() => {});
      }
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    for (const id of Array.from(selectedIds)) {
      await api.remove(id, false).catch(() => {});
    }
    setSelectedIds(new Set());
  };

  const handleShareSelected = () => {
    if (selectedDownloads.length > 0) {
      setShareDownload(selectedDownloads[0]);
    } else {
      const first = Object.values(downloads)[0];
      if (first) setShareDownload(first);
    }
  };

  const handleQuickAdd = (url: string) => {
    const trimmed = url.trim();
    if (settings?.smartNaming !== false) {
      setQuickAddUrl(trimmed);
      try {
        const u = new URL(trimmed);
        const segs = u.pathname.split("/").filter(Boolean);
        if (segs.length > 0) {
          setCapturedMeta((prev) => ({
            ...prev,
            fileName: cleanFileName(decodeURIComponent(segs[segs.length - 1])),
          }));
        }
      } catch {}
    } else {
      setQuickAddUrl(trimmed);
    }
    setIsAddModalOpen(true);
  };

  // Quick video download from the toolbar (quality picked in the Add Url box)
  const handleDownloadVideo = async (
    url: string,
    opts: {
      height?: number;
      fps?: number;
      audioOnly?: boolean;
      saveDir?: string;
      container?: "mp4" | "mkv" | "mp3" | "m4a";
    }
  ) => {
    await api.addDownload({
      url,
      saveDir: opts.saveDir || undefined,
      mediaHeight: opts.height,
      mediaFps: opts.fps,
      mediaAudioOnly: opts.audioOnly,
      convertTo: opts.container && opts.container !== "mp4" ? opts.container : undefined,
    });
    refreshAll();
  };

  // Context Menu Actions
  const handleOpenFolder = (d: DownloadInfo) => {
    const p = d.filePath || d.saveDir;
    api.openFolder(p).catch(() => {});
  };

  const handleOpenFile = (d: DownloadInfo) => {
    if (d.filePath) {
      openChecked(d);
    }
  };

  const handleMoveRename = (d: DownloadInfo) => {
    const newCategory = prompt("Move download to category:", d.category || "Others");
    if (newCategory !== null) {
      api.setDownloadMeta(d.id, newCategory.trim() || null, d.queueId, d.queueOrder).catch(() => {});
    }
  };

  const handleRedownload = async (d: DownloadInfo) => {
    await api.restart(d.id).catch(() => {});
  };

  const handleRefreshAddress = async (d: DownloadInfo) => {
    const newUrl = prompt("Enter refreshed download URL:", d.url);
    if (newUrl && newUrl.trim() && newUrl !== d.url) {
      await api.refreshLink(d.id, newUrl.trim()).catch(() => {});
    }
  };

  const handleGrabUrlFromBrowser = async (d: DownloadInfo) => {
    try {
      const text = await navigator.clipboard.readText().catch(() => "");
      const promptDefault = text && text.startsWith("http") ? text : d.url;
      const grabbedUrl = prompt("Enter or paste refreshed download URL from browser:", promptDefault);
      if (grabbedUrl && grabbedUrl.trim()) {
        await api.refreshLink(d.id, grabbedUrl.trim());
        alert("Download link refreshed successfully!");
      }
    } catch (e: any) {
      alert("Could not refresh link: " + (e?.message || e));
    }
  };

  const handleAddToQueue = async (d: DownloadInfo, qId: string) => {
    await api.moveToQueue(d.id, qId).catch(() => {});
  };

  const handleDeleteFromQueue = async (d: DownloadInfo) => {
    await api.moveToQueue(d.id, "main").catch(() => {});
  };

  const handleDefenderScan = async (d: DownloadInfo) => {
    if (!d.filePath) return;
    try {
      const res = await api.scanFileDefender(d.filePath);
      alert(res);
    } catch (e: any) {
      alert("Virus scan failed: " + (e?.message || e));
    }
  };

  const handleExtractArchive = async (d: DownloadInfo) => {
    if (!d.filePath) return;
    try {
      const res = await api.extractArchive(d.filePath);
      alert(res);
    } catch (e: any) {
      alert("Extraction failed: " + (e?.message || e));
    }
  };

  // Disk Cleaner Execution
  const handleDiskClean = async (targetIds: string[], deleteFiles: boolean) => {
    for (const id of targetIds) {
      await api.remove(id, deleteFiles).catch(() => {});
    }
    await refreshAll();
  };

  const activeProgressDownload = activeProgressModalId ? downloads[activeProgressModalId] : null;

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleWindowDrop}
      className="flex flex-col h-screen w-screen overflow-hidden bg-[var(--bg-app)] text-[var(--text-primary)] font-sans antialiased select-none relative isolate"
    >
      {/* Animated flow-field background (shows through the download list) */}
      <BackgroundLayer kind={settings?.background ?? "flow"} />

      {notice && (
        <div className="dd-anim fixed bottom-16 left-1/2 z-[80] max-w-[90vw] -translate-x-1/2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-4 py-2.5 text-[13px] text-[var(--text-primary)] shadow-2xl">
          {notice}
        </div>
      )}

      {/* 1. Custom Frameless Title Bar */}
      <TitleBar />

      {/* 2. Menu Bar with Dropdowns and Live Search */}
      <MenuBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onOpenAddModal={() => {
          setQuickAddUrl("");
          setIsAddModalOpen(true);
        }}
        onOpenBatchModal={() => setIsBatchModalOpen(true)}
        onOpenSiteGrabber={() => setIsSiteGrabberOpen(true)}
        onOpenImportExport={() => setIsImportOpen(true)}
        onResumeAll={handleResumeAll}
        onPauseAll={handlePauseAll}
        onDeleteSelected={handleDeleteSelected}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenDiskCleaner={() => setIsDiskCleanerOpen(true)}
        onOpenSpeedTest={() => setIsSpeedTestOpen(true)}
        onOpenBandwidth={() => setIsBandwidthOpen(true)}
        onOpenStatistics={() => setIsStatisticsOpen(true)}
        onOpenLicense={() => setIsLicenseModalOpen(true)}
        onOpenUpdate={() => setIsUpdateModalOpen(true)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      {/* Main Container: Sidebar + Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* 3. Left Sidebar */}
        <Sidebar
          currentFilter={filter}
          onSelectFilter={setFilter}
          counts={sidebarCounts}
          saveDir={settings?.defaultDrive || settings?.downloadDir || ""}
          onOpenDiskCleaner={() => setIsDiskCleanerOpen(true)}
        />

        {/* Center Content: Toolbar + Download Table */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* 4. Toolbar */}
          <Toolbar
            onQuickAddUrl={handleQuickAdd}
            onDownloadVideo={handleDownloadVideo}
            onOpenAddModal={() => {
              setQuickAddUrl("");
              setIsAddModalOpen(true);
            }}
            hasSelection={selectedIds.size > 0}
            canResume={canResumeSelected}
            canPause={canPauseSelected}
            onResume={handleResumeSelected}
            onPause={handlePauseSelected}
            onStopAll={handlePauseAll}
            onDelete={handleDeleteSelected}
            onOpenOptions={() => setIsSettingsOpen(true)}
            onOpenQueues={() => setQueueModalTarget("new")}
            onOpenSchedule={() => {
              const mainQ = queues.find((q) => q.id === "main") || queues[0];
              if (mainQ) setQueueModalTarget(mainQ);
            }}
            onShare={handleShareSelected}
          />

          {/* 5. Virtualized Download Table, or the Trusted Sites page */}
          {filter.type === "trusted" ? (
            <TrustedSites onNotice={setNotice} />
          ) : (
          <DownloadTable
            downloads={filteredAndSortedDownloads}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onDoubleClick={handleRowDoubleClick}
            onContextMenu={setContextMenuPos}
            sortField={sortField}
            sortOrder={sortOrder}
            onSort={handleSort}
            allSelected={selectedIds.size === filteredAndSortedDownloads.length && filteredAndSortedDownloads.length > 0}
            onToggleSelectAll={handleToggleSelectAll}
            onPause={(id) => api.pause(id).catch(() => {})}
            onResume={(id) => api.resume(id).catch(() => {})}
            safety={safety}
          />
          )}
        </main>
      </div>

      {/* 7. Footer Bar */}
      <FooterBar
        totalCount={filteredAndSortedDownloads.length}
        selectedCount={selectedIds.size}
        totalDownloadBps={totalDownloadBps}
        totalUploadBps={totalUploadBps}
        onOpenSpeedTest={() => setIsSpeedTestOpen(true)}
        bandwidth={bandwidth}
        onToggleSlowMode={() => api.setSlowMode(!bandwidth?.slowMode).catch((e) => setNotice(typeof e === "string" ? e : e?.message || "Could not change slow mode."))}
        onDownloadAnyway={() => api.setMeteredOverride(true).catch(() => {})}
      />

      {/* 6. Right-Click Context Menu */}
      {contextMenuPos && (
        <ContextMenu
          position={contextMenuPos}
          queues={queues}
          onClose={() => setContextMenuPos(null)}
          onOpen={handleOpenFile}
          onOpenWith={handleOpenFile}
          onOpenFolder={handleOpenFolder}
          onMoveRename={handleMoveRename}
          onRedownload={handleRedownload}
          onResume={(d) => api.resume(d.id)}
          onStop={(d) => api.pause(d.id)}
          onRefreshAddress={handleRefreshAddress}
          onGrabUrlFromBrowser={handleGrabUrlFromBrowser}
          onAddToQueue={handleAddToQueue}
          onDeleteFromQueue={handleDeleteFromQueue}
          onProperties={(d) => setPropertiesDownload(d)}
          onDefenderScan={handleDefenderScan}
          onExtractArchive={handleExtractArchive}
          onShare={(d) => setShareDownload(d)}
        />
      )}

      {/* 8. Download Progress Detail Modal (IDM-style) */}
      {activeProgressDownload && (
        <DownloadProgressModal
          download={activeProgressDownload}
          onClose={() => setActiveProgressModalId(null)}
          onPause={(id) => api.pause(id)}
          onResume={(id) => api.resume(id)}
          onCancel={(id) => api.cancel(id)}
        />
      )}

      {/* 9. Add Download Dialog */}
      {isAddModalOpen && (
        <AddDownloadModal
          onClose={() => {
            setIsAddModalOpen(false);
            setCapturedMeta({});
          }}
          onAdded={refreshAll}
          categories={categories}
          queues={queues}
          defaultDownloadDir={settings?.downloadDir || "C:\\Downloads"}
          initialUrl={quickAddUrl}
          initialFileName={capturedMeta.fileName}
          initialCookies={capturedMeta.cookies}
          initialReferer={capturedMeta.referer}
          initialUserAgent={capturedMeta.userAgent}
        />
      )}

      {/* Batch Download Modal */}
      {isImportOpen && <ImportExportModal onClose={() => setIsImportOpen(false)} onChanged={refreshAll} />}

      {pendingOpen && safety[pendingOpen.id] && (
        <SafetyConfirmModal
          fileName={pendingOpen.fileName}
          report={safety[pendingOpen.id]}
          onOpenAnyway={() => {
            const d = pendingOpen;
            setPendingOpen(null);
            api.openFile(d.filePath).catch(() => {});
          }}
          onShowFolder={() => {
            const d = pendingOpen;
            setPendingOpen(null);
            api.openFolder(d.filePath || d.saveDir).catch(() => {});
          }}
          onClose={() => setPendingOpen(null)}
        />
      )}

      {isBatchModalOpen && (
        <BatchDownloadModal
          onClose={() => setIsBatchModalOpen(false)}
          onAdded={refreshAll}
          categories={categories}
          queues={queues}
          defaultDownloadDir={settings?.downloadDir || "C:\\Downloads"}
        />
      )}

      {/* Site Grabber Modal */}
      {isSiteGrabberOpen && (
        <SiteGrabberModal
          onClose={() => setIsSiteGrabberOpen(false)}
          onAdded={refreshAll}
          defaultDownloadDir={settings?.downloadDir || "C:\\Downloads"}
        />
      )}

      {/* Clipboard Download Confirmation Popup */}
      {clipboardCandidateUrl && (
        <ClipboardPopup
          url={clipboardCandidateUrl}
          onDownload={(url) => {
            if (getVideoSite(url)) {
              // videos: put the link in the Add Url box so the quality picker opens
              window.dispatchEvent(new CustomEvent("flowget-fill-url", { detail: url }));
            } else {
              setQuickAddUrl(url);
              setIsAddModalOpen(true);
            }
            setClipboardCandidateUrl(null);
          }}
          onDismiss={() => setClipboardCandidateUrl(null)}
        />
      )}

      {/* Floating Mini Drop Target */}
      {showDropWidget && (
        <DropTargetWidget onDropUrl={handleQuickAdd} />
      )}

      {/* 10. Premium Card (Bottom-Right, Closable) */}
      {showPremiumCard && !licenseStatus?.isLicensed && (
        <PremiumCard
          onClose={() => setShowPremiumCard(false)}
          onUpgrade={() => setIsLicenseModalOpen(true)}
          onActivateKey={() => setIsLicenseModalOpen(true)}
          daysRemaining={licenseStatus?.daysRemaining ?? 28}
          isExpired={licenseStatus?.isExpired ?? false}
          price="₹999"
        />
      )}

      {/* Disk Cleaner Modal */}
      {isDiskCleanerOpen && (
        <DiskCleanerModal
          downloads={Object.values(downloads)}
          onClose={() => setIsDiskCleanerOpen(false)}
          onClean={handleDiskClean}
          defaultDrive={settings?.defaultDrive ?? ""}
          downloadDir={settings?.downloadDir ?? ""}
          onDefaultChanged={refreshAll}
        />
      )}

      {/* Speed Test Modal */}
      {isSpeedTestOpen && (
        <SpeedTestModal theme={theme} onClose={() => setIsSpeedTestOpen(false)} />
      )}

      {/* Bandwidth Breakdown Modal */}
      {isBandwidthOpen && (
        <BandwidthModal
          downloads={Object.values(downloads)}
          onClose={() => setIsBandwidthOpen(false)}
        />
      )}

      {/* Download Statistics Modal */}
      {isStatisticsOpen && (
        <StatisticsModal
          downloads={Object.values(downloads)}
          onClose={() => setIsStatisticsOpen(false)}
        />
      )}

      {/* Share Modal */}
      {shareDownload && (
        <ShareModal
          download={shareDownload}
          onClose={() => setShareDownload(null)}
        />
      )}

      {/* Properties Modal */}
      {propertiesDownload && (
        <PropertiesModal
          download={propertiesDownload}
          onClose={() => setPropertiesDownload(null)}
          onOpenFolder={handleOpenFolder}
        />
      )}

      {/* Queue Modal */}
      {queueModalTarget && (
        <QueueModal
          queue={queueModalTarget === "new" ? null : queueModalTarget}
          onClose={() => setQueueModalTarget(null)}
          onSave={async (q) => {
            await api.saveQueue(q);
            setQueues((cur) => {
              const idx = cur.findIndex((item) => item.id === q.id);
              if (idx >= 0) {
                const next = [...cur];
                next[idx] = q;
                return next;
              }
              return [...cur, q];
            });
            setQueueModalTarget(null);
          }}
        />
      )}

      {/* Category Modal */}
      {categoryModalTarget && (
        <CategoryModal
          category={categoryModalTarget === "new" ? null : categoryModalTarget}
          defaultDownloadDir={settings?.downloadDir || "C:\\Downloads"}
          onClose={() => setCategoryModalTarget(null)}
          onSave={async (cat) => {
            await api.saveCategory(cat);
            setCategories((cur) => {
              const idx = cur.findIndex((item) => item.id === cat.id);
              if (idx >= 0) {
                const next = [...cur];
                next[idx] = cat;
                return next;
              }
              return [...cur, cat];
            });
            setCategoryModalTarget(null);
          }}
        />
      )}

      {/* Settings Modal */}
      {isSettingsOpen && settings && (
        <SettingsModal
          settings={settings}
          categories={categories}
          adapters={_adapters}
          onSaveCategory={async (cat) => {
            await api.saveCategory(cat);
            setCategories((cur) => cur.map((c) => (c.id === cat.id ? cat : c)));
          }}
          onRefreshSettings={refreshAll}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}

      {/* License Management & Activation Modal */}
      {isLicenseModalOpen && licenseStatus && (
        <LicenseModal
          status={licenseStatus}
          onClose={() => setIsLicenseModalOpen(false)}
          onRefreshStatus={async () => {
            const st = await api.getLicenseStatus();
            setLicenseStatus(st);
          }}
        />
      )}

      {/* Auto-Updater & Changelog Modal */}
      {isUpdateModalOpen && (
        <UpdateModal
          onClose={() => setIsUpdateModalOpen(false)}
        />
      )}
    </div>
  );
}
