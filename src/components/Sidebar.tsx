import React, { useState } from "react";
import {
  Folder,
  ChevronDown,
  ChevronRight,
  Music,
  Archive,
  Film,
  Terminal,
  FileText,
  Smartphone,
  Image,
  Magnet,
  Clock,
  CheckCircle2,
  MoreHorizontal,
  HardDrive,
  Trash2,
} from "lucide-react";
import { DownloadInfo } from "../types";

export type SidebarFilter =
  | { type: "all" }
  | { type: "category"; name: string }
  | { type: "status"; status: "unfinished" | "finished" };

interface SidebarProps {
  currentFilter: SidebarFilter;
  onSelectFilter: (f: SidebarFilter) => void;
  downloads: DownloadInfo[];
  onOpenDiskCleaner: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentFilter,
  onSelectFilter,
  downloads,
  onOpenDiskCleaner,
}) => {
  const [allExpanded, setAllExpanded] = useState(true);
  const [unfinishedExpanded, setUnfinishedExpanded] = useState(true);
  const [finishedExpanded, setFinishedExpanded] = useState(true);

  // Counts calculation
  const totalCount = downloads.length;
  const unfinishedCount = downloads.filter((d) => d.state !== "completed" && d.state !== "failed").length;
  const finishedCount = downloads.filter((d) => d.state === "completed" || d.state === "failed").length;

  const getCategoryCount = (catName: string) => {
    return downloads.filter((d) => {
      const c = (d.category || "").toLowerCase();
      return c === catName.toLowerCase();
    }).length;
  };

  const categories = [
    { name: "Music", label: "Musics", icon: Music, color: "text-purple-400" },
    { name: "Compressed", label: "Compressed", icon: Archive, color: "text-amber-400" },
    { name: "Videos", label: "Videos", icon: Film, color: "text-rose-400" },
    { name: "Programs", label: "Programs", icon: Terminal, color: "text-blue-400" },
    { name: "Documents", label: "Documents", icon: FileText, color: "text-emerald-400" },
    { name: "APKs", label: "APKs", icon: Smartphone, color: "text-teal-400" },
    { name: "Images", label: "Images", icon: Image, color: "text-indigo-400" },
    { name: "Torrents", label: "Torrents", icon: Magnet, color: "text-cyan-400" },
  ];

  // Disk space simulation / estimation
  const diskUsagePercent = 90;
  const getFaceEmoji = (pct: number) => {
    if (pct < 70) return "😊";
    if (pct <= 85) return "😐";
    return "😟";
  };

  // Semi-circle gauge calculation
  // Radius = 40, circumference = 2 * PI * 40 = 251.32. Semi-circle = ~125.66.
  const radius = 40;
  const semiCircumference = Math.PI * radius;
  const strokeDashoffset = semiCircumference * (1 - diskUsagePercent / 100);

  return (
    <aside className="w-60 h-full flex flex-col justify-between bg-[var(--bg-panel)] border-r border-[var(--border-subtle)] select-none text-[13px] text-[var(--text-secondary)]">
      {/* Top Section: Navigation Trees */}
      <div className="flex-1 overflow-y-auto px-2.5 py-3 space-y-1.5">
        {/* ALL DOWNLOADS */}
        <div>
          <div
            onClick={() => onSelectFilter({ type: "all" })}
            className={`flex items-center justify-between px-2.5 py-2 rounded-xl cursor-pointer transition-colors group ${
              currentFilter.type === "all"
                ? "bg-[var(--bg-card)] text-[var(--text-primary)] font-medium shadow-sm"
                : "hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  setAllExpanded(!allExpanded);
                }}
                className="p-0.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] cursor-pointer"
              >
                {allExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </span>
              <Folder className="w-5 h-5 text-purple-400 flex-shrink-0" />
              <span className="font-medium">All Downloads</span>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[11px] bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] font-medium">
              {totalCount}
            </span>
          </div>

          {/* Children Categories */}
          {allExpanded && (
            <div className="ml-5 mt-1 pl-2.5 border-l border-[var(--border-subtle)]/60 space-y-1">
              {categories.map((cat) => {
                const isSelected = currentFilter.type === "category" && currentFilter.name.toLowerCase() === cat.name.toLowerCase();
                const Icon = cat.icon;
                const count = getCategoryCount(cat.name);
                return (
                  <div
                    key={cat.name}
                    onClick={() => onSelectFilter({ type: "category", name: cat.name })}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-[var(--bg-card)] text-[var(--text-primary)] font-medium shadow-sm"
                        : "hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon className={`w-4.5 h-4.5 ${cat.color} flex-shrink-0`} />
                      <span>{cat.label}</span>
                    </div>
                    {count > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-[var(--bg-hover)] text-[var(--text-secondary)] font-medium">
                        {count}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* UNFINISHED */}
        <div>
          <div
            onClick={() => onSelectFilter({ type: "status", status: "unfinished" })}
            className={`flex items-center justify-between px-2.5 py-2 rounded-xl cursor-pointer transition-colors ${
              currentFilter.type === "status" && currentFilter.status === "unfinished"
                ? "bg-[var(--bg-card)] text-[var(--text-primary)] font-medium shadow-sm"
                : "hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  setUnfinishedExpanded(!unfinishedExpanded);
                }}
                className="p-0.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] cursor-pointer"
              >
                {unfinishedExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </span>
              <Clock className="w-5 h-5 text-amber-400 flex-shrink-0" />
              <span>Unfinished</span>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[11px] bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] font-medium">
              {unfinishedCount}
            </span>
          </div>
        </div>

        {/* FINISHED */}
        <div>
          <div
            onClick={() => onSelectFilter({ type: "status", status: "finished" })}
            className={`flex items-center justify-between px-2.5 py-2 rounded-xl cursor-pointer transition-colors ${
              currentFilter.type === "status" && currentFilter.status === "finished"
                ? "bg-[var(--bg-card)] text-[var(--text-primary)] font-medium shadow-sm"
                : "hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  setFinishedExpanded(!finishedExpanded);
                }}
                className="p-0.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] cursor-pointer"
              >
                {finishedExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </span>
              <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              <span>Finished</span>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[11px] bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] font-medium">
              {finishedCount}
            </span>
          </div>
        </div>
      </div>

      {/* Bottom Section: DISK SPACE WIDGET CARD */}
      <div className="p-2.5 m-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-md">
        {/* Card Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-[var(--text-primary)] font-medium">
            <HardDrive className="w-4 h-4 text-teal-400" />
            <span className="text-xs">Disk Space</span>
          </div>
          <button
            onClick={onOpenDiskCleaner}
            title="Disk details & cleanup"
            className="p-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>

        {/* Semicircle Gauge with Emoji and Percentage */}
        <div className="relative flex flex-col items-center justify-center my-1">
          <svg width="120" height="70" viewBox="0 0 120 70" className="overflow-visible">
            <defs>
              <linearGradient id="diskGaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#10B981" />
                <stop offset="60%" stopColor="#F59E0B" />
                <stop offset="100%" stopColor="#EF4444" />
              </linearGradient>
            </defs>
            {/* Background Arc */}
            <path
              d="M 15 65 A 45 45 0 0 1 105 65"
              fill="none"
              stroke="var(--bg-hover)"
              strokeWidth="10"
              strokeLinecap="round"
            />
            {/* Value Arc */}
            <path
              d="M 15 65 A 45 45 0 0 1 105 65"
              fill="none"
              stroke="url(#diskGaugeGrad)"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={semiCircumference}
              strokeDashoffset={strokeDashoffset}
              className="transition-all duration-700 ease-out"
            />
          </svg>

          {/* Center Face Emoji */}
          <div className="absolute top-4 text-2xl filter drop-shadow">
            {getFaceEmoji(diskUsagePercent)}
          </div>

          {/* Large Percentage */}
          <div className="text-xl font-bold tracking-tight text-[var(--text-primary)] mt-[-6px]">
            {diskUsagePercent}%
          </div>
        </div>

        {/* Drive Path */}
        <div className="text-center text-[10px] text-[var(--text-secondary)] truncate mb-2.5 font-mono">
          C:\Downloads
        </div>

        {/* Gradient Disk Cleaner Button */}
        <button
          onClick={onOpenDiskCleaner}
          className="w-full h-8 rounded-xl gradient-accent hover:opacity-95 active:scale-[0.98] transition-all text-white font-medium text-xs flex items-center justify-center gap-2 shadow-sm cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Disk Cleaner</span>
        </button>
      </div>
    </aside>
  );
};
