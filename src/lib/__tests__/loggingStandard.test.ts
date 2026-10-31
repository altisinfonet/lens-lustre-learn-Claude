/**
 * THE LOGGING STANDARD, PINNED.
 *
 * Owner, 2026-08-06: "Never write console.log(...)", "Never log secrets,
 * passwords, tokens, private keys, or sensitive personal data", "Add timing
 * around important operations", "Include the code in every log".
 *
 * These are behaviour tests on the real logger plus source pins on the files
 * that have been converted so far. The converted list grows as files are
 * converted; a file that has been converted can never silently regress to
 * console.log, because it is named here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn(() => Promise.resolve({ data: null, error: null })) },
}));
vi.mock("@/lib/native/authDeepLink", () => ({ isNativeCapacitorApp: () => false }));

import { logger, redact, timed, newCorrelationId, setLogUser } from "@/lib/logger";
import { supabase } from "@/integrations/supabase/client";

/**
 * Read a source file with COMMENTS STRIPPED.
 *
 * Without this, these tests fail on their own subject matter: logger.ts quotes
 * the owner's rule ("Never write console.log(...)") in its header, and a naive
 * text search cannot tell a quoted rule from a violation of it. Same technique
 * as stage-catalog-parity.test.ts and StoriesOwnerSpec.test.ts.
 */
