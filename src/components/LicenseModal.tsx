import { ModalCorner } from "./NotchCorner";
// src/components/LicenseModal.tsx
// License Management & Activation Modal

import { useState } from "react";
import { Key, CheckCircle, AlertTriangle, ShieldCheck, ExternalLink } from "lucide-react";
import { api } from "../api";
import type { TrialAndLicenseStatus } from "../types";

interface Props {
  status: TrialAndLicenseStatus;
  onClose: () => void;
  onRefreshStatus: () => Promise<void>;
}

export default function LicenseModal({ status, onClose, onRefreshStatus }: Props) {
  const [licenseKeyInput, setLicenseKeyInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = licenseKeyInput.trim();
    if (!key) return;

    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await api.activateLicense(key);
      if (res.isLicensed) {
        setSuccessMsg("FlowGet Lifetime Pro successfully activated! Enjoy unlimited speed and features.");
        await onRefreshStatus();
      } else {
        setError("Invalid license key signature.");
      }
    } catch (err: any) {
      setError(typeof err === "string" ? err : err.message || "Failed to activate license.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeactivate = async () => {
    if (!confirm("Are you sure you want to deactivate your license on this PC? You can transfer it to another computer.")) return;

    setLoading(true);
    setError(null);
    try {
      await api.deactivateLicense();
      await onRefreshStatus();
      setSuccessMsg("License deactivated. You can now use your key on another PC.");
    } catch (err: any) {
      setError(typeof err === "string" ? err : err.message || "Failed to deactivate license.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs select-none">
      <div className="notch-card flex w-full max-w-md flex-col border border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 text-xs">
        <ModalCorner onClose={onClose} />
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-3.5 bg-[var(--bg-panel)]">
          <div className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
            <Key className="w-4 h-4 text-purple-400" />
            <span>FlowGet License & Subscription</span>
          </div>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-rose-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {status.licenseNotice && !status.isLicensed && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-300 flex items-start gap-2" role="alert">
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <span>{status.licenseNotice}</span>
            </div>
          )}

          {successMsg && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-300 flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Current Status Card */}
          {status.isLicensed ? (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-bold text-emerald-400">
                  <ShieldCheck size={16} />
                  <span>FlowGet Pro Lifetime Active</span>
                </span>
                <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-300 font-mono">
                  2 PCs Allowed
                </span>
              </div>
              <div className="text-[11px] text-zinc-300">
                Registered to: <strong className="text-[var(--text-primary)] font-mono">{status.licenseEmail || "Verified Buyer"}</strong>
              </div>
              <div className="pt-2 border-t border-emerald-500/20 flex justify-end">
                <button
                  type="button"
                  onClick={handleDeactivate}
                  disabled={loading}
                  className="text-[11px] text-zinc-400 hover:text-rose-400 underline transition"
                >
                  Deactivate / Transfer License to another PC
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-bold text-amber-400">
                  <AlertTriangle size={16} />
                  <span>Not Activated</span>
                </span>
                <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-300 font-medium">
                  Limited Basic Mode
                </span>
              </div>
              <p className="text-[11px] text-zinc-300">
                Basic downloading works, but connections are capped to 2, and Turbo Mode and media streaming are disabled. Activate a license to unlock full 32-stream multi-threaded performance.
              </p>
            </div>
          )}

          {/* Activate Form */}
          {!status.isLicensed && (
            <form onSubmit={handleActivate} className="space-y-3 pt-1">
              <div>
                <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
                  Have a license key? Enter it here:
                </label>
                <input
                  type="text"
                  value={licenseKeyInput}
                  onChange={(e) => setLicenseKeyInput(e.target.value)}
                  placeholder="FG1.eyJrZXlJZCI6... (Paste your key)"
                  className="w-full h-9 px-3 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[var(--text-primary)] font-mono text-[11px] focus:outline-none focus:border-purple-500/50"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !licenseKeyInput.trim()}
                className="w-full h-9 rounded-xl gradient-accent text-white font-medium hover:opacity-90 disabled:opacity-40 transition flex items-center justify-center gap-1.5 shadow-sm"
              >
                <Key size={14} />
                <span>{loading ? "Verifying..." : "Activate Offline License"}</span>
              </button>
            </form>
          )}

          {/* Buy Link */}
          {!status.isLicensed && (
            <div className="rounded-xl border border-white/5 bg-[var(--bg-app)] p-3 flex items-center justify-between">
              <div>
                <div className="font-semibold text-white">FlowGet Lifetime Pro</div>
                <div className="text-[10px] text-[var(--text-secondary)]">One-time payment • 2 PCs • All updates included</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  window.open("https://flowget.net/checkout", "_blank");
                }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-medium transition text-[11px]"
              >
                <span>Buy ₹999</span>
                <ExternalLink size={12} />
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-[var(--border-subtle)] px-5 py-3 bg-[var(--bg-panel)]">
          <button
            onClick={onClose}
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
