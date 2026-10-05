/** OFF-3 · the current network state, re-rendering when it changes. */
import { useEffect, useSyncExternalStore } from "react";
import { getNetState, subscribeNetState, wireBrowserSignals, type NetState } from "@/lib/offline/networkQuality";

export function useNetworkQuality(): NetState {
  useEffect(() => { wireBrowserSignals(); }, []);
  return useSyncExternalStore(subscribeNetState, getNetState, getNetState);
}
