/**
 * THE PRIVACY CHOOSER STAYS OUT UNTIL THE CDN CAN KEEP THE PROMISE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Owner, 2026-08-16, holding a build before the FIRST PUBLIC release:
 *   "Final build give me after checking as it will in Public."
 *
 * The check that mattered, run against production rather than read from a plan
 * document:
 *
 *     select privacy, count(*) from posts   ->   public: 218, and nothing else
 *
 * The database honours a post's privacy. The feed honours it. Eight of the nine
 * surfaces in the Cross-Surface Visibility Invariant honour it. THE DIRECT
 * IMAGE URL DOES NOT: authorized media delivery (B5) is unfinished and the
 * Media-URL cell of that matrix is RED.
 *
 * Today that is harmless ONLY because every post is public, so nothing private
 * exists to leak. A public release is exactly the event that ends that. The
 * first member to choose "Private" would be handed a promise the platform
 * cannot keep — the photograph stays fetchable by anyone with the URL.
 *
 * A control that does not do what it says is worse than no control. So the
 * chooser is withheld, every post is public — which all 218 already are — and
 * nobody is told something untrue.
 *
 * ⚠ WHEN THIS TEST FAILS, DO NOT DELETE IT TO GET GREEN. It failing means
 * somebody restored the chooser. That is only correct once authorized media
 * delivery is LIVE and the Media-URL cell is green. Verify that first; then
 * remove this file in the same commit that restores the control, and say so in
 * the message.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test-utils/sourceText";

const src = stripComments(
  readFileSync(join(process.cwd(), "src/components/WallPosts.tsx"), "utf8"),
);

describe("a member cannot be offered a privacy the CDN will not honour", () => {
  it("does not render a privacy chooser in the composer", () => {
    // The chooser was a DropdownMenu whose items called setNewPrivacy.
    expect(
      /setNewPrivacy\(opt\.value\)/.test(src),
      "the privacy chooser is back — only correct once authorized media " +
        "delivery is live and the Media-URL cell is green",
    ).toBe(false);
  });

  it("does not map PRIVACY_OPTIONS into selectable menu items", () => {
    expect(/PRIVACY_OPTIONS\.map\(/.test(src)).toBe(false);
  });

  it("still carries privacy end to end, so restoring it is a one-line day", () => {
    // Withheld from the UI, NOT ripped out of the write path. The post is
    // created with `privacy: newPrivacy`, which defaults to public.
    expect(src).toContain("privacy: newPrivacy");
    expect(src).toMatch(/useState<Privacy>\(\s*["']public["']\s*\)/);
  });
});
