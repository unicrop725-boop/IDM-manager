import { useState } from "react";
import { t } from "../i18n";
import { Pause, Play, RotateCcw, Square, Trash2, FileX, WifiOff, Link as LinkIcon } from "lucide-react";
import type { DownloadInfo, DownloadState } from "../types";
import { formatBytes, formatEta, formatSpeed, isUnbounded } from "../format";

// Getters, so the text follows the language chosen in Options.
const STATE_LABEL: Record<DownloadState, string> = {
  get queued() { return t("queued", "Queued"); },
  probing: "Connecting",
  get downloading() { return t("downloading", "Downloading"); },
  get paused() { return t("paused", "Paused"); },
  verifying: "Verifying",
  get completed() { return t("complete", "Completed"); },
  get failed() { return t("failed", "Failed"); },
  cancelled: "Cancelled",
  get waitingForNetwork() { return t("waiting_network", "Waiting for network"); },
  get linkExpired() { return t("link_expired", "Link expired"); },
};

const STATE_COLOR: Record<DownloadState, string> = {
  queued: "bg-purple-500/20 text-purple-300",
  probing: "bg-sky-500/20 text-sky-300",
  downloading: "bg-emerald-500/20 text-emerald-300",
  paused: "bg-amber-500/20 text-amber-300",
  verifying: "bg-violet-500/20 text-violet-300",
  completed: "bg-emerald-500/30 text-emerald-200",
  failed: "bg-red-500/20 text-red-300",
  cancelled: "bg-zinc-500/20 text-zinc-300",
  waitingForNetwork: "bg-orange-500/20 text-orange-300",
  linkExpired: "bg-red-500/20 text-red-300",
};

interface Props {
  d: DownloadInfo;
  onAction: (fn: () => Promise<unknown>) => void;
  actions: {
    pause: (id: string) => Promise<void>;
    resume: (id: string) => Promise<void>;
    cancel: (id: string) => Promise<void>;
    restart: (id: string) => Promise<void>;
    remove: (id: string, deleteFile: boolean) => Promise<void>;
    setLimit: (id: string, bytesPerSec: number) => Promise<void>;
    refreshLink: (id: string, newUrl: string) => Promise<void>;
  };
}

