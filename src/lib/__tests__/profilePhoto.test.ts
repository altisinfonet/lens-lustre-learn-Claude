/**
 * Tests for "a Google account picture is not a profile photo".
 *
 * WHY THESE EXIST
 *   The profile photo was mandatory by owner policy for weeks and the rule was
 *   `!profile.avatar_url`. Google sign-in fills avatar_url with the member's
 *   Google picture before they touch anything, so the gate never opened.
 *   Measured on production 2026-08-01: 31 of 77 accounts had a
 *   lh3.googleusercontent.com URL as their "profile photo".
 *
 *   Every case below is a real shape from that production data, plus the ways
 *   an allowlist typically gets defeated.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isOwnProfilePhoto } from "@/lib/profilePhoto";

const CDN = "https://cdn.50mmretina.com/avatars/u/1754000000000-abc.webp";
const LEGACY =
  "https://jtdtehuqtinjxropkkcn.supabase.co/storage/v1/object/public/avatars/u/a.webp";
const GOOGLE = "https://lh3.googleusercontent.com/a/ACg8ocJ6P1PE_BBdugz7bvan";

describe("isOwnProfilePhoto — what counts", () => {
  it("accepts a photo uploaded to the CDN", () => {
    expect(isOwnProfilePhoto(CDN)).toBe(true);
  });

  it("accepts the older Supabase avatars bucket — those are real uploads too", () => {
    // Two live accounts still have these. Rejecting them would push members who
    // DID upload a photo back through the gate for no reason.
    expect(isOwnProfilePhoto(LEGACY)).toBe(true);
  });
});

describe("isOwnProfilePhoto — what does NOT count", () => {
  it("REJECTS a Google account picture — this is the whole bug", () => {
    expect(isOwnProfilePhoto(GOOGLE)).toBe(false);
  });

  it("rejects null, undefined and empty, without throwing", () => {
    expect(isOwnProfilePhoto(null)).toBe(false);
    expect(isOwnProfilePhoto(undefined)).toBe(false);
    expect(isOwnProfilePhoto("")).toBe(false);
    expect(isOwnProfilePhoto("   ")).toBe(false);
  });

  it("rejects a non-string, so a malformed row cannot pass the gate", () => {
    expect(isOwnProfilePhoto(123 as unknown as string)).toBe(false);
    expect(isOwnProfilePhoto({} as unknown as string)).toBe(false);
  });

  it("rejects any other external hotlink — allowlist, not denylist", () => {
    // The point of an allowlist: a provider nobody has thought about yet is
    // refused by default instead of quietly counting as a photo.
    for (const url of [
      "https://www.gravatar.com/avatar/abc123",
      "https://graph.facebook.com/v1/me/picture",
      "https://pbs.twimg.com/profile_images/1/x.jpg",
      "https://avatars.githubusercontent.com/u/1?v=4",
      "https://example.com/cdn.50mmretina.com/fake.webp",
    ]) {
      expect(isOwnProfilePhoto(url), url).toBe(false);
    }
  });

  it("cannot be spoofed by putting our host somewhere other than the start", () => {
    // startsWith, not includes — otherwise an attacker-controlled URL that
    // merely MENTIONS our CDN would pass.
    expect(isOwnProfilePhoto("https://evil.example/?u=https://cdn.50mmretina.com/x.webp")).toBe(false);
    expect(isOwnProfilePhoto("http://cdn.50mmretina.com/x.webp")).toBe(false); // http, not https
  });

  it("rejects a lookalike host", () => {
    expect(isOwnProfilePhoto("https://cdn.50mmretina.com.evil.example/x.webp")).toBe(false);
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT USED TO BE HERE, AND WHY IT IS GONE.
 *
 * A describe block pinned `isMissingPhotoError()` — the helper that turned a
 * bare Postgres 42501 into "Add a profile photo first". Owner order,
 * 2026-08-05:
 *
 *   "DP issues resolved. remove every block gate..."
 *   "Even is DP not uplaoded too still users can post antyhing like with DP
 *    users. simple"
 *
 * The helper and its message were deleted, so tests for them were deleted with
 * them rather than left importing names that no longer exist.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe("nothing may refuse a post or comment for a missing photo", () => {
  const lib = readFileSync("src/lib/profilePhoto.ts", "utf-8");
  const wall = readFileSync("src/components/WallPosts.tsx", "utf-8");
  const comment = readFileSync("src/hooks/feed/useAddComment.ts", "utf-8");

  it("the guess-from-an-RLS-error helper no longer exists", () => {
    // It matched ANY 42501 on an account with no UPLOADED photo. With the photo
    // policies dropped, the RESTRICTIVE policies left on posts / post_comments /
    // post_reactions are the "Banned users cannot …" ones — so this helper would
    // now tell a banned member to upload a photo, putting the removed wall back
    // in front of somebody it never applied to.
    expect(lib).not.toMatch(/export function isMissingPhotoError/);
    expect(lib).not.toMatch(/export const PROFILE_PHOTO_REQUIRED_MESSAGE/);
  });

  it("neither the composer nor the comment box can name a photo on failure", () => {
    // The member reads the real reason, whatever it is.
    expect(wall).not.toMatch(/isMissingPhotoError|PROFILE_PHOTO_REQUIRED_MESSAGE/);
    expect(wall).not.toMatch(/title: noPhoto \?/);
    expect(comment).not.toMatch(/isMissingPhotoError|PROFILE_PHOTO_REQUIRED_MESSAGE/);
  });

  it("keeps isOwnProfilePhoto — it is a definition, not a gate", () => {
    // Used to decide whether to OFFER a stand-in cartoon, and it is what the
    // rule is rebuilt from at ~1000 members. Deleting it would mean writing
    // the Google-picture allowlist again from scratch.
    expect(lib).toMatch(/export function isOwnProfilePhoto/);
  });
});

describe("the gate that was dropped stays dropped", () => {
  it("the drop migration removes all three RESTRICTIVE photo policies", () => {
    const created = readFileSync(
      "supabase/migrations/20260801160001_require_own_profile_photo.sql",
      "utf-8",
    );
    const dropped = readFileSync(
      "supabase/migrations/20260805060000_remove_profile_photo_gate.sql",
      "utf-8",
    );
    // Three were created…
    expect((created.match(/^AS RESTRICTIVE$/gm) || []).length).toBe(3);
    expect((created.match(/^CREATE POLICY /gm) || []).length).toBe(3);
    // …and all three are dropped again. Verified on production 2026-08-05:
    // zero policies anywhere reference has_profile_photo or avatar_url.
    expect((dropped.match(/^DROP POLICY IF EXISTS /gm) || []).length).toBe(3);
  });

  it("has_profile_photo() itself is kept, unused, for the ~1000-member return", () => {
    const dropped = readFileSync(
      "supabase/migrations/20260805060000_remove_profile_photo_gate.sql",
      "utf-8",
    );
    expect(dropped).not.toMatch(/DROP FUNCTION[^\n]*has_profile_photo/);
  });
});
