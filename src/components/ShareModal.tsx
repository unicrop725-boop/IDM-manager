import React from "react";
import { ModalCorner } from "./NotchCorner";
import { useState } from "react";
import { Share2, Mail, Copy, Check } from "lucide-react";
import { siWhatsapp, siTelegram, siFacebook, siX, siReddit } from "simple-icons";
import type { DownloadInfo } from "../types";

interface Props {
  download: DownloadInfo;
  onClose: () => void;
}

/** Official brand logo (Simple Icons) drawn in its brand colour. */
function BrandIcon({ path, color, className = "w-4 h-4" }: { path: string; color: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill={color} aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

interface Network {
  key: string;
  label: string;
  hint: string;
  path: string;
  /** brand colour; X is black, so it follows the theme text colour instead */
  color: string;
  open: (url: string, name: string, text: string) => string;
}

const NETWORKS: Network[] = [
  {
    key: "whatsapp", label: "WhatsApp", hint: "Send via chat", path: siWhatsapp.path, color: `#${siWhatsapp.hex}`,
    open: (_u, _n, text) => `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`,
  },
  {
    key: "telegram", label: "Telegram", hint: "Share to message", path: siTelegram.path, color: `#${siTelegram.hex}`,
    open: (u, n) => `https://t.me/share/url?url=${encodeURIComponent(u)}&text=${encodeURIComponent(n)}`,
  },
  {
    key: "facebook", label: "Facebook", hint: "Post on your wall", path: siFacebook.path, color: `#${siFacebook.hex}`,
    open: (u) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(u)}`,
  },
  {
    key: "x", label: "X", hint: "Post a link", path: siX.path, color: "var(--text-primary)",
    open: (u, n) => `https://twitter.com/intent/tweet?url=${encodeURIComponent(u)}&text=${encodeURIComponent(n)}`,
  },
  {
    key: "reddit", label: "Reddit", hint: "Submit a link", path: siReddit.path, color: `#${siReddit.hex}`,
    open: (u, n) => `https://www.reddit.com/submit?url=${encodeURIComponent(u)}&title=${encodeURIComponent(n)}`,
  },
];

export default function ShareModal({ download, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  const shareText = `Check out "${download.fileName}" on FlowGet:\n${download.url}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(download.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleEmail = () => {
    const subject = `Download Link: ${download.fileName}`;
    const body = `Hi,\n\nHere is the download link for ${download.fileName}:\n${download.url}\n\nDownloaded via FlowGet.`;
    const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(mailto, "_self");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 select-none animate-in fade-in duration-150">
      <div className="notch-card w-[480px] bg-[var(--bg-panel)] border border-[var(--border-subtle)] shadow-2xl flex flex-col overflow-hidden text-xs text-[var(--text-secondary)]">
        <ModalCorner onClose={onClose} />
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <Share2 className="w-4 h-4 text-purple-400" />
            <span>Share Download</span>
          </div>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* File Card */}
          <div className="p-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-1">
            <div className="font-semibold text-sm text-[var(--text-primary)] truncate">
              {download.fileName}
            </div>
            <div className="font-mono text-[11px] text-[var(--text-disabled)] truncate">
              {download.url}
            </div>
          </div>

          {/* Share Actions Grid */}
          <div className="grid grid-cols-2 gap-3">
            {NETWORKS.map((n) => (
              <button
                key={n.key}
                onClick={() => window.open(n.open(download.url, download.fileName, shareText), "_blank")}
                style={{
                  ["--brand" as string]: n.color,
                } as React.CSSProperties}
                className="share-tile p-3 rounded-xl border flex items-center gap-3 font-medium text-left cursor-pointer"
              >
                <div className="share-tile-icon w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0">
                  <BrandIcon path={n.path} color={n.color} className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs text-[var(--text-primary)]">{n.label}</div>
                  <div className="text-[10px] text-[var(--text-secondary)] truncate">{n.hint}</div>
                </div>
              </button>
            ))}

            {/* Email */}
            <button
              onClick={handleEmail}
              style={{ ["--brand" as string]: "#38bdf8" } as React.CSSProperties}
              className="share-tile p-3 rounded-xl border flex items-center gap-3 font-medium text-left cursor-pointer"
            >
              <div className="share-tile-icon w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-sky-400">
                <Mail className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-xs text-[var(--text-primary)]">Email</div>
                <div className="text-[10px] text-[var(--text-secondary)] truncate">Send link via mail</div>
              </div>
            </button>

            {/* Copy Link */}
            <button
              onClick={handleCopyLink}
              className="col-span-2 p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] flex items-center gap-3 transition-colors font-medium text-left cursor-pointer"
            >
              <div className="w-9 h-9 rounded-lg bg-[var(--bg-panel)] flex items-center justify-center text-purple-400 flex-shrink-0">
                {copied ? <Check className="w-5 h-5 text-emerald-400" /> : <Copy className="w-5 h-5" />}
              </div>
              <div>
                <div className="text-xs">{copied ? "Copied!" : "Copy Link"}</div>
                <div className="text-[10px] text-[var(--text-secondary)]">Clipboard URL</div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
