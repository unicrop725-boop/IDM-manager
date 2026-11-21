import React, { useState, useEffect, useRef } from "react";
import { ModalCorner } from "./NotchCorner";
import { RotateCcw, ArrowDown, ArrowUp, Activity, Trash2 } from "lucide-react";

const SPEED_HOST = "https://speed.cloudflare.com";

interface SpeedTestModalProps {
  onClose: () => void;
  theme?: "dark" | "light";
}

interface SpeedHistoryItem {
  id: string;
  timestamp: number;
  pingMs: number;
  downloadSpeed: number;
  uploadSpeed: number;
}

/** Low speed = orange/yellow, high speed = green. */
function getGaugeColor(ratio: number): string {
  const r = Math.max(0, Math.min(1, ratio));
  const stops = [
    { pos: 0.0, c: [250, 127, 21] },
    { pos: 0.3, c: [250, 196, 21] },
    { pos: 0.65, c: [97, 213, 43] },
    { pos: 1.0, c: [2, 140, 60] },
  ];
  let lo = stops[0];
  let hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (r >= stops[i].pos && r <= stops[i + 1].pos) {
      lo = stops[i];
      hi = stops[i + 1];
      break;
    }
  }
  const t = hi.pos === lo.pos ? 0 : (r - lo.pos) / (hi.pos - lo.pos);
  const ch = lo.c.map((v, i) => Math.round(v + t * (hi.c[i] - v)));
  return `rgb(${ch[0]}, ${ch[1]}, ${ch[2]})`;
}

