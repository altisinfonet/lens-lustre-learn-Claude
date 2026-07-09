import { useRef, useCallback, type ReactNode, type CSSProperties } from "react";

interface LongPressButtonProps {
  onTap: () => void;
  /** Optional long-press handler; fires after `delay` ms of pointer hold. */
  onLongPress?: () => void;
  delay?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  disabled?: boolean;
}

/**
 * Button that distinguishes a quick tap from a long-press (default 500ms).
 * If long-press fires, the subsequent click is suppressed.
 * Used in mobile judge views to bookmark via long-press without opening Cinema.
 */
export default function LongPressButton({
  onTap, onLongPress, delay = 500, className, style, children, disabled,
}: LongPressButtonProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);

  const start = useCallback(() => {
    if (disabled || !onLongPress) return;
    longPressFiredRef.current = false;
    timerRef.current = setTimeout(() => {
      longPressFiredRef.current = true;
      onLongPress();
      // Haptic feedback if available
      try { (navigator as any).vibrate?.(40); } catch { /* noop */ }
    }, delay);
  }, [delay, disabled, onLongPress]);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleClick = useCallback(() => {
    if (longPressFiredRef.current) {
      // Suppress tap that follows a long-press
      longPressFiredRef.current = false;
      return;
    }
    if (disabled) return;
    onTap();
  }, [disabled, onTap]);

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={handleClick}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => { if (onLongPress) e.preventDefault(); }}
      className={className}
      style={style}
    >
      {children}
    </button>
  );
}
