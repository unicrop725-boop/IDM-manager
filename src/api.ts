// Typed wrappers around the Tauri commands (src-tauri/src/commands.rs).
// The UI never talks to the network or the disk itself: it only calls these.

import { invoke } from "@tauri-apps/api/core";
import type { AddRequest, AdapterInfo, DownloadInfo, Settings } from "./types";

export const api = {
  addDownload: (request: AddRequest) => invoke<DownloadInfo>("add_download", { request }),
  pause: (id: string) => invoke<void>("pause", { id }),
  resume: (id: string) => invoke<void>("resume", { id }),
  cancel: (id: string) => invoke<void>("cancel", { id }),
  restart: (id: string) => invoke<void>("restart", { id }),
  /** Give an expired download a fresh link for the same file; it continues where it stopped. */
  refreshLink: (id: string, newUrl: string) => invoke<void>("refresh_link", { id, newUrl }),
  remove: (id: string, deleteFile: boolean) => invoke<void>("remove", { id, deleteFile }),
  getDownloads: () => invoke<DownloadInfo[]>("get_downloads"),
  /** `id = null` sets the global limit. 0 = unlimited. */
  setSpeedLimit: (id: string | null, bytesPerSec: number) =>
    invoke<void>("set_speed_limit", { id, bytesPerSec }),
  getSettings: () => invoke<Settings>("get_settings"),
  setDefaultConnections: (connections: number) =>
    invoke<number>("set_default_connections", { connections }),
  /** Network adapters Turbo Mode can bond right now. */
  getAdapters: () => invoke<AdapterInfo[]>("get_adapters"),
  setTurboMode: (enabled: boolean) => invoke<boolean>("set_turbo_mode", { enabled }),
};

/** Tauri rejects with the plain-language string produced by the engine. */
export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}
