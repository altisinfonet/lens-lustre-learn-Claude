import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportClientError } from "@/lib/reportClientError";
import { logger } from "@/lib/logger";

const FILE = "src/components/AppErrorBoundary.tsx";

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
    // BOTH sinks on purpose, and they are not duplicates.
    //
    // reportClientError() is the older path that feeds Admin → Health →
    // "Client failures" and its hourly counts; the owner already reads that
    // screen. SYS-9002 feeds the newer Error Log, where a correlation id shows
    // every log line of the action that died. Removing either one would take
    // away a screen the owner already relies on — and the standing rule here
    // is never break what works.
    logger.fatal({
      code: "SYS-9002",
      event: "ROUTE_CRASHED_BOUNDARY_CAUGHT",
      fn: "componentDidCatch",
      file: FILE,
      message: "A route crashed; the member is looking at the Reload screen, not the page they asked for.",
      reason: error?.message || String(error),
      expected: "The route to render",
      actual: `${error?.name || "Error"} escaped to the last-resort boundary`,
      nextStep:
        "The first frames of componentStack name the route that died. Check BLANK_PAGE_ROOT_CAUSE.md first: a missing /assets/* chunk returns 200 text/html and is cached immutable for a year, which produces exactly this.",
      detail: {
        errorName: error?.name,
        // Same 600-character trim as below — the head names the route, the
        // tail is provider noise.
        componentStack: (info.componentStack || "").slice(0, 600),
      },
    });
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
