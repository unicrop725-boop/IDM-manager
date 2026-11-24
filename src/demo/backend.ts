// Simulated download engine for the website demo. Nothing is downloaded and no network request is made:
// it keeps a list of fake downloads and moves their numbers along, emitting the same events the Rust backend does.
import type { AddRequest, DownloadInfo, DownloadState, SegmentProgress } from "../types";
import { demoEmit } from "./bus";

const MB = 1024 * 1024;
const SEGMENTS = 8;
const TICK_MS = 500;

const EXT_CATEGORY: Record<string, string> = {
  mp3: "Music", wav: "Music", flac: "Music", aac: "Music", m4a: "Music",
  zip: "Compressed", rar: "Compressed", "7z": "Compressed", tar: "Compressed", gz: "Compressed",
  mp4: "Videos", mkv: "Videos", avi: "Videos", mov: "Videos", webm: "Videos",
  exe: "Programs", msi: "Programs", bat: "Programs", cmd: "Programs",
  pdf: "Documents", doc: "Documents", docx: "Documents", xls: "Documents", txt: "Documents",
  apk: "APKs", xapk: "APKs",
  jpg: "Images", jpeg: "Images", png: "Images", gif: "Images", iso: "Images",
  torrent: "Torrents",
};

interface Sim {
  info: DownloadInfo;
  /** Typical speed in bytes/s while downloading. */
  speed: number;
  /** Per-segment lead or lag, so the segment bars do not move in lockstep. */
  offsets: number[];
}

const sims = new Map<string, Sim>();
let nextId = 1;
let globalLimit = 0;
let timer = 0;

function categoryFor(name: string): string {
  const ext = (name.split(".").pop() || "").toLowerCase();
  return EXT_CATEGORY[ext] || "Others";
}

function segmentsFor(total: number, downloaded: number, offsets: number[]): SegmentProgress[] {
  const len = Math.floor(total / SEGMENTS);
  const frac = downloaded / total;
  const raw = offsets.map((o) => Math.min(1, Math.max(0, frac + o)));
  const have = raw.reduce((a, f) => a + f * len, 0);
  const k = have > 0 ? downloaded / have : 0;
  return raw.map((f, i) => ({
    index: i,
    start: i * len + (i ? 1 : 0),
    end: i === SEGMENTS - 1 ? total : (i + 1) * len,
    downloaded: Math.min(len, Math.floor(f * k * len)),
  }));
}

function build(
  name: string,
  totalMB: number,
  pct: number,
  state: DownloadState,
  speedMBps: number,
  host: string,
  category?: string,
  extra: Partial<DownloadInfo> = {},
): Sim {
  const id = "demo-" + nextId++;
  const total = Math.round(totalMB * MB);
  const cat = category || categoryFor(name);
  const dir = "C:\\Downloads\\" + cat;
  const now = Math.floor(Date.now() / 1000);
  const offsets = Array.from({ length: SEGMENTS }, () => (Math.random() - 0.6) * 0.16);
  const downloaded = state === "completed" ? total : Math.round((total * pct) / 100);
  const info: DownloadInfo = {
    id,
    url: `https://${host}/${name}`,
    fileName: name,
    filePath: `${dir}\\${name}`,
    saveDir: dir,
    totalSize: total,
    downloaded,
    state,
    resumeSupported: true,
    mime: null,
    connections: SEGMENTS,
    speedLimit: 0,
    checksum: null,
    checksumVerified: state === "completed" ? true : null,
    error: null,
    createdAt: now - Math.floor(Math.random() * 900) - 60,
    completedAt: state === "completed" ? now - Math.floor(Math.random() * 600) : null,
    speedBps: 0,
    etaSecs: null,
    segments: segmentsFor(total, downloaded, state === "completed" ? offsets.map(() => 0) : offsets),
    note: null,
    protocol: "HTTP/2",
    mirrors: [],
    category: cat,
    queueId: "main",
    ...extra,
  };
  const sim: Sim = { info, speed: speedMBps * MB, offsets };
  sims.set(id, sim);
  return sim;
}

function seed(): void {
  sims.clear();
  nextId = 1;
  build("blender-4.2.0-windows-x64.msi", 340, 19.1, "downloading", 24, "download.example.com");
  build("DeepLearning_IanGoodfellow.pdf", 45.8, 93.4, "downloading", 7, "mirror.example.org");
  build("Figma-Setup-v116.15.exe", 113, 66.2, "downloading", 16, "cdn.example.com");
  build("node-v22.11.0-x64.msi", 32.9, 100, "completed", 0, "nodejs.example.org");
  build("platform-tools-latest-windows.zip", 179, 100, "completed", 0, "dl.example.com");
  build("Spotify-Master-Collection-FLAC.zip", 1228.8, 80, "downloading", 28, "cdn.example.com");
  build("DaVinci_Resolve_Studio_19.0.zip", 4300.8, 55.4, "downloading", 30, "download.example.com");
  build("ubuntu-24.04-desktop-amd64.iso", 4812.8, 70.5, "downloading", 26, "releases.example.org");
  build("Cyberpunk_2077_Patch_v2.1.zip", 18124.8, 50.2, "paused", 34, "patches.example.net");
  build("Interstellar.2014.2160p.HDR.mkv", 24576, 32.1, "paused", 36, "media.example.net");
  build("VSCodeUserSetup-x64-1.95.0.exe", 93.9, 100, "completed", 0, "update.example.com");
  build("rust-1.82.0-x86_64-pc-windows-msvc.msi", 164, 100, "completed", 0, "static.example.org");
}

