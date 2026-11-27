import { useEffect, useState } from "react";
import { listen } from "../events";
import { Download, RefreshCw, ShieldCheck, Plus, Trash2, Check, Wrench, Clock, ExternalLink } from "lucide-react";
import { api } from "../api";
import type { BandwidthPolicy, BandwidthRule, BandwidthStatus, ToolInfo, ToolsProgress } from "../types";

const MIB = 1024 * 1024;
const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_TITLES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const card = "rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3 space-y-2.5";
const input =
  "rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] outline-none focus:border-sky-500";
const primaryBtn =
  "flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 font-medium text-black hover:bg-sky-400 transition disabled:opacity-50";
const ghostBtn =
  "flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 py-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition disabled:opacity-50";

/** What the user sees instead of the helper programs' real names. */
const TOOL_LABELS: Record<string, string> = { "yt-dlp": "Video engine", ffmpeg: "Media converter" };

const errText = (e: unknown) => (typeof e === "string" ? e : (e as Error)?.message || "Something went wrong.");

// ------------------------------------------------------------------------------------------------ Tools

export function ToolsPanel() {
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<ToolsProgress | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [autoUpdate, setAutoUpdate] = useState(true);

  const reload = () => api.getToolsStatus().then(setTools).catch(() => setTools([]));

  useEffect(() => {
    reload();
    api.getSetting("tools_auto_update").then((v) => setAutoUpdate(v !== "0")).catch(() => {});
    const un = listen<ToolsProgress>("tools-progress", ({ payload }) => setProgress(payload));
    return () => {
      un.then((f) => f());
    };
  }, []);

  const run = async (name: string, force: boolean) => {
    setBusy(name);
    setMessage(null);
    try {
      setMessage({ ok: true, text: await api.installTool(name, force) });
    } catch (e) {
      setMessage({ ok: false, text: errText(e) });
    } finally {
      setBusy(null);
      setProgress(null);
      reload();
    }
  };

  const pct = progress && progress.total > 0 ? Math.round((progress.downloaded / progress.total) * 100) : null;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 flex items-start gap-3">
        <Wrench className="mt-0.5 h-5 w-5 flex-shrink-0 text-sky-400" />
        <div>
          <h4 className="font-semibold text-[var(--text-primary)]">Video tools, installed for you</h4>
          <p className="text-[11px] text-[var(--text-secondary)]">
            The video engine (for video sites) and the media converter (for joining and converting) are set up by
            BoltGrab the first time a video needs them. Nothing to configure. Each download is verified for safety.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {(tools.length ? tools : [{ name: "yt-dlp" }, { name: "ffmpeg" }] as ToolInfo[]).map((t) => {
          const working = busy === t.name;
          return (
            <div key={t.name} className={card}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
                    {TOOL_LABELS[t.name] ?? "Component"}
                    {t.installed ? (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                        Installed · {t.source}
                      </span>
                    ) : tools.length ? (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                        Not installed
                      </span>
                    ) : null}
                  </div>
                  <div className="truncate text-[11px] text-[var(--text-secondary)]">
                    {t.installed ? `Version ${t.version ?? "unknown"}` : "Will be installed automatically when needed"}
                  </div>
                </div>
                <button disabled={busy !== null} onClick={() => run(t.name, t.name === "ffmpeg" && t.installed)} className={primaryBtn}>
                  {working ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  {working ? "Working…" : t.installed ? (t.name === "yt-dlp" ? "Update" : "Reinstall") : "Install now"}
                </button>
              </div>
              {working && progress && progress.tool === t.name && (
                <div className="space-y-1">
                  <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-hover)]">
                    <div
                      className="h-full rounded-full bg-sky-500 transition-all"
                      style={{ width: `${pct ?? 100}%`, opacity: pct === null ? 0.4 : 1 }}
                    />
                  </div>
                  <div className="text-[11px] text-[var(--text-secondary)]">
                    {progress.stage === "downloading"
                      ? `Downloading… ${pct !== null ? pct + "%" : ""}`
                      : progress.message || progress.stage}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <label className="flex items-start gap-2.5 font-medium text-[var(--text-secondary)] cursor-pointer">
        <input
          type="checkbox"
          checked={autoUpdate}
          onChange={(e) => {
            setAutoUpdate(e.target.checked);
            api.setSetting("tools_auto_update", e.target.checked ? "1" : "0").catch(() => {});
          }}
          className="mt-0.5 rounded border-[var(--text-disabled)] text-purple-500"
        />
        <div>
          <div>Keep the video engine up to date automatically</div>
          <p className="text-[11px] font-normal text-[var(--text-secondary)]">
            Video sites change often, so BoltGrab checks for an update about once a week and installs it quietly.
          </p>
        </div>
      </label>

      {message && (
        <div
          className={`rounded-lg border p-2.5 text-[12px] ${
            message.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-red-500/30 bg-red-500/10 text-red-200"
          }`}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ Bandwidth

const newRule = (): BandwidthRule => ({ days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", mode: "limit", limitBps: 2 * MIB });

export function BandwidthPanel() {
  const [policy, setPolicy] = useState<BandwidthPolicy | null>(null);
  const [status, setStatus] = useState<BandwidthStatus | null>(null);
  const [hotspots, setHotspots] = useState("");
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.getBandwidthPolicy().then((p) => {
      setPolicy(p);
      setHotspots(p.hotspotNames.join(", "));
    });
    api.getBandwidthState().then(setStatus).catch(() => {});
  }, []);

  // Changes are saved by themselves a moment after the last edit, so nothing is lost by closing this window.
  useEffect(() => {
    if (!dirty || !policy) return;
    const t = setTimeout(async () => {
      try {
        await api.setBandwidthPolicy({
          ...policy,
          hotspotNames: hotspots.split(",").map((x) => x.trim()).filter(Boolean),
        });
        setDirty(false);
        setMessage({ ok: true, text: "Saved. The new limits apply right away." });
      } catch (e) {
        setMessage({ ok: false, text: errText(e) });
      }
    }, 700);
    return () => clearTimeout(t);
  }, [policy, hotspots, dirty]);

  if (!policy) return <div className="text-[12px]">Loading…</div>;

  const update = (patch: Partial<BandwidthPolicy>) => {
    setPolicy({ ...policy, ...patch });
    setDirty(true);
  };
  const updateRule = (i: number, patch: Partial<BandwidthRule>) =>
    update({ rules: policy.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const toggleDay = (i: number, d: number) => {
    const days = policy.rules[i].days;
    updateRule(i, { days: days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort() });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-teal-500/20 bg-teal-500/5 p-3 flex items-start gap-3">
        <Clock className="mt-0.5 h-5 w-5 flex-shrink-0 text-teal-400" />
        <div>
          <h4 className="font-semibold text-[var(--text-primary)]">Smarter bandwidth control</h4>
          <p className="text-[11px] text-[var(--text-secondary)]">
            Limits build on the speed limit in the Connection tab: the stricter one wins, unless a schedule says "No
            limit". They apply to normal file downloads; videos from video sites are not throttled.
          </p>
        </div>
      </div>

      {/* Slow mode */}
      <div className={card}>
        <label className="flex items-start gap-2.5 font-medium text-[var(--text-primary)] cursor-pointer">
          <input
            type="checkbox"
            checked={policy.slowMode}
            onChange={(e) => update({ slowMode: e.target.checked })}
            className="mt-0.5 rounded border-[var(--text-disabled)] text-purple-500"
          />
          <div>
            <div>Slow mode</div>
            <p className="text-[11px] font-normal text-[var(--text-secondary)]">
              Keeps downloads gentle so browsing and calls stay smooth. You can also switch it from the bar at the
              bottom of the window.
            </p>
          </div>
        </label>
        <div className="flex items-center gap-2 pl-6 text-[var(--text-secondary)]">
          Speed in slow mode
          <input
            type="number"
            min={0.1}
            step={0.1}
            value={+(policy.slowModeBps / MIB).toFixed(2)}
            onChange={(e) => update({ slowModeBps: Math.round(parseFloat(e.target.value || "0") * MIB) })}
            className={`${input} w-20`}
          />
          MB/s
        </div>
      </div>

      {/* Schedule */}
      <div className={card}>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold text-[var(--text-primary)]">Limits by time of day</div>
            <p className="text-[11px] text-[var(--text-secondary)]">For example: 2 MB/s on weekdays 09:00–17:00, full speed at night.</p>
          </div>
          <button onClick={() => update({ rules: [...policy.rules, newRule()] })} className={ghostBtn}>
            <Plus className="h-3.5 w-3.5" /> Add schedule
          </button>
        </div>
        {policy.rules.length === 0 && (
          <div className="py-2 text-center text-[11px] text-[var(--text-disabled)]">No schedules. Downloads use your global limit all day.</div>
        )}
        {policy.rules.map((r, i) => (
          <div key={i} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex gap-1" role="group" aria-label="Days">
                {DAY_LETTERS.map((l, d) => (
                  <button
                    key={d}
                    type="button"
                    title={DAY_TITLES[d]}
                    onClick={() => toggleDay(i, d)}
                    className={`h-6 w-6 rounded-md text-[11px] font-medium transition ${
                      r.days.includes(d)
                        ? "bg-sky-500 text-black"
                        : "bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {l}
                  </button>
                ))}
                <span className="ml-2 self-center text-[10px] text-[var(--text-disabled)]">
                  {r.days.length === 0 ? "every day" : ""}
                </span>
              </div>
              <button
                onClick={() => update({ rules: policy.rules.filter((_, j) => j !== i) })}
                title="Remove this schedule"
                className="text-[var(--text-disabled)] hover:text-red-400"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[var(--text-secondary)]">
              From
              <input type="time" value={r.start} onChange={(e) => updateRule(i, { start: e.target.value })} className={input} />
              to
              <input type="time" value={r.end} onChange={(e) => updateRule(i, { end: e.target.value })} className={input} />
              <select
                value={r.mode}
                onChange={(e) => updateRule(i, { mode: e.target.value as BandwidthRule["mode"] })}
                className={input}
              >
                <option value="limit">Limit to</option>
                <option value="pause">Pause downloads</option>
                <option value="unlimited">No limit</option>
              </select>
              {r.mode === "limit" && (
                <>
                  <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={+(r.limitBps / MIB).toFixed(2)}
                    onChange={(e) => updateRule(i, { limitBps: Math.round(parseFloat(e.target.value || "0") * MIB) })}
                    className={`${input} w-20`}
                  />
                  MB/s
                </>
              )}
            </div>
            {r.start && r.end && r.start > r.end && (
              <div className="text-[10px] text-[var(--text-disabled)]">Runs past midnight into the next day.</div>
            )}
          </div>
        ))}
      </div>

      {/* Metered / hotspot */}
      <div className={card}>
        <label className="flex items-start gap-2.5 font-medium text-[var(--text-primary)] cursor-pointer">
          <input
            type="checkbox"
            checked={policy.pauseOnMetered}
            onChange={(e) => update({ pauseOnMetered: e.target.checked })}
            className="mt-0.5 rounded border-[var(--text-disabled)] text-purple-500"
          />
          <div>
            <div>Pause downloads on metered or hotspot connections</div>
            <p className="text-[11px] font-normal text-[var(--text-secondary)]">
              Protects your mobile data. Windows marks phone hotspots and mobile data as metered. Downloads continue
              by themselves when you are back on a normal network. A "Download anyway" button appears at the bottom
              of the window.
            </p>
          </div>
        </label>
        <div className="pl-6 space-y-1.5">
          <label className="block text-[var(--text-secondary)]">
            Also treat these Wi-Fi names as hotspots (separate with commas)
            <input
              value={hotspots}
              onChange={(e) => {
                setHotspots(e.target.value);
                setDirty(true);
              }}
              placeholder="My Phone, Pixel 8"
              className={`${input} mt-1 w-full`}
            />
          </label>
          {status && (
            <div className="text-[11px] text-[var(--text-secondary)]">
              Right now: {status.network.ssid ? `Wi-Fi “${status.network.ssid}”` : "connected"} ·{" "}
              {policy.pauseOnMetered || status.network.metered
                ? status.network.metered
                  ? `metered (${status.network.why ?? "Windows says so"})`
                  : "not metered"
                : "metered status is checked once the switch above is on"}
            </div>
          )}
        </div>
      </div>

      <div className="min-h-[20px] text-[12px]">
        {message ? (
          <span className={message.ok ? "text-emerald-400" : "text-red-300"}>{message.text}</span>
        ) : (
          <span className="text-[var(--text-disabled)]">Changes here are saved automatically.</span>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ Safety

export function SafetyPanel() {
  const [vt, setVt] = useState<{ hasKey: boolean; enabled: boolean }>({ hasKey: false, enabled: false });
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = () => api.getVirusTotalStatus().then(setVt).catch(() => {});
  useEffect(() => {
    reload();
  }, []);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api.setVirusTotalKey(key);
      setKey("");
      setMessage({ ok: true, text: "VirusTotal accepted the key. Finished downloads will be checked." });
    } catch (e) {
      setMessage({ ok: false, text: errText(e) });
    } finally {
      setBusy(false);
      reload();
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-400" />
        <div>
          <h4 className="font-semibold text-[var(--text-primary)]">Safety checks</h4>
          <p className="text-[11px] text-[var(--text-secondary)]">
            BoltGrab always warns about programs (.exe, .msi, scripts) and about disguised files such as
            “invoice.pdf.exe”, and asks before opening a risky file.
          </p>
        </div>
      </div>

      <div className={card}>
        <div className="flex items-center justify-between">
          <div className="font-semibold text-[var(--text-primary)]">VirusTotal check</div>
          {vt.hasKey && vt.enabled ? (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">On</span>
          ) : (
            <span className="rounded-full bg-[var(--bg-hover)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">Off</span>
          )}
        </div>
        <p className="text-[11px] text-[var(--text-secondary)]">
          When a download finishes, BoltGrab looks up its fingerprint (SHA-256) on VirusTotal and shows how many of ~70
          antivirus engines flag it. <b>Only the fingerprint is sent, never the file.</b> A file VirusTotal has never
          seen is shown as “unknown”, which is normal for new files. The free key allows 4 lookups a minute.
        </p>
        {vt.hasKey ? (
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-[var(--text-primary)]">API key saved in the Windows Credential Manager.</span>
            <button
              className={ghostBtn}
              onClick={async () => {
                await api.clearVirusTotalKey();
                reload();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove key
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Paste your VirusTotal API key"
              className={`${input} flex-1`}
              autoComplete="off"
            />
            <button className={primaryBtn} disabled={busy || !key.trim()} onClick={save}>
              {busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Save & test
            </button>
          </div>
        )}
        <p className="flex items-center gap-1 text-[11px] text-[var(--text-disabled)]">
          <ExternalLink className="h-3 w-3" /> Get a free key at virustotal.com (sign up, then “API key” in your profile).
        </p>
      </div>

      {message && (
        <div
          className={`rounded-lg border p-2.5 text-[12px] ${
            message.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-red-500/30 bg-red-500/10 text-red-200"
          }`}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}
