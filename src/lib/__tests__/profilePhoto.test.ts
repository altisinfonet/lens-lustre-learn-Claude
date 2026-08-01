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
import {
  isOwnProfilePhoto,
  isMissingPhotoError,
  PROFILE_PHOTO_REQUIRED_MESSAGE,
} from "@/lib/profilePhoto";

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

describe("isMissingPhotoError — the member has to be told WHY", () => {
  const rls = { code: "42501", message: "new row violates row-level security policy" };

  it("recognises the RLS refusal when the account has no own photo", () => {
    expect(isMissingPhotoError(rls, false)).toBe(true);
  });

  it("does NOT blame the photo when the account HAS one", () => {
    // A member with a real photo who hits an RLS error is being refused for a
    // different reason — banned, private post — and must not be told to upload
    // a photo they already have.
    expect(isMissingPhotoError(rls, true)).toBe(false);
  });

  it("ignores unrelated errors", () => {
    expect(isMissingPhotoError({ code: "23505", message: "duplicate key" }, false)).toBe(false);
    expect(isMissingPhotoError(null, false)).toBe(false);
    expect(isMissingPhotoError(undefined, false)).toBe(false);
  });

  it("matches on the message too, in case the code is absent", () => {
    expect(isMissingPhotoError({ message: "Row-level security policy violated" }, false)).toBe(true);
  });

  it("has a message that tells the member what to do", () => {
    expect(PROFILE_PHOTO_REQUIRED_MESSAGE).toMatch(/profile photo/i);
  });
});

describe("the SQL and the TypeScript must agree", () => {
  it("uses exactly the two patterns the migration uses", async () => {
    // If these drift apart, the UI lets someone through and the database then
    // refuses their post with no explanation. Read the migration and assert the
    // patterns are still the ones this module implements.
    const fs = await import("node:fs");
    const sql = fs.readFileSync(
      "supabase/migrations/20260801160000_require_own_profile_photo.sql",
      "utf-8",
    );
    expect(sql).toContain("'https://cdn.50mmretina.com/%'");
    expect(sql).toContain("'%/storage/v1/object/public/avatars/%'");
    // And that it is RESTRICTIVE — a PERMISSIVE policy would be ORed with the
    // existing ones and would enforce nothing at all.
    // Match the statement form (a line of its own), not the words in the
    // header comment — the comment explains WHY it is restrictive and would
    // otherwise inflate the count.
    expect((sql.match(/^AS RESTRICTIVE$/gm) || []).length).toBe(3);
    expect((sql.match(/^CREATE POLICY /gm) || []).length).toBe(3);
  });
});
