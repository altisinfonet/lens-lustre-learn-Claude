import { ArrowUp } from "lucide-react";
import { motion, type TargetAndTransition } from "framer-motion";

/**
 * Stage L2 · the "N new posts" pill.
 *
 * ⚠ IT FLOATS. The outer box is absolutely positioned inside the sticky
 * category strip, so it takes no space in the page: showing it, counting up or
 * hiding it never moves a single post under the member's thumb. The banner it
 * replaces was an in-flow full-width button above the first post, so every time
 * it appeared the whole list jumped down by its height. New posts are applied
 * only when the member taps this or pulls to refresh.
 *
 * The outer box is a full-width flex row that centres the button and lets taps
 * through everywhere else (`pointer-events-none`). The button is NOT centred
 * with a translate: framer-motion writes its own `transform` for the entry and
 * exit animation, which would replace it.
 *
 * `initial` / `animate` / `exit` come from the caller, which owns the
 * `<AnimatePresence>` that lets the pill animate out.
 */
export default function NewPostsPill({
  count,
  onClick,
  label,
  initial,
  animate,
  exit,
}: {
  count: number;
  onClick: () => void;
  label: (count: number) => string;
  initial?: TargetAndTransition;
  animate?: TargetAndTransition;
  exit?: TargetAndTransition;
}) {
  if (count <= 0) return null;
  return (
    <div
      data-testid="new-posts-pill-anchor"
      style={{ position: "absolute" }}
      className="pointer-events-none left-0 right-0 top-full z-30 mt-2 flex justify-center"
    >
      <motion.button
        type="button"
        onClick={onClick}
        initial={initial}
        animate={animate}
        exit={exit}
        transition={{ duration: 0.2 }}
        data-testid="new-posts-pill"
        aria-live="polite"
        className="pointer-events-auto flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-lg hover:bg-primary/90"
      >
        <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
        {label(count)}
      </motion.button>
    </div>
  );
}