export const SpeedTestModal: React.FC<SpeedTestModalProps> = ({ onClose, theme: propTheme }) => {
  // Determine if dark mode is active
  const isDark = propTheme
    ? propTheme === "dark"
    : !document.documentElement.classList.contains("light");

  const [tab, setTab] = useState<"gauge" | "history">("gauge");
  const [testing, setTesting] = useState(false);
  const [phase, setPhase] = useState<"idle" | "ping" | "download" | "upload" | "finished">("idle");
  const [pingMs, setPingMs] = useState(0);
  const [jitterMs, setJitterMs] = useState(0);
  const [downloadSpeed, setDownloadSpeed] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState(0);

  const [history, setHistory] = useState<SpeedHistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem("flowget_speedtest_history");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const saveHistoryResult = (ping: number, dl: number, ul: number) => {
    const newItem: SpeedHistoryItem = {
      id: `${Date.now()}`,
      timestamp: Date.now(),
      pingMs: ping,
      downloadSpeed: Math.round(dl * 10) / 10,
      uploadSpeed: Math.round(ul * 10) / 10,
    };
    setHistory((prev) => {
      const updated = [newItem, ...prev].slice(0, 50);
      localStorage.setItem("flowget_speedtest_history", JSON.stringify(updated));
      return updated;
    });
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem("flowget_speedtest_history");
  };

  const abortRef = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [maxScale, setMaxScale] = useState(100);

  // Stop any running test when the dialog closes
  useEffect(() => () => abortRef.current?.abort(), []);

  const growScale = (mbps: number) =>
    setMaxScale((cur) => {
      if (mbps < cur * 0.9) return cur;
      return [100, 200, 500, 1000, 2000, 5000].find((v) => v > mbps * 1.1) ?? 10000;
    });

  /**
   * Runs `workers` parallel jobs for `durationMs` and reports live Mbps (1s sliding window).
   * Returns the average Mbps measured after a 1s ramp-up.
   */
  const measure = async (
    durationMs: number,
    workers: number,
    job: (addBytes: (n: number) => void, signal: AbortSignal) => Promise<void>,
    onLive: (mbps: number) => void,
    outer: AbortSignal
  ): Promise<number> => {
    const ctrl = new AbortController();
    const onOuter = () => ctrl.abort();
    outer.addEventListener("abort", onOuter);
    let total = 0;
    const t0 = performance.now();
    const marks: { t: number; b: number }[] = [];
    let rampBytes = 0;
    let rampTime = 0;
    const addBytes = (n: number) => {
      total += n;
    };
    const tick = setInterval(() => {
      const now = performance.now();
      marks.push({ t: now, b: total });
      const windowStart = now - 1000;
      const ref = marks.find((m) => m.t >= windowStart) ?? marks[0];
      const dt = (now - ref.t) / 1000;
      if (dt > 0.2) onLive(((total - ref.b) * 8) / 1e6 / dt);
      if (!rampTime && now - t0 >= 1000) {
        rampTime = now;
        rampBytes = total;
      }
    }, 100);
    const stopTimer = setTimeout(() => ctrl.abort(), durationMs);
    try {
      await Promise.all(
        Array.from({ length: workers }, () =>
          job(addBytes, ctrl.signal).catch((e) => {
            if (!ctrl.signal.aborted) throw e;
          })
        )
      );
    } finally {
      clearInterval(tick);
      clearTimeout(stopTimer);
      outer.removeEventListener("abort", onOuter);
    }
    if (outer.aborted) throw new DOMException("Aborted", "AbortError");
    const end = performance.now();
    const secs = (end - (rampTime || t0)) / 1000;
    const bytes = total - (rampTime ? rampBytes : 0);
    return secs > 0 ? (bytes * 8) / 1e6 / secs : 0;
  };

  const startTest = async () => {
    if (testing) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setTesting(true);
    setError(null);
    setPhase("ping");
    setDownloadSpeed(0);
    setUploadSpeed(0);
    setPingMs(0);
    setJitterMs(0);
    setMaxScale(100);

    try {
      // 1) Latency + jitter: small requests to the nearest Cloudflare edge
      const samples: number[] = [];
      for (let i = 0; i < 9; i++) {
        const t = performance.now();
        const res = await fetch(`${SPEED_HOST}/__down?bytes=0&r=${Date.now()}_${i}`, {
          cache: "no-store",
          signal: ctrl.signal,
        });
        await res.arrayBuffer();
        samples.push(performance.now() - t);
      }
      const usable = samples.slice(1); // first request includes DNS/TLS set-up
      const ping = usable.reduce((a, v) => a + v, 0) / usable.length;
      const jitter =
        usable.slice(1).reduce((a, v, i) => a + Math.abs(v - usable[i]), 0) / Math.max(1, usable.length - 1);
      setPingMs(Math.round(ping));
      setJitterMs(Math.round(jitter));

      // 2) Download: 4 parallel streams for 7s
      setPhase("download");
      const dl = await measure(
        7000,
        4,
        async (addBytes, signal) => {
          while (!signal.aborted) {
            const res = await fetch(`${SPEED_HOST}/__down?bytes=100000000&r=${Math.random()}`, {
              cache: "no-store",
              signal,
            });
            const reader = res.body?.getReader();
            if (!reader) throw new Error("Streaming is not supported");
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              addBytes(value.byteLength);
            }
          }
        },
        (mbps) => {
          setDownloadSpeed(mbps);
          growScale(mbps);
        },
        ctrl.signal
      );
      setDownloadSpeed(dl);
      growScale(dl);

      // 3) Upload: 3 parallel POSTs for 6s
      setPhase("upload");
      const payload = new Uint8Array(2 * 1024 * 1024);
      for (let o = 0; o < payload.length; o += 65536) crypto.getRandomValues(payload.subarray(o, o + 65536));
      const blob = new Blob([payload]);
      const ul = await measure(
        6000,
        3,
        (addBytes, signal) =>
          new Promise<void>((resolve, reject) => {
            const run = () => {
              if (signal.aborted) return resolve();
              const xhr = new XMLHttpRequest();
              let last = 0;
              xhr.open("POST", `${SPEED_HOST}/__up`);
              xhr.upload.onprogress = (e) => {
                addBytes(e.loaded - last);
                last = e.loaded;
              };
              xhr.onload = run;
              xhr.onerror = () => (signal.aborted ? resolve() : reject(new Error("Upload failed")));
              signal.addEventListener("abort", () => {
                xhr.abort();
                resolve();
              });
              xhr.send(blob);
            };
            run();
          }),
        (mbps) => {
          setUploadSpeed(mbps);
          growScale(mbps);
        },
        ctrl.signal
      );
      setUploadSpeed(ul);
      growScale(ul);

      setPhase("finished");
      saveHistoryResult(Math.round(ping), dl, ul);
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") return;
      setPhase("idle");
      setError("Speed test failed. Check your internet connection and try again.");
    } finally {
      setTesting(false);
    }
  };

  const currentSpeed =
    phase === "download"
      ? downloadSpeed
      : phase === "upload"
      ? uploadSpeed
      : phase === "finished"
      ? downloadSpeed
      : 0;

  const speedRatio = Math.min(1, Math.max(0, currentSpeed / maxScale));
  const gaugeColor = getGaugeColor(speedRatio);
  const speedLabel =
    phase === "idle"
      ? "Ready"
      : phase === "ping"
      ? "Testing..."
      : speedRatio < 0.15
      ? "Slow"
      : speedRatio < 0.4
      ? "Fair"
      : speedRatio < 0.7
      ? "Good"
      : "Excellent";

  // Scale labels placed around the arc (angles match the bezel opening at the bottom)
  const STAGE_CX = 200;
  const STAGE_CY = 163;
  const LABEL_RADIUS = 182;
  const scaleLabels = [300, 252, 204, 156, 108, 60].map((deg, i) => {
    const rad = (deg * Math.PI) / 180;
    return {
      key: i,
      text: String(Math.round((i * maxScale) / 5)),
      x: STAGE_CX + Math.sin(rad) * LABEL_RADIUS,
      y: STAGE_CY + Math.cos(rad) * LABEL_RADIUS,
    };
  });

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4 select-none animate-in fade-in duration-200">
      <div
        className={`notch-card w-[500px] border shadow-2xl overflow-hidden flex flex-col text-xs transition-colors duration-200 ${
          isDark
            ? "bg-[#090F17] border-cyan-500/20 shadow-[0_0_50px_rgba(6,182,212,0.15)] text-slate-300"
            : "bg-white border-slate-200 shadow-2xl text-slate-700"
        }`}
      >
        <ModalCorner onClose={onClose} />
        {/* Header */}
        <div
          className={`flex items-center justify-between px-5 py-3.5 border-b transition-colors duration-200 ${
            isDark
              ? "bg-[#0B131F]/90 border-slate-800/80"
              : "bg-slate-50 border-slate-200"
          }`}
        >
          <div className="flex items-center gap-2.5">
            <span className="relative flex w-2 h-2">
              <span className="absolute inline-flex w-full h-full rounded-full bg-red-500/60 animate-ping" />
              <span className="relative inline-flex w-2 h-2 rounded-full bg-red-500" />
            </span>
            <span className={`font-bold text-sm tracking-wide ${isDark ? "text-white" : "text-slate-900"}`}>
              Internet Speed Test
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div
              className={`flex items-center rounded-xl p-0.5 border ${
                isDark ? "bg-[#060B12] border-slate-800" : "bg-slate-100 border-slate-200"
              }`}
            >
              <button
                type="button"
                onClick={() => setTab("gauge")}
                className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                  tab === "gauge"
                    ? isDark
                      ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                      : "bg-white text-teal-700 border border-slate-200 shadow-sm"
                    : isDark
                    ? "text-slate-400 hover:text-white"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                Speed Dial
              </button>
              <button
                type="button"
                onClick={() => setTab("history")}
                className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                  tab === "history"
                    ? isDark
                      ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                      : "bg-white text-teal-700 border border-slate-200 shadow-sm"
                    : isDark
                    ? "text-slate-400 hover:text-white"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                History ({history.length})
              </button>
            </div>

          </div>
        </div>

        {/* Tab 1: Speedometer Dial */}
        {tab === "gauge" && (
          <div className="p-6 flex flex-col items-center justify-center space-y-6">
            {/* Arc Gauge Stage */}
            <div
              className="spd-stage"
              style={
                {
                  "--spd-progress": speedRatio,
                  "--spd-color": gaugeColor,
                  "--spd-track": isDark ? "#243044" : "#c4c8c7",
                } as React.CSSProperties
              }
            >
              <svg
                viewBox="0 0 620 502"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="absolute top-0 overflow-visible"
                style={{ left: 30, width: 340 }}
              >
                {/* Progress fill, clipped to the track shape */}
                <g clipPath="url(#spd-big-chunk-mask)">
                  <foreignObject width="620" height="502">
                    <div className="spd-progress-fill" />
                  </foreignObject>
                </g>

                {/* Track inner shadow */}
                <g filter="url(#spd-inner-shadow)">
                  <path
                    d="M308.5 76C431.383 76 531 175.572 531 298.401C531 336.044 521.643 371.502 505.128 402.58C504.02 404.666 501.333 405.281 499.397 403.926L456.487 373.903C454.86 372.765 454.324 370.606 455.185 368.817C465.441 347.511 471.188 323.627 471.188 298.401C471.188 208.591 398.35 135.785 308.5 135.785C218.65 135.785 145.812 208.591 145.812 298.401C145.812 327.372 153.392 354.574 166.677 378.133C167.702 379.95 167.208 382.258 165.499 383.455L122.873 413.28C120.999 414.591 118.405 414.063 117.234 412.099C97.3965 378.828 86 339.945 86 298.401C86 175.572 185.617 76 308.5 76Z"
                    fill="#C0C4C3"
                  />
                </g>

                {/* Bezel */}
                <g filter="url(#spd-bezel-shadow)">
                  <path
                    d="M308.5 20C462.311 20 587 144.712 587 298.551C587 349.01 573.586 396.334 550.13 437.152C540.926 453.168 519.207 454.633 506.147 441.571V441.571C495.726 431.148 494.489 414.851 501.456 401.861C517.96 371.09 527.321 335.914 527.321 298.551C527.321 177.677 429.352 79.6896 308.5 79.6896C187.648 79.6896 89.6786 177.677 89.6786 298.551C89.6786 340.154 101.285 379.045 121.435 412.163C129.406 425.264 128.613 442.406 117.771 453.251V453.251C105.204 465.82 84.4159 464.934 74.7381 450.024C46.4376 406.423 30 354.407 30 298.551C30 144.712 154.689 20 308.5 20Z"
                    fill={isDark ? "#1B2433" : "#F5F5F3"}
                  />
                </g>

                {/* Outer colour ring */}
                <g clipPath="url(#spd-inner-stroke-mask)">
                  <g transform="matrix(-1.70441e-08 0.22579 -0.243711 -1.84148e-08 308.5 278.135)">
                    <foreignObject x="-1052.47" y="-1052.47" width="2104.95" height="2104.95">
                      <div
                        style={{
                          background:
                            "conic-gradient(from 90deg,rgba(108, 84, 26, 1) 0deg,rgba(2, 126, 43, 1) 43.8398deg,rgba(97, 213, 43, 1) 136.398deg,rgba(250, 196, 21, 1) 245.769deg,rgba(250, 127, 21, 1) 276.374deg,rgba(254, 26, 4, 1) 299.674deg,rgba(108, 84, 26, 1) 360deg)",
                          height: "100%",
                          width: "100%",
                        }}
                      />
                    </foreignObject>
                  </g>
                </g>

                <defs>
                  <filter id="spd-inner-shadow" x="86" y="76" width="445" height="342" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
                    <feFlood floodOpacity="0" result="BackgroundImageFix" />
                    <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
                    <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
                    <feOffset dy="4" />
                    <feGaussianBlur stdDeviation="6" />
                    <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
                    <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.35 0" />
                  </filter>

                  <filter id="spd-bezel-shadow" x="0" y="0" width="617" height="502" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
                    <feFlood floodOpacity="0" result="BackgroundImageFix" />
                    <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
                    <feOffset dy="10" />
                    <feGaussianBlur stdDeviation="15" />
                    <feComposite in2="hardAlpha" operator="out" />
                    <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.2 0" />
                    <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow" />
                    <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow" result="shape" />
                  </filter>

                  <clipPath id="spd-big-chunk-mask">
                    <path d="M308.5 76C431.383 76 531 175.572 531 298.401C531 336.044 521.643 371.502 505.128 402.58C504.02 404.666 501.333 405.281 499.397 403.926L456.487 373.903C454.86 372.765 454.324 370.606 455.185 368.817C465.441 347.511 471.188 323.627 471.188 298.401C471.188 208.591 398.35 135.785 308.5 135.785C218.65 135.785 145.812 208.591 145.812 298.401C145.812 327.372 153.392 354.574 166.677 378.133C167.702 379.95 167.208 382.258 165.499 383.455L122.873 413.28C120.999 414.591 118.405 414.063 117.234 412.099C97.3965 378.828 86 339.945 86 298.401C86 175.572 185.617 76 308.5 76Z" />
                  </clipPath>

                  <clipPath id="spd-inner-stroke-mask">
                    <path d="M308.5 42C352.525 42 393.959 53.0975 430.16 72.6479C434.457 74.9684 435.482 80.6161 432.417 84.419V84.419C429.949 87.4808 425.63 88.2799 422.166 86.419C388.316 68.2318 349.612 57.9147 308.5 57.9147C175.624 57.9147 67.907 165.684 67.907 298.625C67.907 344.39 80.673 387.171 102.836 423.6C104.798 426.826 104.367 430.99 101.698 433.661V433.661C98.1223 437.238 92.1621 436.648 89.5235 432.332C65.7196 393.393 52 347.612 52 298.625C52 156.895 166.839 42 308.5 42ZM552.083 251.981C556.553 250.782 561.112 253.629 561.835 258.202C563.918 271.37 565 284.871 565 298.625C565 342.592 553.948 383.976 534.473 420.149C531.988 424.765 525.779 425.547 522.074 421.84V421.84C519.519 419.283 518.999 415.34 520.705 412.154C538.82 378.333 549.093 339.68 549.093 298.625C549.093 285.888 548.103 273.382 546.198 261.18C545.555 257.059 548.056 253.06 552.083 251.981V251.981ZM451.602 94.6439C454.231 91.3832 458.947 90.7155 462.296 93.2295C505.604 125.741 538.292 171.643 554.224 224.793C555.485 228.999 552.954 233.361 548.716 234.497V234.497C544.467 235.636 540.113 233.103 538.84 228.89C523.892 179.398 493.444 136.636 453.144 106.257C449.473 103.49 448.717 98.2234 451.602 94.6439V94.6439Z" />
                  </clipPath>
                </defs>
              </svg>

              {/* Scale labels around the arc */}
              {scaleLabels.map((l) => (
                <span
                  key={l.key}
                  className={`absolute w-10 h-10 -ml-5 -mt-5 flex items-center justify-center text-[12px] pointer-events-none ${
                    isDark ? "text-slate-400" : "text-slate-500"
                  }`}
                  style={{ left: l.x, top: l.y }}
                >
                  {l.text}
                </span>
              ))}

              {/* Current value + status pill */}
              <div
                className="absolute flex flex-col items-center gap-1 pointer-events-none"
                style={{ left: STAGE_CX, top: STAGE_CY - 38, transform: "translateX(-50%)" }}
              >
                <div className="flex items-baseline gap-1">
                  <span className={`text-[40px] leading-none font-semibold tabular-nums ${isDark ? "text-white" : "text-slate-800"}`}>
                    {currentSpeed.toFixed(0)}
                  </span>
                  <span className={`text-[12px] ${isDark ? "text-slate-400" : "text-slate-500"}`}>Mbps</span>
                </div>
                <span className={`spd-pill ${isDark ? "text-slate-200" : "text-slate-700"}`}>{speedLabel}</span>
              </div>

              {/* Start button in the opening of the arc */}
              <button
                type="button"
                onClick={startTest}
                disabled={testing}
                className={`absolute w-[52px] h-[52px] -ml-[26px] rounded-full border-2 active:scale-95 disabled:opacity-75 transition-all flex items-center justify-center cursor-pointer group ${
                  isDark
                    ? "bg-[#08121C] border-teal-500/70 hover:border-teal-300 shadow-[0_0_18px_rgba(20,184,166,0.3)] text-white"
                    : "bg-white border-teal-600 hover:bg-teal-50 shadow-lg text-teal-800"
                }`}
                style={{ left: STAGE_CX, top: 222 }}
              >
                <span className="text-[12px] font-bold tracking-wide">{testing ? "..." : "Start"}</span>
              </button>
            </div>

            {/* Test Status Indicator */}
            <div className="text-center font-medium">
              {error && <span className="font-semibold text-rose-500">{error}</span>}
              {phase === "idle" && !error && (
                <span className={isDark ? "text-slate-400" : "text-slate-500"}>Click Start to begin speed test</span>
              )}
              {phase === "ping" && (
                <span className={`animate-pulse font-semibold ${isDark ? "text-cyan-400" : "text-teal-600"}`}>
                  Testing Latency & Jitter...
                </span>
              )}
              {phase === "download" && (
                <span className={`font-bold animate-pulse ${isDark ? "text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "text-emerald-600"}`}>
                  Testing Download Speed...
                </span>
              )}
              {phase === "upload" && (
                <span className={`font-bold animate-pulse ${isDark ? "text-sky-400 drop-shadow-[0_0_8px_rgba(56,189,248,0.5)]" : "text-sky-600"}`}>
                  Testing Upload Speed...
                </span>
              )}
              {phase === "finished" && (
                <span className={`font-bold ${isDark ? "text-teal-300 drop-shadow-[0_0_8px_rgba(45,212,191,0.6)]" : "text-teal-700"}`}>
                  Test Complete
                </span>
              )}
            </div>

            {/* Metric Cards (Ping, Download, Upload) */}
            <div className="w-full grid grid-cols-3 gap-3">
              {/* Ping */}
              <div
                className={`p-3.5 rounded-2xl border text-center space-y-1 transition-colors ${
                  isDark
                    ? "bg-[#0B1420]/80 border-purple-500/30 text-white"
                    : "bg-slate-50 border-slate-200 text-slate-900 shadow-sm"
                }`}
              >
                <div className={`flex items-center justify-center gap-1.5 ${isDark ? "text-purple-400" : "text-purple-600"}`}>
                  <Activity className="w-4 h-4" />
                  <span className={isDark ? "text-slate-400" : "text-slate-500"}>Ping</span>
                </div>
                <div className="text-base font-extrabold font-mono">
                  {pingMs > 0 ? pingMs : "--"} <span className="text-xs font-normal opacity-60">ms</span>
                </div>
                {/* Heartbeat strip */}
                <div className="heartbeat-strip pt-0.5">
                  <svg aria-hidden="true" viewBox="0 20 550 150" className="block w-full h-8">
                    <path
                      className="heartbeat-line"
                      d="m0,130.08h44.51c7.08-3.45,11.54-24.65,19.42-24.81s13.23,22.54,21.03,24.81c10.03,2.92,29.69-14.6,39.91-12.4,4.58.98,9.34,12.36,14.02,12.4,3.54.03,7.25-9.31,10.79-9.17,3.24.13,6.17,7.93,9.17,9.17s9.68-1.48,12.4,0c2.4,1.3,3.45,10.3,5.93,9.17,3.23-1.48,2.82-103.01,8.09-103.01,6.96,0,12.35,137.53,16.72,137.53,3.9,0-.09-36.61,8.49-43.69,3.41-2.81,13.69,1.93,17.66,0,7.17-3.49,11.72-24.71,19.69-25.08,8.62-.4,15.39,22.86,23.73,25.08,8.99,2.38,26.51-12.76,35.6-10.79,5.58,1.21,11.46,15.82,17.12,15.1,3.88-.49,4.87-12.59,8.76-12.94,3.01-.28,5.7,7.46,8.49,8.63s9.75-1.43,12.54,0,4.03,9.39,7.01,9.71c4.98.54,2.64-103.55,8.63-103.55,5.16,0,8.8,111.51,12.94,111.64,5.02.16,5.01-15.2,9.3-17.8s15.02,2.06,19.42,0c7.39-3.46,12.74-25.17,20.9-25.08,8.97.09,13.68,25.85,22.38,28.04,9.17,2.31,25.4-15.93,34.79-14.83,4.95.58,11.31,10.3,16.04,11.87h44.51"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      strokeWidth="7"
                      fill="none"
                      stroke="#DE6262"
                    />
                  </svg>
                </div>
              </div>

              {/* Download */}
              <div
                className={`p-3.5 rounded-2xl border text-center space-y-1 transition-colors ${
                  isDark
                    ? "bg-[#0B1420]/80 border-emerald-500/30 text-emerald-400"
                    : "bg-slate-50 border-slate-200 text-emerald-600 shadow-sm"
                }`}
              >
                <div className={`flex items-center justify-center gap-1.5 ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                  <ArrowDown className="w-4 h-4" />
                  <span className={isDark ? "text-slate-400" : "text-slate-500"}>Download</span>
                </div>
                <div className="text-base font-extrabold font-mono">
                  {downloadSpeed.toFixed(1)} <span className="text-xs font-normal opacity-60">Mbps</span>
                </div>
              </div>

              {/* Upload */}
              <div
                className={`p-3.5 rounded-2xl border text-center space-y-1 transition-colors ${
                  isDark
                    ? "bg-[#0B1420]/80 border-cyan-500/30 text-cyan-400"
                    : "bg-slate-50 border-slate-200 text-cyan-700 shadow-sm"
                }`}
              >
                <div className={`flex items-center justify-center gap-1.5 ${isDark ? "text-cyan-400" : "text-cyan-600"}`}>
                  <ArrowUp className="w-4 h-4" />
                  <span className={isDark ? "text-slate-400" : "text-slate-500"}>Upload</span>
                </div>
                <div className="text-base font-extrabold font-mono">
                  {uploadSpeed.toFixed(1)} <span className="text-xs font-normal opacity-60">Mbps</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: History */}
        {tab === "history" && (
          <div className="p-5 space-y-3 max-h-80 overflow-y-auto">
            <div className="flex items-center justify-between text-xs opacity-75">
              <span>Past Tests ({history.length})</span>
              {history.length > 0 && (
                <button
                  type="button"
                  onClick={clearHistory}
                  className="flex items-center gap-1 text-rose-500 hover:text-rose-400 text-[11px] cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear History
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <div className="py-12 text-center text-xs opacity-50">
                No past speed test records found.
              </div>
            ) : (
              <div className="space-y-2">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className={`p-3.5 rounded-xl border flex items-center justify-between text-xs transition-colors ${
                      isDark
                        ? "bg-[#0B1420] border-slate-800 hover:border-slate-700"
                        : "bg-slate-50 border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div>
                      <div className={`font-semibold ${isDark ? "text-white" : "text-slate-900"}`}>
                        {new Date(item.timestamp).toLocaleString()}
                      </div>
                      <div className="text-[11px] opacity-60">
                        Ping: {item.pingMs} ms
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-right">
                      <div>
                        <div className="text-[10px] opacity-50 uppercase tracking-wider">Download</div>
                        <div className="font-mono font-bold text-emerald-500">{item.downloadSpeed} Mbps</div>
                      </div>
                      <div>
                        <div className="text-[10px] opacity-50 uppercase tracking-wider">Upload</div>
                        <div className="font-mono font-bold text-cyan-500">{item.uploadSpeed} Mbps</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div
          className={`flex items-center justify-between px-5 py-3.5 border-t transition-colors ${
            isDark
              ? "bg-[#0B131F]/90 border-slate-800/80"
              : "bg-slate-50 border-slate-200"
          }`}
        >
          <span className="text-[11px] opacity-60 font-mono">
            {phase === "finished" ? `Jitter: ${jitterMs}ms` : "Server: Cloudflare (nearest edge)"}
          </span>
          <button
            type="button"
            onClick={startTest}
            disabled={testing}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl gradient-accent text-white font-medium hover:opacity-90 active:scale-95 disabled:opacity-50 transition-all shadow-md cursor-pointer"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${testing ? "animate-spin" : ""}`} />
            <span>{testing ? "Testing..." : "Test Again"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
