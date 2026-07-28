import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Download, X } from "lucide-react";
import {
  appUpdateSupported,
  checkForAppUpdate,
  startAppUpdate,
} from "@/lib/native/appUpdate";

/**
 * "Update available" prompt (Android app only) — Google Play In-App Updates.
 * Checks Play once per app session on startup; when a newer version exists,
 * shows a bottom sheet with Update (immediate in-app flow, Play Store
 * fallback) and Later. Web/PWA: renders nothing, checks nothing.
 */
const SESSION_KEY = "app_update_dismissed_v1";

const AppUpdatePrompt = () => {
  const [visible, setVisible] = useState(false);
  const [immediateAllowed, setImmediateAllowed] = useState(false);
  const [version, setVersion] = useState<string | undefined>();
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (!appUpdateSupported()) return;
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem(SESSION_KEY) === "1";
    } catch {
      /* storage unavailable — just check */
    }
    if (dismissed) return;
    // Small delay so the splash/first paint isn't competing with the sheet.
    const t = setTimeout(async () => {
      const status = await checkForAppUpdate();
      if (status?.available) {
        setImmediateAllowed(status.immediateAllowed);
        setVersion(status.availableVersion);
        setVisible(true);
      }
    }, 2500);
    return () => clearTimeout(t);
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  const update = async () => {
    setUpdating(true);
    await startAppUpdate(immediateAllowed);
    setUpdating(false);
    // If the immediate flow succeeded the app restarts; if the store opened,
    // keep the sheet dismissed for this session.
    dismiss();
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 120, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 120, opacity: 0 }}
          transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
          className="fixed inset-x-3 bottom-20 z-[95] rounded-lg border border-border bg-card shadow-2xl p-4"
          role="dialog"
          aria-label="App update available"
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Download className="h-4 w-4" strokeWidth={1.5} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                Update available
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                A new version{version ? ` (${version})` : ""} of 50mm Retina World is ready
                {immediateAllowed ? " — install it without leaving the app." : " on Google Play."}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={update}
                  disabled={updating}
                  className="rounded-md bg-primary px-4 py-2 text-xs font-medium uppercase tracking-[0.1em] text-primary-foreground transition-opacity disabled:opacity-60"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {updating ? "Starting…" : "Update now"}
                </button>
                <button
                  onClick={dismiss}
                  className="rounded-md border border-border px-4 py-2 text-xs uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground transition-colors"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  Later
                </button>
              </div>
            </div>
            <button
              onClick={dismiss}
              className="text-muted-foreground/60 hover:text-foreground transition-colors"
              aria-label="Dismiss update prompt"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default AppUpdatePrompt;
