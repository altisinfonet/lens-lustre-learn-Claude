/**
 * Phase 3 Step 3.2 — Navigation Protection
 * Uses beforeunload + custom prompt (no useBlocker needed).
 * Intercepts in-app navigation via a wrapper approach.
 */
import { useEffect } from "react";

interface NavigationBlockerProps {
  /** Judging session is active */
  isActive: boolean;
}

/**
 * Lightweight navigation guard — adds beforeunload to prevent
 * accidental browser close/refresh during active judging.
 * In-app navigation is already guarded by the unsaved changes dialog
 * in CinemaFullView and the session bookmark on all route changes.
 */
const NavigationBlocker = ({ isActive }: NavigationBlockerProps) => {
  useEffect(() => {
    if (!isActive) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isActive]);

  return null;
};

export default NavigationBlocker;
