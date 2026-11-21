import React, { useState } from "react";
import {

  FileText,
  FileSymlink,
  FilePen,
  FileDown,
  FolderOpen,
  CirclePlay,
  CircleStop,
  RefreshCw,
  ListPlus,
  CircleMinus,
  Info,
  ChevronRight,
  ShieldAlert,
  Archive,
  Globe,
  Share2,
  type LucideIcon,
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

interface ItemProps {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  trailing?: React.ReactNode;
}

const Item: React.FC<ItemProps> = ({ icon: Icon, label, onClick, disabled, trailing }) => (
  <button
    disabled={disabled}
    onClick={onClick}
    className="w-full text-left px-4 py-[7px] flex items-center gap-3.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:text-[var(--text-disabled)] disabled:hover:bg-transparent transition-colors"
  >
    <Icon className="w-[15px] h-[15px] flex-shrink-0" strokeWidth={1.5} />
    <span className="flex-1 truncate">{label}</span>
    {trailing}
  </button>
);

const Divider: React.FC = () => <div className="h-[1px] bg-[var(--border-subtle)] mx-4 my-1.5" />;

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
  const menuWidth = 250;
  const menuHeight = 440;
  const left = Math.min(position.x, window.innerWidth - menuWidth - 10);
  const top = Math.min(position.y, window.innerHeight - menuHeight - 10);

  const run = (fn: (d: DownloadInfo) => void) => () => {
    fn(d);
    onClose();
  };

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
        className="absolute w-60 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-2xl py-2.5 z-50 animate-in fade-in zoom-in-95 duration-150"
      >
        <Item icon={FileText} label="Open" disabled={!isCompleted} onClick={run(onOpen)} />
        <Item icon={FileSymlink} label="Open With" disabled={!isCompleted} onClick={run(onOpenWith)} />
        <Item icon={FolderOpen} label="Open Folder" onClick={run(onOpenFolder)} />
        {isCompleted && isArchive && onExtractArchive && (
          <Item icon={Archive} label="Extract Archive" onClick={run(onExtractArchive)} />
        )}
        {isCompleted && onDefenderScan && (
          <Item icon={ShieldAlert} label="Scan with Defender" onClick={run(onDefenderScan)} />
        )}

        <Divider />

        <Item icon={FilePen} label="Move/Rename" onClick={run(onMoveRename)} />
        <Item icon={FileDown} label="Redownload" onClick={run(onRedownload)} />

        <Divider />

        <Item icon={CirclePlay} label="Resume Download" disabled={!canResume} onClick={run(onResume)} />
        <Item icon={CircleStop} label="Stop Download" disabled={!isDownloading} onClick={run(onStop)} />
        <Item icon={RefreshCw} label="Refresh Download Address" onClick={run(onRefreshAddress)} />
        {onGrabUrlFromBrowser && (
          <Item icon={Globe} label="Grab URL from browser" onClick={run(onGrabUrlFromBrowser)} />
        )}

        <Divider />

        {/* Add to queue submenu */}
        <div
          className="relative"
          onMouseEnter={() => setShowQueueSubmenu(true)}
          onMouseLeave={() => setShowQueueSubmenu(false)}
        >
          <Item
            icon={ListPlus}
            label="Add to queue"
            trailing={<ChevronRight className="w-3.5 h-3.5 text-[var(--text-secondary)]" />}
          />
          {showQueueSubmenu && (
            <div className="absolute left-full top-0 ml-1 w-48 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-2xl py-2 z-50">
              {queues.length === 0 ? (
                <div className="px-4 py-1.5 text-[11px] text-[var(--text-disabled)]">No queues created</div>
              ) : (
                queues.map((q) => (
                  <button
                    key={q.id}
                    onClick={() => {
                      onAddToQueue(d, q.id);
                      onClose();
                    }}
                    className="w-full text-left px-4 py-[7px] hover:bg-[var(--bg-hover)] flex items-center justify-between text-[12px] transition-colors"
                  >
                    <span className="truncate">{q.name}</span>
                    {d.queueId === q.id && <span className="text-[10px] text-purple-400">Current</span>}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        <Item icon={CircleMinus} label="Delete from Queue" disabled={!d.queueId} onClick={run(onDeleteFromQueue)} />

        <Divider />

        {onShare && <Item icon={Share2} label="Share" onClick={run(onShare)} />}
        <Item icon={Info} label="Properties" onClick={run(onProperties)} />
      </div>
    </div>
  );
};
