import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportClientError } from "@/lib/reportClientError";

/**
 * Last-resort error screen — a crashed route previously rendered a PURE BLANK
 * page (owner report 2026-07-28: "often blank pages are coming"). The member
 * always gets a Reload button instead of emptiness.
 *
 * 2026-08-05: it also REPORTS now. The owner raised blank pages again —
 * "what tracking you are follwoing, just i cant check is not the soltuion" —
 * and he was right: this boundary caught every crash and told nobody. It wrote
 * one console.error into a browser no engineer would ever read.
 *
 * The component stack goes with it, because "which page" is the first question
 * and the stack is the only thing that answers it after the fact.
 */
class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[AppErrorBoundary]", error, info.componentStack);
    reportClientError("blank_page", error, {
      // Trimmed: the first frames name the route that died, and the tail is
      // provider noise that would only bloat the row.
      componentStack: (info.componentStack || "").slice(0, 600),
    });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
          Something went wrong while loading this page.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-6 py-2.5 rounded-md bg-primary text-primary-foreground text-xs uppercase tracking-[0.15em]"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Reload
        </button>
      </div>
    );
  }
}

export default AppErrorBoundary;
