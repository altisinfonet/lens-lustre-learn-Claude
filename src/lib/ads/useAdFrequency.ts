/**
 * useAdFrequency — the full-screen ad governor.
 *
 * Enforces the anti-annoyance caps for interstitial & app-open ads entirely on
 * the device (localStorage): min gap between interstitials, max per day, skip
 * during the user's first session, and an app-open cooldown. These caps are
 * about UX politeness, not money, so device-local is the correct place — the
 * rewarded PAYOUT (which is about money) is verified server-side separately.
 *
 * Pure/defensive: every storage access is guarded; failures fail OPEN to "not
 * allowed" so a broken storage never spams the user with ads.
 */
import { useCallback, useEffect, useState } from "react";
import {
  type AdFrequencyConfig,
  defaultFrequencyConfig,
  fetchAdFrequency,
  fetchAdZonesEnabled,
} from "./adZonesV2";

const K = {
  intlLast: "adz_intl_last",       // ms timestamp of last interstitial
  intlDay: "adz_intl_day",         // "YYYY-MM-DD:count"
  appOpenLast: "adz_appopen_last", // ms timestamp of last app-open ad
  firstSeen: "adz_first_seen",     // marks that the user has been here before
  sessionMark: "adz_session_started", // sessionStorage — set once per session
};

const todayStr = () => new Date().toISOString().slice(0, 10);
const getNum = (k: string): number => {
  try { const v = localStorage.getItem(k); return v ? parseInt(v, 10) || 0 : 0; } catch { return 0; }
};
const setNum = (k: string, n: number) => { try { localStorage.setItem(k, String(n)); } catch { /* noop */ } };

/** Is this the user's very first session (before any prior visit was recorded)? */
const isFirstSession = (): boolean => {
  try {
    // Mark the session as started (sessionStorage clears per session).
    const started = sessionStorage.getItem(K.sessionMark);
    const everSeen = localStorage.getItem(K.firstSeen);
    if (!everSeen) {
      // First ever load — record it, and this session counts as "first".
      localStorage.setItem(K.firstSeen, String(Date.now()));
      sessionStorage.setItem(K.sessionMark, "1");
      return true;
    }
    // Seen before → not first session.
    if (!started) sessionStorage.setItem(K.sessionMark, "1");
    return false;
  } catch {
    return false;
  }
};

export interface AdFrequency {
  ready: boolean;
  enabled: boolean;              // master flag
  config: AdFrequencyConfig;
  canShowInterstitial: () => boolean;
  recordInterstitial: () => void;
  canShowAppOpen: () => boolean;
  recordAppOpen: () => void;
}

export function useAdFrequency(): AdFrequency {
  const [ready, setReady] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [config, setConfig] = useState<AdFrequencyConfig>(defaultFrequencyConfig());

  useEffect(() => {
    let alive = true;
    (async () => {
      const [flag, cfg] = await Promise.all([fetchAdZonesEnabled(), fetchAdFrequency()]);
      if (!alive) return;
      setEnabled(flag);
      setConfig(cfg);
      setReady(true);
    })();
    return () => { alive = false; };
  }, []);

  const dailyCount = (): number => {
    try {
      const raw = localStorage.getItem(K.intlDay) || "";
      const [day, count] = raw.split(":");
      return day === todayStr() ? (parseInt(count, 10) || 0) : 0;
    } catch { return 0; }
  };

  const canShowInterstitial = useCallback((): boolean => {
    if (!enabled) return false;
    if (config.interstitial_skip_first_session && isFirstSession()) return false;
    const now = Date.now();
    const last = getNum(K.intlLast);
    if (last && now - last < config.interstitial_min_gap_seconds * 1000) return false;
    if (dailyCount() >= config.interstitial_max_per_day) return false;
    return true;
  }, [enabled, config]);

  const recordInterstitial = useCallback(() => {
    setNum(K.intlLast, Date.now());
    try {
      const c = dailyCount() + 1;
      localStorage.setItem(K.intlDay, `${todayStr()}:${c}`);
    } catch { /* noop */ }
  }, [config]);

  const canShowAppOpen = useCallback((): boolean => {
    if (!enabled) return false;
    if (!config.interstitial_on_app_open) return false;
    const now = Date.now();
    const last = getNum(K.appOpenLast);
    if (last && now - last < config.app_open_min_gap_hours * 3600 * 1000) return false;
    return true;
  }, [enabled, config]);

  const recordAppOpen = useCallback(() => setNum(K.appOpenLast, Date.now()), []);

  return { ready, enabled, config, canShowInterstitial, recordInterstitial, canShowAppOpen, recordAppOpen };
}
