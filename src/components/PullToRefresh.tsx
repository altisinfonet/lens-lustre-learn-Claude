import { useState, useRef, useCallback, useEffect } from "react";
import { motion, useMotionValue, useTransform } from "framer-motion";
import { RefreshCw } from "lucide-react";

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
}

const THRESHOLD = 80;

/**
 * Desktop: how much upward wheel travel counts as a pull, and how long a pause
 * before the count resets. Deliberately larger than THRESHOLD — a mouse wheel
 * or trackpad emits far more travel than a finger, and reaching the top of a
 * feed with one hard flick must NOT fire a refresh by accident.
 */
const WHEEL_THRESHOLD = 260;
const WHEEL_IDLE_RESET_MS = 500;

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

  /**
   * ── DESKTOP HAS NO FINGERS ──
   *
   * The three handlers above are `onTouch*` and nothing else, so until now this
   * component did nothing at all on a computer. That was invisible while the
   * feed still had a refresh button; when the owner had the button removed on
   * 2026-08-10 ("Dont show it anywhere neither on Web nor in App") a desktop
   * member was left with NO way to refresh the feed but reloading the page.
   * That was my error: I said pull-to-refresh replaced the button without
   * checking that it only listens to touch.
   *
   * Overscrolling upward with the wheel is the desktop equivalent, and it adds
   * no control to the screen — which is what he asked for. It only arms at the
   * very top of the page, needs WHEEL_THRESHOLD of sustained upward travel, and
   * forgets everything after half a second of stillness or any downward scroll.
   *
   * `passive` is left alone: nothing here calls preventDefault, so the page
   * still scrolls exactly as it did and text selection is untouched. The worst
   * case if it fires when nobody wanted it is one extra feed fetch.
   */
  const wheelTravel = useRef(0);
  const wheelIdle = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (wheelIdle.current) clearTimeout(wheelIdle.current); }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (refreshing || window.scrollY > 0) {
      wheelTravel.current = 0;
      pullY.set(0);
      return;
    }
    // deltaY is negative when the wheel moves the content DOWN, i.e. the member
    // is trying to go further up than the page allows.
    if (e.deltaY >= 0) {
      wheelTravel.current = 0;
      pullY.set(0);
      return;
    }
    wheelTravel.current += -e.deltaY;
    pullY.set(Math.min((wheelTravel.current / WHEEL_THRESHOLD) * THRESHOLD, THRESHOLD * 1.5));

    if (wheelIdle.current) clearTimeout(wheelIdle.current);
    wheelIdle.current = setTimeout(() => {
      wheelTravel.current = 0;
      pullY.set(0);
    }, WHEEL_IDLE_RESET_MS);

    if (wheelTravel.current >= WHEEL_THRESHOLD) {
      wheelTravel.current = 0;
      if (wheelIdle.current) clearTimeout(wheelIdle.current);
      void (async () => {
        setRefreshing(true);
        pullY.set(THRESHOLD / 2);
        await onRefresh();
        setRefreshing(false);
        pullY.set(0);
      })();
    }
  }, [pullY, refreshing, onRefresh]);

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onWheel={handleWheel}
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
