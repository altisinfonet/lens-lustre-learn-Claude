import { describe, it, expect } from "vitest";
import { isCentreUiOn } from "@/lib/notifications/centreUi";

describe("notification centre UI switch (site_settings notif_centre_ui)", () => {
  it('"on" is on for everyone', () => {
    expect(isCentreUiOn("on", "u1")).toBe(true);
    expect(isCentreUiOn("on", null)).toBe(true);
  });
  it("a members list is on only for those members (staged rollout)", () => {
    const v = { users: ["owner-id", "u2"] };
    expect(isCentreUiOn(v, "owner-id")).toBe(true);
    expect(isCentreUiOn(v, "someone-else")).toBe(false);
    expect(isCentreUiOn(v, null)).toBe(false);
  });
  it("anything else is off (no row, unknown shapes, wrong types)", () => {
    for (const v of [null, undefined, "", "off", "ON", true, 1, {}, { users: "owner-id" }, { users: [1] }, []]) {
      expect(isCentreUiOn(v as unknown, "owner-id")).toBe(false);
    }
  });
});
