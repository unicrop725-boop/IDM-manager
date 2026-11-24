// A tiny in-page stand-in for Tauri's event system, used only in demo mode.
type Handler = (e: { payload: any }) => void;
const subs = new Map<string, Set<Handler>>();

export function demoEmit(name: string, payload: unknown): void {
  subs.get(name)?.forEach((h) => {
    try {
      h({ payload });
    } catch (e) {
      console.error("demo event handler failed", e);
    }
  });
}

export function demoListen<T>(name: string, handler: (e: { payload: T }) => void): Promise<() => void> {
  let set = subs.get(name);
  if (!set) subs.set(name, (set = new Set()));
  set.add(handler as Handler);
  return Promise.resolve(() => {
    set!.delete(handler as Handler);
  });
}
