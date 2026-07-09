import { useState, useCallback } from "react";

const STORAGE_KEY = "judge-guide-seen-v5";

export function useJudgeGuide() {
  const hasSeen = () => {
    try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
  };

  const [showGuide, setShowGuide] = useState(() => !hasSeen());

  const dismissGuide = useCallback(() => {
    setShowGuide(false);
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch {}
  }, []);

  const openGuide = useCallback(() => setShowGuide(true), []);

  return { showGuide, dismissGuide, openGuide };
}
