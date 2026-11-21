import { ModalCorner } from "./NotchCorner";
import { useState } from "react";
import { Smartphone, Send } from "lucide-react";

interface Props {
  onClose: () => void;
  onSendLink?: (url: string) => void;
  onAddUrl?: (url: string) => void;
}

export default function MobileSharingModal({ onClose, onSendLink, onAddUrl }: Props) {
  const [phoneUrl, setPhoneUrl] = useState("");
  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = phoneUrl.trim();
    if (!trimmed) return;
    if (onAddUrl) {
      onAddUrl(trimmed);
    } else if (onSendLink) {
      onSendLink(trimmed);
    }
    setPhoneUrl("");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 select-none animate-in fade-in duration-150">
      <div className="notch-card w-[480px] bg-[var(--bg-panel)] border border-[var(--border-subtle)] shadow-2xl flex flex-col overflow-hidden text-xs text-[var(--text-secondary)]">
        <ModalCorner onClose={onClose} />
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <Smartphone className="w-4 h-4 text-purple-400" />
            <span>Mobile Link Sharing</span>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <p className="text-[var(--text-secondary)] leading-relaxed">
            Paste a link you copied on your phone to start downloading it here.
          </p>
          <form onSubmit={handleSend} className="w-full space-y-2">
            <label className="block text-left text-[11px] text-[var(--text-secondary)] font-medium">
              Link to download
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={phoneUrl}
                onChange={(e) => setPhoneUrl(e.target.value)}
                placeholder="https://example.com/file.mp4"
                className="flex-1 h-9 px-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-purple-500/50"
              />
              <button
                type="submit"
                disabled={!phoneUrl.trim()}
                className="flex items-center gap-1.5 px-3 h-9 rounded-xl gradient-accent text-white font-medium hover:opacity-90 disabled:opacity-40 transition-all text-xs"
              >
                <Send className="w-3 h-3" />
                <span>Add</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
