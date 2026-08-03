import { calcProfileCompletion } from "@/lib/profileCompletion";
import { useMemo, useState } from "react";
import { User, Edit2 } from "lucide-react";
import { Link } from "react-router-dom";

interface Props {
  profile: Record<string, any>;
  avatarUrl: string | null;
  displayName: string;
  size?: number;
}

const AvatarCompletionRing = ({ profile, avatarUrl, displayName, size = 160 }: Props) => {
  const [hovered, setHovered] = useState(false);

  /**
   * A tap fires mouseenter AND click, in that order. An ungated click-toggle
   * therefore opened the panel (enter) and instantly closed it again (toggle)
   * on every first tap — measured in a rendered harness, not guessed. So the
   * two input worlds are separated: hover drives the panel on fine pointers,
   * click drives it on coarse ones, and neither interferes with the other.
   */
  const isTouch = () =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  const { total, sections } = useMemo(() => calcProfileCompletion(profile), [profile]);

  const missing = sections.filter((s) => !s.completed);
  const strokeWidth = 4;
  const radius = (size / 2) - (strokeWidth / 2);
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (total / 100) * circumference;

  const ringColor =
    total === 100
      ? "hsl(var(--primary))"
      : total >= 60
      ? "hsl(142, 71%, 45%)"
      : "hsl(48, 96%, 53%)";

  return (
    <div
      className="relative flex-shrink-0 group"
      style={{ width: size, height: size }}
      onMouseEnter={() => { if (!isTouch()) setHovered(true); }}
      onMouseLeave={() => { if (!isTouch()) setHovered(false); }}
      onClick={() => { if (isTouch()) setHovered((h) => !h); }}
    >
      {/* SVG ring */}
      <svg
        width={size}
        height={size}
        className="absolute inset-0 -rotate-90"
        style={{ zIndex: 2 }}
      >
        {/* Background track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--border))"
          strokeWidth={strokeWidth}
        />
        {/* Progress arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={ringColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          className="transition-all duration-700 ease-out"
        />
      </svg>

      {/* Avatar */}
      <div
        className="absolute rounded-full overflow-hidden border-2 border-background"
        style={{
          top: strokeWidth + 1,
          left: strokeWidth + 1,
          width: size - (strokeWidth + 1) * 2,
          height: size - (strokeWidth + 1) * 2,
        }}
      >
        {avatarUrl ? (
          <img referrerPolicy="no-referrer" loading="lazy" decoding="async" src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-muted flex items-center justify-center">
            <User className="h-12 w-12 text-muted-foreground/40" />
          </div>
        )}
      </div>

      {/* Percentage badge */}
      <div
        className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full text-[9px] tracking-[0.15em] uppercase font-semibold shadow-md border border-background"
        style={{
          fontFamily: "var(--font-heading)",
          backgroundColor: ringColor,
          color: "#fff",
          zIndex: 3,
        }}
      >
        {total}%
      </div>

      {/* Hover tooltip — missing fields */}
      {hovered && missing.length > 0 && (
        <div
          /**
           * ANCHORED TO THE RING'S LEFT EDGE, NOT CENTRED ON IT.
           *
           * Measured on the mobile profile (ring size 80, sitting 16px from
           * the screen edge): `left-1/2 -translate-x-1/2` centred this 224px
           * panel on a 40px-wide midpoint, so it spanned from -56px — a third
           * of it OFF the left of the screen. That is the "showing outside of
           * page" the owner photographed. `left-0` keeps every pixel on
           * screen wherever the ring sits, and the max-width stops it ever
           * exceeding the viewport on narrow phones.
           */
          className="absolute left-0 bg-popover text-popover-foreground border border-border rounded-md shadow-lg p-3 w-56 max-w-[calc(100vw-2rem)] animate-in fade-in-0 zoom-in-95 duration-200"
          style={{ top: size + 8, zIndex: 50, fontFamily: "var(--font-body)" }}
        >
          <p
            className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground mb-2"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Complete your profile
          </p>
          <ul className="space-y-1 mb-2.5">
            {missing.map((m) => (
              <li key={m.label} className="text-xs text-muted-foreground flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-muted-foreground/40 flex-shrink-0" />
                {m.label}
              </li>
            ))}
          </ul>
          <Link
            to="/edit-profile"
            className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase text-primary hover:underline transition-all"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            <Edit2 className="h-3 w-3" />
            Complete Now
          </Link>
        </div>
      )}
    </div>
  );
};

export default AvatarCompletionRing;
