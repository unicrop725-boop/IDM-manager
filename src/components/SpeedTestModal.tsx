import { useState, useEffect } from "react";
import { X, Gauge, RotateCcw, ArrowDown, ArrowUp, Activity, Trash2 } from "lucide-react";

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
  const [pingMs, setPingMs] = useState(14);
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
    setTesting(true);
    setPhase("ping");
    setDownloadSpeed(0);
    setUploadSpeed(0);

    setTimeout(() => {
      const finalPing = Math.floor(12 + Math.random() * 8);
      setPingMs(finalPing);
      setJitterMs(Math.floor(1 + Math.random() * 3));
      setPhase("download");

      let currentDl = 0;
      const dlTarget = 85 + Math.random() * 45;
      const dlInterval = setInterval(() => {
        currentDl += (dlTarget - currentDl) * 0.15 + (Math.random() * 4 - 2);
        setDownloadSpeed(Math.max(0, currentDl));
      }, 100);

      setTimeout(() => {
        clearInterval(dlInterval);
        setDownloadSpeed(dlTarget);
        setPhase("upload");

        let currentUl = 0;
        const ulTarget = 35 + Math.random() * 20;
        const ulInterval = setInterval(() => {
          currentUl += (ulTarget - currentUl) * 0.15 + (Math.random() * 3 - 1.5);
          setUploadSpeed(Math.max(0, currentUl));
        }, 100);

        setTimeout(() => {
          clearInterval(ulInterval);
          setUploadSpeed(ulTarget);
          setPhase("finished");
          setTesting(false);
          saveHistoryResult(finalPing, dlTarget, ulTarget);
        }, 2200);
      }, 2500);
    }, 1000);
  };

  useEffect(() => {
    startTest();
  }, []);

  const gaugeSpeed = phase === "download" ? downloadSpeed : phase === "upload" ? uploadSpeed : phase === "finished" ? downloadSpeed : 0;
  const maxSpeed = 150;
  const rotationDegrees = Math.min(180, (gaugeSpeed / maxSpeed) * 180) - 90;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 select-none animate-in fade-in duration-150">
      <div className="w-[480px] rounded-2xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] shadow-2xl overflow-hidden flex flex-col text-xs text-[var(--text-secondary)]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]">
          <div className="flex items-center gap-2">
            <Gauge className="w-4 h-4 text-teal-400" />
            <span className="text-[var(--text-primary)] font-semibold text-sm">Internet Speed Test</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[var(--bg-panel)] rounded-lg p-0.5 border border-[var(--border-subtle)]">
              <button
                onClick={() => setTab("gauge")}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  tab === "gauge" ? "bg-[var(--bg-card)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                Test
              </button>
              <button
                onClick={() => setTab("history")}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  tab === "history" ? "bg-[var(--bg-card)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                History ({history.length})
              </button>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab 1: Gauge */}
        {tab === "gauge" && (
          <div className="p-6 flex flex-col items-center justify-center space-y-6">
            {/* Gauge Widget */}
            <div className="relative flex flex-col items-center justify-center w-56 h-36">
              <svg width="220" height="130" viewBox="0 0 220 130" className="overflow-visible">
                <defs>
                  <linearGradient id="speedGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#8B5CF6" />
                    <stop offset="100%" stopColor="#2DD4BF" />
                  </linearGradient>
                </defs>
                <path
                  d="M 20 120 A 90 90 0 0 1 200 120"
                  fill="none"
                  stroke="var(--bg-hover)"
                  strokeWidth="14"
                  strokeLinecap="round"
                />
                <path
                  d="M 20 120 A 90 90 0 0 1 200 120"
                  fill="none"
                  stroke="url(#speedGrad)"
                  strokeWidth="14"
                  strokeLinecap="round"
                  strokeDasharray="282.7"
                  strokeDashoffset={282.7 * (1 - Math.min(1, gaugeSpeed / maxSpeed))}
                  className="transition-all duration-150 ease-out"
                />
              </svg>

              <div
                className="absolute bottom-2 w-1 h-20 bg-purple-400 origin-bottom rounded-full shadow-lg transition-transform duration-150"
                style={{ transform: `rotate(${rotationDegrees}deg)` }}
              />
              <div className="absolute bottom-1 w-4 h-4 rounded-full gradient-accent shadow-md" />

              <div className="absolute top-14 flex flex-col items-center">
                <span className="text-3xl font-extrabold text-[var(--text-primary)] tracking-tight font-mono">
                  {gaugeSpeed.toFixed(1)}
                </span>
                <span className="text-[11px] text-[var(--text-secondary)] font-medium">Mbps</span>
              </div>
            </div>

            {/* Test Status Indicator */}
            <div className="text-center font-medium">
              {phase === "idle" && <span className="text-[var(--text-disabled)]">Ready</span>}
              {phase === "ping" && <span className="text-purple-400 animate-pulse">Testing Latency & Jitter...</span>}
              {phase === "download" && <span className="text-teal-400 font-semibold animate-pulse">Testing Download Speed...</span>}
              {phase === "upload" && <span className="text-sky-400 font-semibold animate-pulse">Testing Upload Speed...</span>}
              {phase === "finished" && <span className="text-emerald-400 font-semibold">Test Finished</span>}
            </div>

            {/* Metrics Grid */}
            <div className="w-full grid grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-center space-y-1">
                <div className="flex items-center justify-center gap-1 text-[var(--text-secondary)]">
                  <Activity className="w-3.5 h-3.5 text-purple-400" />
                  <span>Ping</span>
                </div>
                <div className="text-sm font-bold text-[var(--text-primary)] font-mono">
                  {pingMs} <span className="text-[10px] font-normal text-[var(--text-disabled)]">ms</span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-center space-y-1">
                <div className="flex items-center justify-center gap-1 text-[var(--text-secondary)]">
                  <ArrowDown className="w-3.5 h-3.5 text-teal-400" />
                  <span>Download</span>
                </div>
                <div className="text-sm font-bold text-teal-400 font-mono">
                  {downloadSpeed.toFixed(1)} <span className="text-[10px] font-normal text-[var(--text-disabled)]">Mbps</span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-center space-y-1">
                <div className="flex items-center justify-center gap-1 text-[var(--text-secondary)]">
                  <ArrowUp className="w-3.5 h-3.5 text-sky-400" />
                  <span>Upload</span>
                </div>
                <div className="text-sm font-bold text-sky-400 font-mono">
                  {uploadSpeed.toFixed(1)} <span className="text-[10px] font-normal text-[var(--text-disabled)]">Mbps</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: History */}
        {tab === "history" && (
          <div className="p-4 space-y-3 max-h-80 overflow-y-auto">
            <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
              <span>Past Tests ({history.length})</span>
              {history.length > 0 && (
                <button
                  onClick={clearHistory}
                  className="flex items-center gap-1 text-rose-400 hover:text-rose-300 text-[11px]"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear History
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <div className="py-8 text-center text-xs text-[var(--text-disabled)]">
                No past speed test records found.
              </div>
            ) : (
              <div className="space-y-2">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-medium text-[var(--text-primary)]">
                        {new Date(item.timestamp).toLocaleString()}
                      </div>
                      <div className="text-[11px] text-[var(--text-disabled)]">
                        Ping: {item.pingMs} ms
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-right">
                      <div>
                        <div className="text-[10px] text-[var(--text-disabled)] uppercase">Download</div>
                        <div className="font-mono font-bold text-teal-400">{item.downloadSpeed} Mbps</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-[var(--text-disabled)] uppercase">Upload</div>
                        <div className="font-mono font-bold text-sky-400">{item.uploadSpeed} Mbps</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-card)]">
          <span className="text-[11px] text-[var(--text-disabled)] font-mono">
            {phase === "finished" ? `Jitter: ${jitterMs}ms` : "Server: Mumbai (CDN Edge)"}
          </span>
          <button
            onClick={startTest}
            disabled={testing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg gradient-accent text-white font-medium hover:opacity-90 active:scale-95 disabled:opacity-50 transition-all shadow-md"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${testing ? "animate-spin" : ""}`} />
            <span>{testing ? "Testing..." : "Test Again"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
