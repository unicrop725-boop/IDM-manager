import { findTrustedSite } from "../data/trustedSites";
import { Select } from "./Select";
import { ModalCorner } from "./NotchCorner";
import { useState, useEffect } from "react";
import { BadgeCheck, ChevronDown, ChevronUp, Download, Key, Link2, Folder, FolderOpen, ListOrdered, Wand2 } from "lucide-react";
import { api } from "../api";
import { cleanFileName } from "../utils/smartNaming";
import type { AddRequest, Category, DuplicateCheckResult, QueueInfo, SafetyWarning } from "../types";
import DuplicateModal from "./DuplicateModal";
import { isProLicenseError } from "../utils/license";

interface Props {
  onClose: () => void;
  onAdded: () => void;
  /** Opens the license-key popup. Called when a download needs Pro, so the key can be entered right away. */
  onNeedLicense?: () => void;
  isLicensed?: boolean;
  categories: Category[];
  queues: QueueInfo[];
  defaultDownloadDir: string;
  initialUrl?: string;
  initialFileName?: string;
  initialCookies?: string;
  initialReferer?: string;
  initialUserAgent?: string;
}

const DOWNLOADABLE_SCHEMES = ["http:", "https:", "ftp:", "ftps:", "sftp:", "magnet:"];

/** Early, friendly checks (the engine checks again): the link's scheme, the checksum's shape and the speed limit. */
function validateAddForm(url: string, checksum: string, speedLimitMb: string): string | null {
  try {
    const u = new URL(url);
    if (!DOWNLOADABLE_SCHEMES.includes(u.protocol)) {
      return `Links starting with "${u.protocol}" can't be downloaded. Use http://, https://, ftp:// or a magnet link.`;
    }
    if (u.protocol !== "magnet:" && !u.hostname) return "That link has no website address in it.";
  } catch {
    return "That doesn't look like a link. It should start with http:// or https:// (for example https://example.com/file.zip).";
  }
  const sum = checksum.trim();
  if (sum) {
    const m = /^(?:(md5|sha1|sha256)s*:s*)?([0-9a-f]+)$/i.exec(sum);
    if (!m) return "The checksum must be hexadecimal (0-9, a-f), optionally written as md5:..., sha1:... or sha256:...";
    const want = { md5: 32, sha1: 40, sha256: 64 } as const;
    const len = m[2].length;
    if (m[1] ? len !== want[m[1].toLowerCase() as keyof typeof want] : ![32, 40, 64].includes(len)) {
      return "That checksum has the wrong length: MD5 is 32 characters, SHA-1 is 40 and SHA-256 is 64.";
    }
  }
  const limit = speedLimitMb.trim();
  if (limit) {
    const n = Number(limit);
    if (!Number.isFinite(n) || n <= 0 || n > 100000) return "The speed limit must be a number of MB/s greater than 0 (leave it empty for no limit).";
  }
  return null;
}

