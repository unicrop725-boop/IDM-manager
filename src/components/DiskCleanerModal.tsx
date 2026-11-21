import { Select } from "./Select";
import { ModalCorner } from "./NotchCorner";
import { useState } from "react";
import { Trash2, CheckCircle2, HardDrive, Clock } from "lucide-react";
import { DownloadInfo } from "../types";
import { formatBytes } from "../format";

interface DiskCleanerModalProps {
  downloads: DownloadInfo[];
  onClose: () => void;
  onClean: (targetIds: string[], deleteFiles: boolean) => Promise<void>;
}

export const DiskCleanerModal: React.FC<DiskCleanerModalProps> = ({
  downloads,
  onClose,
  onClean,
}) => {
  const [cleaning, setCleaning] = useState(false);
  const [cleanFinished, setCleanFinished] = useState(true);
  const [cleanDuplicates, setCleanDuplicates] = useState(true);
  const [cleanTempFiles, setCleanTempFiles] = useState(true);
  const [olderThanDays, setOlderThanDays] = useState(30);
  const [completedScan, setCompletedScan] = useState(false);
  const [cleanedCount, setCleanedCount] = useState(0);

  // Group downloads by URL to find duplicates
  const urlMap = new Map<string, DownloadInfo[]>();
  downloads.forEach((d) => {
    const list = urlMap.get(d.url) || [];
    list.push(d);
    urlMap.set(d.url, list);
  });

  const duplicateItems: DownloadInfo[] = [];
  urlMap.forEach((list) => {
    if (list.length > 1) {
      duplicateItems.push(...list.slice(1));
    }
  });

  // Filter finished items older than X days
  const nowSecs = Date.now() / 1000;
  const cutoffSecs = nowSecs - olderThanDays * 86400;

  const finishedItems = downloads.filter((d) => {
    if (d.state !== "completed") return false;
    const timeRef = d.completedAt || d.createdAt;
    return timeRef <= cutoffSecs;
  });

  const failedOrCancelledItems = downloads.filter((d) => d.state === "failed" || d.state === "cancelled");

  const totalFinishedBytes = finishedItems.reduce((acc, d) => acc + (d.totalSize || 0), 0);
  const totalDuplicateBytes = duplicateItems.reduce((acc, d) => acc + (d.totalSize || 0), 0);
  const totalTempBytes = failedOrCancelledItems.reduce((acc, d) => acc + (d.downloaded || 0), 0);

  const totalReclaimableBytes =
    (cleanFinished ? totalFinishedBytes : 0) +
    (cleanDuplicates ? totalDuplicateBytes : 0) +
    (cleanTempFiles ? totalTempBytes : 0);

  const handleCleanNow = async () => {
    setCleaning(true);
    const idsToDelete = new Set<string>();

    if (cleanFinished) {
      finishedItems.forEach((d) => idsToDelete.add(d.id));
    }
    if (cleanDuplicates) {
      duplicateItems.forEach((d) => idsToDelete.add(d.id));
    }
    if (cleanTempFiles) {
      failedOrCancelledItems.forEach((d) => idsToDelete.add(d.id));
    }

    try {
      await onClean(Array.from(idsToDelete), true);
      setCleanedCount(idsToDelete.size);
      setCompletedScan(true);
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 select-none animate-in fade-in duration-150">
      <div className="notch-card w-[520px] bg-[var(--bg-panel)] border border-[var(--border-subtle)] shadow-2xl overflow-hidden flex flex-col text-xs text-[var(--text-secondary)]">
        <ModalCorner onClose={onClose} />
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]">
          <div className="flex items-center gap-2 text-[var(--text-primary)] font-semibold text-sm">
            <HardDrive className="w-4 h-4 text-teal-400" />
            <span>Disk Space Cleaner</span>
          </div>
        </div>

        {/* Content */}
        {completedScan ? (
          <div className="p-8 flex flex-col items-center justify-center space-y-4 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[var(--text-primary)]">Disk Cleanup Finished!</h3>
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                Successfully purged {cleanedCount} items and reclaimed {formatBytes(totalReclaimableBytes)}.
              </p>
            </div>
            <button
              onClick={onClose}
              className="mt-4 px-5 py-2 rounded-xl gradient-accent text-white font-medium hover:opacity-90 transition-all shadow-md"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <div className="p-3.5 rounded-xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-between">
              <div>
                <div className="text-[11px] text-teal-300 font-semibold uppercase tracking-wider">Total Space You Can Free</div>
                <div className="text-2xl font-extrabold text-[var(--text-primary)] font-mono mt-0.5">
                  {formatBytes(totalReclaimableBytes)}
                </div>
              </div>
              <HardDrive className="w-8 h-8 text-teal-400/80" />
            </div>

            <div className="space-y-2.5">
              {/* Option 1: Duplicates */}
              <label className="flex items-start gap-3 p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer">
                <input
                  type="checkbox"
                  checked={cleanDuplicates}
                  onChange={(e) => setCleanDuplicates(e.target.checked)}
                  className="mt-0.5 rounded text-purple-600 focus:ring-0"
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[var(--text-primary)]">Duplicate Files</span>
                    <span className="font-mono text-purple-400 font-bold">{formatBytes(totalDuplicateBytes)}</span>
                  </div>
                  <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                    Found {duplicateItems.length} duplicate downloads with identical URLs.
                  </p>
                </div>
              </label>

              {/* Option 2: Finished Downloads older than X days */}
              <div className="p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-2">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cleanFinished}
                    onChange={(e) => setCleanFinished(e.target.checked)}
                    className="mt-0.5 rounded text-purple-600 focus:ring-0"
                  />
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[var(--text-primary)]">Older Finished Downloads</span>
                      <span className="font-mono text-teal-400 font-bold">{formatBytes(totalFinishedBytes)}</span>
                    </div>
                    <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                      Found {finishedItems.length} finished files older than selected duration.
                    </p>
                  </div>
                </label>

                <div className="flex items-center gap-2 pl-7 pt-1 text-[11px]">
                  <Clock className="w-3.5 h-3.5 text-[var(--text-disabled)]" />
                  <span className="text-[var(--text-secondary)]">Older than:</span>
                  <Select
                    value={olderThanDays}
                    onChange={(e) => setOlderThanDays(Number(e.target.value))}
                    className="px-2 py-1 rounded-lg bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none cursor-pointer"
                  >
                    <option value={7}>7 Days</option>
                    <option value={14}>14 Days</option>
                    <option value={30}>30 Days (1 Month)</option>
                    <option value={90}>90 Days (3 Months)</option>
                    <option value={0}>All Finished Downloads</option>
                  </Select>
                </div>
              </div>

              {/* Option 3: Leftover Temp & Incomplete files */}
              <label className="flex items-start gap-3 p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer">
                <input
                  type="checkbox"
                  checked={cleanTempFiles}
                  onChange={(e) => setCleanTempFiles(e.target.checked)}
                  className="mt-0.5 rounded text-purple-600 focus:ring-0"
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[var(--text-primary)]">Leftover Temp & Incomplete Files</span>
                    <span className="font-mono text-amber-400 font-bold">{formatBytes(totalTempBytes)}</span>
                  </div>
                  <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                    Found {failedOrCancelledItems.length} failed or cancelled download{failedOrCancelledItems.length === 1 ? "" : "s"} with partial data.
                  </p>
                </div>
              </label>
            </div>
          </div>
        )}

        {/* Footer */}
        {!completedScan && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-card)]">
            <span className="text-[11px] text-[var(--text-disabled)] font-mono">
              Safe Cleanup: Only selected files removed
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 rounded-xl hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCleanNow}
                disabled={cleaning || totalReclaimableBytes === 0}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl gradient-accent text-white font-medium hover:opacity-90 active:scale-95 disabled:opacity-50 transition-all shadow-md"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{cleaning ? "Cleaning..." : `Clean Free Space (${formatBytes(totalReclaimableBytes)})`}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
