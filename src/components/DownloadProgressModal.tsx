import React from "react";
import { X, Pause, Play, Ban, EyeOff, Zap, CheckCircle2, AlertCircle } from "lucide-react";
import { DownloadInfo } from "../types";
import { formatBytes, formatSpeed, formatEta, isUnbounded } from "../format";

interface DownloadProgressModalProps {
  download: DownloadInfo;
  onClose: () => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
}

export const DownloadProgressModal: React.FC<DownloadProgressModalProps> = ({
  download,
  onClose,
  onPause,
  onResume,
  onCancel,
}) => {
  const d = download;
  const pct = d.totalSize && d.totalSize > 0
    ? Math.min(100, Math.max(0, (d.downloaded / d.totalSize) * 100))
    : 0;

  const isDownloading = d.state === "downloading" || d.state === "probing";
  const canResume = d.state === "paused" || d.state === "queued" || d.state === "failed";

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 select-none animate-in fade-in duration-150">
      <div className="w-[560px] rounded-2xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] shadow-2xl overflow-hidden flex flex-col text-xs text-[var(--text-secondary)]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]">
          <div className="flex items-center gap-2 text-[var(--text-primary)] font-semibold text-sm truncate pr-4">
            <Zap className="w-4 h-4 text-purple-400 flex-shrink-0" />
            <span className="truncate">{d.fileName}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 space-y-4">
          {/* Metadata Grid */}
          <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] p-3 space-y-2">
            <div className="flex items-start gap-2">
              <span className="w-24 text-[var(--text-disabled)] font-medium flex-shrink-0">URL:</span>
              <span className="truncate text-[var(--text-primary)] font-mono text-[11px]" title={d.url}>
                {d.url}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-24 text-[var(--text-disabled)] font-medium">Status:</span>
                <span className="capitalize text-[var(--text-primary)] font-medium">{d.state}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[var(--text-disabled)]">Resume Support:</span>
                {d.resumeSupported === true ? (
                  <span className="text-emerald-400 flex items-center gap-1 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Yes
                  </span>
                ) : d.resumeSupported === false ? (
                  <span className="text-rose-400 flex items-center gap-1 font-medium">
                    <AlertCircle className="w-3.5 h-3.5" /> No
                  </span>
                ) : (
                  <span className="text-[var(--text-disabled)]">Checking...</span>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-24 text-[var(--text-disabled)] font-medium">File Size:</span>
                <span className="text-[var(--text-primary)] font-mono">
                  {formatBytes(d.downloaded)} of {formatBytes(d.totalSize)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[var(--text-disabled)]">Transfer Rate:</span>
                <span className="text-teal-400 font-mono font-medium">{formatSpeed(d.speedBps)}</span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-24 text-[var(--text-disabled)] font-medium">Time Left:</span>
                <span className="text-[var(--text-primary)] font-mono">{formatEta(d.etaSecs)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[var(--text-disabled)]">Protocol:</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--bg-hover)] text-purple-300 font-mono">
                  {d.protocol || "HTTP/1.1"}
                </span>
              </div>
            </div>
          </div>

          {/* Progress Bar & Percentage */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--text-primary)] font-semibold">{pct.toFixed(2)}%</span>
              <span className="text-[var(--text-secondary)] font-mono">
                {d.connections} {d.connections === 1 ? "Connection" : "Connections"}
              </span>
            </div>
            <div className="w-full h-3 rounded-full bg-[var(--bg-hover)] overflow-hidden p-0.5 border border-[var(--border-subtle)]">
              <div
                className="h-full rounded-full gradient-accent transition-all duration-200"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {/* Segment Map (visual bar showing each connection's part filling in) */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-semibold text-[var(--text-primary)]">
              Segment Allocation Map
            </span>
            <div className="w-full h-6 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] flex overflow-hidden p-0.5 gap-0.5">
              {d.segments.length === 0 ? (
                <div className="w-full h-full bg-[var(--bg-hover)] rounded flex items-center justify-center text-[10px] text-[var(--text-disabled)]">
                  Probing segment map...
                </div>
              ) : (
                d.segments.map((s, idx) => {
                  const segSpan = isUnbounded(s.end) ? 1 : Math.max(1, s.end - s.start + 1);
                  const segDownloaded = Math.min(segSpan, s.downloaded);
                  const segPct = (segDownloaded / segSpan) * 100;
                  return (
                    <div
                      key={idx}
                      className="h-full bg-[var(--bg-hover)] rounded relative overflow-hidden flex-1 group"
                      title={`Segment #${s.index + 1}: ${formatBytes(segDownloaded)} / ${formatBytes(segSpan)} (${segPct.toFixed(1)}%)`}
                    >
                      <div
                        className="h-full gradient-accent opacity-90 transition-all duration-200"
                        style={{ width: `${segPct}%` }}
                      />
                      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-mono text-[var(--text-primary)] pointer-events-none drop-shadow">
                        #{s.index + 1}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Connection List */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-semibold text-[var(--text-primary)]">
              Active Connections ({d.segments.length})
            </span>
            <div className="max-h-32 overflow-y-auto rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)] font-mono text-[11px]">
              {d.segments.map((s, idx) => {
                const segSpan = isUnbounded(s.end) ? 1 : Math.max(1, s.end - s.start + 1);
                const segDownloaded = Math.min(segSpan, s.downloaded);
                const isComplete = segDownloaded >= segSpan;
                return (
                  <div key={idx} className="flex items-center justify-between px-3 py-1.5">
                    <span className="text-purple-400 font-semibold">Conn #{idx + 1}</span>
                    <span className="text-[var(--text-secondary)]">
                      {formatBytes(s.start)} - {isUnbounded(s.end) ? "EOF" : formatBytes(s.end)}
                    </span>
                    <span className={isComplete ? "text-emerald-400" : "text-teal-400"}>
                      {isComplete ? "Finished" : formatBytes(segDownloaded)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer Action Buttons */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-card)]">
          <button
            onClick={() => {
              if (isDownloading) onPause(d.id);
              else if (canResume) onResume(d.id);
            }}
            className="px-3.5 py-1.5 rounded-lg bg-[var(--bg-hover)] hover:bg-[var(--border-subtle)] text-[var(--text-primary)] font-medium flex items-center gap-1.5 transition-colors"
          >
            {isDownloading ? (
              <>
                <Pause className="w-3.5 h-3.5 text-amber-400" />
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 text-emerald-400" />
                <span>Resume</span>
              </>
            )}
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onCancel(d.id)}
              className="px-3 py-1.5 rounded-lg hover:bg-rose-500/20 text-rose-400 font-medium flex items-center gap-1.5 transition-colors"
            >
              <Ban className="w-3.5 h-3.5" />
              <span>Cancel</span>
            </button>

            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg gradient-accent hover:opacity-90 text-white font-medium flex items-center gap-1.5 transition-opacity shadow-sm"
            >
              <EyeOff className="w-3.5 h-3.5" />
              <span>Hide</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
