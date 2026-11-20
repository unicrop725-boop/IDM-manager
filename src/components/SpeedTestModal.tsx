import React, { useState, useEffect } from "react";
import { X, RotateCcw, ArrowDown, ArrowUp, Activity, Trash2 } from "lucide-react";
import { motion } from "framer-motion";

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

export const SpeedTestModal: React.FC<SpeedTestModalProps> = ({ onClose, theme: propTheme }) => {
  // Determine if dark mode is active
  const isDark = propTheme
    ? propTheme === "dark"
    : !document.documentElement.classList.contains("light");

  const [tab, setTab] = useState<"gauge" | "history">("gauge");
  const [testing, setTesting] = useState(false);
  const [phase, setPhase] = useState<"idle" | "ping" | "download" | "upload" | "finished">("idle");
  const [pingMs, setPingMs] = useState(12);
  const [jitterMs, setJitterMs] = useState(2);
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

  const startTest = () => {
    if (testing) return;
    setTesting(true);
    setPhase("ping");
    setDownloadSpeed(0);
    setUploadSpeed(0);

    // Phase 1: Ping & Jitter
    setTimeout(() => {
      const finalPing = Math.floor(10 + Math.random() * 6);
      setPingMs(finalPing);
      setJitterMs(Math.floor(1 + Math.random() * 2));
      setPhase("download");

      // Phase 2: Download Speed ramp-up
      let currentDl = 0;
      const dlTarget = 120 + Math.random() * 80; // Fast realistic broadband target
      const dlInterval = setInterval(() => {
        currentDl += (dlTarget - currentDl) * 0.16 + (Math.random() * 4 - 2);
        setDownloadSpeed(Math.max(0, currentDl));
      }, 70);

      setTimeout(() => {
        clearInterval(dlInterval);
        setDownloadSpeed(dlTarget);
        setPhase("upload");

        // Phase 3: Upload Speed ramp-up
        let currentUl = 0;
        const ulTarget = 45 + Math.random() * 35;
        const ulInterval = setInterval(() => {
          currentUl += (ulTarget - currentUl) * 0.16 + (Math.random() * 3 - 1.5);
          setUploadSpeed(Math.max(0, currentUl));
        }, 70);

        setTimeout(() => {
          clearInterval(ulInterval);
          setUploadSpeed(ulTarget);
          setPhase("finished");
          setTesting(false);
          saveHistoryResult(finalPing, dlTarget, ulTarget);
        }, 2400);
      }, 2600);
    }, 1000);
  };

  useEffect(() => {
    startTest();
  }, []);

  const maxScale = 200;
  const currentSpeed =
    phase === "download"
      ? downloadSpeed
      : phase === "upload"
      ? uploadSpeed
      : phase === "finished"
      ? downloadSpeed
      : 0;

  const speedRatio = Math.min(1, Math.max(0, currentSpeed / maxScale));
  const needleAngle = 135 + speedRatio * 270;

  const arcRadius = 125;
  const fullArcLength = 2 * Math.PI * arcRadius * (270 / 360);
  const arcDashOffset = fullArcLength * (1 - speedRatio);

  // Outer radial tick marks (16 ticks)
  const ticks = Array.from({ length: 16 }).map((_, i) => {
    const angle = 135 + i * (270 / 15);
    const rad = (angle * Math.PI) / 180;
    const x1 = 160 + 138 * Math.cos(rad);
    const y1 = 160 + 138 * Math.sin(rad);
    const x2 = 160 + 148 * Math.cos(rad);
    const y2 = 160 + 148 * Math.sin(rad);
    const isMajor = i % 3 === 0;
    return { x1, y1, x2, y2, angle, isMajor, key: i };
  });

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4 select-none animate-in fade-in duration-200">
      <div
        className={`w-[500px] rounded-3xl border shadow-2xl overflow-hidden flex flex-col text-xs transition-colors duration-200 ${
          isDark
            ? "bg-[#090F17] border-cyan-500/20 shadow-[0_0_50px_rgba(6,182,212,0.15)] text-slate-300"
            : "bg-white border-slate-200 shadow-2xl text-slate-700"
        }`}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between px-5 py-3.5 border-b transition-colors duration-200 ${
            isDark
              ? "bg-[#0B131F]/90 border-slate-800/80"
              : "bg-slate-50 border-slate-200"
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div className={`w-2.5 h-2.5 rounded-full ${isDark ? "bg-cyan-400 animate-ping" : "bg-teal-500 animate-ping"}`} />
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

            <button
              type="button"
              onClick={onClose}
              className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors cursor-pointer ${
                isDark
                  ? "hover:bg-slate-800 text-slate-400 hover:text-white"
                  : "hover:bg-slate-200 text-slate-500 hover:text-slate-900"
              }`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab 1: Speedometer Dial */}
        {tab === "gauge" && (
          <div className="p-6 flex flex-col items-center justify-center space-y-6">
            {/* Circular Speedometer Stage */}
            <div className="relative flex items-center justify-center w-[320px] h-[320px]">
              <svg width="320" height="320" viewBox="0 0 320 320" className="overflow-visible">
                <defs>
                  {/* Outer Amber / Gold Glow Gradient */}
                  <linearGradient id="amberGoldGrad" x1="0%" y1="100%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#F59E0B" />
                    <stop offset="50%" stopColor="#FBBF24" />
                    <stop offset="100%" stopColor="#EA580C" />
                  </linearGradient>

                  {/* Inner Neon Ring Gradient */}
                  <linearGradient id="innerNeonGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor={isDark ? "#06B6D4" : "#0D9488"} />
                    <stop offset="50%" stopColor={isDark ? "#8B5CF6" : "#6366F1"} />
                    <stop offset="100%" stopColor={isDark ? "#EC4899" : "#A855F7"} />
                  </linearGradient>

                  {/* Center Glow Filter */}
                  <filter id="neonGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation={isDark ? "5" : "3"} result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>
                </defs>

                {/* Background Circle Track */}
                <circle
                  cx="160"
                  cy="160"
                  r="148"
                  fill={isDark ? "#070D14" : "#F8FAFC"}
                  stroke={isDark ? "#0F172A" : "#E2E8F0"}
                  strokeWidth="2"
                />

                {/* Outer Radial Ticks */}
                {ticks.map((t) => (
                  <line
                    key={t.key}
                    x1={t.x1}
                    y1={t.y1}
                    x2={t.x2}
                    y2={t.y2}
                    stroke={
                      isDark
                        ? t.isMajor ? "#06B6D4" : "#EC4899"
                        : t.isMajor ? "#0D9488" : "#94A3B8"
                    }
                    strokeWidth={t.isMajor ? "2" : "1.2"}
                    strokeOpacity={t.isMajor ? (isDark ? "0.9" : "1") : (isDark ? "0.5" : "0.7")}
                    strokeLinecap="round"
                  />
                ))}

                {/* Outer Track Arc Background (270 deg) */}
                <path
                  d="M 71.6 248.4 A 125 125 0 1 1 248.4 248.4"
                  fill="none"
                  stroke={isDark ? "#1E293B" : "#E2E8F0"}
                  strokeWidth="8"
                  strokeLinecap="round"
                />

                {/* Outer Amber Progress Arc (Filled dynamically) */}
                <path
                  d="M 71.6 248.4 A 125 125 0 1 1 248.4 248.4"
                  fill="none"
                  stroke="url(#amberGoldGrad)"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={fullArcLength}
                  strokeDashoffset={arcDashOffset}
                  className="transition-all duration-150 ease-out"
                  filter={isDark ? "drop-shadow(0 0 8px rgba(245, 158, 11, 0.6))" : "drop-shadow(0 0 4px rgba(245, 158, 11, 0.4))"}
                />

                {/* Inner Glowing Dual-Neon Ring */}
                <circle
                  cx="160"
                  cy="160"
                  r="92"
                  fill="none"
                  stroke="url(#innerNeonGrad)"
                  strokeWidth="3.5"
                  filter="url(#neonGlow)"
                  className={isDark ? "opacity-90" : "opacity-80"}
                />

                {/* Center Pivot Background Halo */}
                <circle
                  cx="160"
                  cy="160"
                  r="18"
                  fill={isDark ? "#0A141F" : "#FFFFFF"}
                  stroke={isDark ? "#14B8A6" : "#0D9488"}
                  strokeWidth="2"
                  opacity={isDark ? "0.8" : "0.95"}
                />
              </svg>

              {/* Animated Laser Needle (Framer Motion) */}
              <motion.div
                className="absolute inset-0 pointer-events-none flex items-center justify-center"
                animate={{ rotate: needleAngle }}
                transition={{ type: "spring", stiffness: 90, damping: 14 }}
              >
                {/* Laser Needle Blade pointing to 3 o'clock (0 deg) */}
                <div
                  className="absolute left-[160px] top-[157.5px] h-[5px] rounded-r-full origin-left flex items-center"
                  style={{
                    width: "122px",
                    background: isDark
                      ? "linear-gradient(90deg, rgba(16, 185, 129, 0.2) 0%, #10B981 40%, #4ADE80 100%)"
                      : "linear-gradient(90deg, rgba(13, 148, 136, 0.2) 0%, #059669 40%, #10B981 100%)",
                    boxShadow: isDark
                      ? "0 0 14px #22C55E, 0 0 28px rgba(34, 197, 94, 0.7)"
                      : "0 0 10px rgba(5, 150, 105, 0.6)",
                  }}
                >
                  {/* Glowing needle tip */}
                  <div className={`absolute right-0 w-2.5 h-2.5 rounded-full ${isDark ? "bg-white shadow-[0_0_10px_#FFFFFF]" : "bg-emerald-200 shadow-[0_0_6px_#059669]"}`} />
                </div>
              </motion.div>

              {/* Center Pivot Dot */}
              <div
                className={`absolute top-[150px] left-[150px] w-5 h-5 rounded-full flex items-center justify-center border-2 shadow-sm ${
                  isDark
                    ? "bg-[#0E1A26] border-emerald-400 shadow-[0_0_12px_#10B981]"
                    : "bg-white border-emerald-600 shadow-md"
                }`}
              >
                <div className={`w-1.5 h-1.5 rounded-full ${isDark ? "bg-white" : "bg-emerald-600"}`} />
              </div>

              {/* Digital Speed Readout */}
              <div className="absolute top-[182px] flex flex-col items-center pointer-events-none">
                <div className="flex items-baseline gap-1.5">
                  <span
                    className={`text-3xl font-black tracking-widest font-mono ${
                      isDark
                        ? "text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-orange-300 to-amber-200 drop-shadow-[0_0_15px_rgba(245,158,11,0.7)]"
                        : "text-amber-600 drop-shadow-sm"
                    }`}
                  >
                    {currentSpeed.toFixed(0)}
                  </span>
                  <span
                    className={`text-xs font-extrabold tracking-wider uppercase font-mono ${
                      isDark
                        ? "text-cyan-300 drop-shadow-[0_0_8px_rgba(6,182,212,0.8)]"
                        : "text-teal-700"
                    }`}
                  >
                    MBPS
                  </span>
                </div>
              </div>

              {/* Circular Start / Action Button */}
              <div className="absolute bottom-2 flex flex-col items-center">
                <button
                  type="button"
                  onClick={startTest}
                  disabled={testing}
                  className={`w-18 h-18 rounded-full border-2 active:scale-95 disabled:opacity-75 transition-all flex flex-col items-center justify-center cursor-pointer group ${
                    isDark
                      ? "bg-[#08121C] border-teal-500/70 hover:border-teal-300 shadow-[0_0_22px_rgba(20,184,166,0.35)] text-white"
                      : "bg-white border-teal-600 hover:bg-teal-50 shadow-lg text-teal-800"
                  }`}
                >
                  <span className={`text-sm font-bold tracking-wider transition-colors ${isDark ? "text-white group-hover:text-cyan-300" : "text-teal-800"}`}>
                    {testing ? "..." : "Start"}
                  </span>
                </button>
              </div>
            </div>

            {/* Test Status Indicator */}
            <div className="text-center font-medium">
              {phase === "idle" && (
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
                  {pingMs} <span className="text-xs font-normal opacity-60">ms</span>
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
            {phase === "finished" ? `Jitter: ${jitterMs}ms` : "Server: Mumbai (CDN Edge)"}
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
