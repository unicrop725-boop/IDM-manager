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
    <div className="h-16 w-full flex items-center px-4 gap-4 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] select-none">
      {/* Left: Add URL Input Pill */}
      <form onSubmit={handleSubmit} className="flex items-center gap-1.5 flex-shrink-0">
        <div className="relative flex items-center w-72">
          <Link2 className="w-4 h-4 absolute left-3.5 text-[var(--text-secondary)] pointer-events-none" />
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Add Url or paste link..."
            className="w-full h-9 pl-9 pr-3 bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] focus:bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-full text-xs text-[var(--text-primary)] placeholder-[var(--text-disabled)] focus:outline-none focus:border-purple-500/50 transition-all"
          />
        </div>
        <button
          type="submit"
          title="Download URL"
          className="w-9 h-9 rounded-full gradient-accent hover:opacity-90 active:scale-95 text-white flex items-center justify-center shadow-md transition-all flex-shrink-0"
        >
          <ArrowDown className="w-4 h-4 stroke-[2.5]" />
        </button>
      </form>

      <div className="h-8 w-[1px] bg-[var(--border-subtle)] mx-1" />

      {/* Action Buttons with icon on top, small label below */}
      <div className="flex items-center gap-1">
        {/* Resume */}
        <button
          onClick={onResume}
          disabled={!canResume}
          className="flex flex-col items-center justify-center w-14 h-12 rounded-lg hover:bg-[var(--bg-hover)] disabled:opacity-30 disabled:hover:bg-transparent transition-all group"
        >
          <Play className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
          <span className="text-[10px] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] mt-1">Resume</span>
        </button>

        {/* Stop */}
        <button
          onClick={onPause}
          disabled={!canPause}
          className="flex flex-col items-center justify-center w-14 h-12 rounded-lg hover:bg-[var(--bg-hover)] disabled:opacity-30 disabled:hover:bg-transparent transition-all group"
        >
          <Pause className="w-4 h-4 text-amber-400 group-hover:scale-110 transition-transform" />
          <span className="text-[10px] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] mt-1">Stop</span>
        </button>

        {/* Stop All */}
        <button
          onClick={onStopAll}
          className="flex flex-col items-center justify-center w-14 h-12 rounded-lg hover:bg-[var(--bg-hover)] transition-all group"
        >
          <Octagon className="w-4 h-4 text-rose-400 group-hover:scale-110 transition-transform" />
          <span className="text-[10px] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] mt-1">Stop All</span>
        </button>

        {/* Delete */}
        <button
          onClick={onDelete}
          disabled={!hasSelection}
          className="flex flex-col items-center justify-center w-14 h-12 rounded-lg hover:bg-[var(--bg-hover)] disabled:opacity-30 disabled:hover:bg-transparent transition-all group"
        >
          <Trash2 className="w-4 h-4 text-rose-400 group-hover:scale-110 transition-transform" />
          <span className="text-[10px] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] mt-1">Delete</span>
        </button>

        <div className="h-6 w-[1px] bg-[var(--border-subtle)] mx-1" />

        {/* Options */}
        <button
          onClick={onOpenOptions}
          className="flex flex-col items-center justify-center w-14 h-12 rounded-lg hover:bg-[var(--bg-hover)] transition-all group"
        >
          <Settings className="w-4 h-4 text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] group-hover:rotate-45 transition-all" />
          <span className="text-[10px] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] mt-1">Options</span>
        </button>

        {/* Queues */}
        <button
          onClick={onOpenQueues}
          className="flex flex-col items-center justify-center w-14 h-12 rounded-lg hover:bg-[var(--bg-hover)] transition-all group"
        >
          <ListOrdered className="w-4 h-4 text-purple-400 group-hover:scale-110 transition-transform" />
          <span className="text-[10px] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] mt-1">Queues</span>
        </button>

        {/* Schedule */}
        <button
          onClick={onOpenSchedule}
          className="flex flex-col items-center justify-center w-14 h-12 rounded-lg hover:bg-[var(--bg-hover)] transition-all group"
        >
          <CalendarClock className="w-4 h-4 text-teal-400 group-hover:scale-110 transition-transform" />
          <span className="text-[10px] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] mt-1">Schedule</span>
        </button>

        {/* Share */}
        <button
          onClick={onShare}
          disabled={!hasSelection}
          className="flex flex-col items-center justify-center w-14 h-12 rounded-lg hover:bg-[var(--bg-hover)] disabled:opacity-30 disabled:hover:bg-transparent transition-all group"
        >
          <Share2 className="w-4 h-4 text-sky-400 group-hover:scale-110 transition-transform" />
          <span className="text-[10px] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] mt-1">Share</span>
        </button>
      </div>
    </div>
  );
};
