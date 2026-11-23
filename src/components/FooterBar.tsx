import React from "react";
import { CircleArrowDown, CircleArrowUp, Turtle, PauseCircle, Clock } from "lucide-react";
import type { BandwidthEffective } from "../types";

interface FooterBarProps {
  totalCount: number;
  selectedCount: number;
  totalDownloadBps: number;
  totalUploadBps: number;
  onOpenSpeedTest: () => void;
  /** What the bandwidth rules decide right now (slow mode, schedule, metered pause). */
  bandwidth?: BandwidthEffective | null;
  onToggleSlowMode?: () => void;
  onDownloadAnyway?: () => void;
}

export const FooterBar: React.FC<FooterBarProps> = ({
  totalCount,
  selectedCount,
  totalDownloadBps,
  totalUploadBps,
  onOpenSpeedTest,
  bandwidth,
  onToggleSlowMode,
  onDownloadAnyway,
}) => {
  const toMbs = (bps: number) => ((bps * 8) / (1024 * 1024)).toFixed(2);

  return (
    <footer className="h-12 w-full flex items-center justify-between px-5 grad-bar-up text-[var(--text-secondary)] select-none z-30">
      {/* Left: how many rows are selected (select all lives in the table header) */}
      <div className="flex items-center gap-3">
        {selectedCount > 0 && (
          <span className="text-[12px] text-purple-400 font-medium">
            {selectedCount} of {totalCount} selected
          </span>
        )}
      </div>

      {/* Right: Speed Test + Live Download & Upload Speeds */}
      <div className="flex items-center gap-4">
        {/* Bandwidth status: what is limiting or holding downloads right now */}
        {bandwidth?.reason && (
          <span
            title={bandwidth.reason}
            className={`flex max-w-[280px] items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
              bandwidth.paused ? "bg-amber-500/15 text-amber-300" : "bg-sky-500/15 text-sky-300"
            }`}
          >
            {bandwidth.paused ? <PauseCircle className="h-3.5 w-3.5 flex-shrink-0" /> : <Clock className="h-3.5 w-3.5 flex-shrink-0" />}
            <span className="truncate">{bandwidth.reason}</span>
            {bandwidth.meteredPause && onDownloadAnyway && (
              <button onClick={onDownloadAnyway} className="ml-1 flex-shrink-0 rounded bg-amber-400/20 px-1.5 py-0.5 text-amber-100 hover:bg-amber-400/30">
                Download anyway
              </button>
            )}
          </span>
        )}
        {onToggleSlowMode && (
          <button
            onClick={onToggleSlowMode}
            title={bandwidth?.slowMode ? "Slow mode is on. Click to download at full speed." : "Slow mode: keep downloads gentle so browsing stays smooth"}
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
              bandwidth?.slowMode ? "bg-emerald-500/20 text-emerald-300" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            }`}
          >
            <Turtle className="h-3.5 w-3.5" /> Slow mode
          </button>
        )}
        {/* Speed Test Button */}
        <button
          onClick={onOpenSpeedTest}
          title="Run Internet Speed Test"
          className="flex items-center gap-3 hover:opacity-90 transition-opacity cursor-pointer"
        >
          <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
            <defs>
              <linearGradient id="footerGaugeGrad" x1="3" y1="0" x2="27" y2="0" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#2DD4BF" />
                <stop offset="55%" stopColor="#A855F7" />
                <stop offset="100%" stopColor="#EC4899" />
              </linearGradient>
            </defs>
            <path
              d="M 5.5 22 A 12 12 0 1 1 24.5 22"
              stroke="url(#footerGaugeGrad)"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <path d="M 15 19 L 19.5 11.5" stroke="var(--text-primary)" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="15" cy="19" r="2" fill="var(--text-primary)" />
          </svg>
          <span className="text-[12px] text-[var(--text-primary)] whitespace-nowrap">Speed Test :</span>
        </button>

        {/* Live Download Speed */}
        <div className="flex items-center gap-2.5 ml-1">
          <CircleArrowDown className="w-6 h-6 text-[var(--text-secondary)]" strokeWidth={1.3} />
          <span className="text-[var(--text-primary)] whitespace-nowrap">
            <span className="text-[17px] font-medium">{toMbs(totalDownloadBps)}</span>
            <span className="text-[12px] ml-1.5">Mbs</span>
          </span>
        </div>

        {/* Live Upload Speed */}
        <div className="flex items-center gap-2.5 ml-3">
          <CircleArrowUp className="w-6 h-6 text-[var(--text-secondary)]" strokeWidth={1.3} />
          <span className="text-[var(--text-primary)] whitespace-nowrap">
            <span className="text-[17px] font-medium">{toMbs(totalUploadBps)}</span>
            <span className="text-[12px] ml-1.5">Mbs</span>
          </span>
        </div>
      </div>
    </footer>
  );
};
