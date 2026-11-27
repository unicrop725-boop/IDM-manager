import React, { useEffect, useState } from "react";
import { t } from "../i18n";
import { api } from "../api";
import { formatBytes } from "../format";
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
  Globe,
  type LucideIcon,
  MoreHorizontal,
  Rows2,
} from "lucide-react";
import { NotchCorner } from "./NotchCorner";

export type SidebarFilter =
  | { type: "all" }
  | { type: "category"; name: string }
  | { type: "status"; status: "unfinished" | "finished" }
  /** The Trusted Sites page instead of the download list. */
  | { type: "trusted" };

/** Show the Disk Space card from this usage (percent) upwards. */
const DISK_WARN_PERCENT = 85;

interface SidebarProps {
  saveDir?: string;
  currentFilter: SidebarFilter;
  onSelectFilter: (f: SidebarFilter) => void;
  /** Number of downloads per entry: "all", "unfinished", "finished" and each category name. */
  counts: Record<string, number>;
  onOpenDiskCleaner: () => void;
}

/** Small number badge on the right of a sidebar entry (hidden when zero). */
const Count: React.FC<{ n?: number }> = ({ n }) =>
  n ? (
    <span className="ml-auto min-w-[20px] rounded-full bg-[var(--bg-hover)] px-1.5 py-px text-center text-[11px] tabular-nums text-[var(--text-secondary)]">
      {n}
    </span>
  ) : null;

interface GroupHeaderProps {
  icon: LucideIcon;
  label: string;
  active: boolean;
  /** Only groups that have sub-items get an expand/collapse arrow. */
  expanded?: boolean;
  count?: number;
  /** Optional colours: the icon's colour, and the look of the entry while it is selected. */
  accent?: { icon: string; active: string };
  onClick: () => void;
  onToggle?: () => void;
}

const GroupHeader: React.FC<GroupHeaderProps> = ({ icon: Icon, label, active, expanded, count, accent, onClick, onToggle }) => (
  <div
    onClick={onClick}
    role="button"
    tabIndex={0}
    aria-pressed={active}
    onKeyDown={(e) => {
      if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }
    }}
    className={`outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-purple)] flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${
      active
        ? accent?.active ?? "bg-[var(--bg-card)] text-[var(--text-primary)]"
        : "text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
    }`}
  >
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <Icon className={`w-[22px] h-[22px] flex-shrink-0 ${accent?.icon ?? ""}`} strokeWidth={1.5} />
      <span className="text-[14px] font-medium">{label}</span>
      <Count n={count} />
    </div>
    {onToggle && (
      <span
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="p-0.5 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
      >
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </span>
    )}
  </div>
);

