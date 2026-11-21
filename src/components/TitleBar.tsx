import React from "react";
import { Minus, Square, X, Zap, Plus } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || "");

const run = async (label: string, fn: (w: ReturnType<typeof getCurrentWindow>) => Promise<unknown>) => {
  try {
    await fn(getCurrentWindow());
  } catch (e) {
    console.error(`Window ${label} error:`, e);
  }
};

const minimize = () => run("minimize", (w) => w.minimize());
const toggleMaximize = () => run("toggleMaximize", (w) => w.toggleMaximize());
const close = () => run("close", (w) => w.close());

export const TitleBar: React.FC = () => {
  return (
    <div
      data-tauri-drag-region
      className="h-12 w-full flex items-center justify-between pl-5 select-none bg-[var(--bg-panel)] z-50 text-[var(--text-secondary)]"
    >
      {/* Left: App Logo + Title */}
      <div className="flex items-center gap-3 pointer-events-none">
        <div className="w-6 h-6 rounded-lg gradient-accent flex items-center justify-center text-white shadow-sm">
          <Zap className="w-4 h-4 fill-current" />
        </div>
        <span className="text-[13px] text-[var(--text-primary)]">
          FlowGet <span className="text-[var(--text-secondary)]">1.0</span>
        </span>
      </div>

      {/* Middle Draggable Area */}
      <div data-tauri-drag-region className="flex-1 h-full cursor-default" />

      {/* Right: Window Controls (platform specific) */}
      <div className="flex items-center h-full relative pointer-events-auto" data-tauri-drag-region="false">
        {isMac ? (
          /* macOS: traffic-light dots */
          <div className="group flex items-center gap-2 pr-5">
            <button
              type="button"
              onClick={close}
              title="Close"
              className="w-3 h-3 rounded-full bg-[#FF5F57] flex items-center justify-center text-black/60 cursor-pointer"
            >
              <X className="w-2 h-2 opacity-0 group-hover:opacity-100" strokeWidth={3} />
            </button>
            <button
              type="button"
              onClick={minimize}
              title="Minimize"
              className="w-3 h-3 rounded-full bg-[#FEBC2E] flex items-center justify-center text-black/60 cursor-pointer"
            >
              <Minus className="w-2 h-2 opacity-0 group-hover:opacity-100" strokeWidth={3} />
            </button>
            <button
              type="button"
              onClick={toggleMaximize}
              title="Zoom"
              className="w-3 h-3 rounded-full bg-[#28C840] flex items-center justify-center text-black/60 cursor-pointer"
            >
              <Plus className="w-2 h-2 opacity-0 group-hover:opacity-100" strokeWidth={3} />
            </button>
          </div>
        ) : (
          /* Windows / Linux: minimize, maximize, close */
          <div className="flex items-center h-full">
            <button
              type="button"
              onClick={minimize}
              title="Minimize"
              className="w-12 h-full flex items-center justify-center text-amber-400 hover:bg-amber-400/15 transition-colors cursor-pointer"
            >
              <Minus className="w-[18px] h-[18px]" strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={toggleMaximize}
              title="Maximize"
              className="w-12 h-full flex items-center justify-center text-emerald-400 hover:bg-emerald-400/15 transition-colors cursor-pointer"
            >
              <Square className="w-4 h-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={close}
              title="Close"
              className="w-12 h-full flex items-center justify-center text-rose-500 hover:bg-rose-600 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-[18px] h-[18px]" strokeWidth={2} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
