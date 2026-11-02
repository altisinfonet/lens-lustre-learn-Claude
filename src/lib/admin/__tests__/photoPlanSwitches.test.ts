/**
 * Photo plan · the Owner switches the new photos (`photo_set_v2`, U1a) and the
 * competition full-size deletion (`competition_fullsize_purge`, U6) himself, on
 * Admin → Features. Both rows exist in feature_access on both lanes (created
 * Off by 20261110_0100 / 0103), but the page drops any feature it does not
 * know — before this, neither had a card, so neither could be clicked.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FEATURE_INFO, parseFeatureState } from "@/lib/admin/featureSwitches";

const row = (feature: string) => ({ feature, mode: "off", note: null, updated_at: null, key_configured: null, members: [], history: [] });

describe("photo plan switches have Admin → Features cards", () => {
  it("photo_set_v2 and competition_fullsize_purge are known, with plain-words titles", () => {
    const got = parseFeatureState([row("photo_set_v2"), row("competition_fullsize_purge")]).map((s) => s.feature);
    expect(got).toEqual(["photo_set_v2", "competition_fullsize_purge"]);
    expect(FEATURE_INFO.photo_set_v2.title).toMatch(/new photos/i);
    expect(FEATURE_INFO.photo_set_v2.blurb).toMatch(/2048/);
    expect(FEATURE_INFO.competition_fullsize_purge.title).toMatch(/competition/i);
    expect(FEATURE_INFO.competition_fullsize_purge.blurb).toMatch(/30 days/);
  });

  it("Admin side menu · a Photos group whose two routes render the two switches", () => {
    const src = readFileSync(resolve(__dirname, "../../../pages/AdminPanel.tsx"), "utf8");
    const groups = src.slice(src.indexOf("const tabGroups = ["), src.indexOf("];", src.indexOf("const tabGroups = [")));
    expect(groups).toMatch(/\{\s*label:\s*"Photos",\s*items:\s*\[\s*\["new_photos",\s*"New Photos",\s*Image\],\s*\["competition_fullsize",\s*"Competition Full Size",\s*Trophy\],?\s*\]\s*as const\s*\}/);
    expect(src).toMatch(/currentRoute === "new_photos" && <LazyTab><AdminVideoFeature feature="photo_set_v2" \/><\/LazyTab>/);
    expect(src).toMatch(/currentRoute === "competition_fullsize" && <LazyTab><AdminVideoFeature feature="competition_fullsize_purge" \/><\/LazyTab>/);
    // admin only: no sub-role (moderator, finance, editor, judge) is given either route
    const access = readFileSync(resolve(__dirname, "../../adminRoleAccess.ts"), "utf8");
    const roles = access.slice(access.indexOf("const ROLE_TAB_ACCESS"));
    expect(roles).not.toMatch(/"new_photos"|"competition_fullsize"/);
  });
});
