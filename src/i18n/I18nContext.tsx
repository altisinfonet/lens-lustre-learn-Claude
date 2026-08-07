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
import { homeTranslations } from "./home";

const STORAGE_KEY = "app_lang";
const SUPPORTED = LANGS.map((l) => l.code);
const isLang = (v: unknown): v is Lang => typeof v === "string" && SUPPORTED.includes(v as Lang);

/** Match a browser/device locale (e.g. "hi-IN", "bn") to a language we ship. */
const matchBrowserLang = (): Lang | null => {
  try {
    const candidates = [navigator.language, ...(navigator.languages || [])];
    for (const c of candidates) {
      const base = (c || "").toLowerCase().split("-")[0];
      const hit = SUPPORTED.find((s) => s.toLowerCase() === base);
      if (hit) return hit;
    }
  } catch { /* ignore */ }
  return null;
};

/**
 * Decide the starting language the way Facebook/Instagram do:
 *   1) the user's explicit saved choice (wins), else
 *   2) their device / browser language, if we support it, else
 *   3) English.
 * Only explicit choices are persisted, so auto-detection keeps tracking the
 * device language until the user actively picks one.
 */
const detectInitialLang = (): Lang => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch { /* ignore */ }
  return matchBrowserLang() ?? "en";
};

type Dict = Record<string, string>;

/**
 * Look a key up in one language, across both dictionaries.
 * `homeTranslations` (eager, small) holds the landing-page strings; `dicts`
 * holds everything else — English always present, and any non-English language
 * merged in once its lazy chunk has loaded (see below). The two key sets do not
 * overlap, so the order here is only a preference, not a behaviour change.
 */
const lookupIn = (
  dicts: Partial<Record<Lang, Dict>>,
  l: Lang,
  key: string,
): string | undefined => homeTranslations[l]?.[key] ?? dicts[l]?.[key];

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
  const [lang, setLangState] = useState<Lang>(detectInitialLang);

  // English ships in the boot chunk; the six Indic dictionaries are lazy —
  // pulled in only when a non-English language is actually chosen (PERF,
  // 2026-08-07: keeps ~322 KB of translations out of every English visitor's
  // boot bundle). Until a language's chunk arrives, `t` transparently returns
  // the English string — the same fallback used for any missing key — so text
  // is never blank, it just sharpens into the chosen language a beat later.
  const [dicts, setDicts] = useState<Partial<Record<Lang, Dict>>>(
    () => ({ ...translations }),
  );

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
    try { document.documentElement.lang = l; } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try { document.documentElement.lang = lang; } catch { /* ignore */ }
  }, [lang]);

  // Load the non-English dictionaries on demand. Runs whenever a non-English
  // language is active and its dictionary is not loaded yet; English needs
  // nothing (it is already present).
  useEffect(() => {
    if (lang === "en" || dicts[lang]) return;
    let cancelled = false;
    import("./translations.rest")
      .then((m) => {
        if (!cancelled) setDicts((prev) => ({ ...m.rest, ...prev }));
      })
      .catch(() => { /* stay on the English fallback if the chunk fails */ });
    return () => { cancelled = true; };
  }, [lang, dicts]);

  const t = useCallback(
    (key: string, fallback?: string): string =>
      lookupIn(dicts, lang, key) ?? lookupIn(dicts, "en", key) ?? fallback ?? key,
    [dicts, lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = () => useContext(I18nContext);
/** Convenience: just the translate function. */
export const useT = () => useContext(I18nContext).t;
