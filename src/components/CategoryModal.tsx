import { ModalCorner } from "./NotchCorner";
import { useState } from "react";
import { FolderPlus } from "lucide-react";
import type { Category } from "../types";

interface Props {
  category: Category | null;
  onSave: (cat: Category) => Promise<void>;
  onClose: () => void;
  defaultDownloadDir: string;
}

export default function CategoryModal({ category, onSave, onClose, defaultDownloadDir }: Props) {
  const isEditing = category !== null;
  const [name, setName] = useState(category?.name || "");
  const [extensions, setExtensions] = useState(category?.extensions.join(", ") || "");
  const [defaultFolder, setDefaultFolder] = useState(
    category?.defaultFolder || `${defaultDownloadDir}\\Custom`,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Please provide a category name.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const exts = extensions
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

      const updated: Category = {
        id: category?.id || `cat-${Date.now()}`,
        name: name.trim(),
        extensions: exts,
        defaultFolder: defaultFolder.trim(),
        isBuiltin: category?.isBuiltin || false,
      };

      await onSave(updated);
      onClose();
    } catch (err) {
      setError(typeof err === "string" ? err : (err as Error).message || "Failed to save category");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs select-none">
      <div className="notch-card w-full max-w-md border border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-2xl text-xs text-[var(--text-secondary)]">
        <ModalCorner onClose={onClose} />
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <FolderPlus size={16} className="text-sky-400" />
            <span>{isEditing ? `Edit Category - ${category.name}` : "Create Category"}</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-200">
              {error}
            </div>
          )}

          <div>
            <label className="mb-1 block font-medium text-[var(--text-secondary)]">Category Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Torrents, Podcasts, Ebooks"
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-[var(--text-primary)] outline-none focus:border-sky-500 transition"
              required
            />
          </div>

          <div>
            <label className="mb-1 block font-medium text-[var(--text-secondary)]">File Extensions (comma-separated)</label>
            <input
              type="text"
              value={extensions}
              onChange={(e) => setExtensions(e.target.value)}
              placeholder="torrent, epub, mobi, azw3"
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-[var(--text-primary)] outline-none focus:border-sky-500 transition font-mono text-[11px]"
            />
            <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
              Files with these extensions will be automatically sorted into this category.
            </p>
          </div>

          <div>
            <label className="mb-1 block font-medium text-[var(--text-secondary)]">Default Save Folder</label>
            <input
              type="text"
              value={defaultFolder}
              onChange={(e) => setDefaultFolder(e.target.value)}
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-[var(--text-primary)] outline-none focus:border-sky-500 transition font-mono text-[11px]"
              required
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-2 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-sky-500 px-5 py-2 font-medium text-black hover:bg-sky-400 transition shadow-sm disabled:opacity-50"
            >
              {saving ? "Saving..." : isEditing ? "Save Category" : "Create Category"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
