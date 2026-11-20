import React, { useState } from "react";
import {
  Link2,
  ArrowDown,
  Play,
  Pause,
  Octagon,
  Trash2,
  Settings,
  ListOrdered,
  CalendarClock,
  Share2,
} from "lucide-react";

interface ToolbarProps {
  onQuickAddUrl: (url: string) => void;
  onOpenAddModal: () => void;
  hasSelection: boolean;
  canResume: boolean;
  canPause: boolean;
  onResume: () => void;
  onPause: () => void;
  onStopAll: () => void;
  onDelete: () => void;
  onOpenOptions: () => void;
  onOpenQueues: () => void;
  onOpenSchedule: () => void;
  onShare: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  onQuickAddUrl,
  onOpenAddModal,
  hasSelection,
  canResume,
  canPause,
  onResume,
  onPause,
  onStopAll,
  onDelete,
  onOpenOptions,
  onOpenQueues,
  onOpenSchedule,
  onShare,
}) => {
  const [urlInput, setUrlInput] = useState("");

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = urlInput.trim();
    if (trimmed) {
      onQuickAddUrl(trimmed);
      setUrlInput("");
    } else {
      onOpenAddModal();
    }
  };

  return (
    <div className="h-20 w-full flex items-center px-4 gap-4 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] select-none">
      {/* Left: Add URL Input Pill */}
      <form onSubmit={handleSubmit} className="flex items-center gap-2 flex-shrink-0">
        <div className="relative flex items-center w-80">
          <Link2 className="w-4.5 h-4.5 absolute left-3.5 text-[var(--text-secondary)] pointer-events-none" />
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Add Url or paste link..."
            className="w-full h-10 pl-10 pr-3 bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] focus:bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-full text-xs text-[var(--text-primary)] placeholder-[var(--text-disabled)] focus:outline-none focus:border-purple-500/50 transition-all shadow-inner"
          />
        </div>
        <button
          type="submit"
          title="Download URL"
          className="w-10 h-10 rounded-full gradient-accent hover:opacity-90 active:scale-95 text-white flex items-center justify-center shadow-md transition-all flex-shrink-0 cursor-pointer"
        >
          <ArrowDown className="w-4.5 h-4.5 stroke-[2.5]" />
        </button>
      </form>

      <div className="h-10 w-[1px] bg-[var(--border-subtle)] mx-1" />

      {/* Action Buttons with icon on top, small label below */}
      <div className="flex items-center gap-1.5">
        {/* Resume */}
        <button
          type="button"
          onClick={onResume}
          disabled={!canResume}
          className="flex flex-col items-center justify-center w-16 h-14 rounded-xl hover:bg-[var(--bg-hover)] disabled:opacity-30 disabled:hover:bg-transparent transition-all group cursor-pointer"
        >
          <Play className="w-4.5 h-4.5 text-emerald-400 group-hover:scale-110 transition-transform" />
          <span className="text-[11px] font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] mt-1.5">Resume</span>
        </button>

        {/* Stop */}
        <button
          type="button"
          onClick={onPause}
          disabled={!canPause}
          className="flex flex-col items-center justify-center w-16 h-14 rounded-xl hover:bg-[var(--bg-hover)] disabled:opacity-30 disabled:hover:bg-transparent transition-all group cursor-pointer"
        >
          <Pause className="w-4.5 h-4.5 text-amber-400 group-hover:scale-110 transition-transform" />
          <span className="text-[11px] font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] mt-1.5">Stop</span>
        </button>

        {/* Stop All */}
        <button
          type="button"
          onClick={onStopAll}
          className="flex flex-col items-center justify-center w-16 h-14 rounded-xl hover:bg-[var(--bg-hover)] transition-all group cursor-pointer"
        >
          <Octagon className="w-4.5 h-4.5 text-rose-400 group-hover:scale-110 transition-transform" />
          <span className="text-[11px] font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] mt-1.5">Stop All</span>
        </button>

        {/* Delete */}
        <button
          type="button"
          onClick={onDelete}
          disabled={!hasSelection}
          className="flex flex-col items-center justify-center w-16 h-14 rounded-xl hover:bg-[var(--bg-hover)] disabled:opacity-30 disabled:hover:bg-transparent transition-all group cursor-pointer"
        >
          <Trash2 className="w-4.5 h-4.5 text-rose-400 group-hover:scale-110 transition-transform" />
          <span className="text-[11px] font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] mt-1.5">Delete</span>
        </button>

        <div className="h-8 w-[1px] bg-[var(--border-subtle)] mx-1" />

        {/* Options */}
        <button
          type="button"
          onClick={onOpenOptions}
          className="flex flex-col items-center justify-center w-16 h-14 rounded-xl hover:bg-[var(--bg-hover)] transition-all group cursor-pointer"
        >
          <Settings className="w-4.5 h-4.5 text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] group-hover:rotate-45 transition-all" />
          <span className="text-[11px] font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] mt-1.5">Options</span>
        </button>

        {/* Queues */}
        <button
          type="button"
          onClick={onOpenQueues}
          className="flex flex-col items-center justify-center w-16 h-14 rounded-xl hover:bg-[var(--bg-hover)] transition-all group cursor-pointer"
        >
          <ListOrdered className="w-4.5 h-4.5 text-purple-400 group-hover:scale-110 transition-transform" />
          <span className="text-[11px] font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] mt-1.5">Queues</span>
        </button>

        {/* Schedule */}
        <button
          type="button"
          onClick={onOpenSchedule}
          className="flex flex-col items-center justify-center w-16 h-14 rounded-xl hover:bg-[var(--bg-hover)] transition-all group cursor-pointer"
        >
          <CalendarClock className="w-4.5 h-4.5 text-teal-400 group-hover:scale-110 transition-transform" />
          <span className="text-[11px] font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] mt-1.5">Schedule</span>
        </button>

        {/* Share */}
        <button
          type="button"
          onClick={onShare}
          disabled={!hasSelection}
          className="flex flex-col items-center justify-center w-16 h-14 rounded-xl hover:bg-[var(--bg-hover)] disabled:opacity-30 disabled:hover:bg-transparent transition-all group cursor-pointer"
        >
          <Share2 className="w-4.5 h-4.5 text-sky-400 group-hover:scale-110 transition-transform" />
          <span className="text-[11px] font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] mt-1.5">Share</span>
        </button>
      </div>
    </div>
  );
};
