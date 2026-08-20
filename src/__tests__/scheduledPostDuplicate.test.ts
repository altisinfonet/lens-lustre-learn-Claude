/**
 * DUPLICATING A SCHEDULED POST MUST NOT DISCLOSE IT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RED-2, found by the Workstream 1 write-path audit on 2026-08-20.
 *
 * `ScheduledPostsList.handleDuplicate` built the copy as an inline object
 * literal. It listed six fields and omitted four: `media_ids`, `privacy`,
 * `indexing_disabled` and `categories`. `scheduled_posts` declares
 *
 *     privacy            NOT NULL DEFAULT 'public'
 *     indexing_disabled  NOT NULL DEFAULT false
 *     categories         NOT NULL DEFAULT '{}'
 *     media_ids          NULL
 *
 * so the copy of a PRIVATE, search-excluded, categorised post was scheduled
 * PUBLIC, indexable, uncategorised and legacy-only — and then published that
 * way by the cron publisher, hours later, with no member present to notice.
 *
 * Nothing failed. Nothing was logged. TypeScript was satisfied, because every
 * one of the four was optional on `CreateScheduledPostInput`.
 *
 * ⚠ THE PRIVACY DOWNGRADE IS THE SERIOUS ONE. The missing media_ids grow the
 * Phase 2 delta, which is a number in a report. A private photograph published
 * publicly cannot be un-seen.
 *
 * WHAT IS LOCKED HERE:
 *   • every field a member chose survives the copy, at each privacy level;
 *   • the copy is defined in ONE pure function, not inline in a component;
 *   • the input type makes omission a COMPILE error;
 *   • the hook REFUSES a payload missing a member choice rather than letting
 *     the table default decide it;
 *   • the fields describing what happened to the ORIGINAL are not inherited.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const ROOT = process.cwd();

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));

import {
  duplicateScheduledPostInput,
  assertCarriesMemberChoices,
  type ScheduledPost,
  type CreateScheduledPostInput,
} from "@/hooks/feed/useScheduledPosts";

const OWNER = "11111111-1111-4111-8111-111111111111";
const AT = "2026-09-01T10:00:00.000Z";
const NEXT = "2026-09-02T11:00:00.000Z";

function row(over: Partial<ScheduledPost> = {}): ScheduledPost {
  return {
    id: "sp-1",
    user_id: OWNER,
    content: "a caption with @[Someone](u2)",
    image_urls: ["https://cdn.50mmretina.com/post-images/o/posts/a.webp"],
    thumbnail_urls: ["https://cdn.50mmretina.com/post-images/o/posts/a-thumb.webp"],
    image_url: "https://cdn.50mmretina.com/post-images/o/posts/a.webp",
    tagged_user_ids: ["u2"],
    scheduled_for: AT,
    original_scheduled_for: AT,
    status: "pending",
    attempt_count: 0,
    shifted_count: 0,
    last_shift_reason: null,
    last_error: null,
    published_post_id: null,
    created_at: AT,
    updated_at: AT,
    categories: ["street"],
    privacy: "public",
    indexing_disabled: false,
    media_ids: ["m-1"],
    ...over,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE SIX REQUIRED BEHAVIOURAL CASES
   ═══════════════════════════════════════════════════════════════════════════ */

