import { Select } from "./Select";
import { ModalCorner } from "./NotchCorner";
import { useState } from "react";
import { Globe, Search, Download, CheckSquare, Square, Folder } from "lucide-react";
import { api } from "../api";
import type { GrabbedAsset } from "../types";

interface Props {
  onClose: () => void;
  onAdded: () => void;
  defaultDownloadDir: string;
}

export default function SiteGrabberModal({
  onClose,
  onAdded,
  defaultDownloadDir,
}: Props) {
  const [url, setUrl] = useState("");
  const [depth, setDepth] = useState(1);
  const [categories, setCategories] = useState<string[]>([
    "Images",
    "Videos",
    "Music",
    "Documents",
    "Compressed",
  ]);
  const [customExtensions, setCustomExtensions] = useState("");
  const [saveDir, setSaveDir] = useState(defaultDownloadDir);

  const [loading, setLoading] = useState(false);
  const [assets, setAssets] = useState<GrabbedAsset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const toggleCategory = (cat: string) => {
    if (categories.includes(cat)) {
      setCategories(categories.filter((c) => c !== cat));
    } else {
      setCategories([...categories, cat]);
    }
  };

  const handleScan = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setAssets([]);

    try {
      const customExts = customExtensions
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);

      const res = await api.crawlSite({
        url: url.trim(),
        depth,
        categories,
        customExtensions: customExts,
      });

      setAssets(res);
      if (res.length === 0) {
        setError("No matching files found at the specified depth.");
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const toggleSelectAsset = (idx: number) => {
    setAssets((prev) =>
      prev.map((a, i) => (i === idx ? { ...a, selected: !a.selected } : a))
    );
  };

  const toggleSelectAll = (select: boolean) => {
    setAssets((prev) => prev.map((a) => ({ ...a, selected: select })));
  };

  const selectedCount = assets.filter((a) => a.selected).length;

  const handleDownloadSelected = async () => {
    const selected = assets.filter((a) => a.selected);
    if (selected.length === 0) return;

    setDownloading(true);
    for (const item of selected) {
      try {
        await api.addDownload({
          url: item.url,
          fileName: item.fileName,
          saveDir,
          startQueued: true,
        });
      } catch (err) {
        console.error("Failed to add", item.url, err);
      }
    }

    setDownloading(false);
    onAdded();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="notch-card relative w-full max-w-3xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] shadow-2xl flex flex-col overflow-hidden text-[var(--text-primary)] max-h-[88vh]">
        <ModalCorner onClose={onClose} />
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-teal-500/10 text-teal-400">
              <Globe className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Site Grabber</h2>
              <p className="text-xs text-[var(--text-secondary)]">Explore a website and download all matching files</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 overflow-y-auto">
          {/* Target URL & Depth */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Website URL
              </label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/gallery"
                className="w-full h-9 px-3 text-xs rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-teal-500/50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Crawl Depth
              </label>
              <Select
                value={depth}
                onChange={(e) => setDepth(Number(e.target.value))}
                className="w-full h-9 px-3 text-xs rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-teal-500/50"
              >
                <option value={1}>1 (Current Page Only)</option>
                <option value={2}>2 (Direct Links)</option>
                <option value={3}>3 (2 Clicks Deep)</option>
              </Select>
            </div>
          </div>

          {/* Categories */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              File Types to Grab
            </label>
            <div className="flex flex-wrap gap-2">
              {["Images", "Videos", "Music", "Documents", "Compressed", "Programs", "APKs"].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => toggleCategory(cat)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors border ${
                    categories.includes(cat)
                      ? "bg-teal-500/20 text-teal-300 border-teal-500/40"
                      : "bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Custom extensions & Scan */}
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={customExtensions}
              onChange={(e) => setCustomExtensions(e.target.value)}
              placeholder="Custom extensions: .iso, .flac, .pdf"
              className="flex-1 h-9 px-3 text-xs rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-teal-500/50"
            />
            <button
              type="button"
              onClick={handleScan}
              disabled={loading || !url.trim()}
              className="flex items-center gap-1.5 px-4 h-9 rounded-xl text-xs font-medium gradient-accent text-white hover:opacity-95 disabled:opacity-50 transition-all shadow-md shadow-teal-500/20"
            >
              <Search className="w-3.5 h-3.5" />
              {loading ? "Scanning Site..." : "Start Grabber"}
            </button>
          </div>

          {error && (
            <div className="p-3 text-xs rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
              {error}
            </div>
          )}

          {/* Asset List */}
          {assets.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-[var(--text-primary)]">
                    Discovered Files ({assets.length})
                  </span>
                  <span className="text-[var(--text-disabled)]">•</span>
                  <span>{selectedCount} selected</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleSelectAll(true)}
                    className="hover:text-[var(--text-primary)] transition-colors"
                  >
                    Select All
                  </button>
                  <span className="text-[var(--text-disabled)]">•</span>
                  <button
                    type="button"
                    onClick={() => toggleSelectAll(false)}
                    className="hover:text-[var(--text-primary)] transition-colors"
                  >
                    Deselect All
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)]/50 divide-y divide-[var(--border-subtle)] max-h-56 overflow-y-auto">
                {assets.map((asset, idx) => (
                  <div
                    key={idx}
                    onClick={() => toggleSelectAsset(idx)}
                    className={`flex items-center gap-3 px-3 py-2 text-xs cursor-pointer select-none transition-colors ${
                      asset.selected ? "bg-teal-500/5 text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                    }`}
                  >
                    {asset.selected ? (
                      <CheckSquare className="w-4 h-4 text-teal-400 flex-shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-[var(--text-disabled)] flex-shrink-0" />
                    )}
                    <span className="font-medium truncate flex-1">{asset.fileName}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[var(--bg-card)] border border-[var(--border-subtle)] text-teal-300">
                      {asset.category}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Save Folder */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Save To
            </label>
            <div className="relative flex items-center">
              <Folder className="w-4 h-4 absolute left-3 text-[var(--text-secondary)] pointer-events-none" />
              <input
                type="text"
                value={saveDir}
                onChange={(e) => setSaveDir(e.target.value)}
                className="w-full h-9 pl-9 pr-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-teal-500/50"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--border-subtle)] bg-[var(--bg-card)]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDownloadSelected}
            disabled={downloading || selectedCount === 0}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold text-white gradient-accent hover:opacity-95 shadow-lg shadow-teal-500/20 disabled:opacity-50 transition-all"
          >
            <Download className="w-4 h-4" />
            {downloading ? "Adding to Queue..." : `Download Selected (${selectedCount})`}
          </button>
        </div>
      </div>
    </div>
  );
}
