/**
 * Owner 2026-10-18 (app 1.2.23 on his phone): "autoplay with sound, like the Instagram app";
 * the player must start by itself in the app. The pure rules behind it (src/lib/video/playback.ts):
 *   • sound: app → with sound unless the member muted this session; web → muted until the
 *     member unmutes once, then with sound after a user activation; remembered for the session;
 *   • engine: hls.js wherever there is MSE (the Android WebView says "maybe" to HLS);
 *   • start: sound refused → muted, AbortError → once more, never a broken card;
 *   • one video at a time.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as pb from "../playback";

const { autoplayWithSound, pickHlsEngine, isAppleWebKit, startPlayback, getSoundPref, setSoundPref, resetSoundPref, claimPlayback, currentPlaybackId, resetPlayback } = pb;

beforeEach(() => { resetSoundPref?.(); resetPlayback(); });

describe("sound policy — the app (native)", () => {
  const app = { native: true, hasAudio: true, userActivated: false };
  it("autoplays WITH sound by default, even before any tap", () => expect(autoplayWithSound({ ...app, pref: null })).toBe(true));
  it("the member muted this session → muted", () => expect(autoplayWithSound({ ...app, pref: false })).toBe(false));
  it("a video with no audio track is never 'with sound'", () => expect(autoplayWithSound({ ...app, pref: null, hasAudio: false })).toBe(false));
});

describe("sound policy — the web (browser autoplay rule)", () => {
  const web = { native: false, hasAudio: true };
  it("muted by default", () => expect(autoplayWithSound({ ...web, pref: null, userActivated: true })).toBe(false));
  it("after the member unmuted once, later videos autoplay with sound once the page had a user activation", () =>
    expect(autoplayWithSound({ ...web, pref: true, userActivated: true })).toBe(true));
  it("…but not on a fresh page with no activation yet (the browser would refuse)", () =>
    expect(autoplayWithSound({ ...web, pref: true, userActivated: false })).toBe(false));
  it("a browser that cannot say (no navigator.userActivation) → try with sound; startPlayback falls back", () =>
    expect(autoplayWithSound({ ...web, pref: true, userActivated: null })).toBe(true));
  it("the member muted → muted", () => expect(autoplayWithSound({ ...web, pref: false, userActivated: true })).toBe(false));
});

describe("the session's sound choice", () => {
  it("starts unset, remembers on / off, and survives a re-read from sessionStorage", () => {
    expect(getSoundPref()).toBeNull();
    setSoundPref(true);
    expect(getSoundPref()).toBe(true);
    expect(sessionStorage.getItem("50mm.video.sound")).toBe("on");
    setSoundPref(false);
    expect(sessionStorage.getItem("50mm.video.sound")).toBe("off");
  });
  it("blocked storage never throws: memory only", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("SecurityError"); });
    expect(() => setSoundPref(true)).not.toThrow();
    expect(getSoundPref()).toBe(true);
    spy.mockRestore();
  });
});

describe("which HLS engine", () => {
  it("Android WebView / Chrome (canPlayType 'maybe' AND MSE) → hls.js, not the WebView's own player", () =>
    expect(pickHlsEngine({ nativeHls: true, mse: true, appleWebKit: false })).toBe("hlsjs"));
  it("desktop Chromium / Firefox (no native HLS, MSE) → hls.js", () => expect(pickHlsEngine({ nativeHls: false, mse: true, appleWebKit: false })).toBe("hlsjs"));
  it("iPhone / Safari (native HLS) → native, even with ManagedMediaSource", () => expect(pickHlsEngine({ nativeHls: true, mse: true, appleWebKit: true })).toBe("native"));
  it("native HLS but no MSE → native", () => expect(pickHlsEngine({ nativeHls: true, mse: false, appleWebKit: false })).toBe("native"));
  it("neither → none (the calm 'can't play' message)", () => expect(pickHlsEngine({ nativeHls: false, mse: false, appleWebKit: false })).toBe("none"));
  it("Apple WebKit detection", () => {
    const android = "Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36";
    expect(isAppleWebKit(android, "android")).toBe(false);
    expect(isAppleWebKit("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148")).toBe(true);
    expect(isAppleWebKit("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15")).toBe(true);
    expect(isAppleWebKit("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36")).toBe(false);
    expect(isAppleWebKit("anything", "ios")).toBe(true);
  });
});

/** A media element stand-in that records `muted` AT THE MOMENT play() is called. */
function media(outcomes: Array<"ok" | string>) {
  const calls: boolean[] = [];
  const listeners = new Map<string, () => void>();
  const m = {
    muted: true,
    calls,
    play: vi.fn(async () => {
      calls.push(m.muted);
      const o = outcomes.shift() ?? "ok";
      if (o !== "ok") throw Object.assign(new Error(o), { name: o });
    }),
    addEventListener: (t: string, f: () => void) => { listeners.set(t, f); },
    removeEventListener: (t: string) => { listeners.delete(t); },
    fire: (t: string) => listeners.get(t)?.(),
  };
  return m;
}

