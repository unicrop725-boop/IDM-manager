import React from "react";
import { Minus, Square, X, Sun, Moon, Zap } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface TitleBarProps {
  theme: "dark" | "light";
  onToggleTheme: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({ theme, onToggleTheme }) => {
  const handleMinimize = async () => {
    try {
      const win = getCurrentWindow();
      await win.minimize();
    } catch (e) {
      console.error("Window minimize error:", e);
    }
  };

  const handleMaximize = async () => {
    try {
      const win = getCurrentWindow();
      await win.toggleMaximize();
    } catch (e) {
      console.error("Window toggleMaximize error:", e);
    }
  };

  const handleClose = async () => {
    try {
      const win = getCurrentWindow();
      await win.close();
    } catch (e) {
      console.error("Window close error:", e);
    }
  };

  return (
    <div
      data-tauri-drag-region
      className="h-9 w-full flex items-center justify-between px-3 select-none border-b border-[var(--border-subtle)] bg-[var(--bg-app)] z-50 text-[var(--text-secondary)]"
    >
      {/* Left: App Logo + Title */}
      <div className="flex items-center gap-2 pointer-events-none">
        <div className="w-5 h-5 rounded-md gradient-accent flex items-center justify-center text-white shadow-sm">
          <Zap className="w-3.5 h-3.5 fill-current" />
        </div>
        <span className="text-xs font-semibold tracking-wide text-[var(--text-primary)]">
          FlowGet <span className="text-[var(--text-secondary)] font-normal">1.0</span>
        </span>
      </div>

      {/* Middle Draggable Area */}
      <div data-tauri-drag-region className="flex-1 h-full cursor-default" />

      {/* Right: Theme Toggle + Window Controls */}
      <div className="flex items-center gap-1 -mr-1 z-10 relative pointer-events-auto" data-tauri-drag-region="false">
        <button
          type="button"
          onClick={onToggleTheme}
          title={theme === "dark" ? "Switch to Light Theme" : "Switch to Dark Theme"}
          className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
        >
          {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
        </button>

        <div className="h-3.5 w-[1px] bg-[var(--border-subtle)] mx-1" />

        <button
          type="button"
          onClick={handleMinimize}
          title="Minimize"
          className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={handleMaximize}
          title="Maximize"
          className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
        >
          <Square className="w-3 h-3" />
        </button>

        <button
          type="button"
          onClick={handleClose}
          title="Close"
          className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-red-500/20 hover:text-red-400 text-[var(--text-secondary)] transition-colors cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
