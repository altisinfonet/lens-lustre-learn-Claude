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
import { stripComments } from "@/test-utils/sourceText";

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

/**
 * CODE ONLY — every block comment and // line stripped.
 *
 * Layout.tsx explains this rule at length, and the prose names `missingAvatar`,
 * `onboarding_skipped_at` and the old snooze key many times. A bare substring
 * search matches the EXPLANATION and reports the gate as present when it is
 * not. Same trap the mojibake scan fell into against its own documentation.
 */
const layoutCode = stripComments(layout);

/**
 * THE PROMPT WENT FURTHER THAN "DISMISSIBLE" — IT WENT AWAY.
 *
 * This block used to pin a middle design from 2026-08-05: a closable photo
 * modal with a sessionStorage snooze, so "remind me later" could never become
 * "never ask again". That design was superseded within the same day.
 *
 * The owner's FINAL NOTICE:
 *   "For DP dont block any users to post anything. But DP will be filled up as
 *    policy either uploaded by user or filled up by system based on the gender.
 *    BUt Final Notice : DONT BLOCK ANY USERS for DP to post - allow all"
 *
 * and then: "DP issues resolved. remove every block gate..."
 *
 * The database now hands every member one of our own cartoons in the same
 * INSERT that creates the profile (handle_new_user), and
 * trg_ensure_member_always_has_picture refuses any write that would blank it.
 * Verified on production 2026-08-05: members with no picture, 0 of 84.
 *
 * So there is nobody left to prompt, and Layout.tsx no longer opens the modal
 * for a missing photo at all — only for a missing username or member type,
 * which are structural and cannot be filled in by the system. That is stated
 * in PROFILE_PHOTO_POLICY.md §1c.
 *
 * These tests were therefore pinning a rule the owner had already replaced.
 * They are rewritten below to pin the CURRENT rule — and deliberately rewritten
 * in the STRICTER direction: the thing that must never come back is the gate,
 * so that is what is asserted.
 *
 * ⚠ ONE LEFTOVER, DELIBERATELY NOT TOUCHED: Layout.tsx still writes
 * PHOTO_PROMPT_SNOOZE_KEY in the modal's onDismiss. Nothing reads it, and
 * `dismissible={photoPromptOnly}` is now permanently false, so onDismiss can
 * never fire — the line is unreachable, not wrong. It is left alone rather than
 * cleaned up in passing, because this file is the P0 profile-photo path and
 * "never break what works" outranks tidiness. Flagged for the owner instead.
 */
describe("the photo prompt is gone, and the gate must never come back", () => {
  it("does not let a missing photo open the onboarding modal", () => {
    // The early return that ends the check counts ONLY the structural fields.
    // If missingAvatar is ever added back into it, a member without an
    // uploaded photo is pulled into an unskippable modal again — the exact
    // thing that stopped 32 of 83 members posting on 2026-08-01.
    const gate = layoutCode.match(
      /if \(profile\.onboarding_completed && ([^)]*)\)/,
    );
    expect(gate, "the onboarding gate condition moved — update this test").not.toBeNull();
    expect(gate![1]).toContain("!missingUserType");
    expect(gate![1]).toContain("!missingUsername");
    expect(gate![1], "a missing photo must not keep onboarding open").not.toContain("missingAvatar");
  });

  it("computes missingAvatar but deliberately does nothing with it", () => {
    // Kept on purpose: isOwnProfilePhoto is the single definition of "a photo
    // the member actually uploaded", and it is what the rule gets rebuilt from
    // at ~1000 members. Computed, voided, never acted on.
    expect(layoutCode).toMatch(/const missingAvatar = !isOwnProfilePhoto\(profile\.avatar_url\)/);
    expect(layoutCode).toMatch(/void missingAvatar;/);
  });

  it("keeps the modal unskippable, because only structural gaps open it now", () => {
    // Username and member type cannot be filled in by the system — the username
    // is part of the member's permanent public URL. So reaching the modal at
    // all means something the member alone can supply is missing.
    expect(layoutCode).toMatch(/setPhotoPromptOnly\(false\)/);
    expect(layoutCode).toMatch(/dismissible=\{photoPromptOnly\}/);
  });

  it("does NOT persist a dismissal anywhere durable", () => {
    // localStorage or a column would recreate the loophole that let accounts
    // exist without a photo before 2026-07-28. Still true, still pinned.
    expect(layoutCode).not.toMatch(/localStorage\.setItem\(PHOTO_PROMPT_SNOOZE_KEY/);
    expect(layoutCode).not.toMatch(/onboarding_skipped_at\s*:/);
    expect(layoutCode).not.toMatch(/update\([^)]*onboarding_skipped_at/);
  });

  it("has no client-side block on posting for a missing photo", () => {
    // The message half of the old gate was deleted too: it guessed "you have no
    // profile photo" from a bare Postgres 42501, which is now only ever a
    // "Banned users cannot ..." policy — so it would tell a banned member to
    // upload a photo. See PROFILE_PHOTO_POLICY.md §1d.
    // Comments stripped again: profilePhoto.ts names both symbols in a
    // "REMOVED 2026-08-05 — DO NOT BRING THEM BACK" note, and asserting on the
    // raw file matched that warning instead of real code.
    const profilePhotoCode = stripComments(read("src/lib/profilePhoto.ts"));
    expect(profilePhotoCode).not.toContain("PROFILE_PHOTO_REQUIRED_MESSAGE");
    expect(profilePhotoCode).not.toContain("isMissingPhotoError");
  });
});
