import { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import LogoLighting from "@/components/LogoLighting";

const SESSION_KEY = "splash_shown";

const SplashScreen = ({ onComplete }: { onComplete: () => void }) => {
  const alreadyShown = typeof window !== "undefined" && sessionStorage.getItem(SESSION_KEY);
  const [visible, setVisible] = useState(!alreadyShown);
  const [exiting, setExiting] = useState(false);
  const completedRef = useRef(false);

  const complete = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete();
  }, [onComplete]);

  useEffect(() => {
    if (!visible) {
      complete();
      return;
    }

    sessionStorage.setItem(SESSION_KEY, "1");
    const timer = setTimeout(() => setExiting(true), 1200);
    return () => clearTimeout(timer);
  }, [visible, complete]);

  if (!visible) return null;

  return (
    <motion.div
      initial={{ opacity: 1 }}
      animate={{ opacity: exiting ? 0 : 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      onAnimationComplete={() => {
        if (!exiting) return;
        setVisible(false);
        complete();
      }}
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-5 bg-background"
    >
      <LogoLighting sizeClassName="h-44 w-44 md:h-60 md:w-60" pulse={false} />

      <motion.span
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.3, ease: "easeOut" }}
        className="text-xs md:text-sm font-semibold tracking-[0.25em] uppercase text-foreground"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        50mm Retina World
      </motion.span>
    </motion.div>
  );
};

export default SplashScreen;
