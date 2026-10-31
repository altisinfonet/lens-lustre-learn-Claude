import type { QueryClient } from "@tanstack/react-query";

const BATCH_WINDOW_MS = 150;

type Updater<T> = (prev: T) => T;

interface BatchEntry<T> {
  updaters: Updater<T>[];
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Global batch registry keyed by serialized query key.
 * Accumulates updater functions over a 150ms window, then applies
 * them as a single composed setQueryData call.
 */
const batches = new Map<string, BatchEntry<any>>();

function flush<T>(queryClient: QueryClient, key: readonly unknown[], batchKey: string) {
  const entry = batches.get(batchKey);
  if (!entry || entry.updaters.length === 0) {
    batches.delete(batchKey);
    return;
  }

  const updaters = entry.updaters;
  batches.delete(batchKey);

  // Single setQueryData call — compose all queued updaters
  queryClient.setQueryData<T>(key, (old) => {
    if (old === undefined) return old;
    let result = old as T;
    for (const fn of updaters) {
      result = fn(result);
    }
    return result;
  });
}

/**
 * Queue an updater function for a given query key.
 * All updaters queued within BATCH_WINDOW_MS are composed and applied
 * as a single setQueryData call — prevents rapid-fire cache thrashing.
 */
export function queueCacheUpdate<T>(
  queryClient: QueryClient,
  key: readonly unknown[],
  updater: Updater<T>,
) {
  const batchKey = JSON.stringify(key);

  let entry = batches.get(batchKey);
  if (!entry) {
    entry = {
      updaters: [],
      timer: setTimeout(() => flush<T>(queryClient, key, batchKey), BATCH_WINDOW_MS),
    };
    batches.set(batchKey, entry);
  } else {
    // Reset the window on each new event (sliding window, capped at BATCH_WINDOW_MS)
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => flush<T>(queryClient, key, batchKey), BATCH_WINDOW_MS);
  }

  entry.updaters.push(updater);
}

/**
 * Immediately apply all pending updates for a key (used by optimistic mutations
 * that need the cache to be current before their own setQueryData).
 */
export function flushCacheUpdates<T>(queryClient: QueryClient, key: readonly unknown[]) {
  const batchKey = JSON.stringify(key);
  const entry = batches.get(batchKey);
  if (entry) {
    clearTimeout(entry.timer);
    flush<T>(queryClient, key, batchKey);
  }
}
