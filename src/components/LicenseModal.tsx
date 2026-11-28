import { ModalCorner } from "./NotchCorner";
// src/components/LicenseModal.tsx
// License Management & Activation Modal

import { useMemo, useState } from "react";
import { getPriceDisplay } from "../price";
import { Key, CheckCircle, AlertTriangle, ShieldCheck, ExternalLink } from "lucide-react";
import { api } from "../api";
import type { TrialAndLicenseStatus } from "../types";

interface Props {
  status: TrialAndLicenseStatus;
  onClose: () => void;
  onRefreshStatus: () => Promise<void>;
  /** Activation gate: the window cannot be closed and covers the app (below the title bar) until a key is accepted. */
  required?: boolean;
}

export default function LicenseModal({ status, onClose, onRefreshStatus, required = false }: Props) {
  const [licenseKeyInput, setLicenseKeyInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const price = useMemo(() => getPriceDisplay(), []);

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
        setSuccessMsg("BoltGrab Lifetime Pro successfully activated! Enjoy unlimited speed and features.");
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

  // Activation gate: full-window split screen (form on the left, brand panel on the right).
  // Starts below the 48px title bar so the window can still be minimized, moved and closed.
  if (required && !status.isLicensed) {
    return (
      <div
        className="fixed inset-x-0 bottom-0 top-12 z-40 flex bg-[#fafafa] select-none"
        role="dialog"
        aria-modal={true}
        aria-label="Activate BoltGrab"
      >
        {/* Left: form */}
        <div className="flex flex-1 items-center justify-center overflow-y-auto px-8 py-10">
          <div className="w-full max-w-[22rem] text-[#18181b]">
            <div className="flex justify-center">
              <Key className="h-6 w-6 text-[#4B7E31]" strokeWidth={2.5} />
            </div>
            <h1 className="mt-6 text-center text-[26px] font-bold leading-tight tracking-tight">
              Access your account
              <br />
              with a license key
            </h1>
            <p className="mt-4 text-center text-[13px] leading-snug text-[#71717a]">
              Enter your license key to unlock full access to the app. One key works on up to 2 PCs.
            </p>

            {error && (
              <div className="mt-5 flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-[12px] text-rose-700" role="alert">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
            {status.licenseNotice && (
              <div className="mt-5 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-[12px] text-amber-800" role="alert">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>{status.licenseNotice}</span>
              </div>
            )}
            {successMsg && (
              <div className="mt-5 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-[12px] text-emerald-700">
                <CheckCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            <form onSubmit={handleActivate} className="mt-7">
              <label htmlFor="license-key-input" className="mb-1.5 block text-[12px] font-semibold text-[#18181b]">
                License key<span className="text-[#18181b]">*</span>
              </label>
              <input
                id="license-key-input"
                type="text"
                value={licenseKeyInput}
                onChange={(e) => setLicenseKeyInput(e.target.value)}
                placeholder="License key"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                className="h-11 w-full rounded-lg border border-[#ececf0] bg-[#f1f1f4] px-3.5 font-mono text-[12px] text-[#18181b] placeholder:font-sans placeholder:text-[#a1a1aa] focus:border-[#7EC151] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#B2D959]/40"
              />
              <button
                type="submit"
                disabled={loading || !licenseKeyInput.trim()}
                className="mt-4 h-11 w-full rounded-lg bg-[#B2D959] text-[14px] font-semibold text-[#15200a] transition hover:bg-[#a3cb48] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Verifying..." : "Activate Access"}
              </button>
            </form>

            <p className="mt-6 text-center text-[12px] text-[#52525b]">
              Lost your license key?{" "}
              <span className="font-medium text-[#4B7E31]">support@boltgrab.online</span>
            </p>

            {/* No key yet: price in the buyer's currency (₹ in India, converted elsewhere) */}
            <div className="mt-6 flex items-center justify-between gap-3 rounded-xl border border-[#e4e4e7] bg-white p-3.5">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-[#18181b]">BoltGrab Lifetime Pro</div>
                <div className="mt-0.5 text-[11px] leading-snug text-[#71717a]">One-time payment • 2 PCs • All updates</div>
                <div className="mt-0.5 text-[11px] text-[#6b6b73]">{price.note}</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  api.openUrl("https://boltgrab.online/buy/").catch(() => window.open("https://boltgrab.online/buy/", "_blank", "noopener"));
                }}
                className="flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-[#0F0F12] px-3.5 py-2 text-[12px] font-semibold text-white transition hover:bg-[#26262c]"
              >
                <span>Buy {price.main}</span>
                <ExternalLink size={12} />
              </button>
            </div>
          </div>
        </div>

        {/* Right: brand panel (hidden when the window is narrow) */}
        <div
          className="relative hidden w-[42%] max-w-[34rem] flex-shrink-0 items-end overflow-hidden p-10 md:flex"
          style={{
            background:
              "radial-gradient(120% 90% at 0% 0%, #B2D959 0%, #5E9A3A 22%, #1F3A14 48%, #0F0F12 80%)",
          }}
          aria-hidden="true"
        >
          <p className="text-[34px] font-medium leading-[1.15] tracking-tight text-white">
            Your license key is unique — keep it safe and don't share it with others.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs select-none"
    >
      <div className="notch-card flex w-full max-w-md flex-col border border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 text-xs">
        {!required && <ModalCorner onClose={onClose} />}
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-3.5 bg-[var(--bg-panel)]">
          <div className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
            <Key className="w-4 h-4 text-purple-400" />
            <span>{required ? "Activate BoltGrab" : "BoltGrab License & Subscription"}</span>
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
                  <span>BoltGrab Pro Lifetime Active</span>
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
                  <span>{required ? "License key required" : "Not Activated"}</span>
                </span>
                {!required && (
                  <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-300 font-medium">
                    Limited Basic Mode
                  </span>
                )}
              </div>
              <p className="text-[11px] text-zinc-300">
                {required
                  ? "BoltGrab needs a license key before you can use it. Enter the key from your purchase email to continue. You can use one key on up to 2 PCs."
                  : "Basic downloading works, but connections are capped to 2, and Turbo Mode and media streaming are disabled. Activate a license to unlock full 32-stream multi-threaded performance."}
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
                <div className="font-semibold text-white">BoltGrab Lifetime Pro</div>
                <div className="text-[10px] text-[var(--text-secondary)]">One-time payment • 2 PCs • All updates included</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  window.open("https://boltgrab.online/buy/", "_blank");
                }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-medium transition text-[11px]"
              >
                <span>Buy ₹999</span>
                <ExternalLink size={12} />
              </button>
            </div>
          )}
        </div>

        {/* Footer (the activation gate has no Close: it goes away once the key is accepted) */}
        {!required && (
          <div className="flex items-center justify-end border-t border-[var(--border-subtle)] px-5 py-3 bg-[var(--bg-panel)]">
            <button
              onClick={onClose}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
