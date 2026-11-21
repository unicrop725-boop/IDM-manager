import React, { useState } from "react";
import { ModalCorner } from "./NotchCorner";
import { Pause, Play, Ban, EyeOff, Zap, CheckCircle2, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import { DownloadViz } from "./DownloadViz";
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
  const [showConns, setShowConns] = useState(false);
  const pct = d.totalSize && d.totalSize > 0
    ? Math.min(100, Math.max(0, (d.downloaded / d.totalSize) * 100))
    : 0;

  const isDownloading = d.state === "downloading" || d.state === "probing";
  const canResume = d.state === "paused" || d.state === "queued" || d.state === "failed";

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 select-none animate-in fade-in duration-150">
      <div className="notch-card w-[700px] max-w-[95vw] bg-[var(--bg-panel)] border border-[var(--border-subtle)] shadow-2xl overflow-hidden flex flex-col text-xs text-[var(--text-secondary)]">
        <ModalCorner onClose={onClose} />
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]">
          <div className="flex items-center gap-2 text-[var(--text-primary)] font-semibold text-sm truncate pr-4">
            <Zap className="w-4 h-4 text-purple-400 flex-shrink-0" />
            <span className="truncate">{d.fileName}</span>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6">
          {/* Metadata Grid */}
          <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] p-5 space-y-3.5">
            <div className="flex items-start gap-2">
              <span className="w-28 text-[var(--text-disabled)] font-medium flex-shrink-0">URL:</span>
              <span className="truncate text-[var(--text-primary)] font-mono text-[13px]" title={d.url}>
                {d.url}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-28 text-[var(--text-disabled)] font-medium">Status:</span>
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
                <span className="w-28 text-[var(--text-disabled)] font-medium">File Size:</span>
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
                <span className="w-28 text-[var(--text-disabled)] font-medium">Time Left:</span>
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
          </div>

          {/* Live visualisation: ticks, connection pills and a dot map of the file */}
          <DownloadViz d={d} pct={pct} active={isDownloading} />

          {/* Connection List */}
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => setShowConns((v) => !v)}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-primary)] hover:text-purple-400 transition-colors cursor-pointer"
            >
              {showConns ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              Connection details ({d.segments.length})
            </button>
            {showConns && (
            <div className="max-h-48 overflow-y-auto rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)] font-mono text-[11px]">
              {d.segments.map((s, idx) => {
                const segSpan = isUnbounded(s.end) ? 1 : Math.max(1, s.end - s.start + 1);
                const segDownloaded = Math.min(segSpan, s.downloaded);
                const isComplete = segDownloaded >= segSpan;
                return (
                  <div key={idx} className="flex items-center justify-between px-4 py-2.5">
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
            )}
          </div>
        </div>

        {/* Footer Action Buttons */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border-subtle)] bg-[var(--bg-card)]">
          <button
            onClick={() => {
              if (isDownloading) onPause(d.id);
              else if (canResume) onResume(d.id);
            }}
            className="px-5 py-2.5 rounded-lg bg-[var(--bg-hover)] hover:bg-[var(--border-subtle)] text-[var(--text-primary)] font-medium flex items-center gap-1.5 transition-colors"
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
              className="px-4 py-2.5 rounded-lg hover:bg-rose-500/20 text-rose-400 font-medium flex items-center gap-1.5 transition-colors"
            >
              <Ban className="w-3.5 h-3.5" />
              <span>Cancel</span>
            </button>

            <button
              onClick={onClose}
              className="px-6 py-2.5 rounded-lg gradient-accent hover:opacity-90 text-white font-medium flex items-center gap-1.5 transition-opacity shadow-sm"
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
