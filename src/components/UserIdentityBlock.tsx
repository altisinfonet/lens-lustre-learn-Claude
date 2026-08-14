import { Link } from "react-router-dom";
import AutoBadge from "@/components/AutoBadge";
import UserBadgeInline from "@/components/UserBadgeInline";
import AutoRole from "@/components/AutoRole";
import { Component, type ErrorInfo, type ReactNode } from "react";

import { logger } from "@/lib/logger";

const FILE = "src/components/UserIdentityBlock.tsx";

/** Silent error boundary — renders nothing on crash instead of breaking siblings */
class SafeRender extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.warn({
      code: "UI-8005",
      event: "IDENTITY_BLOCK_CHILD_CRASHED",
      fn: "SafeRender.componentDidCatch",
      file: FILE,
      message: "A child of the member identity block crashed and was rendered as nothing.",
      reason: error.message,
      expected: "The member's name and badge",
      actual: `${error.name} escaped the child; the block renders empty`,
      nextStep:
        "Narrower than SYS-9002 — the page still works and the member may only notice a missing name or badge. The owner's rule is name first, then a VISIBLE badge, so a silent empty block breaks it.",
      detail: { componentStack: (info.componentStack || "").slice(0, 400) },
    });
  }
  render() { return this.state.hasError ? null : this.props.children; }
}

interface UserIdentityBlockProps {
  userId: string;
  name: string | null | undefined;
  /**
   * Badges that arrived WITH the surrounding record — pass them whenever the
   * caller already has them.
   *
   * Every feed/wall/hashtag query computes `author_badges` and, until
   * 2026-08-14, no caller passed it: the tick came from `AutoBadge`, a second
   * per-name lookup at render time. Owner screenshot that day showed a verified
   * account with no tick beside its name. Same correction as the "names showing
   * as ?" fix — if the name and the badge arrive together, "name visible, badge
   * missing" stops being a reachable state.
   *
   * Optional so unmigrated callers keep the lookup rather than lose the tick.
   */
  badges?: string[];
  /** If provided, the name becomes a link to this path */
  linkTo?: string;
  size?: "compact" | "full";
  /** Extra className on the outer wrapper */
  className?: string;
  /** Text size class for the name */
  nameClassName?: string;
  /**
   * Put the badge on its OWN line under the name instead of beside it.
   *
   * Owner rule, standing: "on each and every place Name with Badge will show."
   * The default inline layout honours that wherever there is room. In a narrow
   * container — the 132px friend-suggestion card is the case that forced this —
   * there is not: the name truncates and the badge, which by policy yields all
   * available space to the name (`BADGE_ROW_SHRINK`), gets crushed to nothing.
   * The member then sees a name and NO badge, which breaks the rule.
   *
   * Stacking keeps both visible. Off by default, so no existing surface moves.
   */
  stack?: boolean;
  /** Horizontal alignment. Centre is for card layouts; default matches today. */
  align?: "start" | "center";
}

/**
 * Global identity block — enforces the universal layout:
 *   Line 1: Name + Badges (inline)
 *   Line 2: Roles (below)
 *
 * Use this everywhere a user's name appears to guarantee consistency.
 */
const UserIdentityBlock = ({
  userId,
  name,
  badges,
  linkTo,
  size = "compact",
  className = "",
  nameClassName = "text-[13px] font-semibold text-foreground hover:underline leading-tight",
  stack = false,
  align = "start",
}: UserIdentityBlockProps) => {
  const displayName = name || "Photographer";
  /**
   * `w-full` only when the name is alone on its line. In the stacked layout the
   * verified tick sits beside it, so the name must be shrinkable — a full-width
   * name would push the tick out of the card.
   */
  const resolvedNameClassName =
    `${nameClassName} block min-w-0 truncate${align === "center" ? (stack ? " text-center" : " w-full text-center") : ""}`;

  const nameEl = linkTo ? (
    <Link to={linkTo} className={resolvedNameClassName}>
      {displayName}
    </Link>
  ) : (
    <span className={resolvedNameClassName}>{displayName}</span>
  );

  // Carried badges win over the lookup. SafeRender stays on BOTH paths: it is
  // what stops a badge problem from taking the whole name block down with it.
  const badgeEl = (only: "all" | "verified" | "pills") => (
    <SafeRender>
      {badges ? (
        <UserBadgeInline badges={badges} size={size} only={only} />
      ) : (
        <AutoBadge userId={userId} size={size} only={only} />
      )}
    </SafeRender>
  );

  return (
    <div
      className={`flex min-w-0 flex-col gap-0.5 ${align === "center" ? "items-center w-full" : "items-start"} ${className}`}
    >
      {stack ? (
        <>
          {/*
            The blue verified tick STAYS with the name. It is a fixed 14px glyph
            that always fits, and its whole meaning is "this name is the real
            person" — separated from the name it says nothing. Only the award
            pills, which are words and need room, move to their own line.
          */}
          <div className={`flex min-w-0 max-w-full items-center gap-1 ${align === "center" ? "justify-center w-full" : ""}`}>
            {nameEl}
            {badgeEl("verified")}
          </div>
          <div className={`flex min-w-0 max-w-full items-center ${align === "center" ? "justify-center" : ""}`}>
            {badgeEl("pills")}
          </div>
        </>
      ) : (
        <div className="flex min-w-0 max-w-full items-center gap-1 overflow-hidden">
          {nameEl}
          {badgeEl("all")}
        </div>
      )}
      <div className="max-w-full">
        <SafeRender>
          <AutoRole userId={userId} size={size} />
        </SafeRender>
      </div>
    </div>
  );
};

export default UserIdentityBlock;
