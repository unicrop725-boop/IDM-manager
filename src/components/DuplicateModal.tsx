import { AlertTriangle, Copy, FileText, FolderOpen, RefreshCw, X } from "lucide-react";
import type { DuplicateCheckResult } from "../types";

interface Props {
  duplicate: DuplicateCheckResult;
  url: string;
  onChoice: (choice: "download_again" | "rename" | "overwrite" | "open_existing") => void;
  onClose: () => void;
}

export default function DuplicateModal({ duplicate, url, onChoice, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs select-none">
      <div className="w-full max-w-md rounded-2xl border border-amber-500/30 bg-zinc-900 p-5 shadow-2xl text-xs text-zinc-300">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
            <AlertTriangle size={18} />
            <span>Duplicate Detected</span>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <p className="text-zinc-300 text-xs leading-relaxed">
            {duplicate.urlMatch && duplicate.fileExists
              ? "Both the same download URL and destination file already exist on your computer."
              : duplicate.urlMatch
              ? "This download URL is already present in your download history."
              : "A file with the same name already exists in the destination folder."}
          </p>

          <div className="rounded-lg border border-white/10 bg-black/40 p-2.5 font-mono text-[11px] space-y-1.5 text-zinc-400 break-all">
            <div className="truncate">
              <span className="text-zinc-500">URL: </span>
              {url}
            </div>
            {duplicate.existingFilePath && (
              <div>
                <span className="text-zinc-500">Existing File: </span>
                <span className="text-zinc-300">{duplicate.existingFilePath}</span>
              </div>
            )}
            <div>
              <span className="text-zinc-500">Suggested Name: </span>
              <span className="text-emerald-400">{duplicate.suggestedFileName}</span>
            </div>
          </div>

          <div className="pt-2 text-zinc-400">What would you like to do?</div>

          <div className="grid grid-cols-1 gap-2 pt-1">
            <button
              onClick={() => onChoice("rename")}
              className="flex items-center justify-between rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-left text-sky-200 hover:bg-sky-500/20 transition font-medium"
            >
              <span className="flex items-center gap-2">
                <Copy size={14} className="text-sky-400" />
                Rename automatically
              </span>
              <span className="text-[10px] text-sky-300/80 font-mono">({duplicate.suggestedFileName})</span>
            </button>

            <button
              onClick={() => onChoice("download_again")}
              className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left hover:bg-white/10 transition"
            >
              <RefreshCw size={14} className="text-zinc-400" />
              Download again (new duplicate entry)
            </button>

            <button
              onClick={() => onChoice("overwrite")}
              className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left hover:bg-white/10 text-amber-300 transition"
            >
              <FileText size={14} className="text-amber-400" />
              Overwrite existing file
            </button>

            {duplicate.existingFilePath && (
              <button
                onClick={() => onChoice("open_existing")}
                className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-left text-emerald-300 hover:bg-emerald-500/20 transition"
              >
                <FolderOpen size={14} className="text-emerald-400" />
                Open existing file
              </button>
            )}
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-1.5 text-zinc-300 hover:bg-white/10 transition"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
