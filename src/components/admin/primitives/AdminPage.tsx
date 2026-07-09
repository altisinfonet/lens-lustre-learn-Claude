/**
 * AdminPage — Phase 4 slice (additive). Standard admin page shell.
 * Token-only styling. No behavior. Existing pages NOT migrated yet.
 */
// @phase: phase-4-slice-ui
import * as React from "react";
import { cn } from "@/lib/utils";

interface AdminPageProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}

export function AdminPage({
  title,
  description,
  actions,
  className,
  children,
  ...rest
}: AdminPageProps) {
  return (
    <div className={cn("flex flex-col gap-4 p-4", className)} {...rest}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <h1 className="text-lg font-semibold leading-tight text-foreground truncate">
                {title}
              </h1>
            )}
            {description && (
              <p className="mt-1 text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

export default AdminPage;
