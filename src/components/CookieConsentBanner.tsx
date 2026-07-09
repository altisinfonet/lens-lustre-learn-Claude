import { useCookieConsent } from "@/hooks/core/useCookieConsent";
import { Shield, Cookie, ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import CookiePreferencesModal from "./CookiePreferencesModal";

const CookieConsentBanner = () => {
  const { showBanner, acceptAll, rejectNonEssential, setShowPreferences, showPreferences } = useCookieConsent();

  return (
    <>
      <AnimatePresence>
        {showBanner && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed inset-x-0 bottom-[calc(3rem+env(safe-area-inset-bottom))] lg:inset-x-auto lg:left-4 lg:right-auto lg:bottom-4 z-[60] px-4 md:px-6 lg:px-0 pointer-events-none"
          >
            <div className="max-w-2xl lg:max-w-md mx-auto lg:mx-0 rounded-2xl border border-border/60 bg-card/95 backdrop-blur-xl shadow-[0_-8px_40px_-12px_hsl(var(--primary)/0.15)] overflow-hidden pointer-events-auto">
              <div className="h-1 bg-gradient-to-r from-primary via-primary/60 to-transparent" />

              <div className="p-5 md:p-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10">
                    <Cookie className="w-[18px] h-[18px] text-primary" />
                  </div>
                  <h3 className="text-sm font-semibold tracking-tight text-foreground">
                    We Value Your Privacy
                  </h3>
                </div>

                <p className="text-[13px] leading-relaxed text-muted-foreground mb-5">
                  We use cookies to enhance your experience, analyze traffic, and personalize content.{" "}
                  <a href="/cookie-policy" className="text-primary hover:underline font-medium">
                    Learn more
                  </a>
                </p>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                  <button
                    onClick={acceptAll}
                    className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium shadow-sm hover:brightness-110 active:scale-[0.98] transition-all duration-150"
                  >
                    <Shield className="w-3.5 h-3.5" />
                    Accept All
                  </button>

                  <button
                    onClick={rejectNonEssential}
                    className="flex-1 sm:flex-none inline-flex items-center justify-center px-5 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm font-medium hover:bg-muted/30 active:scale-[0.98] transition-all duration-150"
                  >
                    Essential Only
                  </button>

                  <button
                    onClick={() => setShowPreferences(true)}
                    className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/20 active:scale-[0.98] transition-all duration-150"
                  >
                    Manage
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <CookiePreferencesModal open={showPreferences} onOpenChange={setShowPreferences} />
    </>
  );
};

export default CookieConsentBanner;
