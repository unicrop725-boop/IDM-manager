import React, { useRef } from "react";
import { t } from "../i18n";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Pause,
  Play,
  AlertTriangle,
  WifiOff,
  Music,
  FileArchive,
  Video,
  AppWindow,
  Cpu,
  FileText,
  Image as ImageIcon,
  File,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { DownloadInfo, SafetyReport } from "../types";
import { safetyLines } from "./SafetyConfirmModal";
import { formatBytes, formatDate, getFileTypeLabel, FileCategoryType } from "../format";
import { Checkbox } from "./Checkbox";
import { TickProgress } from "./DownloadViz";
import { ContextMenuPosition } from "./ContextMenu";

export type SortField = "name" | "size" | "status" | "eta" | "date";
export type SortOrder = "asc" | "desc";

interface DownloadTableProps {
  downloads: DownloadInfo[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string, shiftKey: boolean, toggle?: boolean) => void;
  onDoubleClick: (d: DownloadInfo) => void;
  onContextMenu: (pos: ContextMenuPosition) => void;
  sortField: SortField;
  sortOrder: SortOrder;
  onSort: (field: SortField) => void;
  allSelected?: boolean;
  onToggleSelectAll?: () => void;
  onPause?: (id: string) => void;
  onResume?: (id: string) => void;
  /** Safety check results by download id (warnings, VirusTotal). */
  safety?: Record<string, SafetyReport>;
}

/** File name, or the last part of the URL when the name is empty. */
const displayName = (d: DownloadInfo): string => {
  if (d.fileName && d.fileName.trim()) return d.fileName;
  try {
    const last = new URL(d.url).pathname.split("/").filter(Boolean).pop();
    if (last) return decodeURIComponent(last);
  } catch {
    /* not a valid URL */
  }
  return d.url || "(unnamed)";
};

/** A few words for the status column; the whole message (with the fix) is shown on hover. */
const FAILURE_HEADLINES: Record<string, string> = {
  wrong_file: "Web page, not a file",
  certificate: "Untrusted certificate",
  dns: "Site not found",
  timeout: "Server not answering",
  refused: "Connection refused",
  network: "Connection lost",
  auth_failed: "Wrong password",
  not_found: "File not found",
  disk_full: "Disk is full",
  file_changed: "File changed",
  checksum_mismatch: "Checksum differs",
  size_mismatch: "Wrong size",
  http: "Server refused",
};
const failureHeadline = (code?: string, message?: string): string =>
  (code && FAILURE_HEADLINES[code]) || (message ? message.split(/[.!]/)[0].slice(0, 40) : "Failed");