const src = (rel: string) =>
  readFileSync(join(__dirname, "..", "..", rel), "utf8")
    // ONLY block comments that START a line.
    //
    // A naive /\*[\s\S]*?\*\/ eats real code: `accept="image/*"` in the post
    // composer opens a comment that the next genuine `*/` closes, and 20 000
    // characters of WallPosts.tsx vanished — including the very logs this
    // file is asserting. Caught by these tests failing on code that was
    // demonstrably present. Doc comments always start their own line, so
    // anchoring to ^ is both sufficient and safe.
    .replace(/^\s*\/\*[\s\S]*?\*\//gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/** Read a source file verbatim, comments intact. */
const srcRaw = (rel: string) => readFileSync(join(__dirname, "..", "..", rel), "utf8");

/**
 * Files converted to the standard. ADD a file here when you convert it.
 *
 * A file named here can never silently regress to console.log, and must keep
 * emitting logs that carry a catalog code. The list is deliberately explicit
 * rather than a glob: the codebase still holds ~100 unconverted console calls
 * (2026-08-06), and a glob would turn this file into 46 failures overnight
 * instead of a checklist that grows honestly.
 */
const CONVERTED_FILES = [
  "lib/logger.ts",
  "lib/errorCodes.ts",
  "components/feed/FeedStoriesBar.tsx",
  "components/profile/ProfileStories.tsx",
  "components/WallPosts.tsx",
  "hooks/feed/useCaptionMentions.ts",
  "hooks/feed/useCaptionHashtags.ts",
  "hooks/core/useAuth.tsx",
  "lib/networkTracer.ts",
  // Group A — member-facing, converted 2026-08-06
  "lib/imageUpload.ts",
  "lib/storageUpload.ts",
  "lib/imageCompression.ts",
  "lib/commentModeration.ts",
  "lib/profilePostHelper.ts",
  "lib/native/push.ts",
  "lib/native/appUpdate.ts",
  "lib/native/authDeepLink.ts",
  "hooks/feed/useAddComment.ts",
  "hooks/feed/useFeedQuery.ts",
  "pages/Index.tsx",
  "components/AppErrorBoundary.tsx",
  "components/GlobalSearch.tsx",
  "lib/fileSecurityScanner.ts",
  // Group B — judging and admin, converted 2026-08-06
  "hooks/judging/useJudgeActions.ts",
  "hooks/judging/decisionParityProbe.ts",
  "hooks/judging/useUnjudgedDriftMonitor.ts",
  "hooks/judging/usePhotoR4Award.ts",
  "hooks/judging/usePhotoPlacements.ts",
  "hooks/judging/usePhotoDecisions.ts",
  "hooks/judging/useJudgingLock.ts",
  "hooks/judging/useJudgeClassicData.ts",
  "hooks/judging/useGatedEntryStatus.ts",
  "lib/judgingApi.ts",
  "components/judge/CompleteRoundDialog.tsx",
  "components/admin/AdminHealth.tsx",
  "components/admin/AdminPageManagement.tsx",
  "components/admin/AdminGallery.tsx",
  "components/admin/JudgeUIvsDBGateAudit.tsx",
  "components/admin/AdminSEO.tsx",
  "components/admin/AdminPhotoOfDay.tsx",
  "components/admin/AdminMenuBuilder.tsx",
  "components/admin/AdminJudgeMonitoringPanel.tsx",
  "components/admin/AdminBanners.tsx",
  // Group C — misc, converted 2026-08-06. Conversion COMPLETE after these.
  "lib/adSlots.ts",
  "lib/adminLogger.ts",
  "lib/finalVoteTotals.ts",
  "lib/siteSettingsCache.ts",
  "lib/profileMapCache.ts",
  "lib/exifExtract.ts",
  "lib/safeAdminExecute.ts",
  "components/UserIdentityBlock.tsx",
  "pages/NotFound.tsx",
];

/** Files that must actually EMIT structured logs, not merely avoid console. */
const MUST_LOG = [
  "components/feed/FeedStoriesBar.tsx",
  "components/profile/ProfileStories.tsx",
  "components/WallPosts.tsx",
  "hooks/feed/useCaptionMentions.ts",
  "hooks/feed/useCaptionHashtags.ts",
  "hooks/core/useAuth.tsx",
  "lib/networkTracer.ts",
  "lib/imageUpload.ts",
  "lib/storageUpload.ts",
  "lib/imageCompression.ts",
  "lib/commentModeration.ts",
  "lib/profilePostHelper.ts",
  "lib/native/push.ts",
  "lib/native/appUpdate.ts",
  "lib/native/authDeepLink.ts",
  "hooks/feed/useAddComment.ts",
  "hooks/feed/useFeedQuery.ts",
  "pages/Index.tsx",
  "components/AppErrorBoundary.tsx",
  "components/GlobalSearch.tsx",
  "lib/fileSecurityScanner.ts",
  // Group B — judging and admin, converted 2026-08-06
  "hooks/judging/useJudgeActions.ts",
  "hooks/judging/decisionParityProbe.ts",
  "hooks/judging/useUnjudgedDriftMonitor.ts",
  "hooks/judging/usePhotoR4Award.ts",
  "hooks/judging/usePhotoPlacements.ts",
  "hooks/judging/usePhotoDecisions.ts",
  "hooks/judging/useJudgingLock.ts",
  "hooks/judging/useJudgeClassicData.ts",
  "hooks/judging/useGatedEntryStatus.ts",
  "lib/judgingApi.ts",
  "components/judge/CompleteRoundDialog.tsx",
  "components/admin/AdminHealth.tsx",
  "components/admin/AdminPageManagement.tsx",
  "components/admin/AdminGallery.tsx",
  "components/admin/JudgeUIvsDBGateAudit.tsx",
  "components/admin/AdminSEO.tsx",
  "components/admin/AdminPhotoOfDay.tsx",
  "components/admin/AdminMenuBuilder.tsx",
  "components/admin/AdminJudgeMonitoringPanel.tsx",
  "components/admin/AdminBanners.tsx",
  // Group C — misc, converted 2026-08-06. Conversion COMPLETE after these.
  "lib/adSlots.ts",
  "lib/adminLogger.ts",
  "lib/finalVoteTotals.ts",
  "lib/siteSettingsCache.ts",
  "lib/profileMapCache.ts",
  "lib/exifExtract.ts",
  "lib/safeAdminExecute.ts",
  "components/UserIdentityBlock.tsx",
  "pages/NotFound.tsx",
];

describe("rule: nothing sensitive ever leaves the device", () => {
  it("drops secret-looking keys entirely", () => {
    const out = redact({
      password: "hunter2",
      access_token: "eyJhbGciOi",
      apiKey: "sk-live-123",
      sessionId: "abc",
      cookie: "sb-auth=1",
      postId: "keep-me",
    }) as Record<string, unknown>;

    expect(out.password).toBe("[redacted]");
    expect(out.access_token).toBe("[redacted]");
    expect(out.apiKey).toBe("[redacted]");
    expect(out.sessionId).toBe("[redacted]");
    expect(out.cookie).toBe("[redacted]");
    // …but keeps the things that make a log useful
    expect(out.postId).toBe("keep-me");
  });

  it("masks e-mail addresses hidden inside free text", () => {
    const out = redact({ note: "failed for neil@example.com while posting" }) as Record<string, unknown>;
    expect(out.note).not.toContain("neil@example.com");
    expect(out.note).toContain("n***@example.com");
  });

  it("masks e-mails in the message itself, not just in detail", () => {
    logger.error({
      code: "DB-3002",
      event: "TEST_EMAIL_IN_MESSAGE",
      fn: "test",
      file: "loggingStandard.test.ts",
      message: "lookup failed for someone@gmail.com",
    });
    const call = (supabase.rpc as any).mock.calls.at(-1);
    expect(call[1]._message).not.toContain("someone@gmail.com");
  });

  it("survives circular objects instead of hanging", () => {
    const a: any = { name: "a" };
    a.self = a;
    expect(() => redact(a)).not.toThrow();
  });
});

describe("rule: the logger never becomes the incident", () => {
  beforeEach(() => {
    (supabase.rpc as any).mockClear();
  });

  it("does not throw when the database call itself throws", () => {
    (supabase.rpc as any).mockImplementationOnce(() => {
      throw new Error("network down");
    });
    expect(() =>
      logger.error({
        code: "DB-3001",
        event: "TEST_SINK_DOWN",
        fn: "test",
        file: "loggingStandard.test.ts",
        message: "sink is down",
      }),
    ).not.toThrow();
  });

  it("does not throw when the database call rejects", () => {
    (supabase.rpc as any).mockImplementationOnce(() => Promise.reject(new Error("rejected")));
    expect(() =>
      logger.error({
        code: "DB-3001",
        event: "TEST_SINK_REJECTS",
        fn: "test",
        file: "loggingStandard.test.ts",
        message: "sink rejects",
      }),
    ).not.toThrow();
  });
});

describe("rule: level policy — phones are not a data centre", () => {
  beforeEach(() => {
    (supabase.rpc as any).mockClear();
  });

  it("warn, error and fatal are persisted", () => {
    logger.warn({ code: "VAL-2001", event: "T", fn: "f", file: "x", message: "m" });
    logger.error({ code: "DB-3001", event: "T", fn: "f", file: "x", message: "m" });
    logger.fatal({ code: "SYS-9001", event: "T", fn: "f", file: "x", message: "m" });
    expect((supabase.rpc as any).mock.calls.length).toBe(3);
  });

  it("info, debug and trace are NOT persisted — they would bury the failures", () => {
    logger.info({ code: "POST-2004", event: "T", fn: "f", file: "x", message: "m" });
    logger.debug({ code: "POST-2004", event: "T", fn: "f", file: "x", message: "m" });
    logger.trace({ code: "POST-2004", event: "T", fn: "f", file: "x", message: "m" });
    expect((supabase.rpc as any).mock.calls.length).toBe(0);
  });
});

describe("rule: every persisted log answers the owner's questions", () => {
  beforeEach(() => {
    (supabase.rpc as any).mockClear();
  });

  it("carries code, event, function, file, reason, expected, actual and next step", () => {
    logger.error({
      code: "STORY-6001",
      event: "STORY_DELETE_MATCHED_NO_ROWS",
      fn: "handleDeleteOwn",
      file: "src/components/feed/FeedStoriesBar.tsx",
      message: "Deleting the member's own story",
      reason: "The delete returned zero rows.",
      expected: "Exactly one story row deleted",
      actual: "0 rows",
      recordId: "story-123",
      correlationId: "abcd1234",
      durationMs: 87,
    });

    const [rpcName, args] = (supabase.rpc as any).mock.calls.at(-1);
    expect(rpcName).toBe("log_app_event");
    expect(args._code).toBe("STORY-6001");
    expect(args._event).toBe("STORY_DELETE_MATCHED_NO_ROWS");
    expect(args._severity).toBe("error");
    expect(args._fn).toBe("handleDeleteOwn");
    expect(args._file).toContain("FeedStoriesBar.tsx");
    expect(args._reason).toContain("zero rows");
    expect(args._expected).toContain("one story row");
    expect(args._actual).toBe("0 rows");
    expect(args._duration_ms).toBe(87);
    expect(args._correlation_id).toBe("abcd1234");
    // next step falls back to the catalog's resolution when not given
    expect(args._next_step).toBeTruthy();
    expect(args._next_step.toLowerCase()).toContain("polic");
  });

  it("fills in the member automatically once auth has told the logger who is signed in", () => {
    setLogUser("member-42");
    logger.error({ code: "DB-3001", event: "T", fn: "f", file: "x", message: "m" });
    // userId travels in the printed payload; the DB derives it from auth.uid()
    // server-side, which is why it is not an RPC argument (a client could lie).
    const [, args] = (supabase.rpc as any).mock.calls.at(-1);
    expect(Object.keys(args)).not.toContain("_user_id");
    setLogUser(null);
  });
});

describe("rule: timing around important operations", () => {
  beforeEach(() => {
    (supabase.rpc as any).mockClear();
  });

  it("returns the value and records a duration on success", async () => {
    const value = await timed(
      { code: "POST-2004", event: "TEST_OK", fn: "f", file: "x", message: "m" },
      async () => "result",
    );
    expect(value).toBe("result");
  });

  it("RE-THROWS on failure — the logger never swallows a real error", async () => {
    await expect(
      timed({ code: "POST-2003", event: "TEST_FAIL", fn: "f", file: "x", message: "m" }, async () => {
        throw new Error("upload died");
      }),
    ).rejects.toThrow("upload died");

    const [, args] = (supabase.rpc as any).mock.calls.at(-1);
    expect(args._severity).toBe("error");
    expect(args._reason).toContain("upload died");
    expect(typeof args._duration_ms).toBe("number");
  });
});

describe("rule: correlation ids tie one action together without tracking anyone", () => {
  it("produces distinct short ids", () => {
    const a = newCorrelationId();
    const b = newCorrelationId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(3);
    expect(a.length).toBeLessThanOrEqual(8);
  });
});

describe("rule: no console.log in converted files", () => {
  it.each(CONVERTED_FILES)("%s uses the logger, never console.log", (rel) => {
    const code = src(rel);
    expect(code).not.toMatch(/(^|[^.\w])console\.log\s*\(/);
  });

  it("the logger's own console use is the transport, and is justified in comments", () => {
    // The justification lives in a comment, so this one reads the raw file…
    expect(srcRaw("lib/logger.ts")).toContain("the console IS the transport here");
    // …while the violation check reads the comment-stripped code.
    expect(src("lib/logger.ts")).not.toMatch(/(^|[^.\w])console\.log\s*\(/);
  });

  it("no converted file uses console.error/warn/info either — only the logger does", () => {
    for (const rel of MUST_LOG) {
      const code = src(rel);
      expect(code, `${rel} must route through the logger`).not.toMatch(
        /(^|[^.\w])console\.(error|warn|info|debug)\s*\(/,
      );
    }
  });
});

describe("rule: the converted files really do emit structured logs", () => {
  it.each(MUST_LOG)("%s imports the logger and emits at least one coded log", (rel) => {
    const code = src(rel);
    expect(code, `${rel} does not import the logger`).toMatch(/from "@\/lib\/logger"/);
    expect(code, `${rel} emits no log`).toMatch(/logger\.(trace|debug|info|warn|error|fatal)\s*\(/);
    // Every emitted log carries a code from the catalog.
    expect(code, `${rel} has a log with no code`).toMatch(/code:\s*"[A-Z]{2,6}-\d{4}"/);
  });

  it("every code used in converted source exists in the catalog", async () => {
    const { isKnownErrorCode } = await import("@/lib/errorCodes");
    for (const rel of MUST_LOG) {
      const used = [...src(rel).matchAll(/code:\s*"([A-Z]{2,6}-\d{4})"/g)].map((m) => m[1]);
      expect(used.length, `${rel} uses no codes`).toBeGreaterThan(0);
      for (const c of used) {
        expect(isKnownErrorCode(c), `${rel} uses ${c}, which is not in the catalog`).toBe(true);
      }
    }
  });

  it("the story-delete failure the owner reported is logged with its own code", () => {
    // 2026-08-05: "Once updated user unable to delete". The delete was working;
    // nothing recorded that it had matched zero rows. That must never again be
    // invisible, in either viewer.
    for (const rel of ["components/feed/FeedStoriesBar.tsx", "components/profile/ProfileStories.tsx"]) {
      expect(src(rel)).toContain("STORY-6001");
      expect(src(rel)).toContain("STORY_DELETE_MATCHED_NO_ROWS");
    }
  });

  it("the post pipeline logs entry, refusal, throw and success", () => {
    const code = src("components/WallPosts.tsx");
    expect(code).toContain("POST_CREATE_STARTED");
    expect(code).toContain("POST-2002"); // database refused
    expect(code).toContain("POST-2003"); // pipeline threw
    expect(code).toContain("POST_CREATED"); // success + duration
    expect(code).toMatch(/durationMs:/);
  });

  /**
   * OWNER DECISION, 2026-08-06: the network tracer is DEVELOPMENT ONLY.
   *
   * It shipped to production unguarded: it wrapped window.fetch, read every
   * API response body to the end just to measure it, and printed a 22-call
   * report into every member's console. The owner ruled "gate to dev AND
   * convert". These pins fail if any guard is removed.
   *
   * Verified as a real regression test: on main at d82f0ca — before the fix —
   * the first two of these fail, because main.tsx called startNetworkTrace()
   * bare and the file held no import.meta.env.DEV at all.
   */
  it("the network tracer is never started outside development", () => {
    const main = src("main.tsx");
    // Column 0 = module top level = nothing wraps it. An indented call is
    // inside a block, and the second assertion proves which block.
    expect(main, "main.tsx must not call startNetworkTrace() at module top level").not.toMatch(
      /^startNetworkTrace\s*\(/m,
    );
    expect(main, "main.tsx must gate startNetworkTrace() behind import.meta.env.DEV").toMatch(
      /import\.meta\.env\.DEV[\s\S]{0,200}startNetworkTrace\s*\(/,
    );
  });

  it("the tracer guards itself too, so a future call site cannot re-open it", () => {
    const code = src("lib/networkTracer.ts");
    // Both exported entry points return early outside development.
    const guards = code.match(/if\s*\(\s*!import\.meta\.env\.DEV\s*\)\s*return\s*;/g) || [];
    expect(guards.length, "startNetworkTrace and stopNetworkTrace must each guard").toBe(2);
  });

  it("the tracer only ever logs at debug, so it cannot reach the owner's Error Log", () => {
    const code = src("lib/networkTracer.ts");
    const levels = [...code.matchAll(/logger\.(\w+)\s*\(/g)].map((m) => m[1]);
    expect(levels.length, "the tracer emits no logs").toBeGreaterThan(0);
    expect([...new Set(levels)]).toEqual(["debug"]);
  });

  it("the tracer logs the endpoint, never the raw URL with its query string", () => {
    const code = src("lib/networkTracer.ts");
    // `url` is kept on window.API_TRACE for devtools, but must not travel in
    // a log's detail: the query string is where row ids and OAuth parameters
    // live.
    const logs = code.match(/logger\.debug\(\{[\s\S]*?\n  \}\);/g) || [];
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) {
      expect(l, "a tracer log carries the raw url").not.toMatch(/(^|[^.\w])url:/m);
    }
  });

  /**
   * WHAT A MEMBER WROTE IS NOT DIAGNOSTIC DATA.
   *
   * Until 2026-08-06 three call sites in commentModeration.ts ran
   * `console.log("MODERATION RESULT", { content: text, ... })` — the member's
   * actual sentence — and useAddComment.ts logged the entire moderation
   * response, which echoes it back. Being told your comment was rejected is
   * already a bad moment; recording the words adds nothing an investigation
   * needs.
   *
   * redact() does NOT protect against this: it drops keys that LOOK like
   * secrets, and "content" does not. The only rule that works is not passing
   * the text. These pins fail against main at f11eec1.
   */
  it("the member's comment text can never reach a log", () => {
    const code = src("lib/commentModeration.ts");
    expect(code, "the moderation log carries the comment itself").not.toMatch(/content:\s*text/);
    expect(code, "the moderation log carries the normalised comment").not.toMatch(
      /normalized:\s*(lower|normalized)\b/,
    );
    // What it must carry instead: the length, never the words.
    expect(code, "the moderation log should carry the text LENGTH").toMatch(/textLength:\s*text\.length/);
  });

  it("the AI moderation response is never logged — it echoes the comment back", () => {
    const code = src("hooks/feed/useAddComment.ts");
    expect(code).not.toMatch(/AI MODERATION RESPONSE/);
    // Only whether a decision arrived, never the decision payload.
    expect(code).toContain("CMNT-2103");
    // `res` must never be passed as a VALUE. A boolean derived from it —
    // Boolean(res?.error) — is fine and is the point: it says whether the
    // function objected without repeating what the member wrote.
    expect(code, "the raw response object must not travel in a log").not.toMatch(/:\s*res\s*[,}]/);
    expect(code, "the raw response object must not be the whole detail").not.toMatch(
      /detail:\s*res\b/,
    );
  });

  it("the global search box never logs what the member typed", () => {
    const code = src("components/GlobalSearch.tsx");
    expect(code).toContain("UI-8003");
    expect(code, "the search term must not be logged").not.toMatch(/(query|term|q):\s*q\b/);
    expect(code, "log the length instead").toMatch(/queryLength/);
  });

  it("a crashed route is FATAL and keeps BOTH sinks", () => {
    const code = src("components/AppErrorBoundary.tsx");
    // SYS-9002 was reserved for this earlier the same day.
    expect(code).toContain("SYS-9002");
    expect(code, "a dead screen is the most severe client event").toMatch(/logger\.fatal\(/);
    // The older Health screen the owner already reads must keep working.
    expect(code, "reportClientError must not be replaced by the logger").toContain(
      'reportClientError("blank_page"',
    );
  });

  /**
   * GROUP B, 2026-08-06 — judging and admin.
   *
   * Judging is not member-facing, but it is the least forgiving area here: a
   * lost or wrong score changes who wins, and unlike a failed upload nobody
   * notices at the time. These pin the two decisions that make the judging
   * logs worth having. Both fail against main at eb4743c.
   */
  it("a judge's whole save can be replayed from one correlation id", () => {
    const code = src("hooks/judging/useJudgeActions.ts");
    expect(code).toContain("newCorrelationId()");
    // Start, edge-write, failure, verify-missing and verify-ok must ALL carry
    // it, or "my score vanished" cannot be reconstructed.
    const logs: string[] = code.match(/logger\.\w+\(\{[\s\S]*?\n\s*\}\);/g) ?? [];
    const inSubmit = logs.filter((l) => l.includes('fn: "submitScore"'));
    expect(inSubmit.length, "submitScore should log start, write, failure and verify").toBeGreaterThanOrEqual(5);
    for (const l of inSubmit) {
      expect(l, "a submitScore log is missing correlationId").toContain("correlationId: saveCid");
    }
    // A write that cannot be read back is its own code — never folded into a
    // generic save failure.
    expect(code).toContain("JUDGE-6104");
    expect(code).toContain("JUDGE_SCORE_NOT_READABLE_AFTER_SAVE");
  });

  it("dev-only judging probes stay at debug and never reach the Error Log", () => {
    // Both files return early outside DEV. Their findings are developer
    // signals, not member incidents: at warn they would persist to
    // client_errors and bury real failures.
    for (const rel of [
      "hooks/judging/decisionParityProbe.ts",
      "hooks/judging/useUnjudgedDriftMonitor.ts",
    ]) {
      const code = src(rel);
      expect(code, `${rel} must keep its DEV guard`).toMatch(/import\.meta\.env\.DEV/);
      const levels = [...code.matchAll(/logger\.(\w+)\s*\(/g)].map((m) => m[1]);
      expect(levels.length, `${rel} emits no log`).toBeGreaterThan(0);
      expect([...new Set(levels)], `${rel} must only log at debug`).toEqual(["debug"]);
    }
  });

  /**
   * THE "Failed to create post" REPORT, 2026-08-06.
   *
   * A member saw `non-Error thrown: {"isTrusted":true}`. That is JSON.stringify
   * of a DOM Event, and it reached them because `reader.onerror = reject` hands
   * reject the ERROR EVENT — discarding `reader.error`, the DOMException whose
   * name is the actual cause. Fails against main at 8eaed75.
   */
  it("a FileReader failure must never reject with a raw Event", () => {
    const code = src("lib/fileSecurityScanner.ts");
    // The bare form throws away the only fact that explains the failure.
    expect(code, "reader.onerror = reject discards reader.error").not.toMatch(
      /reader\.onerror\s*=\s*reject\s*;/,
    );
    // It must reject with something that names itself, and log the exception.
    expect(code).toContain("FILE-5007");
    expect(code).toContain("reader.error");
    expect(code, "the exception name is the root cause and must be logged").toMatch(
      /exceptionName/,
    );
  });

  it("the file-read failure log carries what an investigation needs", () => {
    const code = src("lib/fileSecurityScanner.ts");
    for (const field of ["stage", "fileName", "fileSizeBytes", "mimeType", "userAgent"]) {
      expect(code, `FILE-5007 must record ${field}`).toContain(field);
    }
    expect(code, "a stage failure must be timed").toMatch(/durationMs:/);
  });

  /**
   * GROUP C, 2026-08-06 — the conversion is COMPLETE after this.
   *
   * These two pin the decisions that are easy to undo by accident.
   */
  it("ad tracking stays behind a DEV guard — it fires on ordinary scrolling", () => {
    const code = src("lib/adSlots.ts");
    // logger.debug never PRINTS in production, but emit() would still build and
    // redact the payload on every scroll event. Vite strips the guarded branch.
    const adLogs = [...code.matchAll(/logger\.debug\(\{[\s\S]*?code:\s*"(ADS-\d{4})"/g)];
    expect(adLogs.length, "adSlots should emit ADS-* debug logs").toBeGreaterThanOrEqual(5);
    // Every ADS log must sit inside an import.meta.env.DEV block.
    const guards = (code.match(/if\s*\(import\.meta\.env\.DEV\)\s*\{/g) || []).length;
    expect(guards, "every ADS log must be DEV-guarded").toBeGreaterThanOrEqual(5);
  });

  it("a failed profile lookup is distinguishable from a deleted account", () => {
    // Both render "Photographer" + a letter avatar. Bug 1 (2026-08-06) was
    // reported from exactly that appearance, so the two must never again be
    // indistinguishable in the log.
    const code = src("lib/profileMapCache.ts");
    expect(code).toContain("DB-3005");
    expect(code).toContain("PROFILE_MAP_BATCH_FAILED");
  });

  it("one user action shares one correlation id", () => {
    const code = src("components/WallPosts.tsx");
    expect(code).toContain("newCorrelationId()");
    // every log in createPost passes it
    const logs: string[] = code.match(/logger\.\w+\(\{[\s\S]*?\}\);/g) ?? [];
    const inCreatePost = logs.filter((l) => l.includes("fn: \"createPost\""));
    expect(inCreatePost.length).toBeGreaterThanOrEqual(5);
    for (const l of inCreatePost) {
      expect(l, "a createPost log is missing correlationId").toContain("correlationId");
    }
  });
});
