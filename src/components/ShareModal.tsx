import { useState } from "react";
import { X, Share2, Mail, MessageCircle, Send, Copy, Check } from "lucide-react";
import type { DownloadInfo } from "../types";

interface Props {
  download: DownloadInfo;
  onClose: () => void;
}

export default function ShareModal({ download, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  const shareText = `Check out "${download.fileName}" on FlowGet:\n${download.url}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(download.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleWhatsApp = () => {
    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`;
    window.open(url, "_blank");
  };

  const handleEmail = () => {
    const subject = `Download Link: ${download.fileName}`;
    const body = `Hi,\n\nHere is the download link for ${download.fileName}:\n${download.url}\n\nDownloaded via FlowGet.`;
    const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(mailto, "_self");
  };

  const handleTelegram = () => {
    const url = `https://t.me/share/url?url=${encodeURIComponent(download.url)}&text=${encodeURIComponent(download.fileName)}`;
    window.open(url, "_blank");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 select-none animate-in fade-in duration-150">
      <div className="w-[440px] rounded-2xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] shadow-2xl flex flex-col overflow-hidden text-xs text-[var(--text-secondary)]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <Share2 className="w-4 h-4 text-purple-400" />
            <span>Share Download</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
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
            {/* WhatsApp */}
            <button
              onClick={handleWhatsApp}
              className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 text-emerald-400 flex items-center gap-3 transition-colors font-medium text-left"
            >
              <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                <MessageCircle className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs text-[var(--text-primary)]">WhatsApp</div>
                <div className="text-[10px] text-[var(--text-secondary)]">Send via chat</div>
              </div>
            </button>

            {/* Email */}
            <button
              onClick={handleEmail}
              className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/20 hover:bg-sky-500/20 text-sky-400 flex items-center gap-3 transition-colors font-medium text-left"
            >
              <div className="w-8 h-8 rounded-lg bg-sky-500/20 flex items-center justify-center">
                <Mail className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs text-[var(--text-primary)]">Email</div>
                <div className="text-[10px] text-[var(--text-secondary)]">Send link via mail</div>
              </div>
            </button>

            {/* Telegram */}
            <button
              onClick={handleTelegram}
              className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 hover:bg-indigo-500/20 text-indigo-400 flex items-center gap-3 transition-colors font-medium text-left"
            >
              <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                <Send className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs text-[var(--text-primary)]">Telegram</div>
                <div className="text-[10px] text-[var(--text-secondary)]">Share to message</div>
              </div>
            </button>

            {/* Copy Link */}
            <button
              onClick={handleCopyLink}
              className="p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] flex items-center gap-3 transition-colors font-medium text-left"
            >
              <div className="w-8 h-8 rounded-lg bg-[var(--bg-panel)] flex items-center justify-center text-purple-400">
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </div>
              <div>
                <div className="text-xs">{copied ? "Copied!" : "Copy Link"}</div>
                <div className="text-[10px] text-[var(--text-secondary)]">Clipboard URL</div>
              </div>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-5 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-card)]">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
