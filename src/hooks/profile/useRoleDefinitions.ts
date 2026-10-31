import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface RoleDefinition {
  role_key: string;
  label: string;
  icon: string;
  pill_class: string;
  show_inline: boolean;
}

const ROLE_DEFS_CACHE_TTL_MS = 60_000;
let cachedDefs: Map<string, RoleDefinition> | null = null;
let fetchPromise: Promise<Map<string, RoleDefinition>> | null = null;
let cachedAt = 0;
const subscribers = new Set<(defs: Map<string, RoleDefinition>) => void>();
let syncInitialized = false;

const notifySubscribers = (defs: Map<string, RoleDefinition>) => {
  subscribers.forEach((subscriber) => subscriber(defs));
};

const ensureRoleDefsSync = () => {
  if (syncInitialized) return;
  syncInitialized = true;

  supabase
    .channel("role-display-config-sync")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "role_display_config" },
      async () => {
        const defs = await fetchDefs(true);
        notifySubscribers(defs);
      },
    )
    .subscribe();
};

const fetchDefs = async (force = false): Promise<Map<string, RoleDefinition>> => {
  if (!force && cachedDefs && Date.now() - cachedAt <= ROLE_DEFS_CACHE_TTL_MS) return cachedDefs;
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    const { data, error } = await supabase.from("role_display_config").select("*").order("sort_order");
    if (error) {
      fetchPromise = null;
      return cachedDefs || new Map<string, RoleDefinition>();
    }

    const map = new Map<string, RoleDefinition>();
    ((data as any[]) || []).forEach((d) => map.set(d.role_key, d));
    cachedDefs = map;
    cachedAt = Date.now();
    fetchPromise = null;
    return map;
  })();

  return fetchPromise;
};

/** Invalidate cache (call after admin edits definitions) */
export const invalidateRoleDefs = () => {
  cachedDefs = null;
  cachedAt = 0;
};

export const useRoleDefinitions = () => {
  const [defs, setDefs] = useState<Map<string, RoleDefinition>>(() => cachedDefs || new Map());

  useEffect(() => {
    let cancelled = false;

    const handleDefsUpdate = (nextDefs: Map<string, RoleDefinition>) => {
      if (!cancelled) setDefs(nextDefs);
    };

    subscribers.add(handleDefsUpdate);
    ensureRoleDefsSync();
    fetchDefs().then((nextDefs) => {
      if (!cancelled) setDefs((prev) => (prev === nextDefs ? prev : nextDefs));
    });

    return () => {
      cancelled = true;
      subscribers.delete(handleDefsUpdate);
    };
  }, []);

  return defs;
};
