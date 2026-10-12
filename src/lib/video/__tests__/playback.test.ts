/** VID-1 part 2 · the player's rules: in view → play, out of view → pause, slow → 240p, one at a time. */
import { describe, it, expect, beforeEach } from "vitest";
import {
  PAUSE_RATIO, PLAY_RATIO, TOKEN_REFRESH_MARGIN_S, claimPlayback, currentPlaybackId, leavePlayback, levelCap, releasePlayback, resetPlayback, shouldPlay, tokenNeedsRefresh,
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

/**
 * Review #415: the comments box plays a copy of the feed video, which pauses
 * the feed card; when the box closed, the feed card stayed paused.
 */
describe("a card paused by a newer one gets the say back when that one goes away", () => {
  beforeEach(resetPlayback);
  it("the newer card unmounts → the card it paused decides again (its own in-view rule)", () => {
    const resumed: string[] = [];
    claimPlayback("feed", () => {}, () => resumed.push("feed"));
    claimPlayback("overlay", () => {}, () => resumed.push("overlay"));
    leavePlayback("overlay");
    expect(resumed).toEqual(["feed"]);
    expect(currentPlaybackId()).toBeNull();
  });
  it("merely pausing the newer card hands nothing back (a tap on pause in the comments box must not start the video behind it)", () => {
    const resumed: string[] = [];
    claimPlayback("feed", () => {}, () => resumed.push("feed"));
    claimPlayback("overlay", () => {}, () => resumed.push("overlay"));
    releasePlayback("overlay");
    expect(resumed).toEqual([]);
    leavePlayback("overlay"); // and closing it afterwards still lets the feed card decide
    expect(resumed).toEqual(["feed"]);
  });
  it("the paused card playing again by itself forgets the hand-back", () => {
    const resumed: string[] = [];
    claimPlayback("feed", () => {}, () => resumed.push("feed"));
    claimPlayback("overlay", () => {}, () => resumed.push("overlay"));
    claimPlayback("feed", () => {}, () => resumed.push("feed")); // the member taps play on the feed card
    leavePlayback("overlay");
    expect(resumed).toEqual([]);
    expect(currentPlaybackId()).toBe("feed");
  });
  it("a real card's pause releases itself while being paused — the hand-back still works", () => {
    // FeedVideoCard's pause() calls releasePlayback(itself), which clears the
    // current holder in the middle of claimPlayback (caught by the card's own suite).
    const resumed: string[] = [];
    claimPlayback("feed", () => releasePlayback("feed"), () => resumed.push("feed"));
    claimPlayback("overlay", () => releasePlayback("overlay"), () => resumed.push("overlay"));
    expect(currentPlaybackId()).toBe("overlay");
    leavePlayback("overlay");
    expect(resumed).toEqual(["feed"]);
  });
  it("the paused card going away first leaves nothing to hand back", () => {
    const resumed: string[] = [];
    claimPlayback("feed", () => {}, () => resumed.push("feed"));
    claimPlayback("overlay", () => {}, () => resumed.push("overlay"));
    leavePlayback("feed");
    leavePlayback("overlay");
    expect(resumed).toEqual([]);
  });
});
