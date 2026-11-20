import React, { useState } from "react";
import { X, FolderOpen, Copy, ExternalLink, Archive, Film, FileText, Music, Terminal, Smartphone, Image as ImageIcon, File } from "lucide-react";
import { DownloadInfo } from "../types";
import { formatBytes, formatDate, getFileTypeLabel, FileCategoryType } from "../format";
import { api } from "../api";

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

  // Editable Save To path
  const initialPath = d.filePath || `${d.saveDir || "C:\\Downloads"}\\${d.fileName}`;
  const [saveToPath, setSaveToPath] = useState(initialPath);
  const [description, setDescription] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const pageUrl = d.referer || d.url;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  // Browse folder button handler
  const handleBrowse = async () => {
    setIsBrowsing(true);
    try {
      const currentDir = saveToPath.substring(0, Math.max(saveToPath.lastIndexOf("\\"), saveToPath.lastIndexOf("/"))) || d.saveDir;
      const pickedFolder = await api.pickFolder(currentDir);
      if (pickedFolder) {
        const separator = pickedFolder.includes("/") ? "/" : "\\";
        const newFullPath = `${pickedFolder.replace(/[/\\]$/, "")}${separator}${d.fileName}`;
        setSaveToPath(newFullPath);
      }
    } catch (e) {
      console.error("Browse folder error:", e);
    } finally {
      setIsBrowsing(false);
    }
  };

  // Open file handler
  const handleOpen = async () => {
    try {
      if (d.state === "completed") {
        await api.openFile(saveToPath);
      } else {
        onOpenFolder(d);
      }
    } catch {
      onOpenFolder(d);
    }
  };

  // Save changes and close
  const handleOk = async () => {
    setIsSaving(true);
    try {
      if (saveToPath !== initialPath) {
        await api.updateDownloadPath(d.id, saveToPath);
      }
    } catch (e) {
      console.error("Update download path error:", e);
    } finally {
      setIsSaving(false);
      onClose();
    }
  };

  // Percentage complete
  const percentComplete = d.totalSize && d.totalSize > 0
    ? ((d.downloaded / d.totalSize) * 100).toFixed(2)
    : d.state === "completed" ? "100.00" : "0.00";

  // Type label & icon
  const typeLabel = getFileTypeLabel(d.fileName);
  const renderCategoryIcon = (type: FileCategoryType) => {
    switch (type) {
      case "Archive":
        return <Archive className="w-8 h-8 text-amber-400 flex-shrink-0" />;
      case "Video":
        return <Film className="w-8 h-8 text-rose-400 flex-shrink-0" />;
      case "Document":
        return <FileText className="w-8 h-8 text-emerald-400 flex-shrink-0" />;
      case "Music":
        return <Music className="w-8 h-8 text-purple-400 flex-shrink-0" />;
      case "Program":
        return <Terminal className="w-8 h-8 text-blue-400 flex-shrink-0" />;
      case "App":
        return <Smartphone className="w-8 h-8 text-teal-400 flex-shrink-0" />;
      case "Image":
        return <ImageIcon className="w-8 h-8 text-indigo-400 flex-shrink-0" />;
      default:
        return <File className="w-8 h-8 text-slate-400 flex-shrink-0" />;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 select-none animate-in fade-in duration-150">
      <div className="w-[540px] rounded-2xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] shadow-2xl overflow-hidden flex flex-col text-xs text-[var(--text-secondary)]">
        {/* Title Bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]">
          <div className="flex items-center gap-2 text-[var(--text-primary)] font-semibold text-sm truncate">
            <span>File Properties</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 space-y-3.5 max-h-[75vh] overflow-y-auto">
          {/* File Header */}
          <div className="flex items-center gap-3 pb-2 border-b border-[var(--border-subtle)]">
            <div className="p-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-sm">
              {renderCategoryIcon(typeLabel)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-sm text-[var(--text-primary)] truncate select-text">
                {d.fileName}
              </div>
              <div className="text-[11px] text-[var(--text-disabled)] font-mono truncate">
                ID: {d.id}
              </div>
            </div>
          </div>

          {/* Form Properties Grid */}
          <div className="space-y-2.5">
            {/* Type */}
            <div className="grid grid-cols-[85px_1fr] items-center gap-2">
              <span className="text-[var(--text-disabled)] font-medium">Type:</span>
              <span className="text-[var(--text-primary)] font-medium">
                {typeLabel} {d.mime ? `(${d.mime})` : "file"}
              </span>
            </div>

            {/* Status */}
            <div className="grid grid-cols-[85px_1fr] items-center gap-2">
              <span className="text-[var(--text-disabled)] font-medium">Status:</span>
              <span className="text-[var(--text-primary)]">
                {d.state === "completed" ? (
                  <span className="text-emerald-400 font-semibold">100% complete</span>
                ) : (
                  <span>{percentComplete}% complete ({d.state})</span>
                )}
              </span>
            </div>

            {/* Size */}
            <div className="grid grid-cols-[85px_1fr] items-center gap-2">
              <span className="text-[var(--text-disabled)] font-medium">Size:</span>
              <span className="text-[var(--text-primary)] font-mono">
                {formatBytes(d.totalSize)} {d.totalSize ? `(${d.totalSize.toLocaleString()} Bytes)` : ""}
              </span>
            </div>

            {/* Save To (With Browse... Button) */}
            <div className="grid grid-cols-[85px_1fr] items-center gap-2">
              <span className="text-[var(--text-disabled)] font-medium">Save To:</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={saveToPath}
                  onChange={(e) => setSaveToPath(e.target.value)}
                  className="flex-1 h-8 px-2.5 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-purple-500/50 select-text"
                />
                <button
                  type="button"
                  onClick={handleBrowse}
                  disabled={isBrowsing}
                  className="px-3 h-8 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] active:scale-95 border border-[var(--border-subtle)] text-[var(--text-primary)] font-medium text-xs transition-all shadow-sm flex-shrink-0 cursor-pointer flex items-center gap-1"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
                  <span>Browse...</span>
                </button>
              </div>
            </div>

            {/* Address */}
            <div className="grid grid-cols-[85px_1fr] items-center gap-2">
              <span className="text-[var(--text-disabled)] font-medium">Address:</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  readOnly
                  value={d.url}
                  className="flex-1 h-8 px-2.5 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg text-xs font-mono text-[var(--text-primary)] opacity-90 select-text"
                />
                <button
                  type="button"
                  onClick={() => copyToClipboard(d.url)}
                  title="Copy URL"
                  className="px-2.5 h-8 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all cursor-pointer flex items-center justify-center flex-shrink-0"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Description */}
            <div className="grid grid-cols-[85px_1fr] items-center gap-2">
              <span className="text-[var(--text-disabled)] font-medium">Description:</span>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional notes or description..."
                className="w-full h-8 px-2.5 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg text-xs text-[var(--text-primary)] placeholder-[var(--text-disabled)] focus:outline-none focus:border-purple-500/50"
              />
            </div>
          </div>

          <div className="border-t border-[var(--border-subtle)] pt-2 space-y-2">
            {/* Web page obtained */}
            <div>
              <span className="text-[var(--text-disabled)] font-medium block mb-1">
                The web page from which this file was obtained:
              </span>
              <a
                href={pageUrl}
                target="_blank"
                rel="noreferrer"
                className="text-purple-400 hover:text-purple-300 hover:underline flex items-center gap-1 font-mono break-all"
              >
                <span>{pageUrl}</span>
                <ExternalLink className="w-3 h-3 flex-shrink-0" />
              </a>
            </div>

            {/* Referer */}
            <div className="grid grid-cols-[85px_1fr] items-center gap-2">
              <span className="text-[var(--text-disabled)] font-medium">Referer:</span>
              <input
                type="text"
                readOnly
                value={pageUrl}
                className="w-full h-7 px-2.5 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg text-[11px] font-mono text-[var(--text-primary)] opacity-85 select-text"
              />
            </div>

            {/* Login / Password */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="grid grid-cols-[55px_1fr] items-center gap-1">
                <span className="text-[var(--text-disabled)] font-medium">Login:</span>
                <input
                  type="text"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  className="w-full h-7 px-2 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg text-xs text-[var(--text-primary)]"
                />
              </div>
              <div className="grid grid-cols-[65px_1fr] items-center gap-1">
                <span className="text-[var(--text-disabled)] font-medium">Password:</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-7 px-2 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg text-xs text-[var(--text-primary)]"
                />
              </div>
            </div>
          </div>

          {/* Status Details / Resume Log */}
          <div className="border-t border-[var(--border-subtle)] pt-2.5 space-y-1.5">
            <div className="text-[11px] text-[var(--text-disabled)] font-mono">
              Last try date: {formatDate(d.createdAt)}
            </div>
            <div>
              <span className="text-[var(--text-disabled)] font-medium">Result:</span>
              <div className="mt-1 p-2.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[11px] text-[var(--text-primary)] font-mono leading-relaxed select-text">
                {d.state === "completed" ? (
                  <span className="text-emerald-400">
                    Download completed successfully. All segments verified. Resume supported: {d.resumeSupported ? "Yes" : "No"}.
                  </span>
                ) : d.state === "failed" ? (
                  <span className="text-rose-400">
                    The data transfer was interrupted: {d.error?.message || "Connection closed"}. Resume supported: {d.resumeSupported ? "Yes" : "No"}.
                  </span>
                ) : (
                  <span>
                    Active transfer in progress with {d.connections} parallel connections. Resume supported: {d.resumeSupported ? "Yes" : "No"}.
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer Buttons: Open and OK */}
        <div className="flex items-center justify-end gap-2.5 px-4 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-card)]">
          <button
            type="button"
            onClick={handleOpen}
            className="px-4 py-1.5 rounded-lg bg-[var(--bg-hover)] hover:bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] font-medium transition-colors cursor-pointer"
          >
            Open
          </button>
          <button
            type="button"
            onClick={handleOk}
            disabled={isSaving}
            className="px-5 py-1.5 rounded-lg gradient-accent hover:opacity-90 active:scale-95 text-white font-medium transition-all shadow-md cursor-pointer disabled:opacity-50"
          >
            {isSaving ? "Saving..." : "OK"}
          </button>
        </div>
      </div>
    </div>
  );
};
