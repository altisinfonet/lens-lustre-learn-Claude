import { detectAdDevice } from "@/lib/adSlots";

/** Global per-page ad density limiter */
const MAX_ADS: Record<"mobile" | "tablet" | "desktop", number> = {
  mobile: 5,
  tablet: 6,
  desktop: 6,
};

const MAX_VIEWPORT_ADS = 2;

/** Active claimed slots — Set-based to prevent leaks */
const activeSlots = new Set<string>();
let slotCounter = 0;
let lastPathname = "";

/** Set of ad container elements currently in the viewport */
const visibleAdElements = new Set<Element>();
let viewportObserver: IntersectionObserver | null = null;

const ensureViewportObserver = (): IntersectionObserver => {
  if (viewportObserver) return viewportObserver;
  viewportObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          visibleAdElements.add(entry.target);
        } else {
          visibleAdElements.delete(entry.target);
        }
      });
    },
    { threshold: 0.1 }
  );
  return viewportObserver;
};

/** Register an ad container element for viewport tracking */
export const trackAdViewport = (el: Element): (() => void) => {
  const obs = ensureViewportObserver();
  obs.observe(el);
  return () => {
    obs.unobserve(el);
    visibleAdElements.delete(el);
  };
};

/** Returns true if viewport can accept another visible ad */
export const isViewportAvailable = (): boolean => {
  return visibleAdElements.size < MAX_VIEWPORT_ADS;
};

/** Check for route change and reset if needed */
const checkRouteReset = () => {
  const pathname = typeof window !== "undefined" ? window.location.pathname : "";
  if (pathname !== lastPathname) {
    activeSlots.clear();
    lastPathname = pathname;
  }
};

/** Atomic claim: adds a slot to activeSlots and returns its id, or null if over limit.
 *  Safe to call during React render phase (synchronous, no side-effects beyond module state). */
export const claimAdSlot = (): string | null => {
  checkRouteReset();
  const device = detectAdDevice(typeof window === "undefined" ? 1280 : window.innerWidth);
  const limit = MAX_ADS[device];
  if (activeSlots.size >= limit) return null;
  const slotId = `ad-slot-${++slotCounter}`;
  activeSlots.add(slotId);
  return slotId;
};

/** Check if a slot can be claimed without actually claiming it. */
export const canClaimAdSlot = (): boolean => {
  checkRouteReset();
  const device = detectAdDevice(typeof window === "undefined" ? 1280 : window.innerWidth);
  const limit = MAX_ADS[device];
  return activeSlots.size < limit;
};

/** Release a previously claimed slot so another component can use it. */
export const releaseAdSlot = (slotId: string): void => {
  activeSlots.delete(slotId);
};

/** @deprecated Use claimAdSlot() instead — kept for backward compat */
export const canRenderAd = (): boolean => {
  checkRouteReset();
  const device = detectAdDevice(typeof window === "undefined" ? 1280 : window.innerWidth);
  const limit = MAX_ADS[device];
  return activeSlots.size < limit;
};

/** @deprecated Use releaseAdSlot() instead */
export const markAdRendered = (): void => {
  claimAdSlot();
};

/** Reset counter (call on route change). */
export const resetAdCounter = (): void => {
  activeSlots.clear();
  lastPathname = typeof window !== "undefined" ? window.location.pathname : "";
  visibleAdElements.clear();
};
