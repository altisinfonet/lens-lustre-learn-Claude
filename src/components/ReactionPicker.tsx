import { useState, useRef, useCallback, useEffect } from "react";
import { ThumbsUp } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export type ReactionType = "like" | "love" | "haha" | "wow" | "sad" | "angry";

export const REACTIONS: { type: ReactionType; emoji: string; label: string; color: string }[] = [
  { type: "like", emoji: "👍", label: "Like", color: "text-primary" },
  { type: "love", emoji: "❤️", label: "Love", color: "text-red-500" },
  { type: "haha", emoji: "😂", label: "Haha", color: "text-yellow-500" },
  { type: "wow", emoji: "😮", label: "Wow", color: "text-yellow-500" },
  { type: "sad", emoji: "😢", label: "Sad", color: "text-yellow-500" },
  { type: "angry", emoji: "😡", label: "Angry", color: "text-orange-500" },
];

export const REACTION_EMOJI_MAP: Record<string, string> = Object.fromEntries(
  REACTIONS.map((r) => [r.type, r.emoji])
);

export const getReactionColor = (type: string | null): string => {
  return REACTIONS.find((r) => r.type === type)?.color || "text-muted-foreground";
};

export const getReactionLabel = (type: string | null): string => {
  return REACTIONS.find((r) => r.type === type)?.label || "Like";
};

interface ReactionPickerProps {
  currentReaction: ReactionType | null;
  onReact: (type: ReactionType) => void;
  onUnreact: () => void;
  disabled?: boolean;
}

const LONG_PRESS_MS = 500;

const ReactionPicker = ({ currentReaction, onReact, onUnreact, disabled }: ReactionPickerProps) => {
  const [showPicker, setShowPicker] = useState(false);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Desktop: hover to show picker
  const handleMouseEnter = useCallback(() => {
    if (leaveTimeout.current) clearTimeout(leaveTimeout.current);
    hoverTimeout.current = setTimeout(() => setShowPicker(true), 400);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    leaveTimeout.current = setTimeout(() => setShowPicker(false), 300);
  }, []);

  const handlePickerEnter = useCallback(() => {
    if (leaveTimeout.current) clearTimeout(leaveTimeout.current);
  }, []);

  const handlePickerLeave = useCallback(() => {
    leaveTimeout.current = setTimeout(() => setShowPicker(false), 200);
  }, []);

  // Mobile: long-press to show picker
  const handleTouchStart = useCallback(() => {
    didLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true;
      setShowPicker(true);
    }, LONG_PRESS_MS);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }, []);

  const handleTouchMove = useCallback(() => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }, []);

  // Close picker on outside tap (mobile)
  useEffect(() => {
    if (!showPicker) return;
    const handleOutside = (e: TouchEvent | MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    };
    document.addEventListener("touchstart", handleOutside, { passive: true });
    document.addEventListener("mousedown", handleOutside);
    return () => {
      document.removeEventListener("touchstart", handleOutside);
      document.removeEventListener("mousedown", handleOutside);
    };
  }, [showPicker]);

  const handleClick = () => {
    // If long-press just fired, skip the click
    if (didLongPress.current) {
      didLongPress.current = false;
      return;
    }
    if (currentReaction) {
      onUnreact();
    } else {
      onReact("like");
    }
    setShowPicker(false);
  };

  const handleReactionSelect = (type: ReactionType) => {
    if (currentReaction === type) {
      onUnreact();
    } else {
      onReact(type);
    }
    setShowPicker(false);
  };

  const activeReaction = currentReaction ? REACTIONS.find((r) => r.type === currentReaction) : null;

  return (
    <div
      ref={containerRef}
      // Sized to the icon, not stretched. Owner, 2026-08-10: the action icons
      // are left-aligned with even spacing, Instagram-style, and carry no text
      // label. The button below is 48px TALL and 44px wide (24px icon + px-2.5)
      // — comfortably above the 36px that he reported as "too small / hard to
      // tap" earlier the same day, and it must not shrink below that again.
      // It stopped being a 48x48 square when he said the icons looked oversized
      // next to Instagram's; the height, which is what the thumb actually
      // needs in a horizontal row, is unchanged.
      className="relative select-none"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Reaction Picker Popover */}
      <AnimatePresence>
        {showPicker && !disabled && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.8 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="absolute bottom-full left-0 mb-2 z-50"
            onMouseEnter={handlePickerEnter}
            onMouseLeave={handlePickerLeave}
          >
            <div className="flex items-center gap-0.5 bg-card border border-border rounded-full px-2 py-1.5 shadow-lg">
              {REACTIONS.map((reaction, i) => (
                <motion.button
                  key={reaction.type}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03, duration: 0.15 }}
                  onClick={() => handleReactionSelect(reaction.type)}
                  className={`relative group/emoji p-1 rounded-full hover:bg-muted transition-colors ${
                    currentReaction === reaction.type ? "bg-muted" : ""
                  }`}
                  title={reaction.label}
                >
                  <span className="text-[26px] block transition-transform duration-150 group-hover/emoji:scale-125 group-hover/emoji:-translate-y-1">
                    {reaction.emoji}
                  </span>
                  <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-foreground text-background text-[10px] px-2 py-0.5 rounded-full opacity-0 group-hover/emoji:opacity-100 transition-opacity whitespace-nowrap pointer-events-none font-medium">
                    {reaction.label}
                  </span>
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Like Button */}
      <button
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
        onContextMenu={(e) => e.preventDefault()}
        disabled={disabled}
        className={`h-12 px-2.5 flex items-center justify-center rounded-md select-none touch-manipulation transition-colors ${
          currentReaction
            ? `${activeReaction?.color || "text-primary"} hover:bg-primary/5`
            : "text-muted-foreground hover:bg-muted/50"
        } disabled:opacity-40`}
      >
        {/*
          THE EMOJI SITS IN THE SAME 24px BOX AS THE OUTLINE ICON.

          Owner, 2026-08-10, looking at the build: "icons are big unparral,
          match the icon size instagram". Both halves of that were true and they
          had the same cause. `text-2xl` gave the emoji a 24px FONT SIZE, and a
          colour-emoji glyph paints well outside its em box — it rendered around
          30px, so a post you had reacted to showed a noticeably larger, higher
          symbol than the comment and share icons beside it. That is the
          "unparallel".

          A fixed h-6 w-6 box with the glyph centred inside at 20px makes the
          reacted and un-reacted states occupy the identical 24px square, and
          matches MessageCircle / Share2 exactly. Do not go back to sizing an
          emoji by font-size alone.
        */}
        {currentReaction && activeReaction ? (
          <span className="h-6 w-6 flex items-center justify-center text-[20px] leading-none">{activeReaction.emoji}</span>
        ) : (
          <ThumbsUp className="h-6 w-6" strokeWidth={1.75} />
        )}
      </button>
    </div>
  );
};

export default ReactionPicker;
