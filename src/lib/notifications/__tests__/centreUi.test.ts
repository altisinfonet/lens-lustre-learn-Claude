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

// ── the hook: reads the switch once per member, resets on a member change ──
import { renderHook, waitFor } from "@testing-library/react";
import { vi } from "vitest";

vi.mock("@/lib/siteSettingsCache", () => ({ readSiteSettingState: vi.fn() }));
import { readSiteSettingState } from "@/lib/siteSettingsCache";
import { useCentreUi } from "@/lib/notifications/centreUi";

describe("useCentreUi", () => {
  it("is false until read, true for a listed member, false for the next unlisted one", async () => {
    const read = vi.mocked(readSiteSettingState);
    read.mockResolvedValue({ known: true, value: { users: ["owner-id"] } });
    const { result, rerender } = renderHook(({ id }) => useCentreUi(id), { initialProps: { id: "owner-id" } });
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
    let resolveNext: (v: { known: boolean; value: unknown }) => void = () => {};
    read.mockReturnValue(new Promise((r) => { resolveNext = r; }) as never);
    rerender({ id: "someone-else" });
    expect(result.current).toBe(false);            // reset at once, not the previous member's answer
    resolveNext({ known: true, value: { users: ["owner-id"] } });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(result.current).toBe(false);
  });

  it("an unreadable switch is off", async () => {
    vi.mocked(readSiteSettingState).mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useCentreUi("owner-id"));
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBe(false);
  });
});
