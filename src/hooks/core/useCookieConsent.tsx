import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";

export type CookieCategory = "essential" | "analytics" | "marketing";

export interface CookieConsentState {
  essential: boolean;
  analytics: boolean;
  marketing: boolean;
  timestamp: number | null;
}

interface CookieConsentContextValue {
  consent: CookieConsentState;
  hasConsented: boolean;
  showBanner: boolean;
  showPreferences: boolean;
  setShowPreferences: (v: boolean) => void;
  acceptAll: () => void;
  rejectNonEssential: () => void;
  updateConsent: (updates: Partial<Pick<CookieConsentState, "analytics" | "marketing">>) => void;
  hasConsent: (category: CookieCategory) => boolean;
}

const STORAGE_KEY = "cookie_consent";

const defaultConsent: CookieConsentState = {
  essential: true,
  analytics: false,
  marketing: false,
  timestamp: null,
};

function loadConsent(): CookieConsentState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.essential === "boolean" && parsed.timestamp) {
      return { ...defaultConsent, ...parsed, essential: true };
    }
    return null;
  } catch {
    return null;
  }
}

function saveConsent(state: CookieConsentState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* noop */ }
}

const CookieConsentContext = createContext<CookieConsentContextValue | null>(null);

export const CookieConsentProvider = ({ children }: { children: ReactNode }) => {
  const [consent, setConsent] = useState<CookieConsentState>(() => loadConsent() ?? defaultConsent);
  const [hasConsented, setHasConsented] = useState(() => loadConsent() !== null);
  const [showBanner, setShowBanner] = useState(() => loadConsent() === null);
  const [showPreferences, setShowPreferences] = useState(false);

  const persist = useCallback((next: CookieConsentState) => {
    const stamped = { ...next, essential: true, timestamp: Date.now() };
    setConsent(stamped);
    setHasConsented(true);
    setShowBanner(false);
    saveConsent(stamped);
  }, []);

  const acceptAll = useCallback(() => {
    persist({ essential: true, analytics: true, marketing: true, timestamp: Date.now() });
  }, [persist]);

  const rejectNonEssential = useCallback(() => {
    persist({ essential: true, analytics: false, marketing: false, timestamp: Date.now() });
  }, [persist]);

  const updateConsent = useCallback((updates: Partial<Pick<CookieConsentState, "analytics" | "marketing">>) => {
    setConsent((prev) => {
      const next = { ...prev, ...updates, essential: true, timestamp: Date.now() };
      saveConsent(next);
      setHasConsented(true);
      setShowBanner(false);
      return next;
    });
  }, []);

  const hasConsent = useCallback((category: CookieCategory) => {
    if (category === "essential") return true;
    return consent[category] === true;
  }, [consent]);

  return (
    <CookieConsentContext.Provider
      value={{ consent, hasConsented, showBanner, showPreferences, setShowPreferences, acceptAll, rejectNonEssential, updateConsent, hasConsent }}
    >
      {children}
    </CookieConsentContext.Provider>
  );
};

export function useCookieConsent() {
  const ctx = useContext(CookieConsentContext);
  if (!ctx) throw new Error("useCookieConsent must be used within CookieConsentProvider");
  return ctx;
}
