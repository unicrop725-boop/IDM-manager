// TEMPORARY test UI for Phase 1: URL input + a list with progress bars.
// It only calls Tauri commands and listens to engine events; there is no download logic here.

import { useCallback, useEffect, useMemo, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Plus } from "lucide-react";
import { api, errorText } from "./api";
import DownloadRow from "./components/DownloadRow";
import type { DownloadInfo, ProgressEvent, Settings } from "./types";

export default function App() {
  const [downloads, setDownloads] = useState<Record<string, DownloadInfo>>({});
  const [settings, setSettings] = useState<Settings | null>(null);
  const [url, setUrl] = useState("");
  // Empty = "Auto": the engine uses what worked best for that website before, else the default.
  const [connections, setConnections] = useState("");
  const [checksum, setChecksum] = useState("");
  const [mirrors, setMirrors] = useState("");
  const [globalLimitMb, setGlobalLimitMb] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Initial load.
  useEffect(() => {
    api.getDownloads().then((list) => setDownloads(Object.fromEntries(list.map((d) => [d.id, d])))).catch((e) => setError(errorText(e)));
    api
      .getSettings()
      .then((s) => {
        setSettings(s);
        setGlobalLimitMb(s.globalSpeedLimit ? String(s.globalSpeedLimit / (1024 * 1024)) : "");
      })
      .catch((e) => setError(errorText(e)));
  }, []);

  // Live events from the engine.
  useEffect(() => {
    const unlisten: Promise<UnlistenFn>[] = [
      // Progress: lightweight, about 4x per second per running download.
      listen<ProgressEvent>("download-progress", ({ payload: p }) =>
        setDownloads((cur) => {
          const d = cur[p.id];
          if (!d) return cur;
          return {
            ...cur,
            [p.id]: {
              ...d,
              downloaded: p.downloaded,
              totalSize: p.total ?? d.totalSize,
              speedBps: p.speedBps,
              etaSecs: p.etaSecs,
              segments: p.segments,
              note: p.note,
              protocol: p.protocol,
            },
          };
        }),
      ),
      // State / metadata changed: replace the whole row.
      listen<DownloadInfo>("download-updated", ({ payload: d }) => setDownloads((cur) => ({ ...cur, [d.id]: d }))),
      listen<string>("download-removed", ({ payload: id }) =>
        setDownloads((cur) => {
          const { [id]: _gone, ...rest } = cur;
          return rest;
        }),
      ),
    ];
    return () => {
      unlisten.forEach((p) => p.then((fn) => fn()));
    };
  }, []);

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  const add = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    await run(async () => {
      const n = parseInt(connections, 10);
      await api.addDownload({
        url: trimmed,
        connections: Number.isFinite(n) ? n : undefined,
        checksum: checksum.trim() || undefined,
        mirrors: mirrors.split(/\s+/).filter(Boolean),
      });
      setUrl("");
      setChecksum("");
      setMirrors("");
    });
  };

  const applyGlobalLimit = () => {
    const mb = parseFloat(globalLimitMb);
    run(() => api.setSpeedLimit(null, Number.isFinite(mb) && mb > 0 ? Math.round(mb * 1024 * 1024) : 0));
  };

  const list = useMemo(
    () => Object.values(downloads).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)),
    [downloads],
  );

  const actions = useMemo(
    () => ({
      pause: api.pause,
      resume: api.resume,
      cancel: api.cancel,
      restart: api.restart,
      remove: api.remove,
      setLimit: (id: string, bps: number) => api.setSpeedLimit(id, bps),
      refreshLink: api.refreshLink,
    }),
    [],
  );

  return (
    <div className="mx-auto flex h-screen max-w-4xl flex-col px-5 py-5">
      <header className="mb-4 flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">FlowGet</h1>
        <span className="text-xs text-zinc-500">Phase 1 test UI{settings ? ` · saving to ${settings.downloadDir}` : ""}</span>
      </header>

      {/* Add form */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <div className="flex gap-2">
          <input
            className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-sky-500"
            placeholder="Paste a download link (https://...)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <button
            onClick={add}
            className="flex items-center gap-1.5 rounded-md bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500"
          >
            <Plus size={16} /> Add
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-zinc-400">
          <label className="flex items-center gap-2" title="Leave empty for Auto: the app remembers what worked best for each website.">
            Connections
            <input
              type="number"
              min={settings?.minConnections ?? 1}
              max={settings?.maxConnections ?? 32}
              placeholder={`Auto (${settings?.defaultConnections ?? 8})`}
              value={connections}
              onChange={(e) => setConnections(e.target.value)}
              className="w-24 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-zinc-200"
            />
          </label>
          <label className="flex items-center gap-2">
            Checksum (optional)
            <input
              value={checksum}
              onChange={(e) => setChecksum(e.target.value)}
              placeholder="sha256:... / md5:... / sha1:..."
              className="w-72 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-zinc-200"
            />
          </label>
          <label className="flex items-center gap-2" title="Other links to the same file. Each is checked (same size and version) before it is used; verified mirrors download different parts at the same time.">
            Mirrors (optional)
            <input
              value={mirrors}
              onChange={(e) => setMirrors(e.target.value)}
              placeholder="extra links, separated by spaces"
              className="w-64 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-zinc-200"
            />
          </label>
          <label className="ml-auto flex items-center gap-2">
            Global limit
            <input
              value={globalLimitMb}
              onChange={(e) => setGlobalLimitMb(e.target.value)}
              onBlur={applyGlobalLimit}
              onKeyDown={(e) => e.key === "Enter" && applyGlobalLimit()}
              placeholder="MB/s"
              inputMode="decimal"
              className="w-16 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-zinc-200"
              title="Limit for all downloads together. Empty = unlimited."
            />
          </label>
        </div>
      </div>

      {error && (
        <div className="mt-3 flex items-start justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          <span>{error}</span>
          <button className="text-red-300 hover:text-red-100" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {/* List */}
      <div className="mt-4 flex-1 space-y-3 overflow-y-auto pb-4">
        {list.length === 0 && (
          <div className="mt-16 text-center text-sm text-zinc-500">No downloads yet. Paste a link above and press Add.</div>
        )}
        {list.map((d) => (
          <DownloadRow key={d.id} d={d} onAction={run} actions={actions} />
        ))}
      </div>
    </div>
  );
}
