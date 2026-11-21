import React, { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Pause,
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
} from "lucide-react";
import { DownloadInfo } from "../types";
import { formatBytes, formatDate, getFileTypeLabel, FileCategoryType } from "../format";
import { Checkbox } from "./Checkbox";
import { ContextMenuPosition } from "./ContextMenu";

export type SortField = "name" | "size" | "status" | "eta" | "date";
export type SortOrder = "asc" | "desc";

interface DownloadTableProps {
  downloads: DownloadInfo[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string, shiftKey: boolean) => void;
  onDoubleClick: (d: DownloadInfo) => void;
  onContextMenu: (pos: ContextMenuPosition) => void;
  sortField: SortField;
  sortOrder: SortOrder;
  onSort: (field: SortField) => void;
  allSelected?: boolean;
  onToggleSelectAll?: () => void;
}

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

  const renderStatus = (d: DownloadInfo) => {
    const pct = d.totalSize && d.totalSize > 0
      ? Math.min(100, Math.max(0, (d.downloaded / d.totalSize) * 100))
      : 0;

    switch (d.state) {
      case "completed":
        return <span className="text-[13px] text-[var(--text-primary)]">Complete</span>;
      case "downloading":
      case "probing":
      case "verifying":
        return (
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] text-[var(--text-primary)]">{Math.round(pct)}%</span>
            <div className="w-28 h-1.5 rounded-full bg-[var(--bg-hover)] overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-teal-400 to-purple-500 transition-all duration-200"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      case "paused":
        return (
          <div className="flex items-center gap-2 text-[13px] text-[var(--text-primary)]">
            <span className="w-4 h-4 rounded-[4px] border border-[var(--text-secondary)] flex items-center justify-center">
              <Pause className="w-2.5 h-2.5" />
            </span>
            <span>Paused</span>
          </div>
        );
      case "queued":
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] bg-purple-500/15 text-purple-300 border border-purple-500/30">
            Queued
          </span>
        );
      case "waitingForNetwork":
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1 w-max">
            <WifiOff className="w-3 h-3" />
            Waiting for network
          </span>
        );
      case "linkExpired":
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] bg-rose-500/15 text-rose-300 border border-rose-500/30 flex items-center gap-1 w-max">
            <AlertTriangle className="w-3 h-3" />
            Link expired
          </span>
        );
      case "failed":
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] bg-rose-500/15 text-rose-400 border border-rose-500/30 truncate max-w-[180px]">
            {d.error?.message || "Failed"}
          </span>
        );
      default:
        return <span className="text-[var(--text-secondary)]">{d.state}</span>;
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--bg-app)] select-none overflow-hidden">
      {/* Table Header */}
      <div className="h-12 w-full flex items-center px-4 grad-bar-down text-[13px] text-[var(--text-secondary)] select-none flex-shrink-0">
        <div className="w-10 flex items-center">
          <Checkbox
            checked={allSelected && downloads.length > 0}
            onChange={() => onToggleSelectAll?.()}
          />
        </div>
        <div
          onClick={() => onSort("name")}
          className="flex-1 flex items-center gap-2 cursor-pointer hover:text-[var(--text-primary)] transition-colors pl-12"
        >
          <span>Name</span>
          {renderSortIcon("name")}
        </div>
        <div
          onClick={() => onSort("size")}
          className="w-28 flex items-center gap-2 cursor-pointer hover:text-[var(--text-primary)] transition-colors"
        >
          <span>Size</span>
          {renderSortIcon("size")}
        </div>
        <div
          onClick={() => onSort("status")}
          className="w-44 flex items-center gap-2 cursor-pointer hover:text-[var(--text-primary)] transition-colors"
        >
          <span>Status</span>
          {renderSortIcon("status")}
        </div>
        <div
          onClick={() => onSort("eta")}
          className="w-36 flex items-center gap-2 cursor-pointer hover:text-[var(--text-primary)] transition-colors"
        >
          <span>Time Left</span>
          {renderSortIcon("eta")}
        </div>
        <div
          onClick={() => onSort("date")}
          className="w-40 flex items-center gap-2 cursor-pointer hover:text-[var(--text-primary)] transition-colors"
        >
          <span>Last Modification</span>
          {renderSortIcon("date")}
        </div>
      </div>

      {/* Virtualized Table Body */}
      <div ref={parentRef} className="flex-1 overflow-y-auto">
        {downloads.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-[var(--text-disabled)] gap-2 py-20">
            <File className="w-10 h-10 stroke-[1.2] opacity-40" />
            <p className="text-xs">No downloads in this list</p>
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
                  onClick={(e) => onToggleSelect(d.id, e.shiftKey)}
                  className={`flex items-center px-4 text-[13px] cursor-default transition-colors ${
                    isSelected
                      ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
                      : "hover:bg-[var(--bg-card)] text-[var(--text-primary)]"
                  }`}
                >
                  {/* Checkbox */}
                  <div
                    className="w-10 flex items-center"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      checked={isSelected}
                      onChange={(e) => onToggleSelect(d.id, (e.nativeEvent as MouseEvent).shiftKey)}
                    />
                  </div>

                  {/* Icon + Name + Category */}
                  <div className="flex-1 flex items-center gap-4 min-w-0 pr-4 pl-1">
                    {renderTypeIcon(typeLabel)}
                    <div className="min-w-0 flex flex-col">
                      <span className="truncate font-medium text-[var(--text-primary)]" title={d.fileName}>
                        {d.fileName}
                      </span>
                      <span className="text-[11px] text-[var(--text-secondary)]">{typeLabel}</span>
                    </div>
                  </div>

                  {/* Size */}
                  <div className="w-28 text-[var(--text-primary)]">
                    {formatBytes(d.totalSize)}
                  </div>

                  {/* Status */}
                  <div className="w-44 flex items-center">
                    {renderStatus(d)}
                  </div>

                  {/* Time Left */}
                  <div className="w-36 text-[var(--text-primary)]">
                    {d.state === "downloading" ? formatTimeLeft(d.etaSecs) : "0 Sec"}
                  </div>

                  {/* Last Modification */}
                  <div className="w-40 text-[var(--text-secondary)] text-[12px] truncate">
                    {formatDate(d.completedAt || d.createdAt)}
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
