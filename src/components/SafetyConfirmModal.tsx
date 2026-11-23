import { ShieldAlert, ShieldCheck, FolderOpen, ExternalLink } from "lucide-react";
import { ModalCorner } from "./NotchCorner";
import type { SafetyReport } from "../types";

interface Props {
  fileName: string;
  report: SafetyReport;
  onOpenAnyway: () => void;
  onShowFolder: () => void;
  onClose: () => void;
}

export type SafetyLine = { text: string; level: "high" | "medium" | "info" };

/** Everything worth telling the user about a file before it is opened, in plain words. */
export function safetyLines(report: SafetyReport): SafetyLine[] {
  const lines: SafetyLine[] = report.warnings.map((w) => ({ text: w.message, level: w.severity }));
  const vt = report.vt;
  if (vt) {
    if (vt.status === "flagged") {
      lines.unshift({
        text: `VirusTotal: ${vt.malicious} of ${vt.total} antivirus engines flag this file as malicious. Do not open it.`,
        level: "high",
      });
    } else if (vt.status === "suspicious") {
      lines.unshift({
        text: `VirusTotal: ${vt.malicious + vt.suspicious} of ${vt.total} engines are suspicious of this file. It may be a false alarm, but be careful.`,
        level: "medium",
      });
    } else if (vt.status === "clean") {
      lines.push({ text: `VirusTotal: none of ${vt.total} antivirus engines flag this file.`, level: "info" });
    } else if (vt.status === "unknown" && vt.message) {
      lines.push({ text: `VirusTotal: ${vt.message}`, level: "info" });
    }
  }
  return lines;
}

/** Should opening this file ask first? Anything above plain information does. */
export const needsConfirmation = (report?: SafetyReport): boolean =>
  !!report && safetyLines(report).some((l) => l.level !== "info");

export function SafetyConfirmModal({ fileName, report, onOpenAnyway, onShowFolder, onClose }: Props) {
  const lines = safetyLines(report);
  const danger = lines.some((l) => l.level === "high");
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs select-none">
      <div className="notch-card w-full max-w-md border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-xs text-[var(--text-secondary)] shadow-2xl">
        <ModalCorner onClose={onClose} />
        <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-5 py-3.5 text-sm font-semibold text-[var(--text-primary)]">
          {danger ? <ShieldAlert size={18} className="text-red-400" /> : <ShieldCheck size={18} className="text-amber-400" />}
          {danger ? "This file may be dangerous" : "Open this file?"}
        </div>
        <div className="space-y-3 p-5">
          <div className="break-all font-medium text-[var(--text-primary)]">{fileName}</div>
          <ul className="space-y-2">
            {lines.map((l, i) => (
              <li
                key={i}
                className={`rounded-lg border px-2.5 py-2 leading-snug ${
                  l.level === "high"
                    ? "border-red-500/40 bg-red-500/10 text-red-200"
                    : l.level === "medium"
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                    : "border-[var(--border-subtle)] bg-[var(--bg-card)]"
                }`}
              >
                {l.text}
              </li>
            ))}
          </ul>
          {report.vt?.link && (
            <div className="flex items-center gap-1 break-all text-[10px] text-[var(--text-disabled)]">
              <ExternalLink size={11} className="flex-shrink-0" /> Full report: {report.vt.link}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onShowFolder}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-1.5 hover:bg-[var(--bg-hover)]"
            >
              <FolderOpen size={13} /> Show in folder
            </button>
            <button
              onClick={onOpenAnyway}
              className={`rounded-lg px-3 py-1.5 font-medium ${
                danger ? "bg-red-500/20 text-red-200 hover:bg-red-500/30" : "bg-sky-500 text-black hover:bg-sky-400"
              }`}
            >
              Open anyway
            </button>
            <button onClick={onClose} className="rounded-lg bg-[var(--bg-hover)] px-3 py-1.5 font-medium text-[var(--text-primary)]">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
