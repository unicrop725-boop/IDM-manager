import React from "react";
import { X, Sparkles, Zap, ShieldCheck } from "lucide-react";

interface PremiumCardProps {
  onClose: () => void;
  onUpgrade: () => void;
  onActivateKey?: () => void;
  price?: string;
}

export const PremiumCard: React.FC<PremiumCardProps> = ({
  onClose,
  onUpgrade,
  onActivateKey,
  price = "₹999",
}) => {
  return (
    <div className="fixed bottom-12 right-6 w-80 rounded-2xl bg-[var(--bg-card)] border border-purple-500/30 shadow-2xl p-4 z-40 select-none animate-in slide-in-from-bottom-5 duration-200">
      {/* Glow Effect */}
      <div className="absolute -top-8 -right-8 w-24 h-24 bg-purple-600/20 rounded-full blur-2xl pointer-events-none" />

      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-purple-400">
          <Sparkles className="w-3.5 h-3.5 fill-current" />
          <span>Special Offer</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Main Info */}
      <div className="space-y-1 mb-3">
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-extrabold text-[var(--text-primary)] tracking-tight">
            {price}
          </span>
          <span className="text-xs text-[var(--text-secondary)] line-through">₹2,499</span>
          <span className="ml-auto text-[10px] text-teal-400 font-medium bg-teal-500/10 px-2 py-0.5 rounded-full border border-teal-500/20">
            60% OFF
          </span>
        </div>
        <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
          <span>
            BoltGrab is a paid app. Without a license, downloading is limited to 2 connections. Buy a lifetime license to unlock full 32-stream multi-threading, Turbo Mode, and HLS/DASH media streaming.
          </span>
        </p>
      </div>

      {/* Upgrade Button */}
      <button
        onClick={onUpgrade}
        className="w-full h-8 rounded-xl gradient-accent hover:opacity-95 active:scale-[0.98] transition-all text-white font-medium text-xs flex items-center justify-center gap-2 shadow-lg shadow-purple-900/20 mb-1.5"
      >
        <Zap className="w-3.5 h-3.5 fill-current" />
        <span>Unlock Lifetime Pro</span>
      </button>

      {onActivateKey && (
        <button
          onClick={onActivateKey}
          className="w-full text-center text-[10px] text-purple-400 hover:text-purple-300 underline mb-2 transition"
        >
          Already have a key? Enter license key
        </button>
      )}

      {/* Footnote */}
      <div className="flex items-center justify-between text-[10px] text-[var(--text-disabled)] px-0.5">
        <span className="flex items-center gap-1">
          <ShieldCheck className="w-3 h-3 text-emerald-400" /> Lifetime License
        </span>
        <span className="italic">(Limited Time Offer)</span>
      </div>
    </div>
  );
};
