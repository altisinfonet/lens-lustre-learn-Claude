import { useEffect, useState, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface Redirect {
  id: string;
  from_path: string;
  to_path: string;
  type: "301" | "302" | "404";
  is_active: boolean;
  hit_count: number;
}

/**
 * Checks URL redirects stored in site_settings and navigates accordingly.
 * Place inside <BrowserRouter> but outside <Routes>.
 */
const RedirectHandler = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const cachedRedirects = qc.getQueryData<unknown>(["site-setting", "url_redirects"]);

  const redirects = useMemo<Redirect[] | null>(() => {
    if (cachedRedirects === undefined) return null; // not yet loaded
    if (!cachedRedirects || !Array.isArray(cachedRedirects)) return [];
    return cachedRedirects as unknown as Redirect[];
  }, [cachedRedirects]);

  useEffect(() => {
    const hash = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash;
    const hashParams = new URLSearchParams(hash);
    const queryParams = new URLSearchParams(location.search);

    const isRecoveryHash =
      hashParams.get("type") === "recovery" &&
      (hashParams.has("access_token") || hashParams.has("refresh_token"));

    const isScannerSafeRecovery =
      queryParams.has("recovery_token") && queryParams.has("recovery_email");

    if ((isRecoveryHash || isScannerSafeRecovery) && location.pathname !== "/reset-password") {
      navigate(`/reset-password${location.search}${location.hash}`, { replace: true });
    }
  }, [location.pathname, location.search, location.hash, navigate]);

  useEffect(() => {
    if (!redirects) return;
    const match = redirects.find((r) => r.is_active && r.from_path === location.pathname);
    if (!match) return;

    // Increment hit count in background
    const updated = redirects.map((r) =>
      r.id === match.id ? { ...r, hit_count: (r.hit_count || 0) + 1 } : r
    );
    supabase.from("site_settings").upsert({
      key: "url_redirects",
      value: updated as any,
      updated_at: new Date().toISOString(),
    });

    // Navigate
    navigate(match.to_path, { replace: true });
  }, [location.pathname, redirects, navigate]);

  return null;
};

export default RedirectHandler;
