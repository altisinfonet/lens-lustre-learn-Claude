/** VID-7 / R-103 · Admin → Features, the pure rules and who may open the page. */
import { describe, it, expect } from "vitest";
import {
  FEATURE_MODES, describeHistory, featureErrorMessage, isDirty, modeLabel, modeSelectable, parseFeatureState, shortId,
} from "../featureSwitches";
import { canAccessTab, resolveAdminSubRoles } from "@/lib/adminRoleAccess";

describe("the Owner's three words (R-103)", () => {
  it("modes read Off / Selected members / All members, in that order", () => {
    expect(FEATURE_MODES.map((m) => m.label)).toEqual(["Off", "Selected members", "All members"]);
    expect(FEATURE_MODES.map((m) => m.mode)).toEqual(["off", "selected", "everyone"]);
  });
  it("modeLabel maps stored values and never throws on a stranger", () => {
    expect(modeLabel("everyone")).toBe("All members");
    expect(modeLabel("selected")).toBe("Selected members");
    expect(modeLabel(null)).toBe("—");
  });
});

describe("modeSelectable: copyright check is refused On without the key", () => {
  it("Off is always selectable", () => expect(modeSelectable("copyright_music_check", "off", false)).toBe(true));
  it("Selected / All are blocked when the key is not configured", () => {
    expect(modeSelectable("copyright_music_check", "selected", false)).toBe(false);
    expect(modeSelectable("copyright_music_check", "everyone", false)).toBe(false);
    expect(modeSelectable("copyright_music_check", "everyone", null)).toBe(false);
  });
  it("…and open once the key is there", () => expect(modeSelectable("copyright_music_check", "everyone", true)).toBe(true));
  it("other features do not depend on the key", () => {
    expect(modeSelectable("video_posts", "everyone", false)).toBe(true);
    expect(modeSelectable("video_ads", "selected", null)).toBe(true);
  });
});

describe("parseFeatureState", () => {
  const good = { feature: "video_posts", mode: "selected", note: "beta", updated_at: "2026-10-10T00:00:00Z", key_configured: null, members: [{ user_id: "u1", full_name: "A", username: "a", avatar_url: null, added_at: "x", note: null }], history: [{ at: "2026-10-10T00:00:00Z", actor: "u9", action: "mode", old: "off", new: "selected", user_id: null, note: null }] };
  it("reads a well-formed card", () => {
    const [c] = parseFeatureState([good]);
    expect(c).toMatchObject({ feature: "video_posts", mode: "selected", note: "beta" });
    expect(c.members).toHaveLength(1);
    expect(c.history).toHaveLength(1);
  });
  it("drops unknown features and unknown modes instead of guessing", () => {
    expect(parseFeatureState([{ ...good, feature: "free_money" }, { ...good, mode: "sometimes" }])).toEqual([]);
  });
  it("null / junk → no cards, no throw", () => {
    expect(parseFeatureState(null)).toEqual([]);
    expect(parseFeatureState({})).toEqual([]);
    expect(parseFeatureState([null, 5, "x"])).toEqual([]);
  });
  it("keeps key_configured only when it is a real boolean", () => {
    expect(parseFeatureState([{ ...good, feature: "copyright_music_check", key_configured: false }])[0].key_configured).toBe(false);
    expect(parseFeatureState([{ ...good, key_configured: "yes" }])[0].key_configured).toBeNull();
  });
});

describe("isDirty", () => {
  const s = { mode: "off" as const, note: null };
  it("unchanged → not dirty", () => expect(isDirty(s, "off", "")).toBe(false));
  it("mode changed → dirty", () => expect(isDirty(s, "everyone", "")).toBe(true));
  it("note changed → dirty; whitespace-only difference → not", () => {
    expect(isDirty(s, "off", "beta")).toBe(true);
    expect(isDirty({ mode: "off", note: "beta" }, "off", " beta ")).toBe(false);
  });
});

describe("error wording", () => {
  it("FEATURE-003 says the key is missing", () => expect(featureErrorMessage({ message: "FEATURE-003: the copyright music check cannot be turned on" })).toMatch(/music-API key/));
  it("FEATURE-001 → admin only", () => expect(featureErrorMessage({ message: "FEATURE-001: only an admin" })).toMatch(/Only an admin/));
  it("anything else is calm and generic, and leaks nothing", () => expect(featureErrorMessage({ message: "relation \"x\" does not exist" })).toBe("Couldn't save — try again."));
});

describe("history in plain words", () => {
  const who = (id: string | null) => (id === "u1" ? "Neil" : id === "u2" ? "Asha" : shortId(id));
  it("mode change", () => expect(describeHistory({ at: "t", actor: "u1", action: "mode", old: "off", new: "everyone", user_id: null, note: null }, who)).toBe("Neil changed it from Off to All members"));
  it("add / remove", () => {
    expect(describeHistory({ at: "t", actor: "u1", action: "add", old: null, new: "member", user_id: "u2", note: null }, who)).toBe("Neil added Asha");
    expect(describeHistory({ at: "t", actor: "u1", action: "remove", old: "member", new: null, user_id: "u2", note: null }, who)).toBe("Neil removed Asha");
  });
  it("a system row (no actor) is named system", () => expect(describeHistory({ at: "t", actor: null, action: "mode", old: "x", new: "off", user_id: null, note: null }, who)).toMatch(/^system /));
});

describe("who can open the Features page", () => {
  it("an admin can", () => expect(canAccessTab(resolveAdminSubRoles(["admin"]), "features")).toBe(true));
  for (const role of ["moderator", "finance", "content_editor", "judge"]) {
    it(`a ${role} cannot`, () => expect(canAccessTab(resolveAdminSubRoles([role]), "features")).toBe(false));
  }
});
