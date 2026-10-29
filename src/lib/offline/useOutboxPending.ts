/**
 * S7b-5 · the signed-in member's actions still waiting in the outbox, as
 * subjects (`post:<id>`, `follow:<member>` … — outboxSubject), and how many.
 *
 * ONE shared subscription for the whole app (review #574): every post card
 * shows a PendingMark, and each reading the whole outbox store on every outbox
 * event (feed telemetry included) was ~30 IndexedDB reads per flush. Telemetry
 * deliveries are ignored, and reads are batched (one per 100 ms at most).
 */
import { useSyncExternalStore } from "react";
import { outboxSubject, pending, subscribeOutbox, type OutboxEvent } from "./outbox";

const EMPTY: ReadonlySet<string> = new Set();
let subjects: ReadonlySet<string> = EMPTY;
let count = 0;
const subs = new Set<() => void>();
let unsubscribe: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function refresh() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void pending().then((items) => {
      const next = new Set<string>();
      let n = 0;
      for (const i of items) {
        const s = outboxSubject(i.action);
        if (!s) continue; // telemetry: nothing on screen waits for it
        next.add(s);
        n++;
      }
      const same = next.size === subjects.size && [...next].every((x) => subjects.has(x)) && n === count;
      if (same) return;
      subjects = next.size ? next : EMPTY;
      count = n;
      subs.forEach((f) => f());
    });
  }, 100);
}

function onEvent(e: OutboxEvent) {
  if (e.type !== "changed" && (e.item.action.kind === "feed_events" || e.item.action.kind === "feed_signals")) return;
  refresh();
}

function subscribe(fn: () => void): () => void {
  subs.add(fn);
  if (!unsubscribe) { unsubscribe = subscribeOutbox(onEvent); refresh(); }
  return () => {
    subs.delete(fn);
    if (subs.size === 0 && unsubscribe) { unsubscribe(); unsubscribe = null; }
  };
}

export function useOutboxPendingSubjects(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => subjects, () => EMPTY);
}

/** How many of the member's own actions (not telemetry) are waiting. */
export function useOutboxPendingCount(): number {
  return useSyncExternalStore(subscribe, () => count, () => 0);
}
