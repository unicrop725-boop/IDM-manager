import { HardDrive, X } from "lucide-react";

export interface SpaceAlertItem {
  id: string;
  fileName: string;
  /** e.g. "D:\" (empty when the path has no drive letter) */
  drive: string;
  /** The engine's own explanation, including how much space is needed and how much is free. */
  message: string;
}

interface Props {
  items: SpaceAlertItem[];
  onClean: (item: SpaceAlertItem) => void;
  onDismiss: (id: string) => void;
}

/**
 * Slides in from the right edge when a download cannot fit on its drive (or the drive filled up while
 * it was downloading), and offers to open Disk Cleaner on that drive. Deliberately large and red:
 * this is the one message that must not be missed.
 */
export function SpaceAlerts({ items, onClean, onDismiss }: Props) {
  if (items.length === 0) return null;
  return (
    <div
      className="fixed bottom-14 right-5 z-[70] flex w-[480px] max-w-[calc(100vw-2.5rem)] flex-col gap-3"
      aria-live="assertive"
    >
      {items.slice(-3).map((it) => (
        <div
          key={it.id}
          role="alert"
          className="space-alert overflow-hidden rounded-2xl border-2 border-red-500/70 bg-[var(--bg-panel)] text-[var(--text-secondary)]"
        >
          {/* Red header band */}
          <div className="flex items-center gap-4 bg-gradient-to-r from-red-600/35 via-red-500/20 to-transparent px-5 py-4">
            <div className="space-alert-icon relative flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-red-500 text-white shadow-lg">
              <HardDrive size={28} strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[19px] font-bold leading-tight text-[var(--text-primary)]">
                {it.drive ? `Not enough space on ${it.drive}` : "Not enough disk space"}
              </div>
              <div className="mt-1 break-all text-[14px] font-semibold text-red-300">{it.fileName}</div>
            </div>
            <button
              onClick={() => onDismiss(it.id)}
              aria-label="Dismiss"
              className="self-start rounded-md p-1.5 text-[var(--text-secondary)] hover:bg-white/10 hover:text-[var(--text-primary)]"
            >
              <X size={18} />
            </button>
          </div>

          <div className="px-5 pb-5 pt-4">
            <p className="text-[14px] leading-relaxed text-[var(--text-primary)]">{it.message}</p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => onDismiss(it.id)}
                className="h-11 rounded-xl bg-[var(--bg-hover)] px-5 text-[14px] font-medium text-[var(--text-primary)] hover:brightness-125"
              >
                Not now
              </button>
              <button
                onClick={() => onClean(it)}
                className="h-11 rounded-xl bg-red-500 px-6 text-[14px] font-bold text-white shadow-lg shadow-red-500/30 hover:bg-red-400"
              >
                Clean drive
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