function publish(sim: Sim): void {
  demoEmit("download-updated", { ...sim.info, segments: sim.info.segments.map((s) => ({ ...s })) });
}

function tick(): void {
  const dt = TICK_MS / 1000;
  const active = [...sims.values()].filter((s) => s.info.state === "downloading");
  let want = 0;
  const targets = active.map((s) => {
    const own = s.info.speedLimit > 0 ? s.info.speedLimit : Infinity;
    const t = Math.min(own, s.speed * (0.8 + Math.random() * 0.4));
    want += t;
    return t;
  });
  const scale = globalLimit > 0 && want > globalLimit ? globalLimit / want : 1;
  let total = 0;
  active.forEach((s, i) => {
    const info = s.info;
    const size = info.totalSize || 0;
    const bps = targets[i] * scale;
    info.downloaded = Math.min(size, info.downloaded + bps * dt);
    total += bps;
    if (info.downloaded >= size) {
      info.downloaded = size;
      info.state = "completed";
      info.speedBps = 0;
      info.etaSecs = null;
      info.completedAt = Math.floor(Date.now() / 1000);
      info.checksumVerified = true;
      info.segments = segmentsFor(size, size, s.offsets.map(() => 0));
      publish(s);
      return;
    }
    info.speedBps = bps;
    info.etaSecs = bps > 0 ? Math.round((size - info.downloaded) / bps) : null;
    info.segments = segmentsFor(size, info.downloaded, s.offsets);
    demoEmit("download-progress", {
      id: info.id,
      downloaded: info.downloaded,
      total: size,
      speedBps: bps,
      etaSecs: info.etaSecs,
      segments: info.segments,
      note: null,
      protocol: info.protocol,
      connections: info.connections,
      adapters: [],
    });
  });
  let done = 0;
  sims.forEach((s) => {
    if (s.info.state === "completed") done++;
  });
  // Let the page around the demo show live numbers.
  try {
    if (window.parent !== window) {
      window.parent.postMessage({ type: "flowget-demo", active: active.length, speedBps: total, done }, window.location.origin);
    }
  } catch {
    /* embedded somewhere that does not allow it: ignore */
  }
}

function start(): void {
  if (!timer) timer = window.setInterval(tick, TICK_MS);
}

function get(id: string): Sim | undefined {
  return sims.get(id);
}

function setState(id: string, state: DownloadState): void {
  const s = get(id);
  if (!s) return;
  s.info.state = state;
  if (state !== "downloading") {
    s.info.speedBps = 0;
    s.info.etaSecs = null;
  }
  s.info.error = null;
  publish(s);
}

export const demoBackend = {
  init(): void {
    if (sims.size === 0) seed();
    start();
  },
  list(): DownloadInfo[] {
    demoBackend.init();
    return [...sims.values()].map((s) => ({ ...s.info }));
  },
  add(request: AddRequest): DownloadInfo {
    demoBackend.init();
    const path = (request.url || "").split(/[?#]/)[0].replace(/\/+$/, "");
    let name = request.fileName || decodeURIComponent(path.split("/").pop() || "") || "download.bin";
    if (!/\.[A-Za-z0-9]{1,5}$/.test(name)) name += ".bin";
    const hostMatch = (request.url || "").match(/^[a-z]+:\/\/([^/?#]+)/i);
    const state: DownloadState = request.startPaused ? "paused" : request.startQueued ? "queued" : "downloading";
    const sim = build(name, 60 + Math.random() * 840, 0, state, 12 + Math.random() * 22, hostMatch ? hostMatch[1] : "files.example.com", request.category || undefined, {
      url: request.url,
      connections: request.connections || SEGMENTS,
      speedLimit: request.speedLimit || 0,
      createdAt: Math.floor(Date.now() / 1000),
    });
    publish(sim);
    return { ...sim.info };
  },
  pause: (id: string) => setState(id, "paused"),
  resume: (id: string) => setState(id, "downloading"),
  queue: (id: string) => setState(id, "queued"),
  cancel: (id: string) => setState(id, "cancelled"),
  restart(id: string): void {
    const s = get(id);
    if (!s) return;
    s.info.downloaded = 0;
    s.info.completedAt = null;
    s.info.checksumVerified = null;
    s.info.segments = segmentsFor(s.info.totalSize || 1, 0, s.offsets);
    setState(id, "downloading");
  },
  refreshLink(id: string, url: string): void {
    const s = get(id);
    if (!s) return;
    s.info.url = url;
    setState(id, "downloading");
  },
  remove(id: string): void {
    if (sims.delete(id)) demoEmit("download-removed", id);
  },
  setMeta(id: string, category?: string | null, queueId?: string | null, queueOrder?: number | null): DownloadInfo | undefined {
    const s = get(id);
    if (!s) return undefined;
    if (category) s.info.category = category;
    if (queueId) s.info.queueId = queueId;
    if (queueOrder != null) s.info.queueOrder = queueOrder;
    publish(s);
    return { ...s.info };
  },
  setSpeedLimit(id: string | null, bps: number): void {
    if (id) {
      const s = get(id);
      if (s) s.info.speedLimit = bps;
    } else {
      globalLimit = bps;
    }
  },
};
