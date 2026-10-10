/** VID-1 §4.4 · feed rows → which posts are video posts, and which must be hidden. */
import { describe, it, expect } from "vitest";
import { toPostVideoMap, type PostVideoRow } from "../postVideoRead";

const row = (over: Partial<{ state: string; version: number; current: number; dur: number | string; w: number | null; h: number | null; videos: null }>= {}): PostVideoRow => ({
  post_id: "p1", video_id: "v1",
  videos: "videos" in over ? null : {
    id: "v1", state: over.state ?? "ready", current_version: over.current ?? 1,
    video_versions: [{ version_no: over.version ?? 1, width: over.w === undefined ? 1080 : over.w, height: over.h === undefined ? 1920 : over.h, declared_duration_s: over.dur ?? "12.40", has_audio: true }],
  },
});

describe("toPostVideoMap", () => {
  it("a ready video becomes a card with its shape and duration", () => {
    expect(toPostVideoMap([row()]).get("p1")).toEqual({ id: "v1", width: 1080, height: 1920, durationS: 12.4, hasAudio: true });
  });
  it("a post with NO post_videos row is simply absent: a photo or text post, untouched", () => {
    expect(toPostVideoMap([]).has("p1")).toBe(false);
  });
  for (const state of ["uploading", "checking", "music_blocked", "failed", "taken_down", "deleted"]) {
    it(`a ${state} video hides its post (never a text post)`, () => expect(toPostVideoMap([row({ state })]).get("p1")).toBe("hidden"));
  }
  it("RLS hid the video row (linked but not visible) → hidden", () => expect(toPostVideoMap([row({ videos: null })]).get("p1")).toBe("hidden"));
  it("no version row for the current version → hidden", () => expect(toPostVideoMap([row({ version: 2, current: 1 })]).get("p1")).toBe("hidden"));
  it("a nonsense duration → hidden", () => {
    expect(toPostVideoMap([row({ dur: "0" })]).get("p1")).toBe("hidden");
    expect(toPostVideoMap([row({ dur: "abc" })]).get("p1")).toBe("hidden");
  });
  it("unknown size stays playable (the card is 9:16 whatever the video)", () => {
    expect(toPostVideoMap([row({ w: null, h: null })]).get("p1")).toMatchObject({ width: null, height: null });
  });
});
