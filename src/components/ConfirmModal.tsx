import { AlertTriangle } from "lucide-react";
import { ModalCorner } from "./NotchCorner";

export interface ConfirmRequest {
  title: string;
  /** The item(s) concerned, shown prominently (e.g. a file name). */
  subject?: string;
  message: string;
  confirmLabel: string;
  /** Red confirm button for actions that remove something. */
  danger?: boolean;
  onConfirm: () => void;
}

interface Props extends ConfirmRequest {
  onClose: () => void;
}

/** BoltGrab's own "are you sure?" dialog, used instead of the browser's plain confirm() popup. */
export function ConfirmModal({ title, subject, message, confirmLabel, danger, onConfirm, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs select-none">
      <div className="notch-card w-full max-w-md border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-xs text-[var(--text-secondary)] shadow-2xl">
        <ModalCorner onClose={onClose} />
        <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-5 py-3.5 text-sm font-semibold text-[var(--text-primary)]">
          <AlertTriangle size={18} className={danger ? "text-red-400" : "text-amber-400"} />
          {title}
        </div>
        <div className="space-y-3 p-5">
          {subject && <div className="break-all font-medium text-[var(--text-primary)]">{subject}</div>}
          <p className="leading-relaxed">{message}</p>
          <div className="flex justify-end gap-2 pt-1">
            {/* Cancel is the default focus, so a stray Enter never confirms a removal. */}
            <button
              autoFocus
              onClick={onClose}
              className="rounded-lg bg-[var(--bg-hover)] px-3 py-1.5 font-medium text-[var(--text-primary)]"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                onConfirm();
                onClose();
              }}
              className={`rounded-lg px-3 py-1.5 font-medium ${
                danger ? "bg-red-500/20 text-red-200 hover:bg-red-500/30" : "bg-sky-500 text-black hover:bg-sky-400"
              }`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