describe("startPlayback — never a broken card", () => {
  it("with sound: `muted` is false BEFORE play() is called (not left to a re-render)", async () => {
    const m = media(["ok"]);
    expect(await startPlayback(m, true)).toEqual({ ok: true, muted: false });
    expect(m.calls).toEqual([false]);
  });
  it("sound refused (NotAllowedError) → the same video starts muted", async () => {
    const m = media(["NotAllowedError", "ok"]);
    expect(await startPlayback(m, true)).toEqual({ ok: true, muted: true });
    expect(m.calls).toEqual([false, true]);
  });
  it("AbortError (the load it waited on was replaced) → once more when it can play", async () => {
    const m = media(["AbortError", "ok"]);
    const p = startPlayback(m, false, { abortRetryMs: 10_000 });
    await Promise.resolve(); await Promise.resolve();
    m.fire("canplay");
    expect(await p).toEqual({ ok: true, muted: true });
    expect(m.play).toHaveBeenCalledTimes(2);
  });
  it("refused even muted → { ok: false } with the reason (the card shows its Play button)", async () => {
    const m = media(["NotAllowedError", "NotAllowedError"]);
    expect(await startPlayback(m, true)).toEqual({ ok: false, error: "NotAllowedError" });
  });
  it("AbortError twice → gives up, no loop", async () => {
    const m = media(["AbortError", "AbortError"]);
    const p = startPlayback(m, false, { abortRetryMs: 1 });
    expect(await p).toEqual({ ok: false, error: "AbortError" });
    expect(m.play).toHaveBeenCalledTimes(2);
  });
});

describe("review #449: no retry for a card that no longer wants to play", () => {
  it("AbortError after the card was stopped (scrolled past / another card / paused) → no second play()", async () => {
    const m = media(["AbortError", "ok"]);
    let wanted = true;
    const p = startPlayback(m, true, { abortRetryMs: 10_000, stillWanted: () => wanted } as Parameters<typeof startPlayback>[2]);
    wanted = false; // paused while play() was pending
    await Promise.resolve(); await Promise.resolve();
    m.fire("canplay");
    expect(await p).toEqual({ ok: false, error: "AbortError" });
    expect(m.play).toHaveBeenCalledTimes(1);
  });
});

describe("one video at a time", () => {
  it("a second card claiming playback pauses the first", () => {
    const a = vi.fn(), b = vi.fn();
    claimPlayback("a", a);
    claimPlayback("b", b);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    expect(currentPlaybackId()).toBe("b");
  });
});

describe("controls timing", () => {
  it("the controls fade out 2–3 s after a tap", () => {
    expect(pb.CONTROLS_HIDE_MS).toBeGreaterThanOrEqual(2000);
    expect(pb.CONTROLS_HIDE_MS).toBeLessThanOrEqual(3000);
  });
});
