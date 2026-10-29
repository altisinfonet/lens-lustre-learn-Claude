/**
 * S11 judging · trackPosition ("where the judge was") must never become the
 * judge's BOOKMARK.
 *
 * Before: trackPosition wrote the shared positionRef + the bookmark's local
 * mirror, and the 30 s heartbeat flushed positionRef into last_entry_id /
 * last_photo_index — the bookmark columns. Wiring it into JudgePanel (the S11
 * finding "trackPosition not wired") would have moved every judge's
 * intentional bookmark to whatever photo they last looked at
 * (JudgePanel.tsx: "bookmark is intentional-only").
 *
 * After: the ambient position lives in its own local key, is never sent to the
 * database, and is offered for resume only when there is no bookmark — and only
 * when the `judge_resume_ambient` switch is on (JudgePanel; no row = OFF).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";

const COMP = "c0c0c0c0-0000-4000-8000-000000000001";
const JUDGE = "a1a1a1a1-0000-4000-8000-000000000002";
const SESSION = { id: "s1", judge_id: JUDGE, competition_id: COMP, round_id: null, last_entry_id: null, last_entry_index: 0, last_photo_index: 0, elapsed_seconds: 0, status: "active", heartbeat_at: "2026-10-29T00:00:00Z" };

const { updates } = vi.hoisted(() => ({ updates: [] as Record<string, unknown>[] }));
vi.mock("@/integrations/supabase/client", () => {
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {};
    for (const k of ["select", "eq", "order", "limit"]) c[k] = () => c;
    c.maybeSingle = async () => result;
    c.single = async () => result;
    c.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(r);
    return c;
  };
  return {
    supabase: {
      from: () => ({
        select: () => chain({ data: { ...SESSION }, error: null }),
        update: (patch: Record<string, unknown>) => { updates.push(patch); return chain({ data: null, error: null }); },
        insert: () => chain({ data: { ...SESSION }, error: null }),
      }),
      auth: { getSession: async () => ({ data: { session: null } }) },
    },
  };
});

import { useJudgeSession, readAmbientPosition, resumeTarget } from "@/hooks/judging/useJudgeSession";

const wrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe("trackPosition is ambient, never the bookmark", () => {
  beforeEach(() => { updates.length = 0; localStorage.clear(); vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(() => { vi.useRealTimers(); });

  it("tracking a photo writes only the ambient key — no bookmark mirror, no database write, even after heartbeats", async () => {
    const { result } = renderHook(() => useJudgeSession(COMP, JUDGE), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.session?.id).toBe("s1"));
    act(() => result.current.trackPosition("entry-9", 4, 2));
    expect(readAmbientPosition(COMP)).toMatchObject({ entry_id: "entry-9", entry_index: 4, photo_index: 2 });
    expect(localStorage.getItem(`judge_resume_${COMP}_session`)).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(95_000); });
    expect(updates.length).toBeGreaterThan(0); // heartbeats did run
    for (const u of updates) expect(u).not.toHaveProperty("last_entry_id");
    expect(result.current.hasResumeData).toBe(false); // ambient is not "a bookmark to resume"
  });

  it("a real bookmark still goes to the database and wins over the ambient position", async () => {
    const { result } = renderHook(() => useJudgeSession(COMP, JUDGE), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.session?.id).toBe("s1"));
    act(() => result.current.trackPosition("entry-9", 4, 2));
    await act(async () => { await result.current.bookmark("entry-3", 1, 0); });
    expect(updates.some((u) => u.last_entry_id === "entry-3")).toBe(true);
  });
});

describe("resumeTarget — what the resume dialog offers", () => {
  const amb = { entry_id: "e-amb", entry_index: 7, photo_index: 1, ts: 1 };
  it("a bookmark always wins", () => {
    expect(resumeTarget({ ...SESSION, last_entry_id: "e-bm", last_photo_index: 3 }, amb, true)).toEqual({ kind: "bookmark", entryId: "e-bm", entryIndex: 0, photoIndex: 3 });
  });
  it("no bookmark + switch ON → the ambient position", () => {
    expect(resumeTarget(SESSION, amb, true)).toEqual({ kind: "ambient", entryId: "e-amb", entryIndex: 7, photoIndex: 1 });
  });
  it("no bookmark + switch OFF (live default) → nothing, exactly as today", () => {
    expect(resumeTarget(SESSION, amb, false)).toBeNull();
  });
  it("a completed session offers nothing", () => {
    expect(resumeTarget({ ...SESSION, status: "completed", last_entry_id: "e-bm" }, amb, true)).toBeNull();
  });
});

describe("JudgePanel wiring", () => {
  const src = readFileSync(join(process.cwd(), "src/pages/JudgePanel.tsx"), "utf8");
  it("calls trackPosition only when the judge_resume_ambient switch is on", () => {
    expect(src).toMatch(/JUDGE_AMBIENT_KEY/);
    expect(src).toMatch(/const \{ trackPosition \} = session;[\s\S]{0,200}if \(!ambientOn[^)]*\) return;[\s\S]{0,300}trackPosition\(/);
  });
  it("an unanswered switch read counts as OFF after a short cap (never leaves the resume check open)", () => {
    expect(src).toMatch(/setTimeout\(\(\) => \{ if \(live\) setAmbientOn\(\(prev\) => prev \?\? false\); \}, AMBIENT_READ_CAP_MS\)/);
    expect(src).toMatch(/const AMBIENT_READ_CAP_MS = 3_000;/);
  });
  it("decides the resume offer through resumeTarget", () => {
    expect(src).toMatch(/resumeTarget\(session\.session, readAmbientPosition\(session\.session\.competition_id\), ambientOn === true\)/);
  });
});
