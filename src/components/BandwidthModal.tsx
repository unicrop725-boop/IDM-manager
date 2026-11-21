import { ModalCorner } from "./NotchCorner";
import { Activity } from "lucide-react";
import { formatSpeed } from "../format";
import type { AdapterInfo, DownloadInfo } from "../types";

interface Props {
  downloads: DownloadInfo[];
  adapters?: AdapterInfo[];
  onClose: () => void;
}

export default function BandwidthModal({ downloads, onClose }: Props) {
  const activeDownloads = downloads.filter((d) => d.state === "downloading");
  const flowgetSpeedBps = activeDownloads.reduce((acc, d) => acc + (d.speedBps || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 select-none animate-in fade-in duration-150">
      <div className="notch-card w-[500px] bg-[var(--bg-panel)] border border-[var(--border-subtle)] shadow-2xl flex flex-col overflow-hidden text-xs text-[var(--text-secondary)]">
        <ModalCorner onClose={onClose} />
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <Activity className="w-4 h-4 text-purple-400" />
            <span>Per-App Bandwidth View</span>
          </div>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5">
          {/* Summary Card */}
          <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] text-[var(--text-disabled)] uppercase font-semibold">FlowGet Usage</span>
                <div className="text-xl font-bold font-mono text-purple-400 mt-0.5">
                  {formatSpeed(flowgetSpeedBps)}
                </div>
              </div>
            </div>

          </div>

          {/* Apps Breakdown List */}
          <div className="space-y-2">
            <div className="text-[11px] font-semibold text-[var(--text-disabled)] uppercase tracking-wider">
              Network Traffic by Application
            </div>

            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] divide-y divide-[var(--border-subtle)]">
              {/* FlowGet */}
              <div className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-400 font-bold text-xs">
                    FG
                  </div>
                  <div>
                    <div className="font-semibold text-[var(--text-primary)]">FlowGet Download Manager</div>
                    <div className="text-[11px] text-purple-300">
                      {activeDownloads.length} active connection{activeDownloads.length === 1 ? "" : "s"}
                    </div>
                  </div>
                </div>
                <div className="text-right font-mono font-semibold text-purple-400">
                  {formatSpeed(flowgetSpeedBps)}
                </div>
              </div>

            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-card)]">
          <span className="text-[11px] text-[var(--text-disabled)] font-mono">
            Updated every 500ms
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl gradient-accent text-white font-medium hover:opacity-90 transition-all shadow-md"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
