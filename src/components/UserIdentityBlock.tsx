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
}: UserIdentityBlockProps) => {
  const displayName = name || "Photographer";
  const resolvedNameClassName = `${nameClassName} block min-w-0 truncate`;

  const nameEl = linkTo ? (
    <Link to={linkTo} className={resolvedNameClassName}>
      {displayName}
    </Link>
  ) : (
    <span className={resolvedNameClassName}>{displayName}</span>
  );

  return (
    <div className={`flex min-w-0 flex-col items-start gap-0.5 ${className}`}>
      <div className="flex min-w-0 max-w-full items-center gap-1 overflow-hidden">
        {nameEl}
        <SafeRender>
          <AutoBadge userId={userId} size={size} />
        </SafeRender>
      </div>
      <div className="max-w-full">
        <SafeRender>
          <AutoRole userId={userId} size={size} />
        </SafeRender>
      </div>
    </div>
  );
};

export default UserIdentityBlock;
