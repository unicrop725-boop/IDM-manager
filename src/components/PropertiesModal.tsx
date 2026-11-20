import React from "react";
import { X, FileText, CheckCircle2, AlertCircle, Copy, FolderOpen } from "lucide-react";
import { DownloadInfo } from "../types";
import { formatBytes, formatDate } from "../format";

interface PropertiesModalProps {
  download: DownloadInfo;
  onClose: () => void;
  onOpenFolder: (d: DownloadInfo) => void;
}

export const PropertiesModal: React.FC<PropertiesModalProps> = ({
  download,
  onClose,
  onOpenFolder,
}) => {
  const d = download;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 select-none animate-in fade-in duration-150">
      <div className="w-[520px] rounded-2xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] shadow-2xl overflow-hidden flex flex-col text-xs text-[var(--text-secondary)]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]">
          <div className="flex items-center gap-2 text-[var(--text-primary)] font-semibold text-sm truncate pr-4">
            <FileText className="w-4 h-4 text-purple-400 flex-shrink-0" />
            <span className="truncate">Properties: {d.fileName}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
          {/* File Name & Path */}
          <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] p-3 space-y-2">
            <div>
              <span className="text-[var(--text-disabled)] font-medium">File Name:</span>
              <div className="font-semibold text-[var(--text-primary)] mt-0.5 break-all select-text">
                {d.fileName}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-disabled)] font-medium">Target Path:</span>
                <button
                  onClick={() => onOpenFolder(d)}
                  className="text-teal-400 hover:underline flex items-center gap-1 text-[11px]"
                >
                  <FolderOpen className="w-3 h-3" />
                  <span>Open Folder</span>
                </button>
              </div>
              <div className="font-mono text-[11px] text-[var(--text-primary)] mt-0.5 break-all select-text bg-[var(--bg-hover)] p-1.5 rounded-lg border border-[var(--border-subtle)]">
                {d.filePath || d.saveDir}
              </div>
            </div>
          </div>

          {/* URL */}
          <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] p-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-disabled)] font-medium">Download URL:</span>
              <button
                onClick={() => copyToClipboard(d.url)}
                className="text-purple-400 hover:text-purple-300 flex items-center gap-1 text-[11px]"
              >
                <Copy className="w-3 h-3" />
                <span>Copy URL</span>
              </button>
            </div>
            <div className="font-mono text-[11px] text-[var(--text-primary)] break-all select-text bg-[var(--bg-hover)] p-1.5 rounded-lg border border-[var(--border-subtle)] max-h-20 overflow-y-auto">
              {d.url}
            </div>
          </div>

          {/* Details Table */}
          <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-[var(--text-disabled)]">File Size</span>
              <span className="font-mono text-[var(--text-primary)] font-medium">
                {formatBytes(d.totalSize)} ({d.totalSize ? d.totalSize.toLocaleString() + " bytes" : "--"})
              </span>
            </div>

            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-[var(--text-disabled)]">Current Status</span>
              <span className="capitalize font-semibold text-[var(--text-primary)]">{d.state}</span>
            </div>

            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-[var(--text-disabled)]">Resume Supported</span>
              {d.resumeSupported === true ? (
                <span className="text-emerald-400 font-medium flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Yes
                </span>
              ) : (
                <span className="text-rose-400 font-medium flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" /> No
                </span>
              )}
            </div>

            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-[var(--text-disabled)]">Connections</span>
              <span className="font-mono text-[var(--text-primary)]">{d.connections}</span>
            </div>

            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-[var(--text-disabled)]">Category</span>
              <span className="text-[var(--text-primary)]">{d.category || "None"}</span>
            </div>

            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-[var(--text-disabled)]">Queue</span>
              <span className="text-[var(--text-primary)]">{d.queueId || "Main Queue"}</span>
            </div>

            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-[var(--text-disabled)]">Protocol</span>
              <span className="font-mono text-purple-300">{d.protocol || "HTTP/1.1"}</span>
            </div>

            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-[var(--text-disabled)]">Date Added</span>
              <span className="text-[var(--text-primary)]">{formatDate(d.createdAt)}</span>
            </div>

            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-[var(--text-disabled)]">Completed Date</span>
              <span className="text-[var(--text-primary)]">{formatDate(d.completedAt)}</span>
            </div>

            {d.checksum && (
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-[var(--text-disabled)]">Checksum Verified</span>
                <span className="font-mono text-xs text-emerald-400 truncate max-w-xs">{d.checksum}</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-4 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-card)]">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg gradient-accent hover:opacity-90 text-white font-medium transition-opacity"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
