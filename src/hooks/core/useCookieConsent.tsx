import { createContext, useContext, useState, useCallback, ReactNode } from "react";

/**
 * Two categories only: essential (always on) and analytics (optional, Google
 * Analytics). There is no advertising / marketing category — Apple 5.1.2(i):
 * the app does not track people across other companies' apps or websites.
 */
export type CookieCategory = "essential" | "analytics";

export interface CookieConsentState {
  essential: boolean;
  analytics: boolean;
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
  updateConsent: (updates: Partial<Pick<CookieConsentState, "analytics">>) => void;
  hasConsent: (category: CookieCategory) => boolean;
}

// v2: everyone is asked again under the new wording. An answer stored under
// the old key was given to a banner that offered a "marketing" category, so it
// is not carried over — it is ignored and removed.
export const CONSENT_STORAGE_KEY = "cookie_consent_v2";
export const LEGACY_CONSENT_STORAGE_KEY = "cookie_consent";

const defaultConsent: CookieConsentState = {
  essential: true,
  analytics: false,
  timestamp: null,
};

function dropLegacyConsent() {
  try {
    localStorage.removeItem(LEGACY_CONSENT_STORAGE_KEY);
  } catch { /* noop */ }
}

function loadConsent(): CookieConsentState | null {
  try {
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.essential === "boolean" && parsed.timestamp) {
      return { essential: true, analytics: parsed.analytics === true, timestamp: parsed.timestamp };
    }
    return null;
  } catch {
    return null;
  }
}

function saveConsent(state: CookieConsentState) {
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(state));
  } catch { /* noop */ }
}

const CookieConsentContext = createContext<CookieConsentContextValue | null>(null);

export const CookieConsentProvider = ({ children }: { children: ReactNode }) => {
  const [initial] = useState(() => {
    dropLegacyConsent();
    return loadConsent();
  });
  const [consent, setConsent] = useState<CookieConsentState>(initial ?? defaultConsent);
  const [hasConsented, setHasConsented] = useState(initial !== null);
  const [showBanner, setShowBanner] = useState(initial === null);
  const [showPreferences, setShowPreferences] = useState(false);

  const persist = useCallback((next: CookieConsentState) => {
    const stamped = { ...next, essential: true, timestamp: Date.now() };
    setConsent(stamped);
    setHasConsented(true);
    setShowBanner(false);
    saveConsent(stamped);
  }, []);

  const acceptAll = useCallback(() => {
    persist({ essential: true, analytics: true, timestamp: Date.now() });
  }, [persist]);

  const rejectNonEssential = useCallback(() => {
    persist({ essential: true, analytics: false, timestamp: Date.now() });
  }, [persist]);

  const updateConsent = useCallback((updates: Partial<Pick<CookieConsentState, "analytics">>) => {
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
