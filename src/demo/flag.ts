/**
 * Demo mode: the real UI running in a plain browser with a simulated backend (src/demo/backend.ts).
 * Only the website's embedded demo is built this way (`npm run build:demo`, mode "demo"); the desktop app never is.
 */
export const IS_DEMO: boolean = (import.meta as any).env?.VITE_FLOWGET_DEMO === "1";
