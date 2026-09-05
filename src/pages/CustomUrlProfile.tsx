import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import NotFound from "@/pages/NotFound";

/**
 * Resolves a custom vanity URL (e.g. /john-doe) to the user's public profile.
 * Supports redirect from old URLs via custom_url_history table.
 *
 * F-85 — WHEN NOTHING RESOLVES, THIS RENDERS THE 404. IT DOES NOT REDIRECT.
 *
 * It used to `navigate("/not-found", { replace: true })`. But App.tsx's
 * `/:customUrl` route greedily matches every single-segment path, and
 * "/not-found" is itself a single segment and not a declared route — so the
 * redirect matched this same route again, remounted this component with
 * customUrl="not-found", failed to resolve that too, and fell through to
 * `return null`. Every mistyped URL, stale bookmark and dead external link to
 * the site rendered a header, a footer and nothing in between.
 *
 * Rendering NotFound in place fixes that AND keeps the member's original URL in
 * the address bar, so the 404 echoes the path they actually asked for and the
 * UI-8006 log line names it instead of naming "/not-found" every time.
 */
const CustomUrlProfile = () => {
  const { customUrl } = useParams<{ customUrl: string }>();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!customUrl) return;
    // React Router does NOT remount this component when only the route param
    // changes — the same instance re-runs this effect. Without this reset, the
    // second leg of an old-URL redirect would render with a stale
    // `checking === false` and show the 404 over a URL still being resolved.
    setChecking(true);
    const resolve = async () => {
      try {
        // Step 1: Resolve via SECURITY DEFINER RPC (no table read)
        const { data: resolved } = await (supabase
          .rpc("resolve_custom_url" as any, { _url: customUrl }) as any);
        const historyRow = Array.isArray(resolved) ? resolved[0] : null;

        if (historyRow) {
          if ((historyRow as any).is_current) {
            // Active URL → go to profile
            navigate(`/profile/${(historyRow as any).user_id}`, { replace: true });
          } else {
            // Old URL → find current URL for this user and redirect
            const { data: currentProfile } = await (supabase
              .from("profiles_public_data" as any)
              .select("id, custom_url")
              .eq("id", (historyRow as any).user_id)
              .maybeSingle() as any);

            if (currentProfile && (currentProfile as any).custom_url) {
              navigate(`/${(currentProfile as any).custom_url}`, { replace: true });
            } else if (currentProfile) {
              navigate(`/profile/${(currentProfile as any).id}`, { replace: true });
            }
          }
        } else {
          // Fallback: check profiles_public_data directly (for users who set URL before history table existed)
          const { data: fallback } = await (supabase
            .from("profiles_public_data" as any)
            .select("id")
            .ilike("custom_url", customUrl)
            .maybeSingle() as any);

          if ((fallback as any)?.id) {
            navigate(`/profile/${(fallback as any).id}`, { replace: true });
          }
        }
      } catch {
        // Swallowed on purpose: a lookup that threw is, to the member, a URL
        // that does not resolve. It falls through to the 404 render below —
        // they need the branded page, not a stack trace and not a blank screen.
      }
      setChecking(false);
    };
    resolve();
  }, [customUrl, navigate]);

  if (checking) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <span
          className="text-xs tracking-[0.3em] uppercase text-muted-foreground animate-pulse"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Loading…
        </span>
      </main>
    );
  }

  // Every branch that resolves calls navigate(), so reaching this line means the
  // vanity URL did not resolve. (Note it is not always an unmount: a redirect to
  // another vanity URL keeps this same instance on the same route pattern, which
  // is what the setChecking(true) above exists for.) Rendering NotFound rather
  // than returning null is what makes the 404 reachable at all for a
  // single-segment path.
  return <NotFound />;
};

export default CustomUrlProfile;
