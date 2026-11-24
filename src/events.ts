// One place to subscribe to backend events: Tauri in the desktop app, an in-page simulation in the website demo.
import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";
import { IS_DEMO } from "./demo/flag";
import { demoListen } from "./demo/bus";

export type { UnlistenFn };
export const listen: typeof tauriListen = IS_DEMO ? (demoListen as unknown as typeof tauriListen) : tauriListen;
