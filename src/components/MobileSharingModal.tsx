import { ModalCorner } from "./NotchCorner";
import { useState } from "react";
import { Smartphone, Wifi, Send } from "lucide-react";

interface Props {
  onClose: () => void;
  onSendLink?: (url: string) => void;
  onAddUrl?: (url: string) => void;
}

export default function MobileSharingModal({ onClose, onSendLink, onAddUrl }: Props) {
  const [phoneUrl, setPhoneUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const localUrl = "http://192.168.1.100:21588/mobile";

  const handleCopy = () => {
    navigator.clipboard.writeText(localUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
        <div className="p-6 flex flex-col items-center text-center space-y-5">
          {/* QR Code Container */}
          <div className="p-4 rounded-2xl bg-white border border-[var(--border-subtle)] shadow-lg flex flex-col items-center">
            {/* Vector Simulated QR Code */}
            <svg width="150" height="150" viewBox="0 0 150 150" fill="none">
              <rect width="150" height="150" fill="white" />
              {/* Corner 1 */}
              <rect x="15" y="15" width="35" height="35" fill="black" />
              <rect x="20" y="20" width="25" height="25" fill="white" />
              <rect x="25" y="25" width="15" height="15" fill="black" />
              {/* Corner 2 */}
              <rect x="100" y="15" width="35" height="35" fill="black" />
              <rect x="105" y="20" width="25" height="25" fill="white" />
              <rect x="110" y="25" width="15" height="15" fill="black" />
              {/* Corner 3 */}
              <rect x="15" y="100" width="35" height="35" fill="black" />
              <rect x="20" y="105" width="25" height="25" fill="white" />
              <rect x="25" y="110" width="15" height="15" fill="black" />
              {/* Pattern Blocks */}
              <rect x="60" y="20" width="8" height="8" fill="black" />
              <rect x="75" y="20" width="8" height="8" fill="black" />
              <rect x="60" y="35" width="8" height="8" fill="black" />
              <rect x="80" y="35" width="8" height="8" fill="black" />
              <rect x="60" y="55" width="30" height="8" fill="black" />
              <rect x="20" y="65" width="8" height="8" fill="black" />
              <rect x="35" y="65" width="8" height="8" fill="black" />
              <rect x="105" y="65" width="15" height="8" fill="black" />
              <rect x="60" y="75" width="10" height="15" fill="black" />
              <rect x="80" y="75" width="15" height="10" fill="black" />
              <rect x="115" y="85" width="15" height="15" fill="black" />
              <rect x="60" y="100" width="25" height="10" fill="black" />
              <rect x="65" y="120" width="15" height="15" fill="black" />
              <rect x="95" y="115" width="20" height="8" fill="black" />
              <rect x="115" y="130" width="15" height="8" fill="black" />
            </svg>
            <div className="text-[10px] text-slate-700 font-mono font-semibold mt-2">
              Scan with Phone Camera
            </div>
          </div>

          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Send links from phone to PC
            </h3>
            <p className="text-xs text-[var(--text-secondary)] max-w-xs">
              Make sure your phone is connected to the same Wi-Fi network. Scan the code to paste any link.
            </p>
          </div>

          {/* Wi-Fi URL & Copy */}
          <div className="w-full flex items-center justify-between p-2.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)]">
            <div className="flex items-center gap-2 font-mono text-[11px] text-purple-300">
              <Wifi className="w-3.5 h-3.5" />
              <span>{localUrl}</span>
            </div>
            <button
              onClick={handleCopy}
              className="px-2.5 py-1 rounded-lg bg-[var(--bg-hover)] text-[var(--text-primary)] hover:text-purple-300 text-[11px] font-medium transition-colors"
            >
              {copied ? "Copied!" : "Copy URL"}
            </button>
          </div>

          {/* Direct test input */}
          <form onSubmit={handleSend} className="w-full space-y-2 pt-1 border-t border-[var(--border-subtle)]">
            <label className="block text-left text-[11px] text-[var(--text-secondary)] font-medium">
              Or simulate receiving link from mobile:
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={phoneUrl}
                onChange={(e) => setPhoneUrl(e.target.value)}
                placeholder="https://example.com/mobile-file.mp4"
                className="flex-1 h-8 px-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-purple-500/50"
              />
              <button
                type="submit"
                disabled={!phoneUrl.trim()}
                className="flex items-center gap-1.5 px-3 h-8 rounded-xl gradient-accent text-white font-medium hover:opacity-90 disabled:opacity-40 transition-all text-xs"
              >
                <Send className="w-3 h-3" />
                <span>Receive</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
