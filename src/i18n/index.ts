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

export function setLanguage(lang: LanguageCode) {
  if (translations[lang]) {
    currentLanguage = lang;
    localStorage.setItem("flowget_language", lang);
  }
}

export function getLanguage(): LanguageCode {
  const saved = localStorage.getItem("flowget_language") as LanguageCode;
  if (saved && translations[saved]) {
    return saved;
  }
  return currentLanguage;
}

export function t(key: string, defaultVal?: string): string {
  const dict = translations[getLanguage()] || translations.en;
  return dict[key] || translations.en[key] || defaultVal || key;
}
