import { motion } from "framer-motion";
import { ReactNode, forwardRef } from "react";

interface PageTransitionProps {
  children: ReactNode;
}

/**
 * The page-change transition — A SLIDE, AND DELIBERATELY NOT A FADE-IN.
 *
 * F-89 — WHY `initial` STARTS AT FULL OPACITY. This wraps every page, and it
 * used to park its content at `opacity: 0` and animate up. On deployed staging
 * the 404's reveal FROZE part-way: computed opacity 0.567406, transform
 * translateY(2.22352px), sampled six times across four seconds and identical
 * every time. Not slow — stopped. The heading rendered as washed-out grey,
 * "Back to Home" looked disabled and "Discover" was nearly invisible, on a page
 * whose colours are in fact correct (17.08:1 contrast). The Owner said it
 * looked nothing like Instagram. He was right, and the cause was a bug rather
 * than a palette.
 *
 * A page must be READABLE IN ITS FIRST PAINTED FRAME. Content is therefore
 * never parked invisible waiting for a reveal that something has to turn on —
 * the motion now runs FROM visible, which is the same 6px rise with nothing
 * that can strand the text at a fraction of its opacity. Measured: first
 * painted frame opacity 1, minimum opacity across the whole load 1.
 *
 * ⚠ TWO THINGS THAT LOOK LIKE SIMPLER FIXES AND ARE NOT.
 *
 * 1. Exempting only the 404 (`instant` when the bare-shell flag is set) CANNOT
 *    WORK, and this is measured rather than argued: the flag is raised by
 *    NotFound in a layout effect, which runs AFTER the first render, so the
 *    first painted frame still had `opacity: 0`. The check stayed red.
 * 2. Moving the animation out of the tree for the 404 would reintroduce the
 *    unbounded remount loop this page was reverted for — a conditional wrapper
 *    changes the tree SHAPE and destroys the subtree below it.
 *
 * `exit` still fades: a page on its way out may safely become invisible,
 * because it is leaving.
 */
const PageTransition = forwardRef<HTMLDivElement, PageTransitionProps>(({ children }, ref) => (
  <motion.div
    ref={ref}
    initial={{ opacity: 1, y: 6 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -6 }}
    transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
  >
    {children}
  </motion.div>
));

PageTransition.displayName = "PageTransition";

export default PageTransition;
