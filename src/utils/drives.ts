import type { DriveEntry } from "../types";

/** "c:\\Users\\me\\file.zip" -> "C:\\"  (null for paths without a drive letter) */
export function driveOf(path?: string | null): string | null {
  const m = /^([a-zA-Z]):[\\/]?/.exec((path ?? "").trim());
  return m ? `${m[1].toUpperCase()}:\\` : null;
}

export function usedPercent(d: Pick<DriveEntry, "totalBytes" | "freeBytes">): number {
  return d.totalBytes > 0 ? Math.round(((d.totalBytes - d.freeBytes) / d.totalBytes) * 100) : 0;
}

/** "C:\\  Local Disk" / "D:\\  New Volume" */
export function driveTitle(d: Pick<DriveEntry, "name" | "label" | "kind">): string {
  const label = d.label || (d.kind === "Removable" ? "Removable Disk" : d.kind === "Network" ? "Network Drive" : "Local Disk");
  return `${d.name}  ${label}`;
}
