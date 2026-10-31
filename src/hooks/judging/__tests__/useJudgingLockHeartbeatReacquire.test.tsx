/**
 * A HEARTBEAT THAT IGNORES ITS ANSWER IS TWO JUDGES ON ONE PHOTO.
 *
 * ── THE DEFECT (R-63 · P10-J1) ───────────────────────────────────────────────
 * `heartbeat_judge_lock(uuid, integer, uuid, integer)` is `RETURNS boolean`, and
 * the boolean is `FOUND` from an UPDATE filtered by `judge_id`
 * (`supabase/migrations/20260326091904_*.sql:120`). FALSE therefore means one
 * specific thing: the lock row is no longer this judge's — it expired and
 * another judge took it.
 *
 * 2-D2-04 moved this heartbeat onto `startVisibilityInterval`, so it stops while
 * the tab is hidden. That is P10's clause and it was accepted, but it turned a
 * latent hole into a reachable one: a judge hidden for longer than
 * `LOCK_TTL_MINUTES` returns to `isLocked: true`, because the heartbeat threw
 * the boolean away and swallowed the failure. Nothing on screen says the round
 * is gone, and two judges score the same photo.
 *
 * ── WHAT IS PINNED HERE, AND WHAT IS DELIBERATELY NOT ────────────────────────
 * Pinned: `false` re-acquires; a failure on the first tick after resume
 * re-acquires; the refusal that comes back surfaces as `lockedByOther`.
 * Deliberately NOT pinned as a fix: a failure on an ordinary interval tick. The
 * judge is demonstrably present, at most two minutes of TTL is at stake, and
 * dropping a working judge out of a round on one flaky request is a worse
 * failure than the one being fixed. That asymmetry is an assertion below
 * (GUARD), so "fixing" it later has to be a decision.
 *
 * ── FAIL-FIRST (C-34) ────────────────────────────────────────────────────────
 * Against the implementation at `3d3fb46` — the head of this PR before R-63 —
 * the three behavioural assertions are red and the two GUARDs are green. The
 * run is committed at `docs/evidence/d2/phase2/p10-j1-fail-first.txt`.
 *
 * ── WHY THE SUPABASE CLIENT IS A STUB HERE ───────────────────────────────────
 * `useJudgingLockUnloadAuth.test.tsx` builds a real supabase-js client, because
 * its subject is the HEADERS of a request. The subject here is what the hook
 * does with a return value, so the smallest honest instrument is a scripted
 * `rpc` that records every call. The scripts return exactly what PostgREST
 * returns for this function: `{ data: boolean, error: null }`, or an error.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const JUDGE_ID = "9f6f0a3e-1111-4222-8333-444444444444";
const OTHER_JUDGE_ID = "5c5c5c5c-2222-4333-8444-555555555555";
const ENTRY_ID = "1b2c3d4e-5555-4666-8777-888888888888";
const PHOTO_INDEX = 2;

/** Must match the hook. The last assertion in this file proves it still does. */
const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000;

type Reply = { data: unknown; error: { message: string } | null } | Error;

const ok = (acquired: boolean, lockedBy?: string): Reply => ({
  data: acquired
    ? { acquired: true }
    : { acquired: false, locked_by: lockedBy ?? null, expires_at: "2026-09-27T12:00:00Z" },
  error: null,
});
const bool = (v: boolean): Reply => ({ data: v, error: null });

const state = vi.hoisted(() => ({
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  acquire: [] as unknown[],
  heartbeat: [] as unknown[],
}));

vi.mock("@/hooks/core/useAuth", () => ({
  useAuth: () => ({
    session: { access_token: "header.judge.signature" },
    user: null,
    loading: false,
    signOut: async () => {},
  }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.calls.push({ fn, args });
      const queue =
        fn === "acquire_judge_lock" ? state.acquire
        : fn === "heartbeat_judge_lock" ? state.heartbeat
        : null;
      if (!queue || queue.length === 0) return { data: null, error: null };
      // The last entry repeats, so a script only has to say what changes.
      const reply = (queue.length > 1 ? queue.shift() : queue[0]) as Reply;
      if (reply instanceof Error) throw reply;
      return reply;
    },
  },
}));

const { useJudgingLock } = await import("@/hooks/judging/useJudgingLock");

const called = (fn: string) => state.calls.filter((c) => c.fn === fn);

let hidden = false;

/** Drives the real `visibilitychange` path inside `startVisibilityInterval`. */
function setHidden(next: boolean) {
  hidden = next;
  document.dispatchEvent(new Event("visibilitychange"));
}

/** Lets every queued promise settle, and fires any timer due within `ms`. */
async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function withHeldLock() {
  const view = renderHook(() => useJudgingLock(JUDGE_ID, ENTRY_ID, PHOTO_INDEX));
  await settle();
  expect(view.result.current.isLocked, "the hook never acquired the lock — the rest of this test proves nothing").toBe(true);
  return view;
}

