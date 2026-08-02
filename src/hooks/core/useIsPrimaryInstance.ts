/**
 * "Am I the one instance of this thing that should do the side effect?"
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The notification bell is rendered TWICE, always. The navbar has a desktop
 * cluster (`hidden lg:flex`) and a mobile cluster (`lg:hidden`), and CSS hides
 * one of them — but CSS does not unmount React components. Verified on
 * production 2026-08-01: `document.querySelectorAll('button[aria-label=
 * "Notifications"]')` returns 2, one with a zero-width bounding box.
 *
 * Rendering a component twice is harmless. Running its SIDE EFFECTS twice is
 * not. Two consequences were live:
 *
 *   1. Two realtime subscriptions to the same channel topic. supabase-js will
 *      happily create a second channel object with the same name, and
 *      `removeChannel` on either one tears down the topic the other is still
 *      using — so unmounting the hidden bell could silence the visible one.
 *   2. The notification sound played TWICE on every arrival, because the
 *      "count went up" effect ran in both instances.
 *
 * The alternative fix was to hoist the data into a provider mounted once. That
 * is a bigger change to the tree for the same outcome, and it only holds while
 * nobody mounts a second bell again. This primitive makes the effect correct
 * for ANY number of instances, which is the property we actually want.
 *
 * HOW IT WORKS
 *
 * Instances of the same `key` are kept in a module-level registry, in mount
 * order. The lowest-numbered live instance is the primary. When the primary
 * unmounts, the next one is promoted and re-rendered, so the effect never
 * simply stops — it moves.
 *
 * Not a substitute for React Query's cache sharing: the QUERY is already shared
 * by key, so two bells fetch once. This is only about effects that must not be
 * duplicated.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useEffect, useState, useRef } from "react";

interface Group {
  /** Live instance ids, ascending. The head is the primary. */
  ids: number[];
  /** Called when leadership changes, so the promoted instance re-renders. */
  listeners: Map<number, () => void>;
}

const groups = new Map<string, Group>();
let nextId = 1;

function groupFor(key: string): Group {
  let g = groups.get(key);
  if (!g) {
    g = { ids: [], listeners: new Map() };
    groups.set(key, g);
  }
  return g;
}

function notify(g: Group) {
  // Copy first: a listener may unmount another instance synchronously.
  for (const fn of [...g.listeners.values()]) fn();
}

/**
 * @param key   Anything that identifies the group. Include the user id when the
 *              effect is per-user (`"notif-realtime:" + userId`), so signing in
 *              as somebody else starts a fresh group instead of inheriting the
 *              previous user's leadership.
 * @returns     true for exactly one live instance per key, false for the rest.
 *              Returns false while `key` is empty, which is the natural
 *              "not ready yet" state (no user id, for example).
 */
export function useIsPrimaryInstance(key: string): boolean {
  const idRef = useRef<number | null>(null);
  if (idRef.current === null) idRef.current = nextId++;
  const id = idRef.current;

  const [, forceRender] = useState(0);
  const bump = () => forceRender((n) => n + 1);
  const bumpRef = useRef(bump);
  bumpRef.current = bump;

  useEffect(() => {
    if (!key) return;
    const g = groupFor(key);
    g.ids.push(id);
    g.ids.sort((a, b) => a - b);
    g.listeners.set(id, () => bumpRef.current());
    // A new arrival never takes leadership from a live instance, but the very
    // first one must render as primary rather than waiting for another event.
    bumpRef.current();

    return () => {
      const wasPrimary = g.ids[0] === id;
      g.ids = g.ids.filter((x) => x !== id);
      g.listeners.delete(id);
      if (g.ids.length === 0 && g.listeners.size === 0) {
        groups.delete(key);
      } else if (wasPrimary) {
        // Promote the next one so the effect resumes somewhere.
        notify(g);
      }
    };
  }, [key, id]);

  if (!key) return false;
  const g = groups.get(key);
  // Before the effect runs (first render) nobody is registered yet. Claiming
  // primacy here would let BOTH instances start their effect on the same tick,
  // which is the exact thing this hook exists to prevent.
  return !!g && g.ids[0] === id;
}

/** Test-only: forget every group. */
export function __resetPrimaryInstanceRegistry() {
  groups.clear();
}

export default useIsPrimaryInstance;
