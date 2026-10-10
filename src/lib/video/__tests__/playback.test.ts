/** VID-1 part 2 · the player's rules: in view → play, out of view → pause, slow → 240p, one at a time. */
import { describe, it, expect, beforeEach } from "vitest";
import {
  PAUSE_RATIO, PLAY_RATIO, TOKEN_REFRESH_MARGIN_S, claimPlayback, currentPlaybackId, levelCap, releasePlayback, resetPlayback, shouldPlay, tokenNeedsRefresh,
} from "../playback";

const base = { ratio: 1, wasPlaying: false, tabVisible: true, online: true, reducedMotion: false };

describe("shouldPlay", () => {
  it("fully in view → plays", () => expect(shouldPlay(base)).toBe(true));
  it("out of view → does not play", () => expect(shouldPlay({ ...base, ratio: 0 })).toBe(false));
  it("just under the start threshold → does not start", () => expect(shouldPlay({ ...base, ratio: PLAY_RATIO - 0.01 })).toBe(false));
  it("exactly at the start threshold → starts", () => expect(shouldPlay({ ...base, ratio: PLAY_RATIO })).toBe(true));
  it("already playing keeps playing between the two thresholds (no flicker)", () => {
    expect(shouldPlay({ ...base, ratio: 0.45, wasPlaying: true })).toBe(true);
    expect(shouldPlay({ ...base, ratio: 0.45, wasPlaying: false })).toBe(false);
  });
  it("already playing pauses below the pause threshold", () => expect(shouldPlay({ ...base, ratio: PAUSE_RATIO - 0.01, wasPlaying: true })).toBe(false));
  it("a hidden tab never plays, however visible the card", () => expect(shouldPlay({ ...base, tabVisible: false, wasPlaying: true })).toBe(false));
  it("offline never plays", () => expect(shouldPlay({ ...base, online: false })).toBe(false));
  it("reduced-motion members get no autoplay", () => expect(shouldPlay({ ...base, reducedMotion: true })).toBe(false));
});

describe("levelCap", () => {
  const levels = [{ height: 720, bitrate: 900_000 }, { height: 240, bitrate: 280_000 }, { height: 480, bitrate: 520_000 }];
  it("fast network: no cap", () => expect(levelCap(levels, false)).toBe(Infinity));
  it("slow network: only the 240p level, wherever it sits in the list", () => expect(levelCap(levels, true)).toBe(1));
  it("slow, sorted by bitrate: level 0", () => expect(levelCap([{ height: 240 }, { height: 480 }, { height: 720 }], true)).toBe(0));
  it("slow, no levels yet → no cap rather than a wrong index", () => expect(levelCap([], true)).toBe(Infinity));
  it("slow, equal heights → the lower bitrate", () => expect(levelCap([{ height: 240, bitrate: 400 }, { height: 240, bitrate: 300 }], true)).toBe(1));
});

describe("tokenNeedsRefresh", () => {
  it("no token → needs one", () => expect(tokenNeedsRefresh(null, 1000)).toBe(true));
  it("plenty of time left → keep", () => expect(tokenNeedsRefresh(1000 + 600, 1000)).toBe(false));
  it("inside the margin → refresh", () => expect(tokenNeedsRefresh(1000 + TOKEN_REFRESH_MARGIN_S, 1000)).toBe(true));
  it("one second outside the margin → keep", () => expect(tokenNeedsRefresh(1000 + TOKEN_REFRESH_MARGIN_S + 1, 1000)).toBe(false));
  it("expired → refresh", () => expect(tokenNeedsRefresh(900, 1000)).toBe(true));
});

describe("one card plays at a time", () => {
  beforeEach(resetPlayback);
  it("claiming pauses the previous card, and only that one", () => {
    const paused: string[] = [];
    claimPlayback("a", () => paused.push("a"));
    claimPlayback("b", () => paused.push("b"));
    expect(paused).toEqual(["a"]);
    expect(currentPlaybackId()).toBe("b");
  });
  it("re-claiming the same card does not pause itself", () => {
    const paused: string[] = [];
    claimPlayback("a", () => paused.push("a"));
    claimPlayback("a", () => paused.push("a"));
    expect(paused).toEqual([]);
  });
  it("a card that stopped releases, so the next claim pauses nothing", () => {
    const paused: string[] = [];
    claimPlayback("a", () => paused.push("a"));
    releasePlayback("a");
    claimPlayback("b", () => paused.push("b"));
    expect(paused).toEqual([]);
  });
  it("a stale release (not the current card) changes nothing", () => {
    claimPlayback("a", () => {});
    claimPlayback("b", () => {});
    releasePlayback("a");
    expect(currentPlaybackId()).toBe("b");
  });
});
