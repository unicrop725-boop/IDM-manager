import {
  Plus,
  Play,
  Pause,
  Square,
  Trash2,
  Settings as SettingsIcon,
  Search,
  Zap,
  Gauge,
  X,
} from "lucide-react";

interface Props {
  onAddClick: () => void;
  onOpenSettings: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedIds: string[];
  onResumeSelected: () => void;
  onPauseSelected: () => void;
  onCancelSelected: () => void;
  onDeleteSelected: () => void;
  turboMode: boolean;
  onToggleTurbo: () => void;
  adaptersCount: number;
  globalSpeedLimitMb: string;
  onGlobalSpeedLimitChange: (val: string) => void;
  onApplyGlobalLimit: () => void;
}

export default function TopBar({
  onAddClick,
  onOpenSettings,
  searchQuery,
  onSearchChange,
  selectedIds,
  onResumeSelected,
  onPauseSelected,
  onCancelSelected,
  onDeleteSelected,
  turboMode,
  onToggleTurbo,
  adaptersCount,
  globalSpeedLimitMb,
  onGlobalSpeedLimitChange,
  onApplyGlobalLimit,
}: Props) {
  const hasSelection = selectedIds.length > 0;

  return (
    <header className="flex h-14 items-center justify-between border-b border-white/10 bg-zinc-950/60 px-4 text-xs select-none">
      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={onAddClick}
          className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 font-medium text-black transition hover:bg-sky-400 shadow-sm"
        >
          <Plus size={15} />
          <span>Add URL</span>
        </button>

        <div className="h-4 w-[1px] bg-white/10 mx-1" />

        <button
          onClick={onResumeSelected}
          disabled={!hasSelection}
          className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 transition ${
            hasSelection
              ? "bg-white/5 text-emerald-400 hover:bg-white/10"
              : "text-zinc-600 cursor-not-allowed"
          }`}
          title="Resume Selected"
        >
          <Play size={14} />
          <span>Resume</span>
        </button>

        <button
          onClick={onPauseSelected}
          disabled={!hasSelection}
          className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 transition ${
            hasSelection
              ? "bg-white/5 text-amber-400 hover:bg-white/10"
              : "text-zinc-600 cursor-not-allowed"
          }`}
          title="Pause Selected"
        >
          <Pause size={14} />
          <span>Pause</span>
        </button>

        <button
          onClick={onCancelSelected}
          disabled={!hasSelection}
          className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 transition ${
            hasSelection
              ? "bg-white/5 text-zinc-300 hover:bg-white/10"
              : "text-zinc-600 cursor-not-allowed"
          }`}
          title="Cancel Selected"
        >
          <Square size={14} />
          <span>Stop</span>
        </button>

        <button
          onClick={onDeleteSelected}
          disabled={!hasSelection}
          className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 transition ${
            hasSelection
              ? "bg-white/5 text-red-400 hover:bg-white/10"
              : "text-zinc-600 cursor-not-allowed"
          }`}
          title="Delete Selected"
        >
          <Trash2 size={14} />
          <span>Delete</span>
        </button>
      </div>

      {/* Middle & Right: Search, Turbo, Limit, Settings */}
      <div className="flex items-center gap-3">
        {/* Search */}
        <div className="relative flex items-center">
          <Search size={14} className="absolute left-2.5 text-zinc-500 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search downloads (name, url, category)..."
            className="w-64 rounded-lg border border-white/10 bg-black/40 py-1.5 pr-7 pl-8 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-sky-500 transition"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange("")}
              className="absolute right-2 text-zinc-400 hover:text-white"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Turbo Mode Toggle */}
        <button
          onClick={onToggleTurbo}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 transition ${
            turboMode
              ? "border-violet-500/50 bg-violet-500/10 text-violet-300"
              : "border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10"
          }`}
          title={
            turboMode
              ? `Turbo Mode Active (${adaptersCount} networks bonded)`
              : "Enable Turbo Mode (multi-network bonding)"
          }
        >
          <Zap size={14} className={turboMode ? "text-violet-400 fill-violet-400" : ""} />
          <span className="font-medium">Turbo</span>
        </button>

        {/* Global Speed Limiter */}
        <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1">
          <Gauge size={13} className="text-zinc-400" />
          <span className="text-zinc-400">Limit:</span>
          <input
            type="text"
            value={globalSpeedLimitMb}
            onChange={(e) => onGlobalSpeedLimitChange(e.target.value)}
            onBlur={onApplyGlobalLimit}
            onKeyDown={(e) => e.key === "Enter" && onApplyGlobalLimit()}
            placeholder="Unlimited"
            className="w-14 bg-transparent text-right text-zinc-200 outline-none"
            title="Global Speed Limit in MB/s (Empty or 0 = unlimited)"
          />
          <span className="text-zinc-500 text-[10px]">MB/s</span>
        </div>

        {/* Settings button */}
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 p-2 text-zinc-300 hover:bg-white/10 hover:text-white transition"
          title="BoltGrab Settings"
        >
          <SettingsIcon size={15} />
        </button>
      </div>
    </header>
  );
}
