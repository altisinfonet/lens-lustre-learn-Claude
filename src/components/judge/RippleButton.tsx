import { forwardRef, useCallback, useRef, useState, type ButtonHTMLAttributes } from "react";

type RippleColor = "primary" | "destructive" | "muted";

interface RippleButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Color of the click ripple. Maps to design tokens. */
  rippleColor?: RippleColor;
  /** When true, emit a one-shot pulse-ring animation on the button border. */
  pulseOnActive?: boolean;
}

const colorClassMap: Record<RippleColor, string> = {
  primary: "bg-primary/40",
  destructive: "bg-destructive/40",
  muted: "bg-muted-foreground/30",
};

interface Ripple { id: number; x: number; y: number; size: number; }

/**
 * Drop-in <button> that emits a click ripple from the cursor point.
 * Uses tailwind tokens only — no hardcoded colors.
 */
const RippleButton = forwardRef<HTMLButtonElement, RippleButtonProps>(
  ({ rippleColor = "primary", pulseOnActive, className = "", onClick, children, ...rest }, ref) => {
    const [ripples, setRipples] = useState<Ripple[]>([]);
    const idRef = useRef(0);

    const handleClick = useCallback(
      (e: React.MouseEvent<HTMLButtonElement>) => {
        const target = e.currentTarget.getBoundingClientRect();
        const size = Math.max(target.width, target.height);
        const x = e.clientX - target.left - size / 2;
        const y = e.clientY - target.top - size / 2;
        const id = ++idRef.current;
        setRipples((r) => [...r, { id, x, y, size }]);
        // GC after animation
        setTimeout(() => setRipples((r) => r.filter((rp) => rp.id !== id)), 600);
        onClick?.(e);
      },
      [onClick]
    );

    return (
      <button
        ref={ref}
        onClick={handleClick}
        className={`relative overflow-hidden ${pulseOnActive ? "animate-glow-pulse" : ""} ${className}`}
        {...rest}
      >
        {children}
        <span className="pointer-events-none absolute inset-0">
          {ripples.map((r) => (
            <span
              key={r.id}
              aria-hidden="true"
              className={`absolute rounded-full animate-ripple ${colorClassMap[rippleColor]}`}
              style={{ left: r.x, top: r.y, width: r.size, height: r.size }}
            />
          ))}
        </span>
      </button>
    );
  }
);

RippleButton.displayName = "RippleButton";
export default RippleButton;
