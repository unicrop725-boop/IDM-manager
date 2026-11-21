import React from "react";
import { Link2, ArrowDown, X, Globe, Youtube } from "lucide-react";
import { getVideoSite } from "../utils/videoUrl";

interface ClipboardPopupProps {
  url: string;
  onDownload: (url: string) => void;
  onDismiss: () => void;
}

export const ClipboardPopup: React.FC<ClipboardPopupProps> = ({
  url,
  onDownload,
  onDismiss,
}) => {
  const isVideo = getVideoSite(url) !== null;
  let domain = "";
  let fileName = "";
  try {
    const u = new URL(url);
    domain = u.hostname;
    const parts = u.pathname.split("/").filter(Boolean);
    fileName = parts.length > 0 ? decodeURIComponent(parts[parts.length - 1]) : "";
  } catch {
    domain = url;
  }

  return (
    <div className="fixed top-12 right-6 w-80 rounded-2xl bg-[var(--bg-card)] border border-purple-500/40 shadow-2xl p-3.5 z-50 select-none animate-in slide-in-from-top-4 duration-200">
      {/* Header */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-purple-400">
          {isVideo ? <Youtube className="w-3.5 h-3.5 text-red-500" /> : <Link2 className="w-3.5 h-3.5" />}
          <span>{isVideo ? "Download this video?" : "Download this file?"}</span>
        </div>
        <button
          onClick={onDismiss}
          className="p-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Target Info */}
      <div className="rounded-xl bg-[var(--bg-panel)] p-2.5 border border-[var(--border-subtle)] mb-2.5 space-y-1">
        <div className="text-xs font-medium text-[var(--text-primary)] truncate" title={fileName || url}>
          {isVideo ? "Video link copied" : fileName || "Captured Link"}
        </div>
        <div className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)] font-mono truncate">
          <Globe className="w-3 h-3 text-teal-400 flex-shrink-0" />
          <span className="truncate">{domain}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={onDismiss}
          className="flex-1 py-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-xs text-[var(--text-secondary)] transition-colors"
        >
          Ignore
        </button>
        <button
          onClick={() => onDownload(url)}
          className="flex-1 py-1.5 rounded-lg gradient-accent hover:opacity-90 active:scale-95 text-white text-xs font-medium flex items-center justify-center gap-1.5 shadow-sm transition-all"
        >
          <ArrowDown className="w-3.5 h-3.5" />
          <span>Download</span>
        </button>
      </div>
    </div>
  );
};
