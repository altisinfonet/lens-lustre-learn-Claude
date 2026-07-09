/**
 * AdminToolbar — Phase 4 slice (additive). Filter/action bar for admin pages.
 * Token-only styling. No behavior. Existing pages NOT migrated yet.
 */
// @phase: phase-4-slice-ui
import * as React from "react";
import { cn } from "@/lib/utils";

interface AdminToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
  left?: React.ReactNode;
  right?: React.ReactNode;
}

export function AdminToolbar({
  left,
  right,
  className,
  children,
  ...rest
}: AdminToolbarProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2",
        className,
      )}
      {...rest}
    >
      <div className="flex flex-wrap items-center gap-2">{left ?? children}</div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}

export default AdminToolbar;