export default function AddDownloadModal({
  onClose,
  onAdded,
  onNeedLicense,
  isLicensed,
  categories,
  queues,
  defaultDownloadDir,
  initialUrl = "",
  initialFileName = "",
  initialCookies = "",
  initialReferer = "",
  initialUserAgent = "",
}: Props) {
  const [url, setUrl] = useState(initialUrl);
  const [fileName, setFileName] = useState(initialFileName);
  const [saveDir, setSaveDir] = useState(defaultDownloadDir);
  const [selectedCategory, setSelectedCategory] = useState("others");
  const [selectedQueue, setSelectedQueue] = useState("main");
  const [startMode, setStartMode] = useState<"immediate" | "paused" | "queued">("immediate");

  // Advanced options
  const [showAdvanced, setShowAdvanced] = useState(Boolean(initialCookies || initialReferer));
  const [connections, setConnections] = useState("8");
  const [speedLimitMb, setSpeedLimitMb] = useState("");
  const [checksum, setChecksum] = useState("");
  const [mirrors, setMirrors] = useState("");
  const [proxy, setProxy] = useState("");
  const [userAgent, setUserAgent] = useState(initialUserAgent);
  const [referer, setReferer] = useState(initialReferer);
  const [cookies, setCookies] = useState(initialCookies);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [needsLicense, setNeedsLicense] = useState(false);
  const [duplicateData, setDuplicateData] = useState<DuplicateCheckResult | null>(null);
  // Programs and disguised files (invoice.pdf.exe) are flagged before anything is downloaded.
  const [nameWarnings, setNameWarnings] = useState<SafetyWarning[]>([]);
  useEffect(() => {
    const name = fileName.trim();
    if (!name) {
      setNameWarnings([]);
      return;
    }
    const t = setTimeout(() => api.assessFileName(name).then(setNameWarnings).catch(() => setNameWarnings([])), 250);
    return () => clearTimeout(t);
  }, [fileName]);

  // Streaming Media & Video Quality Resolution
  // Auto-detect category and filename when URL changes
  useEffect(() => {
    const trimmed = url.trim();
    if (!trimmed) return;

    try {
      const u = new URL(trimmed);
      const segments = u.pathname.split("/").filter(Boolean);
      if (segments.length > 0) {
        const last = decodeURIComponent(segments[segments.length - 1]);
        if (!fileName && last) {
          setFileName(cleanFileName(last));
        }
      }
    } catch {
      // ignore invalid url
    }

    api
      .autoCategorize(trimmed)
      .then((catId) => {
        setSelectedCategory(catId);
        const cat = categories.find((c) => c.id === catId);
        if (cat && cat.defaultFolder) {
          setSaveDir(cat.defaultFolder);
        }
      })
      .catch(() => {});
  }, [url]);

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

  const executeAdd = async (overrideName?: string, overrideStartPaused?: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const limitMb = parseFloat(speedLimitMb);
      const connNum = parseInt(connections, 10);

      const req: AddRequest = {
        url: url.trim(),
        fileName: overrideName || (fileName.trim() ? fileName.trim() : undefined),
        saveDir: saveDir.trim() ? saveDir.trim() : undefined,
        category: selectedCategory,
        queueId: selectedQueue,
        startPaused: overrideStartPaused !== undefined ? overrideStartPaused : startMode === "paused",
        startQueued: startMode === "queued",
        connections: Number.isFinite(connNum) ? connNum : undefined,
        speedLimit: Number.isFinite(limitMb) && limitMb > 0 ? Math.round(limitMb * 1024 * 1024) : undefined,
        checksum: checksum.trim() ? checksum.trim() : undefined,
        proxy: proxy.trim() ? proxy.trim() : undefined,
        userAgent: userAgent.trim() ? userAgent.trim() : undefined,
        referer: referer.trim() ? referer.trim() : undefined,
        cookies: cookies.trim() ? cookies.trim() : undefined,
        mirrors: mirrors.trim() ? mirrors.split("\n").map((m) => m.trim()).filter(Boolean) : undefined,
      };

      await api.addDownload(req);
      setNeedsLicense(false);
      onAdded();
      onClose();
    } catch (e: any) {
      const msg = typeof e === "string" ? e : e?.message || "Failed to add download";
      setError(msg);
      if (isProLicenseError(msg)) {
        // ask for the key right away; the download is retried once it is verified
        setNeedsLicense(true);
        onNeedLicense?.();
      }
    } finally {
      setLoading(false);
    }
  };

  // The key was just verified: carry on with the download the user was trying to add.
  useEffect(() => {
    if (isLicensed && needsLicense) {
      setNeedsLicense(false);
      void executeAdd();
    }
  }, [isLicensed]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Please paste or type a download URL.");
      return;
    }
    const problem = validateAddForm(trimmed, checksum, speedLimitMb);
    if (problem) {
      setError(problem);
      return;
    }

    try {
      const dup = await api.checkDuplicate(trimmed, saveDir.trim() || undefined, fileName.trim() || undefined);
      if (dup.hasDuplicate) {
        setDuplicateData(dup);
        return;
      }
    } catch {
      // Continue if duplicate check fails
    }

    await executeAdd();
  };

  const handleDuplicateChoice = async (choice: "download_again" | "rename" | "overwrite" | "open_existing") => {
    if (!duplicateData) return;

    if (choice === "open_existing") {
      if (duplicateData.existingFilePath) {
        await api.openFile(duplicateData.existingFilePath);
      }
      setDuplicateData(null);
      onClose();
      return;
    }

    if (choice === "rename") {
      setDuplicateData(null);
      await executeAdd(duplicateData.suggestedFileName);
      return;
    }

    if (choice === "download_again" || choice === "overwrite") {
      setDuplicateData(null);
      await executeAdd();
      return;
    }
  };

  return (
    <>
      {duplicateData && (
        <DuplicateModal
          duplicate={duplicateData}
          url={url}
          onChoice={handleDuplicateChoice}
          onClose={() => setDuplicateData(null)}
        />
      )}

      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm select-none animate-in fade-in duration-150">
        <div className="notch-card w-full max-w-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-2xl text-xs text-[var(--text-secondary)] overflow-hidden flex flex-col">
          <ModalCorner onClose={onClose} />
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-card)] px-5 py-3.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <Download className="w-4 h-4 text-purple-400" />
              <span>Add Download</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
            {error && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
                {error}
                {needsLicense && onNeedLicense && (
                  <button
                    type="button"
                    onClick={onNeedLicense}
                    className="mt-2 flex items-center gap-1.5 rounded-lg gradient-accent px-3 py-1.5 font-medium text-white hover:opacity-90 transition"
                  >
                    <Key className="h-3.5 w-3.5" />
                    Enter license key
                  </button>
                )}
              </div>
            )}

            {/* URL input */}
            <div>
              <label className="mb-1.5 block font-medium text-[var(--text-primary)]">Download URL</label>
              <div className="relative flex items-center">
                <Link2 className="w-4 h-4 absolute left-3 text-[var(--text-disabled)] pointer-events-none" />
                <input
                  autoFocus
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/file.zip or video / magnet / hls link"
                  className="w-full h-9 pl-9 pr-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-primary)] placeholder-[var(--text-disabled)] outline-none focus:border-purple-500/50 font-mono text-[11px] transition-colors"
                />
              </div>
              {findTrustedSite(url) && (
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-emerald-400">
                  <BadgeCheck className="h-3.5 w-3.5" /> Trusted site: {findTrustedSite(url)!.name}
                </div>
              )}
            </div>

            {/* File name & Category */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-medium text-[var(--text-primary)]">File Name (optional)</label>
                  {fileName && (
                    <button
                      type="button"
                      onClick={() => setFileName(cleanFileName(fileName))}
                      title="Smart clean file name (remove %20, tracking IDs)"
                      className="flex items-center gap-1 text-[11px] font-medium text-purple-400 hover:text-purple-300 transition-colors"
                    >
                      <Wand2 className="w-3 h-3" />
                      Clean Name
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  placeholder="Auto-detected from URL"
                  className="w-full h-9 px-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-primary)] placeholder-[var(--text-disabled)] outline-none focus:border-purple-500/50 transition-colors"
                />
                {nameWarnings.map((w) => (
                  <div
                    key={w.code}
                    className={`mt-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug ${
                      w.severity === "high"
                        ? "border-red-500/40 bg-red-500/10 text-red-200"
                        : "border-amber-500/30 bg-amber-500/10 text-amber-200"
                    }`}
                  >
                    ⚠ {w.message}
                  </div>
                ))}
              </div>

              <div>
                <label className="mb-1.5 block font-medium text-[var(--text-primary)]">Category</label>
                <Select
                  value={selectedCategory}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                  className="w-full h-9 px-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-primary)] outline-none focus:border-purple-500/50 transition-colors cursor-pointer"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id} className="bg-[var(--bg-card)] text-[var(--text-primary)]">
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {/* Save Directory & Queue */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block font-medium text-[var(--text-primary)]">Save Folder</label>
                <div className="relative flex items-center">
                  <Folder className="w-4 h-4 absolute left-3 text-[var(--text-disabled)] pointer-events-none" />
                  <input
                    type="text"
                    value={saveDir}
                    onChange={(e) => setSaveDir(e.target.value)}
                    className="w-full h-9 pl-9 pr-24 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-primary)] outline-none focus:border-purple-500/50 font-mono text-[11px] truncate transition-colors"
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

              <div>
                <label className="mb-1.5 block font-medium text-[var(--text-primary)]">Queue</label>
                <div className="relative flex items-center">
                  <ListOrdered className="w-4 h-4 absolute left-3 text-[var(--text-disabled)] pointer-events-none" />
                  <Select
                    value={selectedQueue}
                    onChange={(e) => setSelectedQueue(e.target.value)}
                    className="w-full h-9 pl-9 pr-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-primary)] outline-none focus:border-purple-500/50 transition-colors cursor-pointer"
                  >
                    {queues.map((q) => (
                      <option key={q.id} value={q.id} className="bg-[var(--bg-card)] text-[var(--text-primary)]">
                        {q.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            </div>

            {/* Start Mode & Connections */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block font-medium text-[var(--text-primary)]">Start Action</label>
                <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-[var(--bg-card)] p-1 border border-[var(--border-subtle)] text-[11px]">
                  <button
                    type="button"
                    onClick={() => setStartMode("immediate")}
                    className={`py-1.5 rounded-lg font-medium transition-colors ${
                      startMode === "immediate" ? "gradient-accent text-white shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    Start Now
                  </button>
                  <button
                    type="button"
                    onClick={() => setStartMode("queued")}
                    className={`py-1.5 rounded-lg font-medium transition-colors ${
                      startMode === "queued" ? "gradient-accent text-white shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    Queue
                  </button>
                  <button
                    type="button"
                    onClick={() => setStartMode("paused")}
                    className={`py-1.5 rounded-lg font-medium transition-colors ${
                      startMode === "paused" ? "gradient-accent text-white shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    Later
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block font-medium text-[var(--text-primary)]">Connections (1-32)</label>
                <input
                  type="number"
                  min={1}
                  max={32}
                  value={connections}
                  onChange={(e) => setConnections(e.target.value)}
                  placeholder="8"
                  className="w-full h-9 px-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-primary)] outline-none focus:border-purple-500/50 font-mono transition-colors"
                />
              </div>
            </div>

            {/* Optional Checksum */}
            <div>
              <label className="mb-1.5 block font-medium text-[var(--text-primary)]">Checksum (optional verification)</label>
              <input
                type="text"
                value={checksum}
                onChange={(e) => setChecksum(e.target.value)}
                placeholder="sha256:... or md5:..."
                className="w-full h-9 px-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-primary)] placeholder-[var(--text-disabled)] outline-none focus:border-purple-500/50 font-mono text-[11px] transition-colors"
              />
            </div>

            {/* Advanced Toggle */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-1.5 text-[11px] text-purple-400 hover:text-purple-300 font-medium transition-colors"
              >
                {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                <span>{showAdvanced ? "Hide Advanced Options" : "Show Advanced Options (Proxy, Speed Limit, Headers)"}</span>
              </button>

              {showAdvanced && (
                <div className="mt-3 p-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-3 animate-in fade-in duration-150">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-[11px] text-[var(--text-secondary)]">Speed Limit (MB/s)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={speedLimitMb}
                        onChange={(e) => setSpeedLimitMb(e.target.value)}
                        placeholder="Unlimited"
                        className="w-full h-8 px-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--text-primary)] text-[11px] outline-none focus:border-purple-500/50"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-[var(--text-secondary)]">Proxy (HTTP or SOCKS5)</label>
                      <input
                        type="text"
                        value={proxy}
                        onChange={(e) => setProxy(e.target.value)}
                        placeholder="socks5://127.0.0.1:1080"
                        className="w-full h-8 px-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--text-primary)] text-[11px] font-mono outline-none focus:border-purple-500/50"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-[11px] text-[var(--text-secondary)]">User-Agent</label>
                      <input
                        type="text"
                        value={userAgent}
                        onChange={(e) => setUserAgent(e.target.value)}
                        placeholder="Default"
                        className="w-full h-8 px-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--text-primary)] text-[11px] outline-none focus:border-purple-500/50"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-[var(--text-secondary)]">Referer</label>
                      <input
                        type="text"
                        value={referer}
                        onChange={(e) => setReferer(e.target.value)}
                        placeholder="https://..."
                        className="w-full h-8 px-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--text-primary)] text-[11px] outline-none focus:border-purple-500/50"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] text-[var(--text-secondary)]">Cookies</label>
                    <input
                      type="text"
                      value={cookies}
                      onChange={(e) => setCookies(e.target.value)}
                      placeholder="session=xyz; token=123"
                      className="w-full h-8 px-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--text-primary)] font-mono text-[11px] outline-none focus:border-purple-500/50"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] text-[var(--text-secondary)]">Mirrors (one URL per line)</label>
                    <textarea
                      rows={2}
                      value={mirrors}
                      onChange={(e) => setMirrors(e.target.value)}
                      placeholder="https://mirror1.example.com/file.zip"
                      className="w-full p-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--text-primary)] font-mono text-[11px] outline-none focus:border-purple-500/50"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-5 py-2 rounded-xl gradient-accent hover:opacity-90 active:scale-95 disabled:opacity-50 text-white font-medium transition-all shadow-md"
              >
                {loading ? "Adding..." : "Add Download"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
