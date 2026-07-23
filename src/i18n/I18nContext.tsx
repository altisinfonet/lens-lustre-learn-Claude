/**
 * I18nContext — the app's free, dependency-free translation layer.
 *
 * Holds the chosen language (persisted in localStorage), and exposes `t(key)`
 * which returns the current language's string, falling back to English, then
 * to a provided fallback, then the key itself. No external library, so it can
 * never break the build via a missing package — and it works identically on
 * web and inside the Capacitor Android app (same React code).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { translations, LANGS, type Lang } from "./translations";

const STORAGE_KEY = "app_lang";
const isLang = (v: unknown): v is Lang => typeof v === "string" && LANGS.some((l) => l.code === v);

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, fallback?: string) => string;
}

const I18nContext = createContext<I18nValue>({
  lang: "en",
  setLang: () => {},
  t: (key, fallback) => fallback ?? key,
});

export const I18nProvider = ({ children }: { children: ReactNode }) => {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      if (isLang(s)) return s;
    } catch { /* ignore */ }
    return "en";
  });

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
    try { document.documentElement.lang = l; } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try { document.documentElement.lang = lang; } catch { /* ignore */ }
  }, [lang]);

  const t = useCallback(
    (key: string, fallback?: string): string =>
      translations[lang]?.[key] ?? translations.en[key] ?? fallback ?? key,
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = () => useContext(I18nContext);
/** Convenience: just the translate function. */
export const useT = () => useContext(I18nContext).t;
