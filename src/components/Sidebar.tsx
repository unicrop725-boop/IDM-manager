import React, { useState } from "react";
import {
  Folder,
  FolderDown,
  FolderCheck,
  ChevronDown,
  ChevronUp,
  Music,
  Archive,
  Video,
  AppWindow,
  FileText,
  Smartphone,
  Image,
  Magnet,
  type LucideIcon,
  MoreHorizontal,
  Rows2,
} from "lucide-react";
import { NotchCorner } from "./NotchCorner";
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

interface GroupHeaderProps {
  icon: LucideIcon;
  label: string;
  active: boolean;
  expanded: boolean;
  onClick: () => void;
  onToggle: () => void;
}

const GroupHeader: React.FC<GroupHeaderProps> = ({ icon: Icon, label, active, expanded, onClick, onToggle }) => (
  <div
    onClick={onClick}
    className={`flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${
      active
        ? "bg-[var(--bg-card)] text-[var(--text-primary)]"
        : "text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
    }`}
  >
    <div className="flex items-center gap-3">
      <Icon className="w-[22px] h-[22px] flex-shrink-0" strokeWidth={1.5} />
      <span className="text-[14px] font-medium">{label}</span>
    </div>
    <span
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="p-0.5 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
    >
      {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
    </span>
  </div>
);

export const Sidebar: React.FC<SidebarProps> = ({
  currentFilter,
  onSelectFilter,
  onOpenDiskCleaner,
}) => {
  const [allExpanded, setAllExpanded] = useState(true);
  const [unfinishedExpanded, setUnfinishedExpanded] = useState(false);
  const [finishedExpanded, setFinishedExpanded] = useState(false);

  const categories = [
    { name: "Music", label: "Musics", icon: Music },
    { name: "Compressed", label: "Compressed", icon: Archive },
    { name: "Videos", label: "Videos", icon: Video },
    { name: "Programs", label: "Programs", icon: AppWindow },
    { name: "Documents", label: "Documents", icon: FileText },
    { name: "APKs", label: "APKs", icon: Smartphone },
    { name: "Images", label: "Images", icon: Image },
    { name: "Torrents", label: "Torrents", icon: Magnet },
  ];

  // Disk space simulation / estimation
  const diskUsagePercent = 90;
  const getFaceEmoji = (pct: number) => {
    if (pct < 70) return "😊";
    if (pct <= 85) return "😐";
    return "😟";
  };



  return (
    <aside className="w-60 h-full flex flex-col justify-between grad-side select-none text-[13px] text-[var(--text-secondary)]">
      {/* Top Section: Navigation Trees */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {/* ALL DOWNLOADS */}
        <div>
          <GroupHeader
            icon={Folder}
            label="All Downloads"
            active={currentFilter.type === "all"}
            expanded={allExpanded}
            onClick={() => onSelectFilter({ type: "all" })}
            onToggle={() => setAllExpanded(!allExpanded)}
          />

          {allExpanded && (
            <div className="mt-1 mb-1 pl-9 space-y-0.5">
              {categories.map((cat) => {
                const isSelected = currentFilter.type === "category" && currentFilter.name.toLowerCase() === cat.name.toLowerCase();
                const Icon = cat.icon;
                return (
                  <div
                    key={cat.name}
                    onClick={() => onSelectFilter({ type: "category", name: cat.name })}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors text-[13px] ${
                      isSelected
                        ? "bg-[var(--bg-card)] text-[var(--text-primary)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <Icon className="w-[15px] h-[15px] flex-shrink-0" strokeWidth={1.6} />
                    <span>{cat.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* UNFINISHED */}
        <GroupHeader
          icon={FolderDown}
          label="Unfinished"
          active={currentFilter.type === "status" && currentFilter.status === "unfinished"}
          expanded={unfinishedExpanded}
          onClick={() => onSelectFilter({ type: "status", status: "unfinished" })}
          onToggle={() => setUnfinishedExpanded(!unfinishedExpanded)}
        />

        {/* FINISHED */}
        <GroupHeader
          icon={FolderCheck}
          label="Finished"
          active={currentFilter.type === "status" && currentFilter.status === "finished"}
          expanded={finishedExpanded}
          onClick={() => onSelectFilter({ type: "status", status: "finished" })}
          onToggle={() => setFinishedExpanded(!finishedExpanded)}
        />
      </div>

      {/* Bottom Section: DISK SPACE WIDGET CARD */}
      <div className="notch-card px-4 pt-4 pb-4 m-3 bg-[var(--bg-card)] border border-[var(--border-subtle)]">
        <NotchCorner>
          <button
            onClick={onOpenDiskCleaner}
            title="Disk details & cleanup"
            aria-label="Disk details"
            className="notch-action"
          >
            <MoreHorizontal className="w-5 h-5" />
          </button>
        </NotchCorner>
        {/* Card Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5 text-[var(--text-primary)]">
            <Rows2 className="w-[18px] h-[18px]" strokeWidth={1.6} />
            <span className="text-[13px]">Disk Space</span>
          </div>
        </div>

        {/* Semicircle Gauge */}
        <div className="relative mx-auto w-[150px] h-[84px]">
          <svg width="150" height="84" viewBox="0 0 150 84" className="overflow-visible">
            <defs>
              <linearGradient id="diskGaugeGrad" gradientUnits="userSpaceOnUse" x1="15" y1="0" x2="135" y2="0">
                <stop offset="0%" stopColor="#3B82F6" />
                <stop offset="50%" stopColor="#EC4899" />
                <stop offset="100%" stopColor="#F59E0B" />
              </linearGradient>
            </defs>
            <path
              d="M 15 75 A 60 60 0 0 1 135 75"
              fill="none"
              stroke="var(--bg-hover)"
              strokeWidth="11"
              strokeLinecap="round"
            />
            <path
              d="M 15 75 A 60 60 0 0 1 135 75"
              fill="none"
              stroke="url(#diskGaugeGrad)"
              strokeWidth="11"
              strokeLinecap="round"
              pathLength={100}
              strokeDasharray={100}
              strokeDashoffset={100 - diskUsagePercent}
              className="transition-all duration-700 ease-out"
            />
          </svg>
          <div className="absolute left-1/2 top-[34px] -translate-x-1/2 text-[26px] leading-none">
            {getFaceEmoji(diskUsagePercent)}
          </div>
          <span className="absolute left-0 -bottom-1 -translate-x-1/2 text-[11px] text-[var(--text-secondary)]">0%</span>
          <span className="absolute right-0 -bottom-1 translate-x-1/2 text-[11px] text-[var(--text-secondary)]">100%</span>
        </div>

        {/* Percentage + Drive Path */}
        <div className="text-center mt-2 text-[22px] font-bold tracking-tight text-[var(--text-primary)]">
          {diskUsagePercent}%
        </div>
        <div className="text-center text-[12px] text-[var(--text-secondary)] truncate mb-4">
          C:\Downloads
        </div>

        {/* Gradient Disk Cleaner Button */}
        <button
          onClick={onOpenDiskCleaner}
          className="w-full h-10 rounded-xl bg-gradient-to-r from-teal-500 to-purple-500 hover:opacity-95 active:scale-[0.98] transition-all text-white font-medium text-[13px] flex items-center justify-center cursor-pointer shadow-sm"
        >
          Disk Cleaner
        </button>
      </div>
    </aside>
  );
};
