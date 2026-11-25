import React, { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import {
  Link2,
  CloudDownload,
  Play,
  Square,
  TimerOff,
  Trash2,
  Settings,
  Copy,
  CalendarClock,
  Forward,
  FolderOpen,
  Youtube,
  Clapperboard,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { api } from "../api";
import type { MediaResolveResult } from "../types";
import { formatBytes } from "../format";
import { Select } from "./Select";
import { getVideoSite, formatDuration, heightLabel } from "../utils/videoUrl";

interface ToolbarProps {
  onQuickAddUrl: (url: string) => void;
  /** Start a video download at the chosen quality (height/fps), or audio only. */
  onDownloadVideo: (
    url: string,
    opts: {
      height?: number;
      fps?: number;
      audioOnly?: boolean;
      saveDir?: string;
      container?: "mp4" | "mkv" | "mp3" | "m4a";
    }
  ) => Promise<void>;
  onOpenAddModal: () => void;
  hasSelection: boolean;
  canResume: boolean;
  canPause: boolean;
  onResume: () => void;
  onPause: () => void;
  onStopAll: () => void;
  onDelete: () => void;
  onOpenOptions: () => void;
  onOpenQueues: () => void;
  onOpenSchedule: () => void;
  onShare: () => void;
}

interface ToolButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  color: string;
}

const ToolButton: React.FC<ToolButtonProps> = ({ icon: Icon, label, onClick, disabled, color }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="tool-btn flex flex-col items-center justify-center w-[76px] h-[68px] rounded-xl text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-45 disabled:hover:bg-transparent transition-colors cursor-pointer group"
  >
    <Icon className={`w-7 h-7 ${color} group-hover:scale-110 transition-transform`} strokeWidth={1.7} />
    <span className="text-[12px] mt-1.5">{label}</span>
  </button>
);

export const Toolbar: React.FC<ToolbarProps> = ({
  onQuickAddUrl,
  onDownloadVideo,
  onOpenAddModal,
  hasSelection,
  canResume,
  canPause,
  onResume,
  onPause,
  onStopAll,
  onDelete,
  onOpenOptions,
  onOpenQueues,
  onOpenSchedule,
  onShare,
}) => {
  const [urlInput, setUrlInput] = useState("");

  // ----- video links: look up qualities and let the user pick resolution + fps -----
  const site = getVideoSite(urlInput);
  const [mediaState, setMediaState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [mediaInfo, setMediaInfo] = useState<MediaResolveResult | null>(null);
  const [mediaError, setMediaError] = useState("");
  const [selHeight, setSelHeight] = useState("");
  const [selFps, setSelFps] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [saveDir, setSaveDir] = useState("");
  const [container, setContainer] = useState<"mp4" | "mkv" | "mp3" | "m4a">("mp4");
  const [starting, setStarting] = useState(false);
  const token = useRef(0);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    setDismissed(false);
    const trimmed = urlInput.trim();
    if (!getVideoSite(trimmed)) {
      token.current++;
      setMediaState("idle");
      setMediaInfo(null);
      return;
    }
    const mine = ++token.current;
    setMediaState("loading");
    setMediaInfo(null);
    setMediaError("");
    const timer = setTimeout(async () => {
      try {
        const res = await api.resolveVideo(trimmed);
        if (mine !== token.current) return;
        if (res.isDrm) {
          setMediaError(res.drmMessage || "This video is protected and cannot be downloaded.");
          setMediaState("error");
          return;
        }
        const opts = res.videoOptions ?? [];
        if (opts.length === 0) {
          setMediaError("No video qualities were found for this link.");
          setMediaState("error");
          return;
        }
        // default: the best quality up to 1080p
        const heights = [...new Set(opts.map((o) => o.height))].sort((a, b) => b - a);
        const h = heights.find((v) => v <= 1080) ?? heights[0];
        const fps = Math.max(...opts.filter((o) => o.height === h).map((o) => o.fps));
        setSelHeight(String(h));
        setSelFps(String(fps));
        setContainer("mp4");
        setMediaInfo(res);
        setMediaState("ready");
      } catch (e) {
        if (mine !== token.current) return;
        const msg = typeof e === "string" ? e : (e as Error)?.message || "";
        setMediaError(
          msg.includes("yt-dlp is not")
            ? "yt-dlp is not installed. Install it with: pip install yt-dlp"
            : "Could not read this video link."
        );
        setMediaState("error");
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [urlInput]);

  // a link pushed in from outside (e.g. the "copied link" prompt)
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onFill = (e: Event) => {
      const url = (e as CustomEvent<string>).detail;
      if (typeof url === "string") {
        setUrlInput(url);
        inputRef.current?.focus();
      }
    };
    window.addEventListener("flowget-fill-url", onFill);
    return () => window.removeEventListener("flowget-fill-url", onFill);
  }, []);

  // close the picker when clicking elsewhere
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element;
      if (target.closest?.(".select-list")) return; // the resolution / fps lists live outside the form
      if (formRef.current && !formRef.current.contains(target)) setDismissed(true);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const videoOptions = mediaInfo?.videoOptions ?? [];
  const heights = [...new Set(videoOptions.map((o) => o.height))].sort((a, b) => b - a);
  const audioSelected = selHeight === "audio";
  const fpsChoices = [...new Set(videoOptions.filter((o) => String(o.height) === selHeight).map((o) => o.fps))].sort(
    (a, b) => b - a
  );
  const chosen = videoOptions.find((o) => String(o.height) === selHeight && String(o.fps) === selFps);

  const browseFolder = async () => {
    try {
      const picked = await api.pickFolder(saveDir || undefined);
      if (picked) setSaveDir(picked);
    } catch {
      /* picker closed or unavailable */
    }
  };

  const onHeightChange = (value: string) => {
    setSelHeight(value);
    setContainer(value === "audio" ? "mp3" : "mp4");
    if (value !== "audio") {
      const fps = Math.max(...videoOptions.filter((o) => String(o.height) === value).map((o) => o.fps));
      setSelFps(String(fps));
    }
  };

  const startVideo = async () => {
    setStarting(true);
    try {
      await onDownloadVideo(
        urlInput.trim(),
        audioSelected
          ? { audioOnly: true, saveDir: saveDir.trim() || undefined, container }
          : { height: Number(selHeight), fps: Number(selFps), saveDir: saveDir.trim() || undefined, container }
      );
      setUrlInput("");
    } catch (e) {
      setMediaError(typeof e === "string" ? e : (e as Error)?.message || "Could not start the download.");
      setMediaState("error");
    } finally {
      setStarting(false);
    }
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = urlInput.trim();
    if (trimmed && site && mediaState === "ready") {
      void startVideo();
    } else if (trimmed) {
      onQuickAddUrl(trimmed);
      setUrlInput("");
    } else {
      onOpenAddModal();
    }
  };

  const showPanel = site !== null && !dismissed && mediaState !== "idle";
  const LeftIcon = mediaState === "loading" ? Loader2 : site === "youtube" ? Youtube : site ? Clapperboard : Link2;
  const leftColor = site === "youtube" ? "text-red-500" : site ? "text-purple-400" : "text-[var(--text-secondary)]";
  const selectClass =
    "w-full h-9 px-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-primary)] text-[13px] outline-none cursor-pointer";

  return (
    <div className="toolbar-root grad-bar-down select-none">
    <div className="toolbar-inner flex flex-wrap items-center px-4 py-3 gap-x-5 gap-y-2">
      {/* Left: Add URL Input */}
      <form ref={formRef} onSubmit={handleSubmit} className="relative flex-1 min-w-[220px] max-w-[560px]">
        <div className="fancy-field flex items-center w-full h-12 pl-4 pr-1.5">
          <LeftIcon
            className={`w-5 h-5 flex-shrink-0 transition-colors ${leftColor} ${mediaState === "loading" ? "animate-spin" : ""}`}
            strokeWidth={1.6}
          />
          <input
            ref={inputRef}
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Add Url"
            className="fancy-input !pl-3"
            onKeyDown={(e) => e.key === "Escape" && setDismissed(true)}
          />
          <button
            type="submit"
            title="Download URL"
            className="w-9 h-9 rounded-md gradient-accent hover:opacity-90 active:scale-95 text-white flex items-center justify-center transition-all flex-shrink-0 cursor-pointer"
          >
            <CloudDownload className="w-5 h-5" strokeWidth={1.8} />
          </button>
        </div>

        {showPanel && (
          <div className="dd-anim absolute left-0 top-full mt-3 z-40 w-[min(500px,100%)] rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-2xl p-4 text-[13px] text-[var(--text-secondary)]">
            {mediaState === "loading" && (
              <div className="flex items-center gap-2.5 py-1">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Looking up video qualities...</span>
              </div>
            )}

            {mediaState === "error" && <div className="text-rose-400 py-1">{mediaError}</div>}

            {mediaState === "ready" && mediaInfo && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  {mediaInfo.thumbnail && (
                    <img
                      src={mediaInfo.thumbnail}
                      alt=""
                      className="w-24 h-14 rounded-lg object-cover flex-shrink-0 bg-[var(--bg-card)]"
                    />
                  )}
                  <div className="min-w-0">
                    <div className="truncate font-medium text-[var(--text-primary)]" title={mediaInfo.title}>
                      {mediaInfo.title || "Video"}
                    </div>
                    {mediaInfo.duration ? (
                      <div className="text-[12px]">{formatDuration(mediaInfo.duration)}</div>
                    ) : null}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <div className="mb-1 text-[12px]">Resolution</div>
                    <Select value={selHeight} onChange={(e) => onHeightChange(e.target.value)} className={selectClass}>
                      {heights.map((h) => (
                        <option key={h} value={String(h)}>
                          {heightLabel(h)}
                        </option>
                      ))}
                      <option value="audio">Audio only</option>
                    </Select>
                  </div>
                  <div>
                    <div className="mb-1 text-[12px]">Frame rate</div>
                    <Select
                      value={audioSelected ? "" : selFps}
                      onChange={(e) => setSelFps(e.target.value)}
                      disabled={audioSelected}
                      className={selectClass}
                    >
                      {audioSelected ? (
                        <option value="">-</option>
                      ) : (
                        fpsChoices.map((f) => (
                          <option key={f} value={String(f)}>
                            {f} fps
                          </option>
                        ))
                      )}
                    </Select>
                  </div>
                  <div>
                    <div className="mb-1 text-[12px]">Format</div>
                    <Select
                      value={container}
                      onChange={(e) => setContainer(e.target.value as "mp4" | "mkv" | "mp3" | "m4a")}
                      className={selectClass}
                    >
                      {audioSelected ? (
                        <>
                          <option value="mp3">MP3</option>
                          <option value="m4a">M4A</option>
                        </>
                      ) : (
                        <>
                          <option value="mp4">MP4</option>
                          <option value="mkv">MKV</option>
                        </>
                      )}
                    </Select>
                  </div>
                </div>

                <div>
                  <div className="mb-1 text-[12px]">Save to</div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={saveDir}
                      onChange={(e) => setSaveDir(e.target.value)}
                      placeholder={audioSelected ? "Default (Music folder)" : "Default (Videos folder)"}
                      className="flex-1 min-w-0 h-9 px-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-primary)] text-[13px] outline-none focus:border-purple-500/50"
                    />
                    <button
                      type="button"
                      onClick={() => void browseFolder()}
                      title="Choose a folder"
                      className="h-9 px-3 rounded-lg gradient-accent text-white text-[12px] font-medium flex items-center gap-1.5 hover:opacity-90 cursor-pointer flex-shrink-0"
                    >
                      <FolderOpen className="w-4 h-4" />
                      <span>Browse</span>
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 pt-1">
                  <span className="text-[12px]">
                    {audioSelected
                      ? `Best audio, saved as ${container.toUpperCase()}`
                      : chosen?.fileSizeApprox
                      ? `About ${formatBytes(chosen.fileSizeApprox)} + audio`
                      : "Size unknown"}
                  </span>
                  <button
                    type="button"
                    onClick={() => void startVideo()}
                    disabled={starting}
                    className="px-4 h-9 rounded-xl gradient-accent text-white font-medium text-[13px] flex items-center gap-2 hover:opacity-90 disabled:opacity-60 cursor-pointer"
                  >
                    {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudDownload className="w-4 h-4" />}
                    <span>Download</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </form>

      <div className="tool-divider h-9 w-[1px] bg-[var(--border-subtle)] flex-shrink-0" />

      {/* Action Buttons: large icon on top, small label below */}
      <div className="tool-group flex items-center gap-3 flex-shrink-0">
        <ToolButton icon={Play} label={t("resume", "Resume")} color="text-emerald-400" onClick={onResume} disabled={!canResume} />
        <ToolButton icon={Square} label={t("stop", "Stop")} color="text-amber-400" onClick={onPause} disabled={!canPause} />
        <ToolButton icon={TimerOff} label={t("stop_all", "Stop All")} color="text-rose-400" onClick={onStopAll} />

        <div className="h-9 w-[1px] bg-[var(--border-subtle)] mx-2" />

        <ToolButton icon={Trash2} label={t("delete", "Delete")} color="text-red-400" onClick={onDelete} disabled={!hasSelection} />
        <ToolButton icon={Settings} label={t("options", "Options")} color="text-sky-400" onClick={onOpenOptions} />
        <ToolButton icon={Copy} label={t("queues", "Queues")} color="text-purple-400" onClick={onOpenQueues} />
        <ToolButton icon={CalendarClock} label={t("schedule", "Schedule")} color="text-teal-400" onClick={onOpenSchedule} />
        <ToolButton icon={Forward} label={t("share", "Share")} color="text-blue-400" onClick={onShare} disabled={!hasSelection} />
      </div>
    </div>
    </div>
  );
};