export const Sidebar: React.FC<SidebarProps> = ({
  saveDir = "",
  currentFilter,
  onSelectFilter,
  counts,
  onOpenDiskCleaner,
}) => {
  const [allExpanded, setAllExpanded] = useState(true);

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
  // Real disk usage of the drive that holds the download folder (refreshed every 30s)
  const [disk, setDisk] = useState<{ drive: string; totalBytes: number; freeBytes: number } | null>(null);
  // Re-check sooner while downloads are in progress (they are what fills the disk) and whenever one finishes.
  const busy = (counts.unfinished ?? 0) > 0;
  const finishedCount = counts.finished ?? 0;

  // A different drive was chosen: forget the old reading until the new drive has been read.
  useEffect(() => {
    setDisk(null);
  }, [saveDir]);

  useEffect(() => {
    let cancelled = false;
    let running = false;
    const load = () => {
      if (running) return; // never pile up PowerShell checks
      running = true;
      api
        .getDiskSpace(saveDir)
        .then((d) => {
          if (!cancelled) setDisk(d);
        })
        // One failed check must not hide a warning that is still true: keep the last reading.
        .catch(() => {})
        .finally(() => {
          running = false;
        });
    };
    load();
    const t = setInterval(load, busy ? 10000 : 30000);
    // Coming back to the window after filling the disk elsewhere: look again straight away.
    const onWake = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      cancelled = true;
      clearInterval(t);
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [saveDir, busy, finishedCount]);
  const diskUsagePercent = disk ? Math.round(((disk.totalBytes - disk.freeBytes) / disk.totalBytes) * 100) : 0;
  // The Disk Space card only slides in when the drive is nearly full
  const showDiskCard = disk !== null && diskUsagePercent >= DISK_WARN_PERCENT;
  // The face and the gauge colour always change together, from the same thresholds.
  const diskLevel = (pct: number) => {
    if (pct < 70) return { emoji: "😊", color: "#B2D959" }; // plenty of room: green
    if (pct <= 85) return { emoji: "😐", color: "#F5B942" }; // getting full: amber
    return { emoji: "😟", color: "#F25C5C" }; // nearly full: red
  };
  const level = diskLevel(diskUsagePercent);



  return (
    <aside className="w-60 max-[720px]:hidden h-full flex flex-col justify-between grad-side select-none text-[13px] text-[var(--text-secondary)]">
      {/* Top Section: Navigation Trees */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {/* ALL DOWNLOADS */}
        <div>
          <GroupHeader
            icon={Folder}
            label={t("all_downloads", "All Downloads")}
            active={currentFilter.type === "all"}
            expanded={allExpanded}
            count={counts.all}
            onClick={() => onSelectFilter({ type: "all" })}
            onToggle={() => setAllExpanded(!allExpanded)}
          />

          {allExpanded && (
            <div className="mt-1 mb-1 pl-8 space-y-1">
              {categories.map((cat) => {
                const isSelected = currentFilter.type === "category" && currentFilter.name.toLowerCase() === cat.name.toLowerCase();
                const Icon = cat.icon;
                return (
                  <div
                    key={cat.name}
                    onClick={() => onSelectFilter({ type: "category", name: cat.name })}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        onSelectFilter({ type: "category", name: cat.name });
                      }
                    }}
                    className={`outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-purple)] flex items-center gap-3.5 px-3 py-2.5 rounded-lg cursor-pointer transition-colors text-[15px] ${
                      isSelected
                        ? "bg-[var(--bg-card)] text-[var(--text-primary)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <Icon className="w-5 h-5 flex-shrink-0" strokeWidth={1.6} />
                    <span>{cat.label}</span>
                    <Count n={counts[cat.name]} />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* UNFINISHED */}
        <GroupHeader
          icon={FolderDown}
          label={t("unfinished", "Unfinished")}
          count={counts.unfinished}
          active={currentFilter.type === "status" && currentFilter.status === "unfinished"}
          onClick={() => onSelectFilter({ type: "status", status: "unfinished" })}
        />

        {/* FINISHED */}
        <GroupHeader
          icon={FolderCheck}
          label={t("finished", "Finished")}
          count={counts.finished}
          active={currentFilter.type === "status" && currentFilter.status === "finished"}
          onClick={() => onSelectFilter({ type: "status", status: "finished" })}
        />

        {/* TRUSTED SITES */}
        <GroupHeader
          icon={Globe}
          label="Trusted Sites"
          count={counts.trusted}
          accent={{
            icon: "text-sky-400",
            active: "bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/50",
          }}
          active={currentFilter.type === "trusted"}
          onClick={() => onSelectFilter({ type: "trusted" })}
        />
      </div>

      {/* Bottom Section: DISK SPACE WIDGET CARD */}
      <div className={`disk-alert ${showDiskCard ? "disk-alert--open" : ""}`} aria-hidden={!showDiskCard}>
      <div className="disk-alert-inner">
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
            <span className="text-[13px]">{t("disk_space", "Disk Space")}</span>
          </div>
        </div>

        {/* Semicircle Gauge */}
        <div className="relative mx-auto w-[150px] h-[84px]">
          <svg width="150" height="84" viewBox="0 0 150 84" className="overflow-visible">
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
              stroke={level.color}
              strokeWidth="11"
              strokeLinecap="round"
              pathLength={100}
              strokeDasharray={100}
              strokeDashoffset={100 - diskUsagePercent}
              className="transition-all duration-700 ease-out"
              data-testid="disk-gauge-arc"
            />
          </svg>
          <div className="absolute left-1/2 top-[34px] -translate-x-1/2 text-[26px] leading-none">
            {disk ? level.emoji : "—"}
          </div>
          <span className="absolute left-0 -bottom-1 -translate-x-1/2 text-[11px] text-[var(--text-secondary)]">0%</span>
          <span className="absolute right-0 -bottom-1 translate-x-1/2 text-[11px] text-[var(--text-secondary)]">100%</span>
        </div>

        {/* Percentage + Drive Path */}
        <div className="text-center mt-2 text-[22px] font-bold tracking-tight text-[var(--text-primary)]">
          {disk ? `${diskUsagePercent}%` : "--"}
        </div>
        <div className="text-center text-[12px] text-[var(--text-secondary)] truncate mb-4">
          {disk ? `${disk.drive}  ·  ${formatBytes(disk.freeBytes)} free` : "Not available"}
        </div>

        {/* Gradient Disk Cleaner Button */}
        <button
          onClick={onOpenDiskCleaner}
          className="w-full h-10 rounded-xl gradient-accent hover:opacity-95 active:scale-[0.98] transition-all text-white font-medium text-[13px] flex items-center justify-center cursor-pointer shadow-sm"
        >
          Disk Cleaner
        </button>
      </div>
      </div>
      </div>
    </aside>
  );
};
