import React, { useState } from "react";
import {
  FolderOpen,
  ExternalLink,
  Edit3,
  RotateCcw,
  Play,
  Pause,
  RefreshCw,
  ListPlus,
  ListMinus,
  FileText,
  ChevronRight,
  ShieldAlert,
  Archive,
  Globe,
  Share2,
} from "lucide-react";
import { DownloadInfo, QueueInfo } from "../types";

export interface ContextMenuPosition {
  x: number;
  y: number;
  download: DownloadInfo;
}

interface ContextMenuProps {
  position: ContextMenuPosition;
  queues: QueueInfo[];
  onClose: () => void;
  onOpen: (d: DownloadInfo) => void;
  onOpenWith: (d: DownloadInfo) => void;
  onOpenFolder: (d: DownloadInfo) => void;
  onMoveRename: (d: DownloadInfo) => void;
  onRedownload: (d: DownloadInfo) => void;
  onResume: (d: DownloadInfo) => void;
  onStop: (d: DownloadInfo) => void;
  onRefreshAddress: (d: DownloadInfo) => void;
  onGrabUrlFromBrowser?: (d: DownloadInfo) => void;
  onAddToQueue: (d: DownloadInfo, queueId: string) => void;
  onDeleteFromQueue: (d: DownloadInfo) => void;
  onProperties: (d: DownloadInfo) => void;
  onDefenderScan?: (d: DownloadInfo) => void;
  onExtractArchive?: (d: DownloadInfo) => void;
  onShare?: (d: DownloadInfo) => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  position,
  queues,
  onClose,
  onOpen,
  onOpenWith,
  onOpenFolder,
  onMoveRename,
  onRedownload,
  onResume,
  onStop,
  onRefreshAddress,
  onGrabUrlFromBrowser,
  onAddToQueue,
  onDeleteFromQueue,
  onProperties,
  onDefenderScan,
  onExtractArchive,
  onShare,
}) => {
  const [showQueueSubmenu, setShowQueueSubmenu] = useState(false);
  const d = position.download;

  const isCompleted = d.state === "completed";
  const isDownloading = d.state === "downloading" || d.state === "probing";
  const canResume = d.state === "paused" || d.state === "queued" || d.state === "failed" || d.state === "waitingForNetwork";
  const isArchive = d.fileName.match(/\.(zip|rar|7z|tar|gz|bz2|xz)$/i) !== null;

  // Clamping within viewport
  const menuWidth = 220;
  const menuHeight = 360;
  const left = Math.min(position.x, window.innerWidth - menuWidth - 10);
  const top = Math.min(position.y, window.innerHeight - menuHeight - 10);

  return (
    <div
      className="fixed inset-0 z-50 select-none"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        style={{ left: `${left}px`, top: `${top}px` }}
        onClick={(e) => e.stopPropagation()}
        className="absolute w-56 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-2xl py-1.5 text-xs text-[var(--text-primary)] z-50 animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Open */}
        <button
          disabled={!isCompleted}
          onClick={() => {
            onOpen(d);
            onClose();
          }}
          className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] disabled:opacity-35 disabled:hover:bg-transparent flex items-center gap-2.5 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5 text-purple-400" />
          <span>Open</span>
        </button>

        {/* Open With */}
        <button
          disabled={!isCompleted}
          onClick={() => {
            onOpenWith(d);
            onClose();
          }}
          className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] disabled:opacity-35 disabled:hover:bg-transparent flex items-center gap-2.5 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5 text-teal-400" />
          <span>Open With...</span>
        </button>

        {/* Open Folder */}
        <button
          onClick={() => {
            onOpenFolder(d);
            onClose();
          }}
          className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] flex items-center gap-2.5 transition-colors"
        >
          <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
          <span>Open Folder</span>
        </button>

        {/* Archive extract (if applicable) */}
        {isCompleted && isArchive && onExtractArchive && (
          <button
            onClick={() => {
              onExtractArchive(d);
              onClose();
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] flex items-center gap-2.5 text-teal-400 transition-colors"
          >
            <Archive className="w-3.5 h-3.5" />
            <span>Extract Archive</span>
          </button>
        )}

        {/* Virus scan (if completed) */}
        {isCompleted && onDefenderScan && (
          <button
            onClick={() => {
              onDefenderScan(d);
              onClose();
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] flex items-center gap-2.5 text-blue-400 transition-colors"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Scan with Defender</span>
          </button>
        )}

        <div className="h-[1px] bg-[var(--border-subtle)] my-1" />

        {/* Move / Rename */}
        <button
          onClick={() => {
            onMoveRename(d);
            onClose();
          }}
          className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] flex items-center gap-2.5 transition-colors"
        >
          <Edit3 className="w-3.5 h-3.5 text-blue-400" />
          <span>Move / Rename...</span>
        </button>

        {/* Redownload */}
        <button
          onClick={() => {
            onRedownload(d);
            onClose();
          }}
          className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] flex items-center gap-2.5 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5 text-teal-400" />
          <span>Redownload</span>
        </button>

        <div className="h-[1px] bg-[var(--border-subtle)] my-1" />

        {/* Resume Download */}
        <button
          disabled={!canResume}
          onClick={() => {
            onResume(d);
            onClose();
          }}
          className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] disabled:opacity-35 disabled:hover:bg-transparent flex items-center gap-2.5 transition-colors"
        >
          <Play className="w-3.5 h-3.5 text-emerald-400" />
          <span>Resume Download</span>
        </button>

        {/* Stop Download */}
        <button
          disabled={!isDownloading}
          onClick={() => {
            onStop(d);
            onClose();
          }}
          className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] disabled:opacity-35 disabled:hover:bg-transparent flex items-center gap-2.5 transition-colors"
        >
          <Pause className="w-3.5 h-3.5 text-amber-400" />
          <span>Stop Download</span>
        </button>

        {/* Refresh Download Address */}
        <button
          onClick={() => {
            onRefreshAddress(d);
            onClose();
          }}
          className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] flex items-center gap-2.5 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5 text-indigo-400" />
          <span>Refresh Download Address</span>
        </button>

        {/* Grab URL from browser */}
        {onGrabUrlFromBrowser && (
          <button
            onClick={() => {
              onGrabUrlFromBrowser(d);
              onClose();
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] flex items-center gap-2.5 text-purple-400 transition-colors"
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Grab URL from browser</span>
          </button>
        )}

        <div className="h-[1px] bg-[var(--border-subtle)] my-1" />

        {/* Add to queue submenu */}
        <div
          className="relative"
          onMouseEnter={() => setShowQueueSubmenu(true)}
          onMouseLeave={() => setShowQueueSubmenu(false)}
        >
          <button className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] flex items-center justify-between transition-colors">
            <div className="flex items-center gap-2.5">
              <ListPlus className="w-3.5 h-3.5 text-purple-400" />
              <span>Add to queue</span>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
          </button>

          {showQueueSubmenu && (
            <div className="absolute left-full top-0 ml-1 w-48 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-2xl py-1 z-50">
              {queues.length === 0 ? (
                <div className="px-3 py-1.5 text-[11px] text-[var(--text-disabled)]">No queues created</div>
              ) : (
                queues.map((q) => (
                  <button
                    key={q.id}
                    onClick={() => {
                      onAddToQueue(d, q.id);
                      onClose();
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] flex items-center justify-between text-xs transition-colors"
                  >
                    <span className="truncate">{q.name}</span>
                    {d.queueId === q.id && <span className="text-[10px] text-purple-400">Current</span>}
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Delete from Queue */}
        <button
          disabled={!d.queueId}
          onClick={() => {
            onDeleteFromQueue(d);
            onClose();
          }}
          className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] disabled:opacity-35 disabled:hover:bg-transparent flex items-center gap-2.5 transition-colors"
        >
          <ListMinus className="w-3.5 h-3.5 text-rose-400" />
          <span>Delete from Queue</span>
        </button>

        <div className="h-[1px] bg-[var(--border-subtle)] my-1" />

        {/* Share */}
        {onShare && (
          <button
            onClick={() => {
              onShare(d);
              onClose();
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] flex items-center gap-2.5 text-purple-400 transition-colors"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>Share...</span>
          </button>
        )}

        {/* Properties */}
        <button
          onClick={() => {
            onProperties(d);
            onClose();
          }}
          className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] flex items-center gap-2.5 transition-colors"
        >
          <FileText className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
          <span>Properties</span>
        </button>
      </div>
    </div>
  );
};
