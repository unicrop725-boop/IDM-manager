import { Select } from "./Select";
import { ModalCorner } from "./NotchCorner";
import { useState } from "react";
import { Layers, Sparkles, Folder, FolderOpen, ListOrdered } from "lucide-react";
import { api } from "../api";
import type { Category, QueueInfo } from "../types";

interface Props {
  onClose: () => void;
  onAdded: () => void;
  categories: Category[];
  queues: QueueInfo[];
  defaultDownloadDir: string;
}

export default function BatchDownloadModal({
  onClose,
  onAdded,
  categories,
  queues,
  defaultDownloadDir,
}: Props) {
  const [inputText, setInputText] = useState("");
  const [expandedUrls, setExpandedUrls] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("others");
  const [selectedQueue, setSelectedQueue] = useState("main");
  const [saveDir, setSaveDir] = useState(defaultDownloadDir);
  const [loading, setLoading] = useState(false);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);

  const handleExpand = async () => {
    if (!inputText.trim()) return;
    try {
      const res = await api.expandBatch(inputText);
      setExpandedUrls(res.urls);
    } catch {
      const raw = inputText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      setExpandedUrls(raw);
    }
  };

  const browseSaveDir = async () => {
    try {
      const picked = await api.pickFolder(saveDir);
      if (picked) setSaveDir(picked);
    } catch (e) {
      console.error("Browse folder error:", e);
    }
  };

  const handleCategoryChange = (catId: string) => {
    setSelectedCategory(catId);
    const cat = categories.find((c) => c.id === catId);
    if (cat && cat.defaultFolder) {
      setSaveDir(cat.defaultFolder);
    }
  };

  const handleQueueAll = async () => {
    let urlsToQueue = expandedUrls;
    if (urlsToQueue.length === 0 && inputText.trim()) {
      const res = await api.expandBatch(inputText);
      urlsToQueue = res.urls;
    }
    if (urlsToQueue.length === 0) return;

    setLoading(true);
    let queuedCount = 0;

    for (const url of urlsToQueue) {
      queuedCount++;
      setProgressMsg(`Adding ${queuedCount} of ${urlsToQueue.length}...`);
      try {
        await api.addDownload({
          url,
          saveDir,
          category: selectedCategory,
          queueId: selectedQueue,
          startQueued: true,
        });
      } catch (err) {
        console.error("Failed to add", url, err);
      }
    }

    setLoading(false);
    onAdded();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="notch-card relative w-full max-w-2xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] shadow-2xl flex flex-col overflow-hidden text-[var(--text-primary)]">
        <ModalCorner onClose={onClose} />
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-purple-500/10 text-purple-400">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Batch Download</h2>
              <p className="text-xs text-[var(--text-secondary)]">Paste multiple URLs or use patterns like file[001-100].jpg</p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              URLs or Pattern Expression
            </label>
            <textarea
              value={inputText}
              onChange={(e) => {
                setInputText(e.target.value);
                setExpandedUrls([]);
              }}
              rows={5}
              placeholder={`Paste multiple links or pattern:\nhttps://example.com/images/photo_[001-050].jpg\nhttps://example.com/archives/part_[a-z].zip`}
              className="w-full px-3 py-2 text-xs font-mono rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder-[var(--text-disabled)] focus:outline-none focus:border-purple-500/50 resize-y"
            />
            <div className="flex items-center justify-between mt-2">
              <button
                type="button"
                onClick={handleExpand}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-purple-300 transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Expand Pattern / Preview
              </button>
              {expandedUrls.length > 0 && (
                <span className="text-xs text-emerald-400 font-medium">
                  {expandedUrls.length} URLs generated
                </span>
              )}
            </div>
          </div>

          {/* Preview List */}
          {expandedUrls.length > 0 && (
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)]/50 p-3 max-h-40 overflow-y-auto">
              <div className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">
                Generated Download List ({expandedUrls.length})
              </div>
              <ul className="space-y-1 text-xs font-mono text-[var(--text-secondary)]">
                {expandedUrls.slice(0, 100).map((u, i) => (
                  <li key={i} className="truncate">
                    {i + 1}. {u}
                  </li>
                ))}
                {expandedUrls.length > 100 && (
                  <li className="text-[var(--text-disabled)] italic pt-1">
                    ... and {expandedUrls.length - 100} more items
                  </li>
                )}
              </ul>
            </div>
          )}

          {/* Queue & Category Settings */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Category
              </label>
              <Select
                value={selectedCategory}
                onChange={(e) => handleCategoryChange(e.target.value)}
                className="w-full h-9 px-3 text-xs rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-purple-500/50"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Target Queue
              </label>
              <div className="flex items-center gap-1.5">
                <ListOrdered className="w-4 h-4 text-[var(--text-secondary)]" />
                <Select
                  value={selectedQueue}
                  onChange={(e) => setSelectedQueue(e.target.value)}
                  className="w-full h-9 px-3 text-xs rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-purple-500/50"
                >
                  {queues.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Save Folder
            </label>
            <div className="relative flex items-center">
              <Folder className="w-4 h-4 absolute left-3 text-[var(--text-secondary)] pointer-events-none" />
              <input
                type="text"
                value={saveDir}
                onChange={(e) => setSaveDir(e.target.value)}
                className="w-full h-9 pl-9 pr-24 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-purple-500/50"
              />

              <button
                type="button"
                onClick={browseSaveDir}
                title="Choose a folder"
                className="absolute right-1.5 h-7 px-2.5 rounded-md gradient-accent text-white text-[11px] font-medium flex items-center gap-1 hover:opacity-90 active:scale-95 transition-all cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Browse</span>
              </button>
            </div>
          </div>

          {progressMsg && (
            <div className="text-xs text-purple-400 font-medium animate-pulse">
              {progressMsg}
            </div>
          )}
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
            onClick={handleQueueAll}
            disabled={loading || (!inputText.trim() && expandedUrls.length === 0)}
            className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-purple-600 to-teal-500 hover:opacity-95 shadow-lg shadow-purple-500/20 disabled:opacity-50 transition-all"
          >
            {loading ? "Adding Downloads..." : `Queue ${expandedUrls.length > 0 ? expandedUrls.length : "Batch"} Downloads`}
          </button>
        </div>
      </div>
    </div>
  );
}
