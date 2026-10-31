import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface BadgeDefinition {
  type_key: string;
  label: string;
  icon: string;
  badge_class: string;
  ribbon_class: string;
  is_active: boolean;
}

const BADGE_DEFS_CACHE_TTL_MS = 60_000;
let cachedDefs: Map<string, BadgeDefinition> | null = null;
let fetchPromise: Promise<Map<string, BadgeDefinition>> | null = null;
let cachedAt = 0;
const subscribers = new Set<(defs: Map<string, BadgeDefinition>) => void>();
let syncInitialized = false;

const notifySubscribers = (defs: Map<string, BadgeDefinition>) => {
  subscribers.forEach((subscriber) => subscriber(defs));
};

const ensureBadgeDefsSync = () => {
  if (syncInitialized) return;
  syncInitialized = true;

  supabase
    .channel("badge-definitions-sync")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "badge_definitions" },
      async () => {
        const defs = await fetchDefs(true);
        notifySubscribers(defs);
      },
    )
    .subscribe();
};

const fetchDefs = async (force = false): Promise<Map<string, BadgeDefinition>> => {
  if (!force && cachedDefs && Date.now() - cachedAt <= BADGE_DEFS_CACHE_TTL_MS) return cachedDefs;
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    const { data, error } = await supabase.from("badge_definitions").select("*").eq("is_active", true).order("sort_order");
    if (error) {
      fetchPromise = null;
      return cachedDefs || new Map<string, BadgeDefinition>();
    }

    const map = new Map<string, BadgeDefinition>();
    ((data as any[]) || []).forEach((d) => map.set(d.type_key, d));
    cachedDefs = map;
    cachedAt = Date.now();
    fetchPromise = null;
    return map;
  })();

  return fetchPromise;
};

/** Invalidate cache (call after admin edits definitions) */
export const invalidateBadgeDefs = () => {
  cachedDefs = null;
  cachedAt = 0;
};

export const useBadgeDefinitions = () => {
  const [defs, setDefs] = useState<Map<string, BadgeDefinition>>(() => cachedDefs || new Map());

  useEffect(() => {
    let cancelled = false;

    const handleDefsUpdate = (nextDefs: Map<string, BadgeDefinition>) => {
      if (!cancelled) setDefs(nextDefs);
    };

    subscribers.add(handleDefsUpdate);
    ensureBadgeDefsSync();
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
