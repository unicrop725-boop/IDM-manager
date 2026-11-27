import React, { useState, useRef, useEffect } from "react";
import { t } from "../i18n";
import { ThemeToggle } from "./ThemeToggle";
import { Plus, Play, Pause, Trash2, FolderOpen, HardDrive, Gauge, Settings, Info, Sun, Moon, Layers, Globe, BarChart3, Activity, Upload, Key, RefreshCw } from "lucide-react";

interface MenuBarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onOpenAddModal: () => void;
  onOpenBatchModal?: () => void;
  onOpenSiteGrabber?: () => void;
  onOpenImportExport?: () => void;
  onResumeAll: () => void;
  onPauseAll: () => void;
  onDeleteSelected: () => void;
  onOpenSettings: () => void;
  onOpenDiskCleaner: () => void;
  onOpenSpeedTest: () => void;
  onOpenBandwidth?: () => void;
  onOpenStatistics?: () => void;
  onOpenLicense?: () => void;
  onOpenUpdate?: () => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
}

export const MenuBar: React.FC<MenuBarProps> = ({
  searchQuery,
  onSearchChange,
  onOpenAddModal,
  onOpenBatchModal,
  onOpenSiteGrabber,
  onOpenImportExport,
  onResumeAll,
  onPauseAll,
  onDeleteSelected,
  onOpenSettings,
  onOpenDiskCleaner,
  onOpenSpeedTest,
  onOpenBandwidth,
  onOpenStatistics,
  onOpenLicense,
  onOpenUpdate,
  theme,
  onToggleTheme,
}) => {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActiveMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleMenu = (menuName: string) => {
    setActiveMenu(activeMenu === menuName ? null : menuName);
  };

  return (
    <div
      ref={menuRef}
      className="h-14 w-full flex items-center justify-between px-5 grad-bar-down select-none text-[13px] text-[var(--text-secondary)] z-40"
    >
      {/* Menus List */}
      <div className="flex items-center gap-3 max-[720px]:gap-0">
        {/* Tasks */}
        <div className="relative">
          <button
            onClick={() => toggleMenu("Tasks")}
            className={`px-3 py-1.5 rounded-lg transition-colors hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] ${
              activeMenu === "Tasks" ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : ""
            }`}
          >
            {t("tasks", "Tasks")}
          </button>
          {activeMenu === "Tasks" && (
            <div className="dd-anim absolute left-0 mt-1 w-48 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-2xl py-1 z-50 animate-in fade-in zoom-in-95 duration-150">
              <button
                onClick={() => {
                  onOpenAddModal();
                  setActiveMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] flex items-center gap-2 text-[var(--text-primary)]"
              >
                <Plus className="w-3.5 h-3.5 text-purple-400" />
                <span>Add URL...</span>
                <span className="ml-auto text-[10px] text-[var(--text-disabled)]">Ctrl+N</span>
              </button>
              {onOpenBatchModal && (
                <button
                  onClick={() => {
                    onOpenBatchModal();
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] flex items-center gap-2 text-[var(--text-primary)]"
                >
                  <Layers className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Batch Download...</span>
                </button>
              )}
              {onOpenSiteGrabber && (
                <button
                  onClick={() => {
                    onOpenSiteGrabber();
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] flex items-center gap-2 text-[var(--text-primary)]"
                >
                  <Globe className="w-3.5 h-3.5 text-teal-400" />
                  <span>Site Grabber...</span>
                </button>
              )}
              {onOpenImportExport && (
                <button
                  onClick={() => {
                    onOpenImportExport();
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] flex items-center gap-2 text-[var(--text-primary)]"
                >
                  <Upload className="w-3.5 h-3.5 text-sky-400" />
                  <span>Import &amp; Backup...</span>
                </button>
              )}
              <button
                onClick={() => {
                  onResumeAll();
                  setActiveMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] flex items-center gap-2 text-[var(--text-primary)]"
              >
                <Play className="w-3.5 h-3.5 text-emerald-400" />
                <span>Resume All</span>
              </button>
              <button
                onClick={() => {
                  onPauseAll();
                  setActiveMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] flex items-center gap-2 text-[var(--text-primary)]"
              >
                <Pause className="w-3.5 h-3.5 text-amber-400" />
                <span>Stop All</span>
              </button>
              <div className="h-[1px] bg-[var(--border-subtle)] my-1" />
              <button
                onClick={() => {
                  onOpenSettings();
                  setActiveMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] flex items-center gap-2 text-[var(--text-primary)]"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Options...</span>
              </button>
            </div>
          )}
        </div>

        {/* File */}
        <div className="relative">
          <button
            onClick={() => toggleMenu("File")}
            className={`px-3 py-1.5 rounded-lg transition-colors hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] ${
              activeMenu === "File" ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : ""
            }`}
          >
            {t("file", "File")}
          </button>
          {activeMenu === "File" && (
            <div className="dd-anim absolute left-0 mt-1 w-52 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-2xl py-1 z-50">
              <button
                onClick={() => {
                  onOpenDiskCleaner();
                  setActiveMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] flex items-center gap-2 text-[var(--text-primary)]"
              >
                <HardDrive className="w-3.5 h-3.5 text-teal-400" />
                <span>Disk Cleaner</span>
              </button>
              <button
                onClick={() => {
                  window.dispatchEvent(new CustomEvent("open-downloads-folder"));
                  setActiveMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] flex items-center gap-2 text-[var(--text-primary)]"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Open Downloads Folder</span>
              </button>
            </div>
          )}
        </div>

        {/* Downloads */}
        <div className="relative">
          <button
            onClick={() => toggleMenu("Downloads")}
            className={`px-3 py-1.5 rounded-lg transition-colors hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] ${
              activeMenu === "Downloads" ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : ""
            }`}
          >
            {t("downloads", "Downloads")}
          </button>
          {activeMenu === "Downloads" && (
            <div className="dd-anim absolute left-0 mt-1 w-48 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-2xl py-1 z-50">
              <button
                onClick={() => {
                  onDeleteSelected();
                  setActiveMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] flex items-center gap-2 text-rose-400"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Selected</span>
                <span className="ml-auto text-[10px] text-[var(--text-disabled)]">Del</span>
              </button>
              <div className="h-[1px] bg-[var(--border-subtle)] my-1" />
              <button
                onClick={() => {
                  onOpenSpeedTest();
                  setActiveMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] flex items-center gap-2 text-[var(--text-primary)]"
              >
                <Gauge className="w-3.5 h-3.5 text-teal-400" />
                <span>Speed Test</span>
              </button>
              {onOpenStatistics && (
                <button
                  onClick={() => {
                    onOpenStatistics();
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] flex items-center gap-2 text-[var(--text-primary)]"
                >
                  <BarChart3 className="w-3.5 h-3.5 text-purple-400" />
                  <span>Download Statistics</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* View */}
        <div className="relative">
          <button
            onClick={() => toggleMenu("View")}
            className={`px-3 py-1.5 rounded-lg transition-colors hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] ${
              activeMenu === "View" ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : ""
            }`}
          >
            {t("view", "View")}
          </button>
          {activeMenu === "View" && (
            <div className="dd-anim absolute left-0 mt-1 w-48 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-2xl py-1 z-50">
              <button
                onClick={() => {
                  onToggleTheme();
                  setActiveMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] flex items-center gap-2 text-[var(--text-primary)]"
              >
                {theme === "dark" ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-purple-400" />}
                <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>
              </button>
              {onOpenBandwidth && (
                <button
                  onClick={() => {
                    onOpenBandwidth();
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] flex items-center gap-2 text-[var(--text-primary)]"
                >
                  <Activity className="w-3.5 h-3.5 text-blue-400" />
                  <span>Bandwidth Usage</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Help */}
        <div className="relative">
          <button
            onClick={() => toggleMenu("Help")}
            className={`px-3 py-1.5 rounded-lg transition-colors hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] ${
              activeMenu === "Help" ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : ""
            }`}
          >
            {t("help", "Help")}
          </button>
          {activeMenu === "Help" && (
            <div className="dd-anim absolute left-0 mt-1 w-52 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-2xl py-1 z-50">
              {onOpenUpdate && (
                <button
                  onClick={() => {
                    onOpenUpdate();
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] flex items-center gap-2 text-[var(--text-primary)]"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-teal-400" />
                  <span>Check for Updates...</span>
                </button>
              )}
              {onOpenLicense && (
                <button
                  onClick={() => {
                    onOpenLicense();
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] flex items-center gap-2 text-[var(--text-primary)]"
                >
                  <Key className="w-3.5 h-3.5 text-purple-400" />
                  <span>Activate License...</span>
                </button>
              )}
              <div className="h-[1px] bg-[var(--border-subtle)] my-1" />
              <button
                onClick={() => {
                  alert("BoltGrab 1.0 - Next-Gen High Performance Download Manager\nBuilt with Rust, Tauri 2, and React.\nLifetime Pro license.");
                  setActiveMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] flex items-center gap-2 text-[var(--text-primary)]"
              >
                <Info className="w-3.5 h-3.5 text-indigo-400" />
                <span>About BoltGrab</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Right: Theme Toggle + Rounded Search Box */}
      <div className="flex items-center gap-3 max-[720px]:gap-1 min-w-0">
        <div className="max-[480px]:hidden">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </div>
      <div className="fancy-field relative w-[290px] max-[720px]:w-40 max-[480px]:w-28 h-10 min-w-0">
        <svg
          className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 fill-[var(--text-secondary)] pointer-events-none"
          aria-hidden="true"
          viewBox="0 0 24 24"
        >
          <path d="M21.53 20.47l-3.66-3.66C19.195 15.24 20 13.214 20 11c0-4.97-4.03-9-9-9s-9 4.03-9 9 4.03 9 9 9c2.215 0 4.24-.804 5.808-2.13l3.66 3.66c.147.146.34.22.53.22s.385-.073.53-.22c.295-.293.295-.767.002-1.06zM3.5 11c0-4.135 3.365-7.5 7.5-7.5s7.5 3.365 7.5 7.5-3.365 7.5-7.5 7.5-7.5-3.365-7.5-7.5z" />
        </svg>
        <input
          id="global-search-input"
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t("search_placeholder", "Search in the List")}
          className="fancy-input"
        />
      </div>
      </div>
    </div>
  );
};
