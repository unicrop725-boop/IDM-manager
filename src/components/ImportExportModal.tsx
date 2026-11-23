import { useEffect, useMemo, useState } from "react";
import { ModalCorner } from "./NotchCorner";
import { Upload, Save, History, FileText, Globe, Download, RotateCcw, Check, AlertTriangle } from "lucide-react";
import { api } from "../api";
import { formatBytes } from "../format";
import type { BrowserProfile, ImportItem, RestoreSummary } from "../types";

interface Props {
  onClose: () => void;
  /** Something was added or restored: reload the lists. */
  onChanged: () => void;
}

type Source = "idm" | "fdm" | "jdownloader" | "browser" | "text";

const SOURCES: { id: Source; label: string; hint: string; exts: string[] }[] = [
  {
    id: "idm",
    label: "Internet Download Manager",
    hint: "In IDM choose Tasks > Export and save the file (.ef2, or a text list). Cookies and referrers saved by IDM come along.",
    exts: ["ef2", "txt", "*"],
  },
  {
    id: "fdm",
    label: "Free Download Manager",
    hint: "Save or export your list of links from FDM as a text file. FlowGet reads every download link in it.",
    exts: ["txt", "csv", "json", "xml", "html", "*"],
  },
  {
    id: "jdownloader",
    label: "JDownloader",
    hint: "Use a link list or .crawljob file exported from JDownloader. Save folders and file names are kept when present.",
    exts: ["crawljob", "json", "txt", "*"],
  },
  {
    id: "browser",
    label: "Browser download history",
    hint: "Lists what Chrome, Edge or Brave downloaded before, so you can fetch it again with FlowGet.",
    exts: [],
  },
  {
    id: "text",
    label: "Any file with links",
    hint: "A text file, bookmarks page or export. Every http, https, ftp and magnet link inside is found.",
    exts: ["txt", "html", "htm", "csv", "json", "xml", "*"],
  },
];

const errText = (e: unknown) => (typeof e === "string" ? e : (e as Error)?.message || "Something went wrong.");

const nameOf = (i: ImportItem) => {
  if (i.fileName) return i.fileName;
  try {
    const last = new URL(i.url).pathname.split("/").filter(Boolean).pop();
    if (last) return decodeURIComponent(last);
    return new URL(i.url).hostname;
  } catch {
    return i.url;
  }
};

const btn =
  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition disabled:opacity-50";
const primary = `${btn} bg-sky-500 text-black hover:bg-sky-400`;
const ghost = `${btn} border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]`;

