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
  Archive,
  Film,
  Terminal,
  FileText,
  Smartphone,
  Image as ImageIcon,
  File,
} from "lucide-react";
import { DownloadInfo } from "../types";
import { formatBytes, formatEta, formatDate, getFileTypeLabel, FileCategoryType } from "../format";
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
}

export const DownloadTable: React.FC<DownloadTableProps> = ({
  downloads,
  selectedIds,
  onToggleSelect,
  onDoubleClick,
  onContextMenu,
  sortField,
  sortOrder,
  onSort,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: downloads.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
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
    switch (type) {
      case "Music":
        return <Music className="w-4 h-4 text-purple-400 flex-shrink-0" />;
      case "Archive":
        return <Archive className="w-4 h-4 text-amber-400 flex-shrink-0" />;
      case "Video":
        return <Film className="w-4 h-4 text-rose-400 flex-shrink-0" />;
      case "Program":
        return <Terminal className="w-4 h-4 text-blue-400 flex-shrink-0" />;
      case "App":
        return <Smartphone className="w-4 h-4 text-teal-400 flex-shrink-0" />;
      case "Document":
        return <FileText className="w-4 h-4 text-emerald-400 flex-shrink-0" />;
      case "Image":
        return <ImageIcon className="w-4 h-4 text-indigo-400 flex-shrink-0" />;
      default:
        return <File className="w-4 h-4 text-[var(--text-secondary)] flex-shrink-0" />;
    }
  };

  const renderStatus = (d: DownloadInfo) => {
    const pct = d.totalSize && d.totalSize > 0
      ? Math.min(100, Math.max(0, (d.downloaded / d.totalSize) * 100))
      : 0;

    switch (d.state) {
      case "completed":
        return <span className="text-[var(--text-secondary)]">Complete</span>;
      case "downloading":
      case "probing":
      case "verifying":
        return (
          <div className="w-full pr-4 flex flex-col gap-1">
            <div className="flex items-center justify-between text-[11px] font-mono">
              <span className="text-teal-400 font-medium">{pct.toFixed(1)}%</span>
              <span className="text-[var(--text-secondary)]">
                {formatBytes(d.downloaded)} / {formatBytes(d.totalSize)}
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-[var(--bg-hover)] overflow-hidden">
              <div
                className="h-full rounded-full gradient-accent transition-all duration-200"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      case "paused":
        return (
          <div className="flex items-center gap-1.5 text-amber-400">
            <Pause className="w-3.5 h-3.5 fill-current" />
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
      <div className="h-10 w-full flex items-center px-3 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] text-xs font-medium text-[var(--text-secondary)] select-none flex-shrink-0">
        <div className="w-8 flex items-center justify-center">#</div>
        <div
          onClick={() => onSort("name")}
          className="flex-1 flex items-center gap-1.5 cursor-pointer hover:text-[var(--text-primary)] transition-colors px-2"
        >
          <span>Name</span>
          {renderSortIcon("name")}
        </div>
        <div
          onClick={() => onSort("size")}
          className="w-24 flex items-center gap-1.5 cursor-pointer hover:text-[var(--text-primary)] transition-colors px-2 justify-end"
        >
          <span>Size</span>
          {renderSortIcon("size")}
        </div>
        <div
          onClick={() => onSort("status")}
          className="w-48 flex items-center gap-1.5 cursor-pointer hover:text-[var(--text-primary)] transition-colors px-2"
        >
          <span>Status</span>
          {renderSortIcon("status")}
        </div>
        <div
          onClick={() => onSort("eta")}
          className="w-24 flex items-center gap-1.5 cursor-pointer hover:text-[var(--text-primary)] transition-colors px-2 justify-end"
        >
          <span>Time Left</span>
          {renderSortIcon("eta")}
        </div>
        <div
          onClick={() => onSort("date")}
          className="w-36 flex items-center gap-1.5 cursor-pointer hover:text-[var(--text-primary)] transition-colors px-2 justify-end"
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
                  className={`flex items-center px-3 border-b border-[var(--border-subtle)] text-xs cursor-default transition-colors ${
                    isSelected
                      ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
                      : "hover:bg-[var(--bg-card)] text-[var(--text-primary)]"
                  }`}
                >
                  {/* Checkbox */}
                  <div
                    className="w-8 flex items-center justify-center"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => onToggleSelect(d.id, (e.nativeEvent as MouseEvent).shiftKey)}
                      className="w-3.5 h-3.5 rounded border-[var(--border-subtle)] bg-[var(--bg-card)] accent-purple-600 cursor-pointer"
                    />
                  </div>

                  {/* Name + Icon + Type label */}
                  <div className="flex-1 flex items-center gap-2 px-2 min-w-0 pr-4">
                    {renderTypeIcon(typeLabel)}
                    <span className="truncate font-medium text-[var(--text-primary)]" title={d.fileName}>
                      {d.fileName}
                    </span>
                    <span className="px-1.5 py-0.2 rounded text-[10px] bg-[var(--bg-hover)] text-[var(--text-secondary)] flex-shrink-0 font-normal">
                      {typeLabel}
                    </span>
                  </div>

                  {/* Size */}
                  <div className="w-24 text-right px-2 font-mono text-[var(--text-secondary)]">
                    {formatBytes(d.totalSize)}
                  </div>

                  {/* Status */}
                  <div className="w-48 px-2 flex items-center">
                    {renderStatus(d)}
                  </div>

                  {/* Time Left */}
                  <div className="w-24 text-right px-2 font-mono text-[var(--text-secondary)]">
                    {d.state === "downloading" ? formatEta(d.etaSecs) : "--"}
                  </div>

                  {/* Last Modification */}
                  <div className="w-36 text-right px-2 text-[var(--text-secondary)] text-[11px] truncate">
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
