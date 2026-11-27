import { useSyncExternalStore } from "react";
import en from "./en.json";
import hi from "./hi.json";
import gu from "./gu.json";

export type LanguageCode = "en" | "hi" | "gu";

const translations: Record<LanguageCode, Record<string, string>> = {
  en,
  hi,
  gu,
};

let currentLanguage: LanguageCode = "en";

const listeners = new Set<() => void>();

export function setLanguage(lang: LanguageCode) {
  if (translations[lang]) {
    currentLanguage = lang;
    try {
      localStorage.setItem("flowget_language", lang);
    } catch {
      /* storage unavailable: the choice lasts for this session */
    }
    listeners.forEach((l) => l());
  }
}

/** Re-renders a component when the language changes (use once near the top of the tree). */
export function useLanguage(): LanguageCode {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getLanguage,
  );
}

export function getLanguage(): LanguageCode {
  let saved: LanguageCode | null = null;
  try {
    saved = localStorage.getItem("flowget_language") as LanguageCode | null;
  } catch {
    /* storage unavailable */
  }
  if (saved && translations[saved]) {
    return saved;
  }
  return currentLanguage;
}

export function t(key: string, defaultVal?: string): string {
  const dict = translations[getLanguage()] || translations.en;
  return dict[key] || translations.en[key] || defaultVal || key;
}
