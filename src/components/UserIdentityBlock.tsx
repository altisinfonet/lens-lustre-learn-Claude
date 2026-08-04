import { Link } from "react-router-dom";
import AutoBadge from "@/components/AutoBadge";
import AutoRole from "@/components/AutoRole";
import { Component, type ErrorInfo, type ReactNode } from "react";

/** Silent error boundary — renders nothing on crash instead of breaking siblings */
class SafeRender extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("[SafeRender] child crashed:", error.message);
  }
  render() { return this.state.hasError ? null : this.props.children; }
}

interface UserIdentityBlockProps {
  userId: string;
  name: string | null | undefined;
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
  linkTo,
  size = "compact",
  className = "",
  nameClassName = "text-[13px] font-semibold text-foreground hover:underline leading-tight",
  stack = false,
  align = "start",
}: UserIdentityBlockProps) => {
  const displayName = name || "Photographer";
  const resolvedNameClassName =
    `${nameClassName} block min-w-0 truncate${align === "center" ? " w-full text-center" : ""}`;

  const nameEl = linkTo ? (
    <Link to={linkTo} className={resolvedNameClassName}>
      {displayName}
    </Link>
  ) : (
    <span className={resolvedNameClassName}>{displayName}</span>
  );

  const badgeEl = (
    <SafeRender>
      <AutoBadge userId={userId} size={size} />
    </SafeRender>
  );

  return (
    <div
      className={`flex min-w-0 flex-col gap-0.5 ${align === "center" ? "items-center w-full" : "items-start"} ${className}`}
    >
      {stack ? (
        <>
          {nameEl}
          {/* Own line: the badge no longer competes with the name for width. */}
          <div className={`flex min-w-0 max-w-full items-center ${align === "center" ? "justify-center" : ""}`}>
            {badgeEl}
          </div>
        </>
      ) : (
        <div className="flex min-w-0 max-w-full items-center gap-1 overflow-hidden">
          {nameEl}
          {badgeEl}
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
