import { Select } from "./Select";
import { BACKGROUNDS } from "./BackgroundLayer";
import type { DriveEntry } from "../types";
import { driveTitle } from "../utils/drives";
import { getLiquidImage, setLiquidImage, fileToLiquidDataUrl, liquidImageFromDrop } from "../utils/liquidImage";
import { ModalCorner } from "./NotchCorner";
import { useEffect, useState } from "react";
import {
  Settings as SettingsIcon,
  Folder,
  Shield,
  Zap,
  Globe,
  Save,
  Check,
  Sparkles,
  Battery,
  Play,
  Clock,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { BandwidthPanel, SafetyPanel, ToolsPanel } from "./SettingsAdvanced";
import { api } from "../api";
import { setLanguage as updateI18nLanguage } from "../i18n";
import type { AdapterInfo, Category, Settings } from "../types";

interface Props {
  settings: Settings;
  categories: Category[];
  adapters: AdapterInfo[];
  onSaveCategory: (cat: Category) => Promise<void>;
  onRefreshSettings: () => Promise<void>;
  onClose: () => void;
}

type TabType = "general" | "connection" | "proxy" | "categories" | "automation" | "smartFeatures" | "bandwidth" | "safety" | "tools";

export default function SettingsModal({
  settings,
  categories,
  adapters,
  onSaveCategory,
  onRefreshSettings,
  onClose,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabType>("general");

  // General tab
  const [downloadDir, setDownloadDir] = useState(settings.downloadDir);
  const [startWithWindows, setStartWithWindows] = useState(settings.startWithWindows);
  const [language, setLanguage] = useState(settings.language || "en");
  const [theme, setTheme] = useState(settings.theme || "dark");

  // Connection tab
  const [defaultConnections, setDefaultConnections] = useState(settings.defaultConnections);
  const [globalSpeedLimitMb, setGlobalSpeedLimitMb] = useState(
    settings.globalSpeedLimit ? String(settings.globalSpeedLimit / (1024 * 1024)) : "",
  );
  const [turboMode, setTurboMode] = useState(settings.turboMode);

  // Proxy tab
  const [proxy, setProxy] = useState(settings.proxy || "");

  // Categories folder map
  const [catFolders, setCatFolders] = useState<Record<string, string>>(() =>
    Object.fromEntries(categories.map((c) => [c.id, c.defaultFolder])),
  );

  // File types tab

  // Automation tab
  const [autoExtract, setAutoExtract] = useState(settings.autoExtract);
  const [virusScan, setVirusScan] = useState(settings.virusScan);
  const [openFolderOnComplete, setOpenFolderOnComplete] = useState(settings.openFolderOnComplete);

  // Smart Features tab (Phase 7)
  const [batterySaver, setBatterySaver] = useState(settings.batterySaver ?? true);
  const [smartNaming, setSmartNaming] = useState(settings.smartNaming ?? true);
  const [resumeOnStart, setResumeOnStart] = useState(settings.resumeOnStart ?? true);
  const [clipboardMonitor, setClipboardMonitor] = useState(settings.clipboardMonitor ?? true);
  const [background, setBackground] = useState(settings.background ?? "flow");
  const [defaultDrive, setDefaultDrive] = useState(settings.defaultDrive ?? "");
  const [drives, setDrives] = useState<DriveEntry[]>([]);
  useEffect(() => {
    api.listDrives().then((list) => setDrives(Array.isArray(list) ? list : [])).catch(() => setDrives([]));
  }, []);
  const [liquidImage, setLiquidImageState] = useState<string | null>(() => getLiquidImage());
  const [liquidError, setLiquidError] = useState("");

  const [draggingImage, setDraggingImage] = useState(false);

  /** A picture dropped anywhere on this dialog becomes the liquid background right away (never a download). */
  const dropLiquidImage = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation(); // the window must not treat it as a download link
    setDraggingImage(false);
    const result = await liquidImageFromDrop(e.dataTransfer, true);
    if (!result) return;
    if ("error" in result) {
      setLiquidError(result.error);
      return;
    }
    setLiquidError("");
    setLiquidImage(result.dataUrl);
    setLiquidImageState(result.dataUrl);
    setBackground("liquid");
    try {
      await api.setSetting("background", "liquid");
      await onRefreshSettings();
    } catch {
      /* the choice is still applied when Save Settings is pressed */
    }
  };

  const chooseLiquidImage = async (file: File | undefined) => {
    if (!file) return;
    setLiquidError("");
    try {
      const url = await fileToLiquidDataUrl(file);
      setLiquidImage(url);
      setLiquidImageState(url);
    } catch (e) {
      setLiquidError((e as Error).message);
    }
  };

  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSaveAll = async () => {
    setSaving(true);
    setError(null);
    try {
      // 1. Save settings in DB
      await api.setSetting("download_dir", downloadDir);
      await api.setSetting("language", language);
      await api.setSetting("theme", theme);
      await api.setSetting("proxy", proxy.trim());
      await api.setSetting("auto_extract", autoExtract ? "1" : "0");
      await api.setSetting("virus_scan", virusScan ? "1" : "0");
      await api.setSetting("open_folder_on_complete", openFolderOnComplete ? "1" : "0");

      // Smart Features (Phase 7)
      await api.setSetting("battery_saver", batterySaver ? "1" : "0");
      await api.setSetting("smart_naming", smartNaming ? "1" : "0");
      await api.setSetting("resume_on_start", resumeOnStart ? "1" : "0");
      await api.setSetting("clipboard_monitor", clipboardMonitor ? "1" : "0");
      await api.setSetting("background", background);
      await api.setSetting("default_drive", defaultDrive);

      // Update active i18n
      updateI18nLanguage(language as any);

      // 2. Start with Windows
      await api.setStartWithWindows(startWithWindows);

      // 3. Engine settings
      await api.setDefaultConnections(defaultConnections);
      const limitMb = parseFloat(globalSpeedLimitMb);
      await api.setSpeedLimit(null, Number.isFinite(limitMb) && limitMb > 0 ? Math.round(limitMb * 1024 * 1024) : 0);
      await api.setTurboMode(turboMode);

      // 4. Update category folders
      for (const cat of categories) {
        const newFolder = catFolders[cat.id];
        if (newFolder && newFolder !== cat.defaultFolder) {
          await onSaveCategory({ ...cat, defaultFolder: newFolder });
        }
      }

      await onRefreshSettings();
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2000);
    } catch (e) {
      setError(typeof e === "string" ? e : (e as Error).message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs select-none">
      <div
        onDragEnter={(e) => { e.preventDefault(); setDraggingImage(true); }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDraggingImage(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDraggingImage(false); }}
        onDrop={(e) => void dropLiquidImage(e)}
        className="notch-card flex h-[560px] w-full max-w-2xl flex-col border border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-2xl text-xs text-[var(--text-secondary)] overflow-hidden"
      >
        {draggingImage && (
          <div className="pointer-events-none absolute inset-0 z-40 flex flex-col items-center justify-center gap-2 border-2 border-dashed border-purple-400 bg-[var(--bg-panel)]/90 text-purple-300">
            <span className="text-base font-semibold">Drop the image here</span>
            <span className="text-[12px] text-[var(--text-secondary)]">It becomes your Liquid background</span>
          </div>
        )}
        <ModalCorner onClose={onClose} />
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-3.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <SettingsIcon size={16} className="text-sky-400" />
            <span>FlowGet Settings</span>
          </div>
        </div>

        {/* Content body with side tabs */}
        <div className="flex flex-1 overflow-hidden">
          {/* Tabs sidebar */}
          <div className="w-44 border-r border-[var(--border-subtle)] bg-[var(--bg-card)] p-2 space-y-1">
            <button
              onClick={() => setActiveTab("general")}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                activeTab === "general" ? "bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium shadow-xs" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <Folder size={17} /> General
            </button>
            <button
              onClick={() => setActiveTab("connection")}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                activeTab === "connection" ? "bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium shadow-xs" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <Zap size={17} /> Connection
            </button>
            <button
              onClick={() => setActiveTab("proxy")}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                activeTab === "proxy" ? "bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium shadow-xs" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <Globe size={17} /> Proxy
            </button>
            <button
              onClick={() => setActiveTab("categories")}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                activeTab === "categories" ? "bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium shadow-xs" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <Folder size={17} /> Default Folders
            </button>
            <button
              onClick={() => setActiveTab("automation")}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                activeTab === "automation" ? "bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium shadow-xs" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <Shield size={17} /> After Download
            </button>
            <button
              onClick={() => setActiveTab("smartFeatures")}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                activeTab === "smartFeatures" ? "bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium shadow-xs" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <Sparkles size={17} className="text-purple-400" /> Smart Features
            </button>
            <button
              onClick={() => setActiveTab("bandwidth")}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                activeTab === "bandwidth" ? "bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium shadow-xs" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <Clock size={17} /> Bandwidth
            </button>
            <button
              onClick={() => setActiveTab("safety")}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                activeTab === "safety" ? "bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium shadow-xs" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <ShieldCheck size={17} /> Safety
            </button>
            <button
              onClick={() => setActiveTab("tools")}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                activeTab === "tools" ? "bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium shadow-xs" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <Wrench size={17} /> Video Tools
            </button>
          </div>

          {/* Tab Content Panel */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-200">
                {error}
              </div>
            )}

            {/* General Tab */}
            {activeTab === "general" && (
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block font-medium text-[var(--text-secondary)]">Default Download Directory</label>
                  <input
                    type="text"
                    value={downloadDir}
                    onChange={(e) => setDownloadDir(e.target.value)}
                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-[var(--text-primary)] outline-none focus:border-sky-500 transition font-mono text-[11px]"
                  />
                  <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                    Base folder where newly created downloads are saved unless a category override applies.
                  </p>
                </div>

                <div className="pt-2 border-t border-[var(--border-subtle)]">
                  <label className="flex items-center gap-2 font-medium text-[var(--text-secondary)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={startWithWindows}
                      onChange={(e) => setStartWithWindows(e.target.checked)}
                      className="rounded border-[var(--text-disabled)] text-sky-500"
                    />
                    <span>Launch FlowGet on Windows startup</span>
                  </label>
                  <p className="pl-6 text-[11px] text-[var(--text-secondary)]">
                    Registers FlowGet into Windows user logon registry for background downloads and scheduled tasks.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[var(--border-subtle)]">
                  <div>
                    <label className="mb-1 block font-medium text-[var(--text-secondary)]">Language</label>
                    <Select
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-[var(--text-primary)] outline-none focus:border-sky-500"
                    >
                      <option value="en">English (US)</option>
                      <option value="hi">हिन्दी (Hindi)</option>
                      <option value="gu">ગુજરાતી (Gujarati)</option>
                      <option value="es">Español</option>
                      <option value="fr">Français</option>
                      <option value="de">Deutsch</option>
                      <option value="zh">中文 (Chinese)</option>
                    </Select>
                  </div>
                  <div>
                    <label className="mb-1 block font-medium text-[var(--text-secondary)]">Theme</label>
                    <Select
                      value={theme}
                      onChange={(e) => setTheme(e.target.value)}
                      className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-[var(--text-primary)] outline-none focus:border-sky-500"
                    >
                      <option value="dark">Dark Theme (IDM Modern)</option>
                      <option value="light">Light Theme</option>
                      <option value="system">System Default</option>
                    </Select>
                  </div>
                </div>

                {drives.length > 0 && (
                  <div>
                    <label className="mb-1 block font-medium text-[var(--text-secondary)]">Default disk</label>
                    <Select
                      value={defaultDrive}
                      onChange={(e) => setDefaultDrive(e.target.value)}
                      className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-[var(--text-primary)] outline-none focus:border-sky-500"
                    >
                      <option value="">Same disk as the download folder</option>
                      {drives.map((d) => (
                        <option key={d.name} value={d.name}>
                          {driveTitle(d)}
                        </option>
                      ))}
                    </Select>
                    <p className="mt-1 text-[11px] font-normal text-[var(--text-secondary)]">
                      The Disk Space card shows this disk, and Disk Cleaner opens on it.
                    </p>
                  </div>
                )}

                <div>
                  <label className="mb-1 block font-medium text-[var(--text-secondary)]">Animated background</label>
                  <Select
                    value={background}
                    onChange={(e) => setBackground(e.target.value)}
                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-[var(--text-primary)] outline-none focus:border-sky-500"
                  >
                    {BACKGROUNDS.map((b) => (
                      <option key={b.value} value={b.value}>
                        {b.label}
                      </option>
                    ))}
                  </Select>
                  <p className="mt-1 text-[11px] font-normal text-[var(--text-secondary)]">
                    Shown behind the download list. Pick None for a plain background (uses less battery).
                  </p>

                  {background === "liquid" && (
                    <div className="relative mt-3 flex items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
                      <div
                        className="h-12 w-12 flex-shrink-0 rounded-lg border border-[var(--border-subtle)] bg-cover bg-center"
                        style={liquidImage ? { backgroundImage: `url(${liquidImage})` } : { background: "#B2D959" }}
                        aria-label="Liquid image preview"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-[var(--text-primary)]">Liquid image</div>
                        <div className="text-[11px] font-normal text-[var(--text-secondary)]">
                          {liquidImage ? "Your picture shapes the liquid surface." : "Using the built-in picture. Choose your own, or drag an image onto this window."}
                        </div>
                        {liquidError && <div className="text-[11px] text-rose-400">{liquidError}</div>}
                      </div>
                      <label className="cursor-pointer rounded-lg gradient-accent px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90">
                        Choose image
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            void chooseLiquidImage(e.target.files?.[0]);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      {liquidImage && (
                        <button
                          type="button"
                          onClick={() => {
                            setLiquidImage(null);
                            setLiquidImageState(null);
                          }}
                          className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Connection Tab */}
            {activeTab === "connection" && (
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="font-medium text-[var(--text-secondary)]">Default Connections per Download</label>
                    <span className="font-mono text-sky-400 font-semibold">{defaultConnections} connections</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={32}
                    value={defaultConnections}
                    onChange={(e) => setDefaultConnections(parseInt(e.target.value, 10))}
                    className="w-full accent-sky-500"
                  />
                  <div className="flex justify-between text-[10px] text-[var(--text-secondary)] mt-0.5">
                    <span>1 connection (safe)</span>
                    <span>8 (recommended)</span>
                    <span>32 (maximum acceleration)</span>
                  </div>
                </div>

                <div className="pt-2 border-t border-[var(--border-subtle)]">
                  <label className="mb-1 block font-medium text-[var(--text-secondary)]">Global Speed Limiter (MB/s)</label>
                  <input
                    type="text"
                    value={globalSpeedLimitMb}
                    onChange={(e) => setGlobalSpeedLimitMb(e.target.value)}
                    placeholder="Unlimited (empty or 0)"
                    className="w-48 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-[var(--text-primary)] outline-none focus:border-sky-500"
                  />
                  <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                    Limits bandwidth across all concurrent downloads combined.
                  </p>
                </div>

                <div className="pt-2 border-t border-[var(--border-subtle)]">
                  <label className="flex items-center gap-2 font-medium text-[var(--text-secondary)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={turboMode}
                      onChange={(e) => setTurboMode(e.target.checked)}
                      className="rounded border-[var(--text-disabled)] text-sky-500"
                    />
                    <span>Turbo Mode (Multi-Network Bonding)</span>
                  </label>
                  <p className="pl-6 text-[11px] text-[var(--text-secondary)]">
                    Aggregates Wi-Fi, Ethernet, and Mobile Hotspot simultaneously to achieve combined download speeds.
                  </p>
                  <div className="mt-2 pl-6 space-y-1">
                    <div className="text-[11px] text-[var(--text-secondary)]">Available network adapters:</div>
                    {adapters.map((a) => (
                      <div key={a.id} className="text-[11px] text-[var(--text-secondary)] font-mono">
                        • {a.name} ({a.kind.toUpperCase()}) - {a.ip}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Proxy Tab */}
            {activeTab === "proxy" && (
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block font-medium text-[var(--text-secondary)]">Proxy Address (HTTP / SOCKS5)</label>
                  <input
                    type="text"
                    value={proxy}
                    onChange={(e) => setProxy(e.target.value)}
                    placeholder="http://127.0.0.1:8080 or socks5://user:pass@127.0.0.1:1080"
                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-[var(--text-primary)] font-mono text-[11px] outline-none focus:border-sky-500"
                  />
                  <p className="mt-1.5 text-[11px] text-[var(--text-secondary)] leading-relaxed">
                    Leave blank to use direct internet connection without proxy. Supports HTTP, HTTPS, and SOCKS5 proxy servers with optional embedded credentials.
                  </p>
                </div>

                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3 text-[11px] text-[var(--text-secondary)] space-y-1">
                  <div className="font-medium text-[var(--text-secondary)]">Examples:</div>
                  <div>• HTTP Proxy: <code className="text-sky-300">http://192.168.1.100:8080</code></div>
                  <div>• SOCKS5 Proxy: <code className="text-sky-300">socks5://127.0.0.1:1080</code></div>
                  <div>• Authenticated: <code className="text-sky-300">socks5://user:password@proxy.corp.com:1080</code></div>
                </div>
              </div>
            )}

            {/* Categories Folders Tab */}
            {activeTab === "categories" && (
              <div className="space-y-3">
                <p className="text-[11px] text-[var(--text-secondary)]">
                  Each category automatically routes downloads to its own dedicated save folder.
                </p>

                <div className="space-y-2.5">
                  {categories.map((c) => (
                    <div key={c.id} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-[var(--text-primary)]">{c.name}</span>
                        <span className="text-[10px] text-[var(--text-secondary)] font-mono truncate max-w-xs">
                          {c.extensions.slice(0, 8).join(", ")}
                          {c.extensions.length > 8 ? "..." : ""}
                        </span>
                      </div>
                      <input
                        type="text"
                        value={catFolders[c.id] || ""}
                        onChange={(e) =>
                          setCatFolders({ ...catFolders, [c.id]: e.target.value })
                        }
                        className="w-full rounded border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2.5 py-1 text-[11px] font-mono text-[var(--text-secondary)] outline-none focus:border-sky-500"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Automation Tab */}
            {activeTab === "automation" && (
              <div className="space-y-4">
                <div className="space-y-3">
                  <label className="flex items-start gap-2.5 font-medium text-[var(--text-secondary)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoExtract}
                      onChange={(e) => setAutoExtract(e.target.checked)}
                      className="mt-0.5 rounded border-[var(--text-disabled)] text-sky-500"
                    />
                    <div>
                      <div>Auto-extract archives upon download completion</div>
                      <p className="text-[11px] font-normal text-[var(--text-secondary)]">
                        Automatically unpacks ZIP, RAR, 7Z, TAR, and GZ archives into subfolders named after the file.
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 font-medium text-[var(--text-secondary)] cursor-pointer pt-2 border-t border-[var(--border-subtle)]">
                    <input
                      type="checkbox"
                      checked={virusScan}
                      onChange={(e) => setVirusScan(e.target.checked)}
                      className="mt-0.5 rounded border-[var(--text-disabled)] text-sky-500"
                    />
                    <div>
                      <div>Scan downloaded files with Windows Defender</div>
                      <p className="text-[11px] font-normal text-[var(--text-secondary)]">
                        Invokes Microsoft Windows Defender command-line scanner (MpCmdRun.exe) immediately upon file verification.
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 font-medium text-[var(--text-secondary)] cursor-pointer pt-2 border-t border-[var(--border-subtle)]">
                    <input
                      type="checkbox"
                      checked={openFolderOnComplete}
                      onChange={(e) => setOpenFolderOnComplete(e.target.checked)}
                      className="mt-0.5 rounded border-[var(--text-disabled)] text-sky-500"
                    />
                    <div>
                      <div>Open folder upon download completion</div>
                      <p className="text-[11px] font-normal text-[var(--text-secondary)]">
                        Reveals the completed file highlighted in Windows File Explorer.
                      </p>
                    </div>
                  </label>
                </div>
              </div>
            )}

            {activeTab === "bandwidth" && <BandwidthPanel />}
            {activeTab === "safety" && <SafetyPanel />}
            {activeTab === "tools" && <ToolsPanel />}

            {/* Smart Features Tab (Phase 7) */}
            {activeTab === "smartFeatures" && (
              <div className="space-y-4">
                <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-3 flex items-center gap-3">
                  <Sparkles className="w-5 h-5 text-purple-400 flex-shrink-0" />
                  <div>
                    <h4 className="font-semibold text-[var(--text-primary)]">Next-Generation Features</h4>
                    <p className="text-[11px] text-[var(--text-secondary)]">
                      Features and intelligence capabilities designed beyond traditional download managers.
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  {/* Resume on restart */}
                  <label className="flex items-start gap-2.5 font-medium text-[var(--text-secondary)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={resumeOnStart}
                      onChange={(e) => setResumeOnStart(e.target.checked)}
                      className="mt-0.5 rounded border-[var(--text-disabled)] text-purple-500"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <Play size={20} className="text-sky-400" />
                        <span>Resume paused downloads on restart</span>
                      </div>
                      <p className="text-[11px] font-normal text-[var(--text-secondary)]">
                        Downloads that were running when FlowGet closed (or the PC restarted or crashed) continue by themselves the next time FlowGet starts. Downloads you paused yourself stay paused.
                      </p>
                    </div>
                  </label>

                  {/* Battery Saver */}
                  <label className="flex items-start gap-2.5 font-medium text-[var(--text-secondary)] cursor-pointer pt-2 border-t border-[var(--border-subtle)]">
                    <input
                      type="checkbox"
                      checked={batterySaver}
                      onChange={(e) => setBatterySaver(e.target.checked)}
                      className="mt-0.5 rounded border-[var(--text-disabled)] text-purple-500"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <Battery size={20} className="text-emerald-400" />
                        <span>Battery-Saver Mode (Laptop)</span>
                      </div>
                      <p className="text-[11px] font-normal text-[var(--text-secondary)]">
                        Automatically pauses heavy active downloads when your laptop battery drops below 20% to prevent unexpected shutdown.
                      </p>
                    </div>
                  </label>

                  {/* Clipboard link detection */}
                  <label className="flex items-start gap-2.5 font-medium text-[var(--text-secondary)] cursor-pointer pt-2 border-t border-[var(--border-subtle)]">
                    <input
                      type="checkbox"
                      checked={clipboardMonitor}
                      onChange={(e) => setClipboardMonitor(e.target.checked)}
                      className="mt-0.5 rounded border-[var(--text-disabled)] text-purple-500"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <Sparkles size={20} className="text-purple-400" />
                        <span>Detect copied download links</span>
                      </div>
                      <p className="text-[11px] font-normal text-[var(--text-secondary)]">
                        When you copy a file, video (YouTube, ...) or magnet link anywhere, FlowGet comes forward and offers to download it.
                      </p>
                    </div>
                  </label>

                  {/* Smart Naming */}
                  <label className="flex items-start gap-2.5 font-medium text-[var(--text-secondary)] cursor-pointer pt-2 border-t border-[var(--border-subtle)]">
                    <input
                      type="checkbox"
                      checked={smartNaming}
                      onChange={(e) => setSmartNaming(e.target.checked)}
                      className="mt-0.5 rounded border-[var(--text-disabled)] text-purple-500"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <Sparkles size={20} className="text-purple-400" />
                        <span>Smart Naming</span>
                      </div>
                      <p className="text-[11px] font-normal text-[var(--text-secondary)]">
                        Cleans messy URL characters (%20), tracking query parameters (?utm_source=...), and random generated hash strings automatically.
                      </p>
                    </div>
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--border-subtle)] px-5 py-3 bg-[var(--bg-card)]">
          <div>
            {savedSuccess && (
              <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                <Check size={14} /> Settings saved successfully
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition"
            >
              Close
            </button>
            <button
              onClick={handleSaveAll}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-5 py-1.5 font-medium text-black hover:bg-sky-400 transition shadow-sm disabled:opacity-50"
            >
              <Save size={14} />
              <span>{saving ? "Saving..." : "Save Settings"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
