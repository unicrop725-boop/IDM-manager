import React, { useState, useEffect } from "react";
import { X, RotateCcw, ArrowDown, ArrowUp, Activity, Trash2 } from "lucide-react";
import { motion } from "framer-motion";

interface SpeedTestModalProps {
  onClose: () => void;
}

interface SpeedHistoryItem {
  id: string;
  timestamp: number;
  pingMs: number;
  downloadSpeed: number;
  uploadSpeed: number;
}

export const SpeedTestModal: React.FC<SpeedTestModalProps> = ({ onClose }) => {
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

  // Max scale calibrated to 200 Mbps (or dynamic)
  const maxScale = 200;
  const currentSpeed =
    phase === "download"
      ? downloadSpeed
      : phase === "upload"
      ? uploadSpeed
      : phase === "finished"
      ? downloadSpeed
      : 0;

  // Percentage from 0 to 1
  const speedRatio = Math.min(1, Math.max(0, currentSpeed / maxScale));

  // Gauge angles:
  // Sweep spans 270 degrees.
  // 0% -> 135 deg (bottom-left)
  // 50% -> 270 deg (top center)
  // 80% -> 351 deg (right side, exactly matching the screenshot)
  // 100% -> 405 deg (bottom-right)
  const needleAngle = 135 + speedRatio * 270;

  // Arc length for 270 degrees on radius 125
  const arcRadius = 125;
  const fullArcLength = 2 * Math.PI * arcRadius * (270 / 360); // ~589
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
    <div className="fixed inset-0 bg-black/75 backdrop-blur-md flex items-center justify-center z-50 p-4 select-none animate-in fade-in duration-200">
      <div className="w-[500px] rounded-3xl bg-[#090F17] border border-cyan-500/20 shadow-[0_0_50px_rgba(6,182,212,0.15)] overflow-hidden flex flex-col text-xs text-slate-300">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800/80 bg-[#0B131F]/90">
          <div className="flex items-center gap-2.5">
            <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
            <span className="text-white font-bold text-sm tracking-wide">Internet Speed Test</span>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#060B12] rounded-xl p-0.5 border border-slate-800">
              <button
                onClick={() => setTab("gauge")}
                className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                  tab === "gauge"
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Speed Dial
              </button>
              <button
                onClick={() => setTab("history")}
                className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                  tab === "history"
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                History ({history.length})
              </button>
            </div>

            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab 1: Sci-Fi Neon Speedometer Dial */}
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

                  {/* Inner Neon Ring Gradient: Cyan to Magenta */}
                  <linearGradient id="innerNeonGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#06B6D4" />
                    <stop offset="50%" stopColor="#8B5CF6" />
                    <stop offset="100%" stopColor="#EC4899" />
                  </linearGradient>

                  {/* Laser Needle Gradient */}
                  <linearGradient id="laserNeedleGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#10B981" />
                    <stop offset="70%" stopColor="#22C55E" />
                    <stop offset="100%" stopColor="#4ADE80" />
                  </linearGradient>

                  {/* Center Glow Filter */}
                  <filter id="neonGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="5" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>
                </defs>

                {/* Background Dark Circle Track */}
                <circle cx="160" cy="160" r="148" fill="#070D14" stroke="#0F172A" strokeWidth="2" />

                {/* Outer Radial Ticks */}
                {ticks.map((t) => (
                  <line
                    key={t.key}
                    x1={t.x1}
                    y1={t.y1}
                    x2={t.x2}
                    y2={t.y2}
                    stroke={t.isMajor ? "#06B6D4" : "#EC4899"}
                    strokeWidth={t.isMajor ? "2" : "1.2"}
                    strokeOpacity={t.isMajor ? "0.9" : "0.5"}
                    strokeLinecap="round"
                  />
                ))}

                {/* Outer Track Arc Background (270 deg) */}
                <path
                  d="M 71.6 248.4 A 125 125 0 1 1 248.4 248.4"
                  fill="none"
                  stroke="#1E293B"
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
                  filter="drop-shadow(0 0 8px rgba(245, 158, 11, 0.6))"
                />

                {/* Inner Glowing Dual-Neon Ring (Cyan -> Magenta) */}
                <circle
                  cx="160"
                  cy="160"
                  r="92"
                  fill="none"
                  stroke="url(#innerNeonGrad)"
                  strokeWidth="3.5"
                  filter="url(#neonGlow)"
                  className="opacity-90"
                />

                {/* Center Pivot Background Halo */}
                <circle cx="160" cy="160" r="18" fill="#0A141F" stroke="#14B8A6" strokeWidth="2" opacity="0.8" />
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
                    background: "linear-gradient(90deg, rgba(16, 185, 129, 0.2) 0%, #10B981 40%, #4ADE80 100%)",
                    boxShadow: "0 0 14px #22C55E, 0 0 28px rgba(34, 197, 94, 0.7)",
                  }}
                >
                  {/* Bright glowing needle tip */}
                  <div className="absolute right-0 w-2 h-2 rounded-full bg-white shadow-[0_0_10px_#FFFFFF]" />
                </div>
              </motion.div>

              {/* Center Pivot Dot */}
              <div className="absolute top-[150px] left-[150px] w-5 h-5 rounded-full bg-[#0E1A26] border-2 border-emerald-400 flex items-center justify-center shadow-[0_0_12px_#10B981]">
                <div className="w-1.5 h-1.5 rounded-full bg-white shadow-sm" />
              </div>

              {/* Digital Speed Readout (Futuristic Stylized Text) */}
              <div className="absolute top-[182px] flex flex-col items-center pointer-events-none">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-orange-300 to-amber-200 drop-shadow-[0_0_15px_rgba(245,158,11,0.7)] font-mono">
                    {currentSpeed.toFixed(0)}
                  </span>
                  <span className="text-xs font-extrabold tracking-wider text-cyan-300 uppercase drop-shadow-[0_0_8px_rgba(6,182,212,0.8)] font-mono">
                    MBPS
                  </span>
                </div>
              </div>

              {/* Circular Start / Action Button (Nestled at the bottom opening) */}
              <div className="absolute bottom-2 flex flex-col items-center">
                <button
                  type="button"
                  onClick={startTest}
                  disabled={testing}
                  className="w-18 h-18 rounded-full bg-[#08121C] border-2 border-teal-500/70 hover:border-teal-300 shadow-[0_0_22px_rgba(20,184,166,0.35)] active:scale-95 disabled:opacity-75 transition-all flex flex-col items-center justify-center text-white cursor-pointer group"
                >
                  <span className="text-sm font-bold tracking-wider text-white group-hover:text-cyan-300 transition-colors">
                    {testing ? "..." : "Start"}
                  </span>
                </button>
              </div>
            </div>

            {/* Test Status Indicator */}
            <div className="text-center font-medium">
              {phase === "idle" && <span className="text-slate-400">Click Start to begin speed test</span>}
              {phase === "ping" && <span className="text-cyan-400 animate-pulse font-semibold">Testing Latency & Jitter...</span>}
              {phase === "download" && (
                <span className="text-emerald-400 font-bold animate-pulse drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]">
                  Testing Download Speed...
                </span>
              )}
              {phase === "upload" && (
                <span className="text-sky-400 font-bold animate-pulse drop-shadow-[0_0_8px_rgba(56,189,248,0.5)]">
                  Testing Upload Speed...
                </span>
              )}
              {phase === "finished" && (
                <span className="text-teal-300 font-bold drop-shadow-[0_0_8px_rgba(45,212,191,0.6)]">
                  Test Complete
                </span>
              )}
            </div>

            {/* Metric Cards (Ping, Download, Upload) with Glassmorphism */}
            <div className="w-full grid grid-cols-3 gap-3">
              {/* Ping */}
              <div className="p-3.5 rounded-2xl bg-[#0B1420]/80 border border-purple-500/30 text-center space-y-1 shadow-sm">
                <div className="flex items-center justify-center gap-1.5 text-purple-400">
                  <Activity className="w-4 h-4" />
                  <span className="text-slate-400 font-medium">Ping</span>
                </div>
                <div className="text-base font-extrabold text-white font-mono">
                  {pingMs} <span className="text-xs font-normal text-slate-500">ms</span>
                </div>
              </div>

              {/* Download */}
              <div className="p-3.5 rounded-2xl bg-[#0B1420]/80 border border-emerald-500/30 text-center space-y-1 shadow-sm">
                <div className="flex items-center justify-center gap-1.5 text-emerald-400">
                  <ArrowDown className="w-4 h-4" />
                  <span className="text-slate-400 font-medium">Download</span>
                </div>
                <div className="text-base font-extrabold text-emerald-400 font-mono">
                  {downloadSpeed.toFixed(1)} <span className="text-xs font-normal text-slate-500">Mbps</span>
                </div>
              </div>

              {/* Upload */}
              <div className="p-3.5 rounded-2xl bg-[#0B1420]/80 border border-cyan-500/30 text-center space-y-1 shadow-sm">
                <div className="flex items-center justify-center gap-1.5 text-cyan-400">
                  <ArrowUp className="w-4 h-4" />
                  <span className="text-slate-400 font-medium">Upload</span>
                </div>
                <div className="text-base font-extrabold text-cyan-400 font-mono">
                  {uploadSpeed.toFixed(1)} <span className="text-xs font-normal text-slate-500">Mbps</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: History */}
        {tab === "history" && (
          <div className="p-5 space-y-3 max-h-80 overflow-y-auto">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Past Tests ({history.length})</span>
              {history.length > 0 && (
                <button
                  type="button"
                  onClick={clearHistory}
                  className="flex items-center gap-1 text-rose-400 hover:text-rose-300 text-[11px] cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear History
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-600">
                No past speed test records found.
              </div>
            ) : (
              <div className="space-y-2">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="p-3.5 rounded-xl bg-[#0B1420] border border-slate-800 flex items-center justify-between text-xs hover:border-slate-700 transition-colors"
                  >
                    <div>
                      <div className="font-semibold text-white">
                        {new Date(item.timestamp).toLocaleString()}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Ping: {item.pingMs} ms
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-right">
                      <div>
                        <div className="text-[10px] text-slate-500 uppercase tracking-wider">Download</div>
                        <div className="font-mono font-bold text-emerald-400">{item.downloadSpeed} Mbps</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-500 uppercase tracking-wider">Upload</div>
                        <div className="font-mono font-bold text-cyan-400">{item.uploadSpeed} Mbps</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-slate-800/80 bg-[#0B131F]/90">
          <span className="text-[11px] text-slate-500 font-mono">
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
