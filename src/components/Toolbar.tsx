import React, { useState } from "react";
import {
  Link2,
  CloudDownload,
  Play,
  Square,
  TimerOff,
  Trash2,
  Settings,
  Copy,
  CalendarClock,
  Forward,
  type LucideIcon,
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

interface ToolButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  color: string;
}

const ToolButton: React.FC<ToolButtonProps> = ({ icon: Icon, label, onClick, disabled, color }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="flex flex-col items-center justify-center w-[76px] h-[68px] rounded-xl text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-45 disabled:hover:bg-transparent transition-colors cursor-pointer group"
  >
    <Icon className={`w-7 h-7 ${color} group-hover:scale-110 transition-transform`} strokeWidth={1.7} />
    <span className="text-[12px] mt-1.5">{label}</span>
  </button>
);

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
    <div className="h-[84px] w-full flex items-center px-4 gap-5 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] select-none">
      {/* Left: Add URL Input */}
      <form onSubmit={handleSubmit} className="flex-1 min-w-[320px] max-w-[560px]">
        <div className="flex items-center w-full h-12 pl-4 pr-1.5 rounded-xl bg-[var(--bg-card)]">
          <Link2 className="w-5 h-5 text-[var(--text-secondary)] flex-shrink-0" strokeWidth={1.5} />
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Add Url"
            className="flex-1 min-w-0 h-full ml-3 bg-transparent text-[13px] text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none"
          />
          <button
            type="submit"
            title="Download URL"
            className="w-9 h-9 rounded-xl gradient-accent hover:opacity-90 active:scale-95 text-white flex items-center justify-center transition-all flex-shrink-0 cursor-pointer"
          >
            <CloudDownload className="w-5 h-5" strokeWidth={1.8} />
          </button>
        </div>
      </form>

      <div className="h-9 w-[1px] bg-[var(--border-subtle)] flex-shrink-0" />

      {/* Action Buttons: large icon on top, small label below */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <ToolButton icon={Play} label="Resume" color="text-emerald-400" onClick={onResume} disabled={!canResume} />
        <ToolButton icon={Square} label="Stop" color="text-amber-400" onClick={onPause} disabled={!canPause} />
        <ToolButton icon={TimerOff} label="Stop All" color="text-rose-400" onClick={onStopAll} />

        <div className="h-9 w-[1px] bg-[var(--border-subtle)] mx-2" />

        <ToolButton icon={Trash2} label="Delete" color="text-red-400" onClick={onDelete} disabled={!hasSelection} />
        <ToolButton icon={Settings} label="Options" color="text-sky-400" onClick={onOpenOptions} />
        <ToolButton icon={Copy} label="Queues" color="text-purple-400" onClick={onOpenQueues} />
        <ToolButton icon={CalendarClock} label="Schedule" color="text-teal-400" onClick={onOpenSchedule} />
        <ToolButton icon={Forward} label="Share" color="text-blue-400" onClick={onShare} disabled={!hasSelection} />
      </div>
    </div>
  );
};
