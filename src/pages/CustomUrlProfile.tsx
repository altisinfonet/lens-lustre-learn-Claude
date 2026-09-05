import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import NotFound from "@/pages/NotFound";
import { PublicProfileInner } from "@/pages/PublicProfile";

/**
 * Resolves a custom vanity URL (e.g. /50mmretinaworld) to the member's public
 * profile — and RENDERS IT IN PLACE. It does not redirect, and that is the
 * whole point of the file.
 *
 * F-86 — THE VANITY URL MUST SURVIVE. This used to answer a resolved URL with
 * `navigate("/profile/" + user_id, { replace: true })`. The profile appeared,
 * but the address bar became `/profile/<uuid>`: the feature was defeated (a
 * member shares /theirname and the recipient sees a UUID), an INTERNAL USER
 * UUID became the member's public identity on every visit — with `replace:true`
 * meaning Back did not even return to the vanity URL — and search engines
 * indexed the UUID rather than the clean name, so the vanity URL could never
 * rank. 96 of 111 production profiles carry a custom_url, so this was nearly
 * every member.
 *
 * F-85 — AND THE BRANDED 404 MUST BE REACHABLE. App.tsx's `/:customUrl` route
 * greedily matches every single-segment path, so the catch-all
 * `<Route path="*" element={<NotFound />} />` only ever fires for MULTI-segment
 * ones. This used to answer a dead URL with `navigate("/not-found")`, but
 * "/not-found" is itself a single segment and is not a declared route, so it
 * matched `/:customUrl` again, re-resolved "not-found", failed, navigated to
 * where it already was, and fell through to `return null`. Every mistyped URL,
 * stale bookmark and dead inbound link rendered a header, a footer and nothing
 * between them. Rendering NotFound in place also keeps the typed path, so the
 * 404 echoes the address the member actually asked for and the UI-8006 log line
 * names it instead of naming "/not-found" every time.
 *
 * THE ONE REDIRECT THAT STAYS is the renamed-URL case: an old vanity URL sends
 * the member to the member's CURRENT vanity URL, because one canonical address
 * per member is the correct behaviour. `/profile/<id>` remains as the fallback
 * for a member who genuinely has no custom_url, and the `/profile/:userId`
 * route is untouched — existing links depend on it.
 */
const CustomUrlProfile = () => {
  const { customUrl } = useParams<{ customUrl: string }>();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [resolvedUserId, setResolvedUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!customUrl) return;
    // React Router does NOT remount this component when only the route param
    // changes — the same instance re-runs this effect. Without these resets the
    // second leg of a renamed-URL redirect would render with a stale result:
    // either the previous member's profile, or the 404, over an address that is
    // still being resolved.
    setChecking(true);
    setResolvedUserId(null);

    const resolve = async () => {
      try {
        // Step 1: Resolve via SECURITY DEFINER RPC (no table read)
        const { data: resolved } = await (supabase
          .rpc("resolve_custom_url" as any, { _url: customUrl }) as any);
        const historyRow = Array.isArray(resolved) ? resolved[0] : null;

        if (historyRow) {
          if ((historyRow as any).is_current) {
            // Active URL → render the profile HERE. The address stays /membername.
            setResolvedUserId((historyRow as any).user_id as string);
          } else {
            // Old URL → find the member's current URL and redirect to it, so
            // every member has one canonical address.
            const { data: currentProfile } = await (supabase
              .from("profiles_public_data" as any)
              .select("id, custom_url")
              .eq("id", (historyRow as any).user_id)
              .maybeSingle() as any);

            if (currentProfile && (currentProfile as any).custom_url) {
              navigate(`/${(currentProfile as any).custom_url}`, { replace: true });
            } else if (currentProfile) {
              // No vanity URL of their own — /profile/<id> is the fallback.
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
            // The typed URL IS this member's current one, so it survives too.
            setResolvedUserId((fallback as any).id as string);
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

  // key= matches the /profile/:userId wrapper: a full remount when the member
  // changes, rather than one instance re-rendering with another member's data.
  if (resolvedUserId) return <PublicProfileInner key={resolvedUserId} userId={resolvedUserId} />;

  // Nothing resolved. Rendering NotFound here — rather than returning null — is
  // what makes the 404 reachable at all for a single-segment path.
  return <NotFound />;
};

export default CustomUrlProfile;