export default function ImportExportModal({ onClose, onChanged }: Props) {
  const [tab, setTab] = useState<"import" | "backup">("import");
  const [source, setSource] = useState<Source>("idm");
  const [profiles, setProfiles] = useState<BrowserProfile[]>([]);
  const [profilePath, setProfilePath] = useState("");
  const [items, setItems] = useState<ImportItem[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState("");
  const [startNow, setStartNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);

  useEffect(() => {
    api.listBrowserProfiles().then((p) => {
      setProfiles(p);
      if (p[0]) setProfilePath(p[0].path);
    });
  }, []);

  const src = SOURCES.find((s) => s.id === source)!;

  const choose = (s: Source) => {
    setSource(s);
    setItems(null);
    setPicked(new Set());
    setMessage(null);
  };

  const showItems = (list: ImportItem[], preselect: boolean) => {
    setItems(list);
    setPicked(preselect ? new Set(list.map((_, i) => i)) : new Set());
    setFilter("");
  };

  const readFile = async () => {
    setMessage(null);
    try {
      // "*" in the list means any file may be chosen (no filter).
      const path = await api.pickFile(`Choose the ${src.label} file`, src.exts.includes("*") ? [] : src.exts);
      if (!path) return;
      setBusy(true);
      showItems(await api.importPreview(source, path), true);
    } catch (e) {
      setItems(null);
      setMessage({ ok: false, text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  const readHistory = async () => {
    setMessage(null);
    setBusy(true);
    try {
      // A long history: nothing is ticked until the user chooses.
      showItems(await api.importPreview("browser", profilePath), false);
    } catch (e) {
      setItems(null);
      setMessage({ ok: false, text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  const visible = useMemo(() => {
    if (!items) return [];
    const q = filter.trim().toLowerCase();
    return items.map((it, i) => ({ it, i })).filter(({ it }) => !q || `${nameOf(it)} ${it.url}`.toLowerCase().includes(q));
  }, [items, filter]);

  const toggle = (i: number) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const addSelected = async () => {
    if (!items) return;
    setBusy(true);
    setMessage(null);
    let ok = 0;
    const failures: string[] = [];
    for (const i of [...picked].sort((a, b) => a - b)) {
      const it = items[i];
      try {
        await api.addDownload({
          url: it.url,
          fileName: it.fileName ?? undefined,
          referer: it.referer ?? undefined,
          userAgent: it.userAgent ?? undefined,
          cookies: it.cookies ?? undefined,
          saveDir: it.saveDir ?? undefined,
          startPaused: !startNow,
        });
        ok++;
      } catch (e) {
        failures.push(`${nameOf(it)}: ${errText(e)}`);
      }
    }
    setBusy(false);
    onChanged();
    setMessage({
      ok: failures.length === 0,
      text:
        `Added ${ok} download${ok === 1 ? "" : "s"}${startNow ? "" : " (paused)"}.` +
        (failures.length ? ` ${failures.length} could not be added: ${failures.slice(0, 2).join("; ")}${failures.length > 2 ? "…" : ""}` : ""),
    });
    if (ok > 0) {
      setItems(null);
      setPicked(new Set());
    }
  };

  const saveBackup = async () => {
    setMessage(null);
    try {
      const day = new Date().toISOString().slice(0, 10);
      const path = await api.pickFile("Save FlowGet backup", ["json"], true, `flowget-backup-${day}.json`);
      if (!path) return;
      setBusy(true);
      const n = await api.exportBackup(path);
      setMessage({ ok: true, text: `Backup saved: settings and ${n} download${n === 1 ? "" : "s"}.` });
    } catch (e) {
      setMessage({ ok: false, text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  const chooseRestore = async () => {
    setMessage(null);
    try {
      const path = await api.pickFile("Choose a FlowGet backup", ["json"]);
      if (path) setConfirmRestore(path);
    } catch (e) {
      setMessage({ ok: false, text: errText(e) });
    }
  };

  const restore = async () => {
    if (!confirmRestore) return;
    setBusy(true);
    setMessage(null);
    try {
      const s: RestoreSummary = await api.restoreBackup(confirmRestore);
      onChanged();
      setMessage({
        ok: true,
        text: `Restored ${s.settings} settings, ${s.queues} queues and ${s.downloads} downloads${
          s.skippedDownloads ? ` (${s.skippedDownloads} already here were left alone)` : ""
        }.`,
      });
    } catch (e) {
      setMessage({ ok: false, text: errText(e) });
    } finally {
      setBusy(false);
      setConfirmRestore(null);
    }
  };

  const tabBtn = (id: "import" | "backup", label: string, icon: React.ReactNode) => (
    <button
      onClick={() => {
        setTab(id);
        setMessage(null);
      }}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
        tab === id ? "bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs select-none">
      <div className="notch-card flex max-h-[620px] w-full max-w-2xl flex-col overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-xs text-[var(--text-secondary)] shadow-2xl">
        <ModalCorner onClose={onClose} />
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-3.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <Upload size={16} className="text-sky-400" />
            Import &amp; Backup
          </div>
        </div>
        <div className="flex gap-1 border-b border-[var(--border-subtle)] px-4 py-2">
          {tabBtn("import", "Import downloads", <Download size={14} />)}
          {tabBtn("backup", "Backup & restore", <Save size={14} />)}
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {tab === "import" && (
            <>
              <div className="grid grid-cols-5 gap-2">
                {SOURCES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => choose(s.id)}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border p-2.5 text-center leading-tight transition ${
                      source === s.id
                        ? "border-sky-500 bg-sky-500/10 text-[var(--text-primary)]"
                        : "border-[var(--border-subtle)] bg-[var(--bg-card)] hover:bg-[var(--bg-hover)]"
                    }`}
                  >
                    {s.id === "browser" ? <History size={18} /> : s.id === "text" ? <FileText size={18} /> : <Globe size={18} />}
                    <span className="text-[11px]">{s.label}</span>
                  </button>
                ))}
              </div>
              <p className="text-[11px]">{src.hint}</p>

              {source === "browser" ? (
                profiles.length === 0 ? (
                  <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
                    No Chrome, Edge or Brave history was found on this PC.
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <select
                      value={profilePath}
                      onChange={(e) => setProfilePath(e.target.value)}
                      className="flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2.5 py-1.5 text-[var(--text-primary)]"
                    >
                      {profiles.map((p) => (
                        <option key={p.path} value={p.path}>
                          {p.browser} — {p.profile}
                        </option>
                      ))}
                    </select>
                    <button className={primary} disabled={busy} onClick={readHistory}>
                      <History size={14} /> {busy ? "Reading…" : "Read history"}
                    </button>
                  </div>
                )
              ) : (
                <button className={primary} disabled={busy} onClick={readFile}>
                  <Upload size={14} /> {busy ? "Reading…" : "Choose file…"}
                </button>
              )}

              {items && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[var(--text-primary)]">
                      {items.length} download{items.length === 1 ? "" : "s"} found · {picked.size} selected
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        placeholder="Filter…"
                        className="w-32 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2 py-1 text-[var(--text-primary)] outline-none focus:border-sky-500"
                      />
                      <button className="text-sky-400 hover:underline" onClick={() => setPicked(new Set(visible.map((v) => v.i)))}>
                        Select shown
                      </button>
                      <button className="text-sky-400 hover:underline" onClick={() => setPicked(new Set())}>
                        None
                      </button>
                    </div>
                  </div>
                  <div className="max-h-56 divide-y divide-[var(--border-subtle)] overflow-y-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)]">
                    {visible.slice(0, 300).map(({ it, i }) => (
                      <label key={i} className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-[var(--bg-hover)]">
                        <input
                          type="checkbox"
                          checked={picked.has(i)}
                          onChange={() => toggle(i)}
                          className="rounded border-[var(--text-disabled)] text-purple-500"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[var(--text-primary)]">{nameOf(it)}</div>
                          <div className="truncate text-[10px] text-[var(--text-disabled)]" title={it.url}>
                            {it.url}
                          </div>
                        </div>
                        <div className="whitespace-nowrap text-right text-[10px]">
                          {it.size ? formatBytes(it.size) : ""}
                          {it.note && <div>{it.note}</div>}
                        </div>
                      </label>
                    ))}
                    {visible.length > 300 && (
                      <div className="p-2 text-center text-[10px] text-[var(--text-disabled)]">
                        Showing the first 300 of {visible.length}. Use the filter to narrow the list.
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={startNow}
                        onChange={(e) => setStartNow(e.target.checked)}
                        className="rounded border-[var(--text-disabled)] text-purple-500"
                      />
                      Start downloading right away
                    </label>
                    <button className={primary} disabled={busy || picked.size === 0} onClick={addSelected}>
                      <Download size={14} /> {busy ? "Adding…" : `Add ${picked.size} download${picked.size === 1 ? "" : "s"}`}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {tab === "backup" && (
            <div className="space-y-3">
              <div className="space-y-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
                <div className="font-semibold text-[var(--text-primary)]">Save a backup</div>
                <p className="text-[11px]">
                  One file with your settings, categories, queues and download history. Passwords, cookies and your
                  license key are <b>not</b> included.
                </p>
                <button className={primary} disabled={busy} onClick={saveBackup}>
                  <Save size={14} /> Save backup…
                </button>
              </div>
              <div className="space-y-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
                <div className="font-semibold text-[var(--text-primary)]">Restore from a backup</div>
                <p className="text-[11px]">
                  Brings back settings, queues and history from a backup file, on this or another PC. Downloads that
                  are already in the list are left alone and nothing is deleted.
                </p>
                {confirmRestore ? (
                  <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-amber-100">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                      <span>
                        Restore from <b className="break-all">{confirmRestore}</b>? Settings in the file replace the
                        matching ones here.
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button className={primary} disabled={busy} onClick={restore}>
                        <RotateCcw size={14} /> {busy ? "Restoring…" : "Yes, restore"}
                      </button>
                      <button className={ghost} onClick={() => setConfirmRestore(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button className={ghost} disabled={busy} onClick={chooseRestore}>
                    <RotateCcw size={14} /> Choose backup file…
                  </button>
                )}
              </div>
            </div>
          )}

          {message && (
            <div
              className={`flex items-start gap-2 rounded-lg border p-2.5 ${
                message.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-red-500/30 bg-red-500/10 text-red-200"
              }`}
            >
              {message.ok ? <Check size={14} className="mt-0.5 flex-shrink-0" /> : <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />}
              <span>{message.text}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
