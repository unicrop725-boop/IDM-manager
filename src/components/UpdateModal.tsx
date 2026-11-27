import { ModalCorner } from "./NotchCorner";
// src/components/UpdateModal.tsx
// "Check for Updates": BoltGrab has no built-in updater yet, so this says so and points to the download page,
// instead of pretending an update exists.

import { useEffect, useState } from "react";
import { Sparkles, ExternalLink, ShieldCheck } from "lucide-react";
import { api } from "../api";
import { IS_DEMO } from "../demo/flag";

interface Props {
  onClose: () => void;
}

const DOWNLOAD_PAGE = "https://boltgrab.online/download/";

export default function UpdateModal({ onClose }: Props) {
  const [version, setVersion] = useState<string>("");

  useEffect(() => {
    if (IS_DEMO) {
      setVersion("demo");
      return;
    }
    import("@tauri-apps/api/app")
      .then((m) => m.getVersion())
      .then(setVersion)
      .catch(() => setVersion(""));
  }, []);

  const openDownloadPage = () => {
    Promise.resolve(api.openUrl(DOWNLOAD_PAGE)).catch(() => window.open(DOWNLOAD_PAGE, "_blank", "noopener"));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs select-none">
      <div className="notch-card flex w-full max-w-md max-h-[calc(100vh-2rem)] flex-col border border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 text-xs">
        <ModalCorner onClose={onClose} />
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-3.5 bg-[var(--bg-panel)]">
          <div className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
            <Sparkles className="w-4 h-4 text-purple-400" />
            <span>Check for Updates</span>
          </div>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="rounded-xl bg-purple-500/10 border border-purple-500/20 p-3">
            <div className="text-[11px] text-[var(--text-secondary)]">Installed version</div>
            <div className="font-mono text-sm font-semibold text-[var(--text-primary)]">{version ? `v${version}` : "unknown"}</div>
          </div>

          <div className="flex items-start gap-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-3 text-[var(--text-secondary)]">
            <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5 text-emerald-500" />
            <p>
              BoltGrab does not update itself yet. To get the newest version, download the installer from the website and run it over this
              one. Your downloads, settings and license are kept.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] px-5 py-3 bg-[var(--bg-panel)]">
          <button
            onClick={onClose}
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition"
          >
            Close
          </button>
          <button
            onClick={openDownloadPage}
            className="flex items-center gap-1.5 rounded-xl gradient-accent px-4 py-1.5 font-medium text-white hover:opacity-90 transition shadow-sm"
          >
            <ExternalLink size={14} />
            <span>Open download page</span>
          </button>
        </div>
      </div>
    </div>
  );
}
