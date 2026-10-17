/**
 * OFF-2 · how one outbox item is sent. Every send carries the item's stored
 * key; nothing here makes a key (see outbox.ts, "THE ONE RULE").
 *
 * Per D1's contract (scripts/db-off2-outbox-contract.json, docs/evidence/d1/OFF-2):
 *   comment  upsert(..., { onConflict: "user_id,idempotency_key", ignoreDuplicates: true })
 *            then read the row back by (user_id, idempotency_key): the original result.
 *   report   the same on (reporter_id, idempotency_key).
 *   like     insert on the natural key (post_id, user_id); a 23505 means it is
 *            already there — delivered.
 *   unlike   delete by (post_id, user_id): repeating it changes nothing.
 *   seen     (Stage L2) upsert feed_events on the primary key the tracker made
 *            once per event, ignoreDuplicates: a resend is the same row.
 * Any 23505 is "delivered": the only way to get one is that the row exists.
 *
 * Classification, for outbox.ts: status 0 (fetch threw, our timeout), 408, 429
 * and 5xx are retryable; every other error is final.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isNetworkError } from "./retryPolicy";
import { OUTBOX_TARGETS, type OutboxItem, type SendResult, type Sender } from "./outbox";

type Answer = { error: unknown; status?: number; data?: unknown };

export function classify(a: Answer): SendResult {
  if (!a.error) return { ok: true, result: a.data };
  const code = (a.error as { code?: unknown }).code;
  if (code === "23505") return { ok: true, result: undefined };
  const s = typeof a.status === "number" ? a.status : 0;
  const retry = s === 0 || s === 408 || s === 429 || s >= 500 || isNetworkError(a.error);
  return { ok: false, retry, error: a.error };
}

async function call(p: PromiseLike<Answer>): Promise<Answer> {
  try {
    return await p;
  } catch (error) {
    return { error, status: 0 };
  }
}

// The client is typed loosely here: the generated types know the tables, but the
// sender is written once for four of them and is checked against D1's contract.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

export function supabaseSender(client: SupabaseClient): Sender {
  const db = client as Loose;
  return async (item: OutboxItem): Promise<SendResult> => {
    const a = item.action;
    const t = OUTBOX_TARGETS[a.kind];
    switch (a.kind) {
      case "react": {
        if (a.replace) {
          const d = classify(await call(db.from(t.table).delete().eq("post_id", a.postId).eq("user_id", item.userId)));
          if (!d.ok) return d;
        }
        return classify(await call(db.from(t.table).insert({ post_id: a.postId, user_id: item.userId, reaction_type: a.reactionType })));
      }
      case "unreact":
        return classify(await call(db.from(t.table).delete().eq("post_id", a.postId).eq("user_id", item.userId)));
      case "comment": {
        const w = classify(await call(db.from(t.table).upsert(
          { post_id: a.postId, user_id: item.userId, content: a.content, parent_id: a.parentId, idempotency_key: item.key },
          { onConflict: t.onConflict, ignoreDuplicates: true },
        )));
        if (!w.ok) return w;
        const r = await call(db.from(t.table).select("id").eq("user_id", item.userId).eq("idempotency_key", item.key).maybeSingle());
        return { ok: true, result: r.error ? undefined : r.data ?? undefined };
      }
      case "report": {
        const w = classify(await call(db.from(t.table).upsert(
          { reporter_id: item.userId, target_type: a.targetType, target_id: a.targetId, reason: a.reason, idempotency_key: item.key },
          { onConflict: t.onConflict, ignoreDuplicates: true },
        )));
        if (!w.ok) return w;
        const r = await call(db.from(t.table).select("id").eq("reporter_id", item.userId).eq("idempotency_key", item.key).maybeSingle());
        return { ok: true, result: r.error ? undefined : r.data ?? undefined };
      }
      case "feed_events": {
        // Stage L2. Each event's id was made once, when it was recorded; ON
        // CONFLICT (id) DO NOTHING makes a resend after a lost answer harmless.
        // user_id is the item's member (RLS: own rows only); author_id is
        // overwritten server-side by validate_feed_event_author. A final 4xx —
        // the hourly rate limit (P0001), a deleted post — drops the batch: it is
        // ranking telemetry, never retried into a wall.
        if (a.events.length === 0) return { ok: true };
        return classify(await call(db.from(t.table).upsert(
          a.events.map((e) => ({ id: e.id, user_id: item.userId, post_id: e.post_id, author_id: e.author_id, event_type: e.event_type, dwell_ms: e.dwell_ms })),
          { onConflict: t.onConflict, ignoreDuplicates: true },
        )));
      }
    }
  };
}
