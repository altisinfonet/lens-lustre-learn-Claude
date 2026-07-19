import { Link } from "react-router-dom";
import { isActiveNow } from "@/hooks/core/useLastActive";

interface PresenceAvatarProps {
  src?: string | null;
  name?: string | null;
  /** Presence heartbeat timestamp (from profile map / profiles_public_data). */
  lastActiveAt?: string | null;
  /** Avatar diameter in px. Default 40. */
  size?: number;
  /** If provided, the avatar is wrapped in a router Link. */
  to?: string;
  /** Extra classes on the avatar image/fallback. */
  className?: string;
  /** Show the green ring around the avatar when online. Default true. */
  showRing?: boolean;
  /** Show the green presence dot at the corner. Default true. */
  showDot?: boolean;
}

/**
 * Facebook/Instagram-style avatar with an online-presence indicator.
 * "Online" = active within the last 5 minutes (isActiveNow). Presence data is
 * only available to authenticated viewers and to users who haven't hidden their
 * active status, so the dot simply doesn't render otherwise.
 *
 * Note: ring/offset classes are written literally (not interpolated) so
 * Tailwind's JIT keeps them.
 */
export default function PresenceAvatar({
  src,
  name,
  lastActiveAt,
  size = 40,
  to,
  className = "",
  showRing = true,
  showDot = true,
}: PresenceAvatarProps) {
  const online = isActiveNow(lastActiveAt);
  const dim = { width: size, height: size };
  // dot ~28% of avatar, min 8px
  const dotSize = Math.max(8, Math.round(size * 0.28));

  const ringClass =
    online && showRing ? "ring-2 ring-green-500 ring-offset-2 ring-offset-background" : "";

  const inner = src ? (
    <img
      referrerPolicy="no-referrer"
      loading="lazy"
      decoding="async"
      src={src}
      alt={name || ""}
      style={dim}
      className={`rounded-full object-cover ${ringClass} ${className}`}
    />
  ) : (
    <div
      style={dim}
      className={`rounded-full bg-primary/10 flex items-center justify-center font-semibold text-muted-foreground ${ringClass} ${className}`}
    >
      {(name || "?")[0]?.toUpperCase()}
    </div>
  );

  const content = (
    <span className="relative inline-block shrink-0" style={dim}>
      {inner}
      {online && showDot && (
        <span
          aria-label="Online"
          title="Online"
          style={{ width: dotSize, height: dotSize }}
          className="absolute bottom-0 right-0 block rounded-full bg-green-500 ring-2 ring-background"
        />
      )}
    </span>
  );

  if (to) {
    return (
      <Link to={to} className="shrink-0" aria-label={name || "profile"}>
        {content}
      </Link>
    );
  }
  return content;
}
