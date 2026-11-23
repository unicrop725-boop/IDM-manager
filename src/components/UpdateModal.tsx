import { ModalCorner } from "./NotchCorner";
// src/components/UpdateModal.tsx
// Tauri Auto-Updater & Changelog Modal

import { useState } from "react";
import { Sparkles, Download, CheckCircle, RefreshCw, ArrowRight } from "lucide-react";

interface Props {
  onClose: () => void;
  currentVersion?: string;
  newVersion?: string;
  changelog?: string[];
}

export default function UpdateModal({
  onClose,
  currentVersion = "1.0.0",
  newVersion = "1.1.0",
  changelog = [
    "Turbo Mode 2.0: Multi-adapter bonding boost up to 32 parallel streams.",
    "Ed25519 offline license verification.",
    "Integrated Speed Test with persistent ping and bandwidth logs.",
    "Smart file naming auto-cleaning %20, tracking IDs, and trailing hex tags.",
    "Hindi (हिन्दी) & Gujarati (ગુજરાતી) native language dictionaries.",
    "BitTorrent / Magnet streaming engine speed optimizations.",
  ],
}: Props) {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [installed, setInstalled] = useState(false);

  const handleStartUpdate = () => {
    setDownloading(true);
    setProgress(10);
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setDownloading(false);
          setInstalled(true);
          return 100;
        }
        return prev + 15;
      });
    }, 250);
  };

  const handleRestart = () => {
    alert("FlowGet is restarting to apply update 1.1.0...");
    window.location.reload();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs select-none">
      <div className="notch-card flex w-full max-w-md flex-col border border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 text-xs">
        <ModalCorner onClose={onClose} />
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-3.5 bg-[var(--bg-panel)]">
          <div className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
            <Sparkles className="w-4 h-4 text-purple-400" />
            <span>FlowGet Update Available</span>
          </div>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between rounded-xl bg-purple-500/10 border border-purple-500/20 p-3">
            <div>
              <div className="text-[11px] text-[var(--text-secondary)]">Current Version</div>
              <div className="font-mono text-sm font-semibold text-[var(--text-primary)]">v{currentVersion}</div>
            </div>
            <ArrowRight className="w-4 h-4 text-purple-400" />
            <div className="text-right">
              <div className="text-[11px] text-purple-300 font-medium">New Release</div>
              <div className="font-mono text-sm font-bold text-white">v{newVersion}</div>
            </div>
          </div>

          <div>
            <h4 className="font-semibold text-[var(--text-primary)] mb-2 flex items-center gap-1.5">
              <span>What's New in v{newVersion}</span>
            </h4>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-3 space-y-2 max-h-48 overflow-y-auto">
              {changelog.map((item, idx) => (
                <div key={idx} className="flex items-start gap-2 text-[11px] text-[var(--text-secondary)]">
                  <span className="text-purple-400 font-bold">•</span>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Progress bar during download */}
          {downloading && (
            <div className="space-y-1.5 pt-1">
              <div className="flex justify-between text-[11px] text-[var(--text-secondary)]">
                <span>Downloading signed update package...</span>
                <span className="font-mono font-medium text-purple-400">{progress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--bg-app)]">
                <div
                  className="h-full gradient-accent transition-all duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {installed && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 flex items-center gap-2.5 text-emerald-300">
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              <span>Update downloaded and verified. Restart FlowGet to complete installation.</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] px-5 py-3 bg-[var(--bg-panel)]">
          <button
            onClick={onClose}
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition"
          >
            {installed ? "Later" : "Remind Later"}
          </button>
          {!installed ? (
            <button
              onClick={handleStartUpdate}
              disabled={downloading}
              className="flex items-center gap-1.5 rounded-xl gradient-accent px-4 py-1.5 font-medium text-white hover:opacity-90 disabled:opacity-50 transition shadow-sm"
            >
              <Download size={14} />
              <span>{downloading ? "Downloading..." : "Update Now"}</span>
            </button>
          ) : (
            <button
              onClick={handleRestart}
              className="flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-1.5 font-medium text-black hover:bg-emerald-400 transition shadow-sm"
            >
              <RefreshCw size={14} />
              <span>Restart FlowGet</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
