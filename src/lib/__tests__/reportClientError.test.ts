/**
 * FAILURES MUST BECOME COUNTABLE — AND MUST NEVER MAKE THINGS WORSE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Owner, 2026-08-05, after a day of members unable to post:
 *   "in entire day many of members unable to post complaining and you are just
 *    escaping?? Next time happened soo how to measure??"
 *   "what tracking you are follwoing, just i cant check is not the soltuion"
 *
 * He was right. Nothing recorded a single client-side failure, so every report
 * ended in "I can't check". Measured while investigating: the last successful
 * post was 04 Aug 18:27 UTC then ~8h of nothing, yet Postgres logs showed no
 * RLS or constraint errors, edge logs showed no 4xx/5xx, and a live probe of
 * s3-presign-upload returned 200 with a working PUT. The failure is
 * INTERMITTENT, so only recorded rows will ever explain it.
 *
 * THE CENTRAL TEST IN THIS FILE is `describeThrown` against message-less
 * values. "Unknown error" was never a description — it was the app admitting
 * it had thrown away the evidence. Every case below is a real shape that used
 * to render as those two words.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `vi.mock` is hoisted above every import, so the factory may not close over a
 * module-level `const`. `vi.hoisted` is the supported way to share one spy.
 */
const { rpc } = vi.hoisted(() => ({
  rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@/lib/native/authDeepLink", () => ({ isNativeCapacitorApp: () => false }));

import { describeThrown, reportClientError } from "../reportClientError";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

beforeEach(() => rpc.mockClear());

describe("describeThrown digs a real sentence out of anything", () => {
  it("uses a plain Error's message", () => {
    expect(describeThrown(new Error("boom"))).toContain("boom");
  });

  it("names a FunctionsFetchError even though it carries no useful message", () => {
    // This is the edge-worker cold-start failure that s3Upload.ts already
    // retries for — and the single most likely cause of the outage.
    const e: any = new Error("");
    e.name = "FunctionsFetchError";
    expect(describeThrown(e)).toContain("FunctionsFetchError");
  });

  it("surfaces a status code hidden on the error object", () => {
    const e: any = new Error("Edge Function returned a non-2xx status code");
    e.context = { status: 546 };
    expect(describeThrown(e)).toContain("546");
  });

  it("handles a storage-style plain object with statusCode and error", () => {
    expect(describeThrown({ statusCode: 413, error: "Payload too large" }))
      .toMatch(/413.*Payload too large|Payload too large.*413/);
  });

  it("handles a thrown string", () => {
    expect(describeThrown("just a string")).toBe("just a string");
  });

  it("says so when null or undefined is thrown", () => {
    expect(describeThrown(null)).toMatch(/null|undefined/);
    expect(describeThrown(undefined)).toMatch(/null|undefined/);
  });

  it("serialises an unknown object rather than giving up", () => {
    // The shape IS the evidence when there is nothing else.
    expect(describeThrown({ weird: true })).toContain("weird");
  });

  it("NEVER returns the empty string, for any of these", () => {
    // An empty description is what produced "Unknown error" in the first place.
    const shapes: unknown[] = [
      new Error(""), { }, [], 0, false, null, undefined, "", { message: "" },
      (() => { const e: any = new Error(""); e.name = "AbortError"; return e; })(),
    ];
    for (const s of shapes) {
      expect(describeThrown(s), `empty description for ${JSON.stringify(s)}`).not.toBe("");
    }
  });
});

describe("reporting never makes an incident worse", () => {
  it("does not throw when the RPC rejects", () => {
    rpc.mockImplementationOnce(() => Promise.reject(new Error("network down")));
    expect(() => reportClientError("post_create", new Error("x"))).not.toThrow();
  });

  it("does not throw when the client itself blows up", () => {
    rpc.mockImplementationOnce(() => { throw new Error("client exploded"); });
    expect(() => reportClientError("post_create", new Error("x"))).not.toThrow();
  });

  it("returns synchronously — the member's retry never waits on logging", () => {
    expect(reportClientError("post_create", new Error("x"))).toBeUndefined();
  });

  it("sends the kind, the message and the build", () => {
    (window as any).__APP_BUILD = "test-build";
    reportClientError("blank_page", new Error("kaboom"), { componentStack: "<Feed>" });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0] as any;
    expect(fn).toBe("log_client_error");
    expect(args._kind).toBe("blank_page");
    expect(args._message).toContain("kaboom");
    expect(args._app_build).toBe("test-build");
    expect(args._detail).toEqual({ componentStack: "<Feed>" });
  });

  it("drops a report it could not describe instead of writing junk", () => {
    // describeThrown never returns "", so this is belt and braces — but a row
    // with an empty message is worse than no row: it is a count with no lead.
    reportClientError("reply", new Error("real"));
    expect((rpc.mock.calls[0] as any)[1]._message).not.toBe("");
  });
});

describe("the three places failures actually happen are wired up", () => {
  /**
   * Read RAW, not comment-stripped — the usual `/*…*​/` strip silently ate the
   * assertion target here, because these files contain `/*` inside JSX and
   * regex literals and the non-greedy pair then spans real code. Comment
   * stripping exists so a test cannot pass by matching its own explanation, so
   * each string asserted below is one that cannot occur in prose: a call with
   * its opening argument, or an operator.
   */
  const strip = (s: string) => s;

  it("the composer records a failed post, and no longer says 'Unknown error'", () => {
    const src = strip(read("src/components/WallPosts.tsx"));
    expect(src).toContain('reportClientError("post_create"');
    expect(src).toContain("describeThrown(err)");
    // The literal that hid every real cause for a whole day.
    expect(src).not.toContain('|| "Unknown error"');
  });

  it("the error boundary records a blank page", () => {
    const src = strip(read("src/components/AppErrorBoundary.tsx"));
    expect(src).toContain('reportClientError("blank_page"');
    expect(src).toContain("componentStack");
  });

  it("the reply path records a failure AND tells the member why", () => {
    const src = strip(read("src/hooks/feed/useAddComment.ts"));
    expect(src).toContain('reportClientError("reply"');
    // It used to discard the error (`_err`) and raise a title with no body.
    expect(src).not.toMatch(/onError:\s*\(_err/);
    expect(src).toMatch(/description:\s*msg/);
  });
});

describe("the database side cannot be abused or read by members", () => {
  const sql = read("supabase/migrations/20260805030000_client_error_log.sql")
    .replace(/^\s*--.*$/gm, "")
    .replace(/--.*$/gm, "")
    .replace(/COMMENT ON[\s\S]*?;/g, "");

  it("is rate limited — a logger inside a retry loop must not amplify writes", () => {
    expect(sql).toMatch(/_recent >= 20/);
    expect(sql).toMatch(/_recent >= 200/);
  });

  it("never raises, whatever happens inside it", () => {
    expect(sql).toMatch(/EXCEPTION WHEN OTHERS THEN\s*\n?\s*RETURN;/);
  });

  it("accepts only the four known kinds", () => {
    expect(sql).toMatch(/_kind NOT IN \('post_create', 'reply', 'upload', 'blank_page'\)/);
  });

  it("has RLS on and grants members no direct table access", () => {
    expect(sql).toMatch(/ALTER TABLE public\.client_errors ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.client_errors FROM PUBLIC, anon, authenticated/);
  });

  it("lets a logged-out caller report a blank page", () => {
    // The crash the owner keeps reporting often happens before sign-in.
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.log_client_error[^;]*TO anon, authenticated/);
  });

  it("reading is admin-only", () => {
    expect(sql).toMatch(/has_role\(auth\.uid\(\), 'admin'::app_role\)/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.get_client_error_stats_admin\(integer\) FROM PUBLIC, anon/);
  });

  it("bounds every stored string", () => {
    expect(sql).toMatch(/left\(_message, 500\)/);
    expect(sql).toMatch(/left\(_url, 300\)/);
  });

  it("keeps 30 days, with a floor so nobody can delete the evidence", () => {
    expect(sql).toMatch(/GREATEST\(7, _days\)/);
    expect(sql).toMatch(/cron\.schedule\(\s*'prune-client-errors'/);
  });
});

describe("the owner can actually SEE it — 'just i cant check is not the soltuion'", () => {
  const panel = read("src/components/admin/ClientFailuresAudit.tsx");
  const health = read("src/components/admin/AdminHealth.tsx");

  it("is mounted in Admin Health, where he already looks", () => {
    expect(health).toContain("<ClientFailuresAudit />");
    expect(health).toContain('import ClientFailuresAudit from "@/components/admin/ClientFailuresAudit"');
  });

  it("reads through the admin-gated function, not the raw table", () => {
    expect(panel).toContain("get_client_error_stats_admin");
    expect(panel).not.toMatch(/from\("client_errors"\)/);
  });

  it("says 'no failures' in words rather than showing an empty box", () => {
    // "Nothing is failing" is a real answer and the one that redirects the
    // search. A blank panel would repeat the original sin.
    expect(panel).toContain("No client failures recorded");
  });

  it("labels each kind in plain words, not our internal names", () => {
    expect(panel).toContain('post_create: "Could not post"');
    expect(panel).toContain('blank_page: "Blank page / crash"');
  });

  it("shows the real message, the count and how many members", () => {
    expect(panel).toContain("{r.sample}");
    expect(panel).toContain("{r.occurrences}");
    expect(panel).toContain("{r.members}");
  });
});
