/**
 * THE PROFILE PHOTO IS A PROMPT NOW, NOT A WALL.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Owner decision, 2026-08-05, verbatim:
 *
 *   "Now allow everyone to post and to comment despite DP is there yes / no.
 *    But everytime if DP is not there ask to upload but if everytime ignores,
 *    no issues allow them to start post, comment, to post share all but on next
 *    opening again ask to upload DP.
 *    I step back from my policy but I will again push it once I have 1000
 *    members, I will wait till then."
 *
 * WHY HE STEPPED BACK — measured 2026-08-05: **32 of 83 active members (39%)**
 * had no uploaded photo and could not post OR comment at all. Four of them had
 * been posting before the rule landed on 2026-08-01 and were never told why it
 * stopped. A Google sign-in picture does not count, so members who believed
 * they had a photo were blocked too.
 *
 * THE GATE HAD TWO HALVES, and both had to come down:
 *   1. three RESTRICTIVE database policies (dropped — see
 *      supabase/migrations/20260805060000_remove_profile_photo_gate.sql);
 *   2. this unskippable client modal.
 *
 * These tests pin the SECOND half, and — most importantly — pin the shape of
 * "remind me later" so it can never quietly become "never ask again".
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const layout = read("src/components/Layout.tsx");
const modal = read("src/components/OnboardingModal.tsx");
const migration = read("supabase/migrations/20260805060000_remove_profile_photo_gate.sql")
  .replace(/^\s*--.*$/gm, "");

describe("the database no longer blocks anyone", () => {
  it("drops all three profile-photo policies", () => {
    expect(migration).toMatch(/DROP POLICY IF EXISTS "Profile photo required to create posts"\s+ON public\.posts;/);
    expect(migration).toMatch(/DROP POLICY IF EXISTS "Profile photo required to comment on posts"\s+ON public\.post_comments;/);
    expect(migration).toMatch(/DROP POLICY IF EXISTS "Profile photo required to comment"\s+ON public\.comments;/);
  });

  it("does NOT touch the banned-user policies", () => {
    // Lifting the photo rule must not become an amnesty. Verified on production
    // after applying: 6 "Banned users cannot …" policies, unchanged.
    expect(migration).not.toMatch(/Banned users cannot/);
  });

  it("keeps has_profile_photo(), because the rule returns at ~1000 members", () => {
    expect(migration).not.toMatch(/DROP FUNCTION[^\n]*has_profile_photo/);
  });
});

describe("the modal asks, and takes no for an answer", () => {
  it("can be dismissed only when it is told it may be", () => {
    expect(modal).toMatch(/dismissible\?: boolean;/);
    expect(modal).toMatch(/dismissible = false/);
  });

  it("still cannot be escaped or clicked away when NOT dismissible", () => {
    // The unskippable path is what pulls accounts with no username through.
    expect(modal).toMatch(/onPointerDownOutside=\{\(e\) => \{ if \(!dismissible\) e\.preventDefault\(\); \}\}/);
    expect(modal).toMatch(/onEscapeKeyDown=\{\(e\) => \{ if \(!dismissible\) e\.preventDefault\(\); \}\}/);
    expect(modal).toMatch(/dismissible \? "" : " \[&>button\]:hidden"/);
  });

  it("offers a visible way out, not just an X", () => {
    // A fix that cannot be SEEN is indistinguishable from no fix (standing rule).
    expect(modal).toContain("Not now — remind me later");
    expect(modal).toMatch(/\{dismissible && \(/);
  });
});

describe("'remind me later' can never become 'never ask again'", () => {
  it("the snooze is sessionStorage — gone on the next opening", () => {
    // localStorage or a database column would recreate the exact loophole that
    // let accounts exist without a photo before 2026-07-28.
    expect(layout).toMatch(/const PHOTO_PROMPT_SNOOZE_KEY = "dp_prompt_snoozed_v1";/);
    expect(layout).toMatch(/sessionStorage\.setItem\(PHOTO_PROMPT_SNOOZE_KEY, "1"\)/);
    expect(layout).toMatch(/sessionStorage\.getItem\(PHOTO_PROMPT_SNOOZE_KEY\)/);
  });

  it("does NOT persist the dismissal anywhere durable", () => {
    expect(layout).not.toMatch(/localStorage\.setItem\(PHOTO_PROMPT_SNOOZE_KEY/);
    // `onboarding_skipped_at` is NAMED in a comment as the old loophole; what
    // matters is that nothing WRITES it. Asserting on the bare word would match
    // that explanation — the exact trap the comment-stripping rule exists for.
    expect(layout).not.toMatch(/onboarding_skipped_at\s*:/);
    expect(layout).not.toMatch(/update\([^)]*onboarding_skipped_at/);
  });

  it("only the photo may be snoozed — a missing username still blocks", () => {
    expect(layout).toMatch(
      /const onlyPhotoMissing =\s*\n?\s*missingAvatar && !missingUserType && !missingUsername/,
    );
    // The snooze check is guarded by that flag, not applied to every case.
    const snoozeAt = layout.indexOf("if (sessionStorage.getItem(PHOTO_PROMPT_SNOOZE_KEY)) return;");
    const guardAt = layout.indexOf("if (onlyPhotoMissing) {");
    expect(guardAt).toBeGreaterThan(-1);
    expect(snoozeAt).toBeGreaterThan(guardAt);
  });

  it("a member with no photo is still ASKED — the prompt is not simply removed", () => {
    // The owner stepped back from blocking, not from asking.
    expect(layout).toMatch(/setPhotoPromptOnly\(onlyPhotoMissing\)/);
    expect(layout).toMatch(/dismissible=\{photoPromptOnly\}/);
  });

  it("private-browsing failures do not silently suppress the prompt", () => {
    // If sessionStorage throws, we show it rather than skip it.
    expect(layout).toMatch(/catch \{ \/\* private mode — just show it \*\/ \}/);
  });
});
