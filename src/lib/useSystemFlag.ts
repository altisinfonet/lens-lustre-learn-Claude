import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Read a boolean feature flag from the system_flags table.
 * Returns false until the flag is loaded (safe default).
 * Caches per key per mount — does not poll.
 */
export function useSystemFlag(key: string): boolean {
  const [value, setValue] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("system_flags")
      .select("value")
      .eq("key", key)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data?.value === true) setValue(true);
      });
    return () => { cancelled = true; };
  }, [key]);

  return value;
}
