import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

/**
 * Resolves a custom vanity URL (e.g. /john-doe) to the user's public profile.
 * Supports redirect from old URLs via custom_url_history table.
 */
const CustomUrlProfile = () => {
  const { customUrl } = useParams<{ customUrl: string }>();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!customUrl) return;
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
            } else {
              navigate("/not-found", { replace: true });
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
          } else {
            navigate("/not-found", { replace: true });
          }
        }
      } catch {
        navigate("/not-found", { replace: true });
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

  return null;
};

export default CustomUrlProfile;
