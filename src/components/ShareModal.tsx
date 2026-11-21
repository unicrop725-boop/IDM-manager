import React from "react";
import { ModalCorner } from "./NotchCorner";
import { useState } from "react";
import { Share2, Mail, Copy, Check } from "lucide-react";
import type { DownloadInfo } from "../types";

interface Props {
  download: DownloadInfo;
  onClose: () => void;
}

/** Official brand logo drawn in its brand colour. */
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
  color: string;
  open: (url: string, name: string, text: string) => string;
}

const NETWORKS: Network[] = [
  {
    key: "whatsapp",
    label: "WhatsApp",
    hint: "Send via chat",
    path: "M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766 0-3.18-2.587-5.771-5.764-5.771z",
    color: "#25D366",
    open: (_u, _n, text) => `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`,
  },
  {
    key: "telegram",
    label: "Telegram",
    hint: "Share to message",
    path: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z",
    color: "#24A1DE",
    open: (u, n) => `https://t.me/share/url?url=${encodeURIComponent(u)}&text=${encodeURIComponent(n)}`,
  },
  {
    key: "facebook",
    label: "Facebook",
    hint: "Post on your wall",
    path: "M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12c0 4.84 3.44 8.87 8 9.8V15H8v-3h2V9.5C10 7.57 11.57 6 13.5 6H16v3h-2c-.55 0-1 .45-1 1v2h3v3h-3v6.95C18.05 21.45 22 17.19 22 12z",
    color: "#1877F2",
    open: (u) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(u)}`,
  },
  {
    key: "x",
    label: "X",
    hint: "Post a link",
    path: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z",
    color: "var(--text-primary)",
    open: (u, n) => `https://twitter.com/intent/tweet?url=${encodeURIComponent(u)}&text=${encodeURIComponent(n)}`,
  },
  {
    key: "reddit",
    label: "Reddit",
    hint: "Submit a link",
    path: "M12 2C6.48 2 2 6.48 2 12c0 5.52 4.48 10 10 10s10-4.48 10-10c0-5.52-4.48-10-10-10zm5.01 14.75c-.85.85-2.34.92-3.01.92s-2.16-.07-3.01-.92c-.15-.15-.15-.39 0-.54.15-.15.39-.15.54 0 .61.61 1.79.71 2.47.71.69 0 1.86-.1 2.47-.71.15-.15.39-.15.54 0 .15.15.15.39 0 .54zm-6.26-3.75c-.69 0-1.25-.56-1.25-1.25s.56-1.25 1.25-1.25 1.25.56 1.25 1.25-.56 1.25-1.25 1.25zm4.5 0c-.69 0-1.25-.56-1.25-1.25s.56-1.25 1.25-1.25 1.25.56 1.25 1.25-.56 1.25-1.25 1.25z",
    color: "#FF4500",
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