export default function DownloadRow({ d, onAction, actions }: Props) {
  const [limitMb, setLimitMb] = useState<string>(d.speedLimit ? String(d.speedLimit / (1024 * 1024)) : "");
  const [newLink, setNewLink] = useState("");

  const known = d.totalSize != null && d.totalSize > 0;
  const pct = d.state === "completed" ? 100 : known ? Math.min(100, (d.downloaded / (d.totalSize as number)) * 100) : 0;
  const active = d.state === "probing" || d.state === "downloading" || d.state === "verifying";
  const running = d.state === "probing" || d.state === "downloading";
  const canPause = running || d.state === "waitingForNetwork";
  const canResume =
    d.state === "paused" || d.state === "failed" || d.state === "cancelled" || d.state === "waitingForNetwork" || d.state === "linkExpired";
  const showSegments = d.segments.length > 1 && d.segments.every((s) => !isUnbounded(s.end));

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium" title={d.filePath || d.url}>
            {d.fileName}
          </div>
          <div className="truncate text-xs text-zinc-500" title={d.url}>
            {d.url}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {d.resumeSupported === false && (
            <span
              className="rounded-full bg-orange-500/20 px-2 py-0.5 text-xs text-orange-300"
              title="This server cannot continue a download after it stops. Pausing will start over."
            >
              Resume not supported
            </span>
          )}
          {d.protocol && running && (
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${d.protocol === "HTTP/3" ? "bg-violet-500/20 text-violet-300" : "bg-white/10 text-zinc-400"}`}
              title="Protocol of the connections. HTTP/3 (QUIC) copes better with packet loss; the app falls back to HTTP/2 or HTTP/1.1 if it cannot be used."
            >
              {d.protocol}
            </span>
          )}
          <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${STATE_COLOR[d.state]}`}>
            {d.state === "waitingForNetwork" && <WifiOff size={12} />}
            {STATE_LABEL[d.state]}
          </span>
        </div>
      </div>

      {/* Overall progress */}
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-[width] duration-200 ${
            d.state === "failed" ? "bg-red-500" : d.state === "paused" ? "bg-amber-500" : "bg-emerald-500"
          } ${!known && active ? "w-full animate-pulse" : ""}`}
          style={known || !active ? { width: `${pct}%` } : undefined}
        />
      </div>

      {/* Per-segment progress */}
      {showSegments && (
        <div className="mt-2 flex gap-[2px]" title="Progress of each connection">
          {d.segments.map((s) => {
            const len = s.end - s.start + 1;
            const p = Math.min(100, (s.downloaded / len) * 100);
            return (
              <div key={s.index} className="h-1 flex-1 overflow-hidden rounded-sm bg-white/10">
                <div className="h-full bg-sky-400" style={{ width: `${p}%` }} />
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
        <div>
          {formatBytes(d.downloaded)} of {formatBytes(d.totalSize)}
          {known && <span className="ml-1 text-zinc-500">({pct.toFixed(1)}%)</span>}
          {d.checksumVerified === true && <span className="ml-2 text-emerald-400">checksum OK</span>}
        </div>
        <div className="flex items-center gap-4">
          {running && (
            <>
              <span>{formatSpeed(d.speedBps)}</span>
              <span>ETA {formatEta(d.etaSecs)}</span>
            </>
          )}
          <span className="text-zinc-500" title="Connections in use now. The count starts small and grows while the speed keeps improving, and drops if the server refuses connections.">
            {running && d.liveConnections ? `${d.liveConnections} of ${d.connections}` : d.connections} conn.
          </span>
        </div>
      </div>

      {/* Turbo Mode: speed per network adapter */}
      {running && d.adapters && d.adapters.length > 1 && (
        <div className="mt-2 space-y-1" title="Turbo Mode: this download is using several networks at once">
          {d.adapters.map((a) => {
            const share = d.speedBps > 0 ? Math.min(100, (a.speedBps / d.speedBps) * 100) : 0;
            return (
              <div key={a.id} className="flex items-center gap-2 text-xs text-zinc-400">
                <span className="w-32 truncate" title={`${a.name} (${a.ip})`}>{a.name}</span>
                <div className="h-1 flex-1 overflow-hidden rounded-sm bg-white/10">
                  <div className="h-full bg-violet-400" style={{ width: `${share}%` }} />
                </div>
                <span className="w-24 text-right">{formatSpeed(a.speedBps)}</span>
                <span className="w-12 text-right text-zinc-500">{a.connections} conn.</span>
              </div>
            );
          })}
        </div>
      )}

      {d.state === "waitingForNetwork" && (
        <div className="mt-2 text-xs text-orange-300">
          No internet connection. Your progress is saved, and the download continues by itself when you are back online.
        </div>
      )}
      {d.mirrors.length > 0 && (
        <div className="mt-2 text-xs text-zinc-400">
          Mirrors: {d.mirrors.filter((m) => m.ok).length} of {d.mirrors.length} verified and in use
          {d.mirrors.some((m) => !m.ok) && (
            <ul className="mt-1 list-disc pl-5 text-zinc-500">
              {d.mirrors
                .filter((m) => !m.ok)
                .map((m) => (
                  <li key={m.url} className="truncate" title={m.url}>
                    Not used: {m.url}: {m.reason}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
      {d.note && <div className="mt-2 text-xs text-amber-300">{d.note}</div>}
      {d.error && <div className="mt-2 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-300">{d.error.message}</div>}

      {/* An expired link needs a fresh address for the SAME file; progress is kept. */}
      {d.state === "linkExpired" && (
        <div className="mt-2 flex gap-2">
          <input
            className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-3 py-1.5 text-xs outline-none focus:border-sky-500"
            placeholder="Paste a fresh link for this file"
            value={newLink}
            onChange={(e) => setNewLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newLink.trim()) onAction(() => actions.refreshLink(d.id, newLink.trim()).then(() => setNewLink("")));
            }}
          />
          <Btn
            icon={<LinkIcon size={14} />}
            label="Use new link"
            onClick={() => newLink.trim() && onAction(() => actions.refreshLink(d.id, newLink.trim()).then(() => setNewLink("")))}
          />
        </div>
      )}

      {/* Actions */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canPause && (
          <Btn icon={<Pause size={14} />} label="Pause" onClick={() => onAction(() => actions.pause(d.id))} />
        )}
        {canResume && (
          <Btn
            icon={<Play size={14} />}
            label={d.state === "cancelled" ? "Start" : d.state === "linkExpired" ? "Retry" : "Resume"}
            onClick={() => onAction(() => actions.resume(d.id))}
          />
        )}
        {d.state !== "completed" && d.state !== "cancelled" && (
          <Btn icon={<Square size={14} />} label="Cancel" onClick={() => onAction(() => actions.cancel(d.id))} />
        )}
        <Btn icon={<RotateCcw size={14} />} label="Restart" onClick={() => onAction(() => actions.restart(d.id))} />
        <Btn icon={<Trash2 size={14} />} label="Remove" onClick={() => onAction(() => actions.remove(d.id, false))} />
        {d.state === "completed" && (
          <Btn
            icon={<FileX size={14} />}
            label="Remove + delete file"
            onClick={() => onAction(() => actions.remove(d.id, true))}
          />
        )}
        <label className="ml-auto flex items-center gap-1 text-xs text-zinc-500">
          Limit
          <input
            className="w-16 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-xs text-zinc-200"
            placeholder="MB/s"
            inputMode="decimal"
            value={limitMb}
            onChange={(e) => setLimitMb(e.target.value)}
            onBlur={() => {
              const mb = parseFloat(limitMb);
              onAction(() => actions.setLimit(d.id, Number.isFinite(mb) && mb > 0 ? Math.round(mb * 1024 * 1024) : 0));
            }}
            title="Speed limit for this download in MB/s. Empty = unlimited."
          />
        </label>
      </div>
    </div>
  );
}

function Btn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200 hover:bg-white/10"
    >
      {icon}
      {label}
    </button>
  );
}
