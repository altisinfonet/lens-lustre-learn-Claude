import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Last-resort error screen — a crashed route previously rendered a PURE BLANK
 * page (owner report 2026-07-28: "often blank pages are coming"). Now the
 * member always gets a Reload button instead of emptiness.
 */
class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[AppErrorBoundary]", error, info.componentStack);
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