const formatTimeLeft = (secs: number | null | undefined): string => {
  if (secs == null || !isFinite(secs) || secs <= 0) return "0 Sec";
  const s = Math.round(secs);
  if (s < 60) return `${s} Sec`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} Min ${s % 60} Sec`;
  const h = Math.floor(m / 60);
  return `${h} Hr ${m % 60} Min`;
};

export const DownloadTable: React.FC<DownloadTableProps> = ({
  downloads,
  selectedIds,
  onToggleSelect,
  onDoubleClick,
  onContextMenu,
  sortField,
  sortOrder,
  onSort,
  allSelected = false,
  onToggleSelectAll,
  onPause,
  onResume,
  safety = {},
}) => {
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: downloads.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 12,
  });

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 opacity-30 hover:opacity-100" />;
    }
    return sortOrder === "asc" ? (
      <ArrowUp className="w-3 h-3 text-purple-400" />
    ) : (
      <ArrowDown className="w-3 h-3 text-purple-400" />
    );
  };

  const renderTypeIcon = (type: FileCategoryType) => {
    const cls = "w-[22px] h-[22px] flex-shrink-0 text-[var(--text-primary)] opacity-80";
    switch (type) {
      case "Music":
        return <Music className={cls} strokeWidth={1.4} />;
      case "Archive":
        return <FileArchive className={cls} strokeWidth={1.4} />;
      case "Video":
        return <Video className={cls} strokeWidth={1.4} />;
      case "Program":
        return <AppWindow className={cls} strokeWidth={1.4} />;
      case "App":
        return <Cpu className={cls} strokeWidth={1.4} />;
      case "Document":
        return <FileText className={cls} strokeWidth={1.4} />;
      case "Image":
        return <ImageIcon className={cls} strokeWidth={1.4} />;
      default:
        return <File className={cls} strokeWidth={1.4} />;
    }
  };

  // HTTP(S) downloads (engine) and yt-dlp videos can be paused/resumed; streams, FTP and torrents
  // are managed elsewhere.
  const canToggle = (d: DownloadInfo) => !d.protocol || d.protocol.startsWith("HTTP") || d.protocol === "Video";

  const rowAction = (d: DownloadInfo, kind: "pause" | "resume") => {
    const handler = kind === "pause" ? onPause : onResume;
    if (!handler || !canToggle(d)) return null;
    const Icon = kind === "pause" ? Pause : Play;
    return (
      <button
        type="button"
        title={kind === "pause" ? "Pause" : "Resume"}
        aria-label={kind === "pause" ? "Pause download" : "Resume download"}
        onClick={(e) => {
          e.stopPropagation();
          handler(d.id);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        className={`row-action ${kind === "pause" ? "row-action--pause" : "row-action--resume"}`}
      >
        <Icon className="w-3.5 h-3.5 fill-current" />
      </button>
    );
  };

  /** A small shield next to the name: red = risky, amber = program, green = VirusTotal found nothing. */
  const safetyBadge = (report?: SafetyReport) => {
    if (!report) return null;
    const lines = safetyLines(report);
    const title = lines.map((l) => l.text).join("\n");
    const cls = "h-3.5 w-3.5 flex-shrink-0";
    if (lines.some((l) => l.level === "high"))
      return <span title={title}><ShieldAlert className={`${cls} text-red-400`} /></span>;
    if (lines.some((l) => l.level === "medium"))
      return <span title={title}><TriangleAlert className={`${cls} text-amber-400`} /></span>;
    if (report.vt?.status === "clean")
      return <span title={title}><ShieldCheck className={`${cls} text-emerald-400`} /></span>;
    return null;
  };

  const renderStatus = (d: DownloadInfo) => {
    const pct = d.totalSize && d.totalSize > 0
      ? Math.min(100, Math.max(0, (d.downloaded / d.totalSize) * 100))
      : 0;

    switch (d.state) {
      case "completed":
        return <span className="text-[13px] text-[var(--text-primary)]">{t("complete", "Complete")}</span>;
      case "probing":
        // Not a vague "0%": say what is happening, and what went wrong while retrying.
        return (
          <div className="flex min-w-0 flex-col gap-0.5" title={d.note || "Contacting the server…"}>
            <span className="flex items-center gap-1.5 text-[13px] text-[var(--text-primary)]">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-sky-400" />
              Connecting…
            </span>
            {d.note && <span className="truncate text-[11px] text-amber-400">{d.note}</span>}
          </div>
        );
      case "downloading":
      case "verifying":
        return (
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] text-[var(--text-primary)]">{Math.round(pct)}%</span>
            <div className="w-28">
              <TickProgress pct={pct} ticks={24} size="sm" active={d.state === "downloading"} />
            </div>
          </div>
        );
      case "paused":
        return (
          <div className="flex items-center gap-2 text-[13px] text-[var(--text-primary)]">
            <span className="w-4 h-4 rounded-[4px] border border-[var(--text-secondary)] flex items-center justify-center">
              <Pause className="w-2.5 h-2.5" />
            </span>
            <span>{t("paused", "Paused")}</span>
          </div>
        );
      case "queued":
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] bg-purple-500/15 text-purple-300 border border-purple-500/30">
            {t("queued", "Queued")}
          </span>
        );
      case "waitingForNetwork":
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1 w-max">
            <WifiOff className="w-3 h-3" />
            {t("waiting_network", "Waiting for network")}
          </span>
        );
      case "linkExpired":
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] bg-rose-500/15 text-rose-300 border border-rose-500/30 flex items-center gap-1 w-max">
            <AlertTriangle className="w-3 h-3" />
            {t("link_expired", "Link expired")}
          </span>
        );
      case "failed":
        // Short reason in the row; the full explanation (with what to do) is in the tooltip and Properties.
        return (
          <span
            title={d.error?.message || "The download failed."}
            className="px-2 py-0.5 rounded-full text-[10px] bg-rose-500/15 text-rose-400 border border-rose-500/30 truncate max-w-[200px]"
          >
            {failureHeadline(d.error?.code, d.error?.message)}
          </span>
        );
      default:
        return <span className="text-[var(--text-secondary)]">{d.state}</span>;
    }
  };

  return (
    <div className="dt-root flex-1 flex flex-col h-full select-none overflow-hidden">
      {/* Table Header */}
      <div className="h-12 w-full flex items-center px-4 grad-bar-down text-[13px] text-[var(--text-secondary)] select-none flex-shrink-0">
        <div className="w-10 flex-shrink-0 flex items-center">
          <Checkbox
            checked={allSelected && downloads.length > 0}
            onChange={() => onToggleSelectAll?.()}
          />
        </div>
        <div
          onClick={() => onSort("name")}
          className="flex-1 flex items-center gap-2 cursor-pointer hover:text-[var(--text-primary)] transition-colors pl-12 dt-col-name-h"
        >
          <span>{t("name", "Name")}</span>
          {renderSortIcon("name")}
        </div>
        <div
          onClick={() => onSort("size")}
          className="dt-col-size w-28 flex items-center gap-2 cursor-pointer hover:text-[var(--text-primary)] transition-colors"
        >
          <span>{t("size", "Size")}</span>
          {renderSortIcon("size")}
        </div>
        <div
          onClick={() => onSort("status")}
          className="dt-col-status w-44 flex items-center gap-2 cursor-pointer hover:text-[var(--text-primary)] transition-colors"
        >
          <span>{t("status", "Status")}</span>
          {renderSortIcon("status")}
        </div>
        <div
          onClick={() => onSort("eta")}
          className="dt-col-eta w-36 flex items-center gap-2 cursor-pointer hover:text-[var(--text-primary)] transition-colors"
        >
          <span>{t("time_left", "Time Left")}</span>
          {renderSortIcon("eta")}
        </div>
        <div
          onClick={() => onSort("date")}
          className="dt-col-date w-40 flex items-center gap-2 cursor-pointer hover:text-[var(--text-primary)] transition-colors"
        >
          <span>{t("last_modification", "Last Modification")}</span>
          {renderSortIcon("date")}
        </div>
        <div className="dt-col-action w-12 flex-shrink-0" aria-hidden="true" />
      </div>

      {/* Virtualized Table Body */}
      <div ref={parentRef} className="flex-1 overflow-y-auto">
        {downloads.length === 0 ? (
          <div className="h-full flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-2 rounded-2xl bg-[var(--bg-panel)]/70 px-8 py-5 text-[var(--text-secondary)] backdrop-blur-md">
              <File className="w-10 h-10 stroke-[1.2] opacity-60" />
              <p className="text-xs">No downloads in this list</p>
            </div>
          </div>
        ) : (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const d = downloads[virtualRow.index];
              const isSelected = selectedIds.has(d.id);
              const typeLabel = getFileTypeLabel(d.fileName);

              return (
                <div
                  key={d.id}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  onDoubleClick={() => onDoubleClick(d)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onContextMenu({ x: e.clientX, y: e.clientY, download: d });
                  }}
                  onClick={(e) => onToggleSelect(d.id, e.shiftKey, e.ctrlKey || e.metaKey)}
                  // Keyboard: Tab reaches each row, Enter opens it, Space selects it.
                  tabIndex={0}
                  aria-selected={isSelected}
                  aria-label={`${displayName(d)}, ${d.state}`}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onDoubleClick(d);
                    } else if (e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      onToggleSelect(d.id, e.shiftKey, true);
                    }
                  }}
                  className={`outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-purple)] flex items-center px-4 text-[13px] cursor-default transition-colors ${
                    isSelected
                      ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
                      : "hover:bg-[var(--bg-card)] text-[var(--text-primary)]"
                  }`}
                >
                  {/* Checkbox */}
                  <div
                    className="w-10 flex-shrink-0 flex items-center"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      checked={isSelected}
                      onChange={(e) => onToggleSelect(d.id, (e.nativeEvent as MouseEvent).shiftKey, true)}
                    />
                  </div>

                  {/* Icon + Name + Category */}
                  <div className="dt-col-name flex-1 flex items-center gap-4 min-w-0 pr-4 pl-1">
                    {renderTypeIcon(typeLabel)}
                    <div className="min-w-0 flex flex-col">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate font-medium text-[var(--text-primary)]" title={displayName(d)}>
                          {displayName(d)}
                        </span>
                        {safetyBadge(safety[d.id])}
                      </span>
                      <span className="text-[11px] text-[var(--text-secondary)]">{typeLabel}</span>
                    </div>
                  </div>

                  {/* Size */}
                  <div className="dt-col-size w-28 text-[var(--text-primary)]">
                    {formatBytes(d.totalSize)}
                  </div>

                  {/* Status */}
                  <div className="dt-col-status w-44 flex items-center">
                    {renderStatus(d)}
                  </div>

                  {/* Time Left */}
                  <div className="dt-col-eta w-36 text-[var(--text-primary)]">
                    {d.state === "downloading" ? formatTimeLeft(d.etaSecs) : "0 Sec"}
                  </div>

                  {/* Last Modification */}
                  <div className="dt-col-date w-40 text-[var(--text-secondary)] text-[12px] truncate">
                    {formatDate(d.completedAt || d.createdAt)}
                  </div>

                  {/* Pause / Resume (always in the same place) */}
                  <div className="dt-col-action w-12 flex-shrink-0 flex items-center justify-center">
                    {d.state === "downloading" || d.state === "probing"
                      ? rowAction(d, "pause")
                      : d.state === "paused"
                      ? rowAction(d, "resume")
                      : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
