import { Link } from "react-router-dom";
import { useOnline } from "@/lib/presence/online";
import { avatarInitial } from "@/lib/displayName";

interface PresenceAvatarProps {
  src?: string | null;
  name?: string | null;
  /**
   * The member this avatar belongs to. The dot is live Realtime Presence keyed
   * on this id (P1 §1), not a `last_active_at` timestamp — the old
   * `lastActiveAt` prop is gone, and passing a timestamp here would not compile.
   */
  userId?: string | null;
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
 *
 * "Online" means a Realtime Presence entry exists for `userId` right now (P1
 * §1) — not "wrote a timestamp in the last five minutes", which is what it used
 * to mean and which showed a dot for members who had already closed the tab.
 * Signed-out viewers never open the channel, and a member who has hidden their
 * active status never announces themselves, so in both cases nothing renders.
 *
 * Note: ring/offset classes are written literally (not interpolated) so
 * Tailwind's JIT keeps them.
 */
export default function PresenceAvatar({
  src,
  name,
  userId,
  size = 40,
  to,
  className = "",
  showRing = true,
  showDot = true,
}: PresenceAvatarProps) {
  const online = useOnline(userId);
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
      {avatarInitial(name)}
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