beforeEach(() => {
  vi.useFakeTimers();
  state.calls.length = 0;
  state.acquire = [ok(true)];
  state.heartbeat = [bool(true)];
  hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useJudgingLock — the heartbeat reads its answer (R-63 / P10-J1)", () => {
  it("re-acquires when the heartbeat says the lock is not this judge's any more", async () => {
    state.acquire = [ok(true), ok(false, OTHER_JUDGE_ID)];
    state.heartbeat = [bool(false)];

    const view = await withHeldLock();
    expect(called("acquire_judge_lock")).toHaveLength(1);

    await settle(HEARTBEAT_INTERVAL_MS);
    await settle();

    expect(
      called("heartbeat_judge_lock"),
      "the heartbeat did not run at all, so this test is measuring nothing",
    ).toHaveLength(1);
    expect(
      called("acquire_judge_lock"),
      "heartbeat_judge_lock returned false — the lock row is another judge's — and the hook " +
        "did not go back and ask. It is still telling the judge they hold a round they do not.",
    ).toHaveLength(2);

    view.unmount();
  });

  it("shows the other judge, rather than a lock it does not have", async () => {
    state.acquire = [ok(true), ok(false, OTHER_JUDGE_ID)];
    state.heartbeat = [bool(false)];

    const view = await withHeldLock();
    await settle(HEARTBEAT_INTERVAL_MS);
    await settle();

    expect(view.result.current.isLocked, "the judge is still being told they hold the lock").toBe(false);
    expect(view.result.current.lockedByOther).toBe(true);
    expect(view.result.current.lockedByJudgeId).toBe(OTHER_JUDGE_ID);

    view.unmount();
  });

  it("re-acquires when the first heartbeat after the tab comes back fails", async () => {
    const view = await withHeldLock();

    // Hidden: the timer stops, which is P10's clause and the reason the lock
    // can expire underneath it.
    await act(async () => { setHidden(true); });
    await settle(HEARTBEAT_INTERVAL_MS * 3);
    expect(
      called("heartbeat_judge_lock"),
      "the heartbeat kept firing while the tab was hidden — P10's clause is not holding",
    ).toHaveLength(0);

    // Back, and the one tick whose whole job is to re-establish the claim
    // cannot reach the server. That is not evidence the lock is still ours.
    state.heartbeat = [new Error("Failed to fetch")];
    state.acquire = [ok(false, OTHER_JUDGE_ID)];

    await act(async () => { setHidden(false); });
    await settle();

    expect(
      called("heartbeat_judge_lock"),
      "no heartbeat fired on becoming visible, so nothing checked the lock",
    ).toHaveLength(1);
    expect(
      called("acquire_judge_lock"),
      "the first heartbeat after an unknown-length absence failed and the hook carried on as " +
        "though the lock were still held.",
    ).toHaveLength(2);
    expect(view.result.current.lockedByOther).toBe(true);
    expect(view.result.current.isLocked).toBe(false);

    view.unmount();
  });

  it("GUARD does not drop a present judge out of a round over one flaky request", async () => {
    const view = await withHeldLock();

    // Mid-session, tab visible throughout: a failed heartbeat costs at most the
    // remaining TTL and the next tick will say. Re-acquiring here would make a
    // transient network fault take a round away from someone working in it.
    state.heartbeat = [new Error("Failed to fetch")];

    await settle(HEARTBEAT_INTERVAL_MS);
    await settle();

    expect(called("heartbeat_judge_lock")).toHaveLength(1);
    expect(
      called("acquire_judge_lock"),
      "an ordinary interval tick failed and the hook re-acquired. That is the over-fix: it " +
        "turns one dropped request into a lost round for a judge who is demonstrably present.",
    ).toHaveLength(1);
    expect(view.result.current.isLocked).toBe(true);

    view.unmount();
  });

  it("GUARD leaves a healthy lock alone", async () => {
    const view = await withHeldLock();

    await settle(HEARTBEAT_INTERVAL_MS * 3);
    await settle();

    expect(called("heartbeat_judge_lock").length).toBeGreaterThanOrEqual(3);
    expect(
      called("acquire_judge_lock"),
      "the lock was confirmed held on every tick and the hook re-acquired anyway",
    ).toHaveLength(1);
    expect(view.result.current.isLocked).toBe(true);

    view.unmount();
  });

  it("GUARD the interval this file advances is the interval the hook uses", () => {
    // Without this, changing HEARTBEAT_INTERVAL_MS in the hook would make every
    // `settle(HEARTBEAT_INTERVAL_MS)` above fire nothing, and five tests would
    // go green while measuring an absence.
    const src = readFileSync(
      join(process.cwd(), "src/hooks/judging/useJudgingLock.ts"),
      "utf8",
    );
    const m = src.match(/const HEARTBEAT_INTERVAL_MS\s*=\s*([^;]+);/);
    expect(m, "HEARTBEAT_INTERVAL_MS is no longer declared where this test looks for it").toBeTruthy();
    const value = Number(Function(`"use strict";return (${m![1].replace(/_/g, "")})`)());
    expect(value).toBe(HEARTBEAT_INTERVAL_MS);
  });
});
