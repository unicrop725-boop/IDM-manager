import React from "react";
import { Gauge, ArrowDown, ArrowUp } from "lucide-react";
import { formatSpeedMbps } from "../format";

interface FooterBarProps {
  totalCount: number;
  selectedCount: number;
  allSelected: boolean;
  onToggleSelectAll: () => void;
  totalDownloadBps: number;
  totalUploadBps: number;
  onOpenSpeedTest: () => void;
}

export const FooterBar: React.FC<FooterBarProps> = ({
  totalCount,
  selectedCount,
  allSelected,
  onToggleSelectAll,
  totalDownloadBps,
  totalUploadBps,
  onOpenSpeedTest,
}) => {
  return (
    <footer className="h-9 w-full flex items-center justify-between px-3.5 border-t border-[var(--border-subtle)] bg-[var(--bg-panel)] text-xs text-[var(--text-secondary)] select-none z-30">
      {/* Left: Select All Checkbox + Count */}
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 cursor-pointer group">
          <input
            type="checkbox"
            checked={allSelected && totalCount > 0}
            onChange={onToggleSelectAll}
            className="w-3.5 h-3.5 rounded border-[var(--border-subtle)] bg-[var(--bg-card)] accent-purple-600 cursor-pointer"
          />
          <span className="text-[11px] group-hover:text-[var(--text-primary)] transition-colors">
            Select All
          </span>
        </label>
        {selectedCount > 0 && (
          <span className="text-[10px] text-purple-400 font-medium">
            ({selectedCount} of {totalCount} selected)
          </span>
        )}
      </div>

      {/* Right: Speed Test + Live Download & Upload Speeds */}
      <div className="flex items-center gap-4 text-xs font-mono">
        {/* Speed Test Button */}
        <button
          onClick={onOpenSpeedTest}
          title="Run Internet Speed Test"
          className="flex items-center gap-1.5 px-2 py-0.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-teal-400 transition-colors"
        >
          <Gauge className="w-3.5 h-3.5" />
          <span className="text-[11px] font-sans">Speed Test</span>
        </button>

        <div className="h-3 w-[1px] bg-[var(--border-subtle)]" />

        {/* Live Download Speed */}
        <div className="flex items-center gap-1 text-emerald-400 font-medium">
          <ArrowDown className="w-3.5 h-3.5 stroke-[2.5]" />
          <span>{formatSpeedMbps(totalDownloadBps)}</span>
        </div>

        {/* Live Upload Speed */}
        <div className="flex items-center gap-1 text-sky-400 font-medium">
          <ArrowUp className="w-3.5 h-3.5 stroke-[2.5]" />
          <span>{formatSpeedMbps(totalUploadBps)}</span>
        </div>
      </div>
    </footer>
  );
};