describe("RED-2 — duplicating a scheduled post preserves every member choice", () => {
  it("1. a PUBLIC post duplicates as public", () => {
    const out = duplicateScheduledPostInput(row({ privacy: "public" }), NEXT);
    expect(out.privacy).toBe("public");
  });

  it("2. a FRIENDS post duplicates as friends — not public", () => {
    const out = duplicateScheduledPostInput(row({ privacy: "friends" }), NEXT);
    expect(out.privacy).toBe("friends");
    expect(out.privacy, "the table default would silently widen this").not.toBe("public");
  });

  it("3. a PRIVATE post duplicates as private — the disclosure case", () => {
    /**
     * ⚠ THE ONE THAT MATTERS. Under RED-2 this assertion produced "public":
     * the field was omitted and `privacy NOT NULL DEFAULT 'public'` decided.
     */
    const out = duplicateScheduledPostInput(row({ privacy: "private" }), NEXT);
    expect(out.privacy).toBe("private");
    expect(out.privacy).not.toBe("public");
  });

  it("4. a CATEGORISED post keeps every category, in order", () => {
    const out = duplicateScheduledPostInput(
      row({ categories: ["street", "portrait", "monochrome"] }),
      NEXT,
    );
    expect(out.categories).toEqual(["street", "portrait", "monochrome"]);
  });

  it("5. a SEARCH-EXCLUDED post stays excluded", () => {
    const out = duplicateScheduledPostInput(row({ indexing_disabled: true }), NEXT);
    expect(out.indexing_disabled).toBe(true);
    expect(out.indexing_disabled, "the table default would re-expose it to crawlers").not.toBe(false);
  });

  it("6. a post WITH MEDIA keeps its registered media_objects", () => {
    /**
     * The copy shows the same photographs, so it must reference the same
     * verified objects. Dropping them is what makes the duplicate legacy-only
     * and grows the Phase 2 delta by one post per duplicate.
     */
    const out = duplicateScheduledPostInput(row({ media_ids: ["m-1", "m-2"] }), NEXT);
    expect(out.media_ids).toEqual(["m-1", "m-2"]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE REST OF THE PAYLOAD
   ═══════════════════════════════════════════════════════════════════════════ */

describe("RED-2 — the whole payload", () => {
  it("carries all ten fields, and only the time changes", () => {
    const source = row({
      privacy: "private",
      indexing_disabled: true,
      categories: ["street", "portrait"],
      media_ids: ["m-1", "m-2"],
    });
    const out = duplicateScheduledPostInput(source, NEXT);
    expect(out).toEqual({
      content: source.content,
      media_ids: ["m-1", "m-2"],
      image_urls: source.image_urls,
      thumbnail_urls: source.thumbnail_urls,
      image_url: source.image_url,
      tagged_user_ids: source.tagged_user_ids,
      scheduled_for: NEXT,
      privacy: "private",
      indexing_disabled: true,
      categories: ["street", "portrait"],
    });
    expect(out.scheduled_for).not.toBe(source.scheduled_for);
  });

  it("does NOT inherit the original's publishing history", () => {
    /**
     * A copy that inherited attempt_count: 3 would start three-quarters of the
     * way to max_shifts_exceeded. These describe what happened to the ORIGINAL.
     */
    const out = duplicateScheduledPostInput(
      row({ status: "failed", attempt_count: 3, shifted_count: 2, last_error: "boom", published_post_id: "p-9" }),
      NEXT,
    ) as Record<string, unknown>;
    for (const forbidden of [
      "status",
      "attempt_count",
      "shifted_count",
      "last_shift_reason",
      "last_error",
      "published_post_id",
      "original_scheduled_for",
      "id",
      "user_id",
      "created_at",
      "updated_at",
    ]) {
      expect(out[forbidden], `${forbidden} must not be copied onto a duplicate`).toBeUndefined();
    }
  });

  it("a legacy-only source duplicates as legacy-only, explicitly — not accidentally", () => {
    /**
     * `media_ids: null` is a legitimate answer for a row created before the
     * media write path. It must be SAID, not left out: the difference between
     * "this post has no registered media" and "somebody forgot the field" is
     * the whole of RED-2.
     */
    const out = duplicateScheduledPostInput(row({ media_ids: null }), NEXT);
    expect(out.media_ids).toBeNull();
    expect("media_ids" in out, "the key must be present even when the value is null").toBe(true);
  });

  it("survives a row whose optional arrays are absent", () => {
    const sparse = row({
      content: null,
      thumbnail_urls: null,
      categories: undefined,
      media_ids: null,
    });
    const out = duplicateScheduledPostInput(sparse, NEXT);
    expect(out.content).toBe("");
    expect(out.thumbnail_urls).toEqual([]);
    expect(out.categories).toEqual([]);
    expect(out.media_ids).toBeNull();
    // ⚠ privacy is NOT coerced. There is no safe default for it, so a source
    // row that lacks it must fail loudly at the hook, not quietly here.
    expect(out.privacy).toBe(sparse.privacy);
  });

  it("is index-aligned: as many thumbnails as images", () => {
    const out = duplicateScheduledPostInput(
      row({
        image_urls: ["a.webp", "b.webp", "c.webp"],
        thumbnail_urls: ["a-thumb.webp", "b-thumb.webp", "c-thumb.webp"],
      }),
      NEXT,
    );
    expect(out.thumbnail_urls).toHaveLength(out.image_urls.length);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE STRUCTURAL GUARDS
   ═══════════════════════════════════════════════════════════════════════════ */

describe("RED-2 — the shape that allowed it cannot come back", () => {
  const hook = readFileSync(join(ROOT, "src/hooks/feed/useScheduledPosts.ts"), "utf8");
  const list = readFileSync(join(ROOT, "src/components/post/ScheduledPostsList.tsx"), "utf8");

  it("every carried field is REQUIRED on CreateScheduledPostInput", () => {
    /**
     * The compile-time half of the fix. `privacy?: string` is what let the
     * omission through review — TypeScript had nothing to say about it.
     */
    const iface = hook.slice(
      hook.indexOf("export interface CreateScheduledPostInput {"),
      hook.indexOf("export function useCreateScheduledPost"),
    );
    expect(iface).toContain("media_ids: string[] | null;");
    expect(iface).toContain("privacy: string;");
    expect(iface).toContain("indexing_disabled: boolean;");
    expect(iface).toContain("categories: string[];");
    expect(iface).toContain("thumbnail_urls: string[];");
    expect(iface).toContain("tagged_user_ids: string[];");
    for (const optional of [
      "media_ids?",
      "privacy?",
      "indexing_disabled?",
      "categories?",
      "thumbnail_urls?",
      "tagged_user_ids?",
    ]) {
      expect(iface, `${optional} makes omission invisible again`).not.toContain(optional);
    }
  });

  it("the read type carries the fields a duplicate has to copy", () => {
    /**
     * The ROOT CAUSE. `ScheduledPost` did not declare privacy,
     * indexing_disabled or media_ids at all, so `p.privacy` would not have
     * compiled even if handleDuplicate's author had reached for it — while
     * `select("*")` had been returning all three the whole time.
     */
    const iface = hook.slice(
      hook.indexOf("export interface ScheduledPost {"),
      hook.indexOf("export function useScheduledPosts"),
    );
    expect(iface).toContain("privacy: string;");
    expect(iface).toContain("indexing_disabled: boolean;");
    expect(iface).toContain("media_ids: string[] | null;");
  });

  it("the insert applies NO defaults to a member's own choices", () => {
    /**
     * `privacy: input.privacy ?? "public"` is the same bug one layer down: it
     * turns a missing value into a permissive one, silently.
     */
    const body = hook.slice(hook.indexOf('.from("scheduled_posts")'), hook.indexOf("onSuccess"));
    expect(body).toContain("privacy: input.privacy,");
    expect(body).toContain("indexing_disabled: input.indexing_disabled,");
    expect(body).toContain("categories: input.categories,");
    expect(body).not.toContain('input.privacy ?? "public"');
    expect(body).not.toContain("input.indexing_disabled ?? false");
    expect(body).not.toContain("input.categories ?? []");
  });

  it("the hook refuses a payload that is missing a member choice", () => {
    expect(hook).toContain("assertCarriesMemberChoices(input);");
    expect(hook).toMatch(/function assertCarriesMemberChoices/);
  });

  it("the component no longer builds the copy itself", () => {
    const fn = list.slice(list.indexOf("const handleDuplicate"), list.indexOf("const handleCancel"));
    expect(fn).toContain("duplicate.mutateAsync(duplicateScheduledPostInput(p, next.toISOString()))");
    expect(
      /mutateAsync\(\s*\{/.test(fn),
      "an inline object literal is exactly the shape that dropped four fields",
    ).toBe(false);
  });

  it("nothing else in the app builds a scheduled-post payload inline", () => {
    /**
     * There are exactly two writers: the composer, which is creating something
     * NEW and legitimately supplies every field from the UI, and the duplicate
     * builder. A third would be a third chance to forget a field.
     */
    const composer = readFileSync(join(ROOT, "src/components/WallPosts.tsx"), "utf8");
    const call = composer.slice(
      composer.indexOf("createScheduled.mutateAsync"),
      composer.indexOf("createScheduled.mutateAsync") + 1400,
    );
    for (const field of [
      "media_ids:",
      "image_urls:",
      "thumbnail_urls:",
      "image_url:",
      "tagged_user_ids:",
      "scheduled_for:",
      "privacy:",
      "indexing_disabled:",
      "categories:",
      "content:",
    ]) {
      expect(call, `the composer must supply ${field} explicitly`).toContain(field);
    }

    /**
     * ⚠ PRESENCE OF THE KEY IS NOT ENOUGH — the same weak-assertion trap as
     * mutation 30 in the write-path harness, where `registerAllOrNone(` merely
     * appearing satisfied a test while the result was discarded. `media_ids:
     * null,` contains "media_ids:" and would have passed the loop above while
     * every scheduled post published legacy-only. Assert the BINDING.
     */
    expect(
      /media_ids:\s*await registerAllOrNone\(/.test(call),
      "the composer must REGISTER media for a scheduled post, not just mention the field — " +
        "the publisher runs hours later with no member and no session to derive ownership from.",
    ).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE RUNTIME REFUSAL — the layer the type system cannot provide
   ═══════════════════════════════════════════════════════════════════════════

   `CreateScheduledPostInput` stops the RED-2 shape being WRITTEN in TypeScript.
   It does not stop an `as any`, an untyped caller, or a row read from a source
   that genuinely lacks the column. In all three the field arrives `undefined`,
   the insert omits it, and the table default decides a member's privacy.
   ═══════════════════════════════════════════════════════════════════════════ */

describe("RED-2 — the hook refuses to let the database choose", () => {
  const complete = (): CreateScheduledPostInput => duplicateScheduledPostInput(row(), NEXT);

  it("accepts a complete payload", () => {
    expect(() => assertCarriesMemberChoices(complete())).not.toThrow();
  });

  it("accepts a legitimately empty payload — [] and null are answers", () => {
    expect(() =>
      assertCarriesMemberChoices({
        ...complete(),
        media_ids: null,
        categories: [],
        tagged_user_ids: [],
        thumbnail_urls: [],
        indexing_disabled: false,
      }),
    ).not.toThrow();
  });

  for (const field of [
    "privacy",
    "indexing_disabled",
    "categories",
    "image_urls",
    "thumbnail_urls",
    "tagged_user_ids",
    "media_ids",
  ] as const) {
    it(`REFUSES a payload with ${field} omitted`, () => {
      const bad = { ...complete() } as Record<string, unknown>;
      delete bad[field];
      expect(
        () => assertCarriesMemberChoices(bad as unknown as CreateScheduledPostInput),
        `${field} omitted must throw, not fall through to the table default`,
      ).toThrowError(new RegExp(field));
    });
  }

  it("REFUSES an empty privacy string — '' is not a choice either", () => {
    expect(() => assertCarriesMemberChoices({ ...complete(), privacy: "" })).toThrowError(/privacy/);
  });

  it("the refusal explains WHY, so the next reader does not just add a default", () => {
    try {
      assertCarriesMemberChoices({ ...complete(), privacy: undefined as unknown as string });
      throw new Error("should have thrown");
    } catch (e) {
      expect(String((e as Error).message)).toContain("RED-2");
      expect(String((e as Error).message)).toContain("private post");
    }
  });
});

describe("RED-2 — omission is a COMPILE error, not just a runtime one", () => {
  it("tsc rejects the exact call handleDuplicate used to make", () => {
    /**
     * ⚠ THE PROOF, NOT THE CLAIM. A comment saying "these are required now" is
     * satisfiable by prose. This compiles the RED-2 payload — the real six
     * fields, the real four omissions — against the real interface and asserts
     * the compiler refuses it. If someone re-adds `?`, this test goes red.
     */
    const dir = mkdtempSync(join(tmpdir(), "red2-"));
    const probe = join(dir, "probe.ts");
    writeFileSync(
      probe,
      `import type { CreateScheduledPostInput } from "${join(ROOT, "src/hooks/feed/useScheduledPosts")}";\n` +
        `// The literal that shipped: six fields, four omissions.\n` +
        `export const red2: CreateScheduledPostInput = {\n` +
        `  content: "",\n` +
        `  image_urls: [],\n` +
        `  thumbnail_urls: [],\n` +
        `  image_url: null,\n` +
        `  tagged_user_ids: [],\n` +
        `  scheduled_for: "2026-09-01T00:00:00Z",\n` +
        `};\n`,
    );

    let failed = false;
    let output = "";
    try {
      execFileSync(
        "npx",
        ["tsc", "--noEmit", "--strict", "--skipLibCheck", "--moduleResolution", "bundler", "--module", "esnext", "--target", "es2020", probe],
        { encoding: "utf8", stdio: "pipe", cwd: ROOT },
      );
    } catch (e) {
      failed = true;
      output = String((e as { stdout?: string }).stdout ?? "");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    expect(failed, "the RED-2 payload still compiles — a field has been made optional again").toBe(true);
    for (const field of ["privacy", "indexing_disabled", "categories", "media_ids"]) {
      expect(output, `tsc did not complain about the missing ${field}`).toContain(field);
    }
  }, 90_000);
});
