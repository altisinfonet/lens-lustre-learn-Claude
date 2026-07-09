import { useState, useRef, useCallback } from "react";
import { motion, useMotionValue, useTransform } from "framer-motion";
import { RefreshCw } from "lucide-react";

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
}

const THRESHOLD = 80;

const PullToRefresh = ({ onRefresh, children }: PullToRefreshProps) => {
  const [refreshing, setRefreshing] = useState(false);
  const pullY = useMotionValue(0);
  const startY = useRef(0);
  const pulling = useRef(false);

  const rotate = useTransform(pullY, [0, THRESHOLD], [0, 360]);
  const opacity = useTransform(pullY, [0, THRESHOLD / 2, THRESHOLD], [0, 0.5, 1]);
  const scale = useTransform(pullY, [0, THRESHOLD], [0.5, 1]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (window.scrollY === 0 && !refreshing) {
      startY.current = e.touches[0].clientY;
      pulling.current = true;
    }
  }, [refreshing]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!pulling.current) return;
    const delta = Math.max(0, (e.touches[0].clientY - startY.current) * 0.4);
    pullY.set(Math.min(delta, THRESHOLD * 1.5));
  }, [pullY]);

  const handleTouchEnd = useCallback(async () => {
    if (!pulling.current) return;
    pulling.current = false;
    if (pullY.get() >= THRESHOLD && !refreshing) {
      setRefreshing(true);
      pullY.set(THRESHOLD / 2);
      await onRefresh();
      setRefreshing(false);
    }
    pullY.set(0);
  }, [pullY, refreshing, onRefresh]);

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <motion.div
        className="flex items-center justify-center pointer-events-none overflow-hidden"
        style={{ height: pullY, opacity }}
      >
        <motion.div style={{ rotate, scale }}>
          <RefreshCw className={`h-5 w-5 text-primary ${refreshing ? "animate-spin" : ""}`} />
        </motion.div>
      </motion.div>
      {children}
    </div>
  );
};

export default PullToRefresh;
