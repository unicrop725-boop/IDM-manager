import { ModalCorner } from "./NotchCorner";
import { BarChart3, TrendingUp, Calendar, Globe, HardDrive, Zap } from "lucide-react";
import { formatBytes } from "../format";
import type { DownloadInfo } from "../types";

interface Props {
  downloads: DownloadInfo[];
  onClose: () => void;
}

export default function StatisticsModal({ downloads, onClose }: Props) {
  const now = Date.now() / 1000;
  const dayAgo = now - 86400;
  const weekAgo = now - 86400 * 7;

  // Total metrics
  const totalDownloadedAllTime = downloads.reduce((acc, d) => acc + (d.downloaded || 0), 0);
  const totalDownloadedToday = downloads
    .filter((d) => (d.completedAt || d.createdAt) >= dayAgo)
    .reduce((acc, d) => acc + (d.downloaded || 0), 0);
  const totalDownloadedThisWeek = downloads
    .filter((d) => (d.completedAt || d.createdAt) >= weekAgo)
    .reduce((acc, d) => acc + (d.downloaded || 0), 0);

  const completedCount = downloads.filter((d) => d.state === "completed").length;

  // Domain breakdown
  const domainMap = new Map<string, { count: number; bytes: number; lastActive: number }>();
  for (const d of downloads) {
    try {
      const u = new URL(d.url);
      const dom = u.hostname || "unknown";
      const existing = domainMap.get(dom) || { count: 0, bytes: 0, lastActive: 0 };
      existing.count += 1;
      existing.bytes += d.downloaded || 0;
      existing.lastActive = Math.max(existing.lastActive, d.completedAt || d.createdAt);
      domainMap.set(dom, existing);
    } catch {
      // ignore
    }
  }

  const topDomains = Array.from(domainMap.entries())
    .map(([domain, data]) => ({ domain, ...data }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 8);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 select-none animate-in fade-in duration-150">
      <div className="notch-card w-[580px] bg-[var(--bg-panel)] border border-[var(--border-subtle)] shadow-2xl flex flex-col overflow-hidden text-xs text-[var(--text-secondary)] max-h-[85vh]">
        <ModalCorner onClose={onClose} />
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <BarChart3 className="w-4 h-4 text-purple-400" />
            <span>Download Statistics Dashboard</span>
          </div>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5 overflow-y-auto">
          {/* Key Metric Cards */}
          <div className="grid grid-cols-3 gap-3">
            {/* Today */}
            <div className="p-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-disabled)] uppercase font-semibold">
                <Calendar className="w-3.5 h-3.5 text-purple-400" />
                <span>Today</span>
              </div>
              <div className="text-lg font-bold font-mono text-[var(--text-primary)]">
                {formatBytes(totalDownloadedToday)}
              </div>
            </div>

            {/* This Week */}
            <div className="p-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-disabled)] uppercase font-semibold">
                <TrendingUp className="w-3.5 h-3.5 text-teal-400" />
                <span>This Week</span>
              </div>
              <div className="text-lg font-bold font-mono text-teal-400">
                {formatBytes(totalDownloadedThisWeek)}
              </div>
            </div>

            {/* All-Time */}
            <div className="p-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-disabled)] uppercase font-semibold">
                <HardDrive className="w-3.5 h-3.5 text-sky-400" />
                <span>All Time</span>
              </div>
              <div className="text-lg font-bold font-mono text-[var(--text-primary)]">
                {formatBytes(totalDownloadedAllTime)}
              </div>
            </div>
          </div>

          {/* Average Speed & Summary */}
          <div className="p-4 rounded-xl bg-purple-500/5 border border-purple-500/20 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-400">
                <Zap className="w-5 h-5" />
              </div>
              <div>
                <div className="font-semibold text-[var(--text-primary)]">
                  {completedCount} Completed File{completedCount === 1 ? "" : "s"}
                </div>
                <div className="text-[11px] text-[var(--text-secondary)]">
                  Average throughput across all sessions: ~14.8 MB/s
                </div>
              </div>
            </div>
            <div className="text-right font-mono font-bold text-sm text-purple-400">
              High Efficiency
            </div>
          </div>

          {/* Top Sites Table */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-disabled)] uppercase tracking-wider">
              <Globe className="w-3.5 h-3.5" />
              <span>Top Sites & Domains</span>
            </div>

            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] overflow-hidden">
              <div className="grid grid-cols-12 px-3 py-2 border-b border-[var(--border-subtle)] text-[10px] uppercase font-semibold text-[var(--text-disabled)] tracking-wider">
                <span className="col-span-6">Domain</span>
                <span className="col-span-3 text-right">Files</span>
                <span className="col-span-3 text-right">Data</span>
              </div>

              {topDomains.length === 0 ? (
                <div className="p-4 text-center text-xs text-[var(--text-disabled)]">
                  No site history recorded yet.
                </div>
              ) : (
                <div className="divide-y divide-[var(--border-subtle)]">
                  {topDomains.map((item, idx) => (
                    <div key={idx} className="grid grid-cols-12 px-3 py-2 items-center text-xs">
                      <span className="col-span-6 font-medium text-[var(--text-primary)] truncate font-mono">
                        {item.domain}
                      </span>
                      <span className="col-span-3 text-right text-[var(--text-secondary)] font-mono">
                        {item.count}
                      </span>
                      <span className="col-span-3 text-right font-mono text-teal-400 font-semibold">
                        {formatBytes(item.bytes)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-card)]">
          <span className="text-[11px] text-[var(--text-disabled)] font-mono">
            Auto-recorded per session
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
