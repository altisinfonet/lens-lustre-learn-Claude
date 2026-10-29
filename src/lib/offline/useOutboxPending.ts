/**
 * S7b-5 · the signed-in member's actions still waiting in the outbox, as
 * subjects (`post:<id>`, `follow:<member>` … — outboxSubject), kept current
 * from the outbox's own events. Empty when nothing waits.
 */
import { useEffect, useState } from "react";
import { outboxSubject, pending, subscribeOutbox } from "./outbox";

const EMPTY: ReadonlySet<string> = new Set();

export function useOutboxPendingSubjects(): ReadonlySet<string> {
  const [subjects, setSubjects] = useState<ReadonlySet<string>>(EMPTY);
  useEffect(() => {
    let live = true;
    const read = () => {
      void pending().then((items) => {
        if (!live) return;
        const next = new Set<string>();
        for (const i of items) {
          const s = outboxSubject(i.action);
          if (s) next.add(s);
        }
        setSubjects((prev) => (prev.size === next.size && [...next].every((x) => prev.has(x)) ? prev : next));
      });
    };
    read();
    const stop = subscribeOutbox(read);
    return () => { live = false; stop(); };
  }, []);
  return subjects;
}

/** How many of the member's own actions (not telemetry) are waiting. */
export function useOutboxPendingCount(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    const read = () => { void pending().then((items) => { if (live) setN(items.filter((i) => outboxSubject(i.action)).length); }); };
    read();
    const stop = subscribeOutbox(read);
    return () => { live = false; stop(); };
  }, []);
  return n;
}
