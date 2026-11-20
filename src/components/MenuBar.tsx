import React, { useState, useRef, useEffect } from "react";
import { Search, Plus, Play, Pause, Trash2, FolderOpen, HardDrive, Gauge, Settings, Info, Sun, Moon, Layers, Globe, Smartphone, BarChart3, Activity, Key, RefreshCw } from "lucide-react";

interface MenuBarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onOpenAddModal: () => void;
  onOpenBatchModal?: () => void;
  onOpenSiteGrabber?: () => void;
  onResumeAll: () => void;
  onPauseAll: () => void;
  onDeleteSelected: () => void;
  onOpenSettings: () => void;
  onOpenDiskCleaner: () => void;
  onOpenSpeedTest: () => void;
  onOpenBandwidth?: () => void;
  onOpenMobileSharing?: () => void;
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
  onResumeAll,
  onPauseAll,
  onDeleteSelected,
  onOpenSettings,
  onOpenDiskCleaner,
  onOpenSpeedTest,
  onOpenBandwidth,
  onOpenMobileSharing,
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
      className="h-10 w-full flex items-center justify-between px-3 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] select-none text-xs text-[var(--text-secondary)] z-40"
    >
      {/* Menus List */}
      <div className="flex items-center gap-1">
        {/* Tasks */}
        <div className="relative">
          <button
            onClick={() => toggleMenu("Tasks")}
            className={`px-2.5 py-1 rounded-md transition-colors hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] ${
              activeMenu === "Tasks" ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : ""
            }`}
          >
            Tasks
          </button>
          {activeMenu === "Tasks" && (
            <div className="absolute left-0 mt-1 w-48 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-2xl py-1 z-50 animate-in fade-in zoom-in-95 duration-150">
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
              {onOpenMobileSharing && (
                <button
                  onClick={() => {
                    onOpenMobileSharing();
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] flex items-center gap-2 text-[var(--text-primary)]"
                >
                  <Smartphone className="w-3.5 h-3.5 text-teal-400" />
                  <span>Mobile Link Sharing...</span>
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
            className={`px-2.5 py-1 rounded-md transition-colors hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] ${
              activeMenu === "File" ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : ""
            }`}
          >
            File
          </button>
          {activeMenu === "File" && (
            <div className="absolute left-0 mt-1 w-52 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-2xl py-1 z-50">
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
            className={`px-2.5 py-1 rounded-md transition-colors hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] ${
              activeMenu === "Downloads" ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : ""
            }`}
          >
            Downloads
          </button>
          {activeMenu === "Downloads" && (
            <div className="absolute left-0 mt-1 w-48 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-2xl py-1 z-50">
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
            className={`px-2.5 py-1 rounded-md transition-colors hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] ${
              activeMenu === "View" ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : ""
            }`}
          >
            View
          </button>
          {activeMenu === "View" && (
            <div className="absolute left-0 mt-1 w-48 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-2xl py-1 z-50">
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
                  <span>Per-App Bandwidth</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Help */}
        <div className="relative">
          <button
            onClick={() => toggleMenu("Help")}
            className={`px-2.5 py-1 rounded-md transition-colors hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] ${
              activeMenu === "Help" ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : ""
            }`}
          >
            Help
          </button>
          {activeMenu === "Help" && (
            <div className="absolute left-0 mt-1 w-52 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-2xl py-1 z-50">
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
                  alert("FlowGet 1.0 - Next-Gen High Performance Download Manager\nBuilt with Rust, Tauri 2, and React.\nLifetime Pro & 30-Day Trial Engine.");
                  setActiveMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] flex items-center gap-2 text-[var(--text-primary)]"
              >
                <Info className="w-3.5 h-3.5 text-indigo-400" />
                <span>About FlowGet</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Right: Rounded Search Box */}
      <div className="relative w-64">
        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] pointer-events-none" />
        <input
          id="global-search-input"
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search in the List"
          className="w-full h-7 pl-8 pr-3 bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] focus:bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-full text-xs text-[var(--text-primary)] placeholder-[var(--text-disabled)] focus:outline-none focus:border-purple-500/50 transition-all"
        />
      </div>
    </div>
  );
};
