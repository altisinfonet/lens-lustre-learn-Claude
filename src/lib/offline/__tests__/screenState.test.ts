import { describe, it, expect } from "vitest";
import { screenState } from "@/lib/offline/screenState";

const net = { message: "TypeError: Failed to fetch" };
describe("what an empty screen says (S7b-4)", () => {
  it("saved data always shows", () => {
    expect(screenState({ hasData: true, loading: false, error: net, online: false })).toBe("show");
  });
  it("no network, or a network failure, is offline — never 'missing'", () => {
    expect(screenState({ hasData: false, loading: true, error: null, online: false })).toBe("offline");
    expect(screenState({ hasData: false, loading: false, error: null, online: true, paused: true })).toBe("offline");
    expect(screenState({ hasData: false, loading: false, error: net, online: true })).toBe("offline");
  });
  it("online: loading, then a real 'missing'", () => {
    expect(screenState({ hasData: false, loading: true, error: null, online: true })).toBe("loading");
    expect(screenState({ hasData: false, loading: false, error: null, online: true })).toBe("missing");
    expect(screenState({ hasData: false, loading: false, error: { message: "permission denied", code: "42501" }, online: true })).toBe("missing");
  });
});
