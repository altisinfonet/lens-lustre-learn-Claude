/**
 * Owner 18 Nov 2026 — photography phrases above the comment box, in the
 * member's language, editable by admins (site_settings comment_suggestions).
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_SUGGESTIONS, MAX_PHRASE_LENGTH, MAX_SUGGESTIONS, readSuggestions, suggestionTexts,
} from "@/lib/comments/photoSuggestions";

describe("photography comment suggestions", () => {
  it("the standard list is photography wording, in all 7 languages", () => {
    expect(DEFAULT_SUGGESTIONS.phrases.length).toBe(8);
    for (const p of DEFAULT_SUGGESTIONS.phrases) {
      for (const l of ["en", "hi", "bn", "mr", "gu", "ta", "te"] as const) expect(p[l], `${p.en} / ${l}`).toBeTruthy();
    }
    expect(suggestionTexts(DEFAULT_SUGGESTIONS, "en")).toContain("Great composition 👏");
    expect(suggestionTexts(DEFAULT_SUGGESTIONS, "bn")).toContain("দারুণ আলো ✨");
  });

  it("nothing saved, or something broken saved → the standard list, never an empty or crashing row", () => {
    for (const bad of [null, undefined, "x", 3, {}, { phrases: "no" }]) expect(readSuggestions(bad)).toBe(DEFAULT_SUGGESTIONS);
  });

  it("an admin's list is cleaned: English required, trimmed, capped in length and count", () => {
    const long = "x".repeat(80);
    const s = readSuggestions({
      enabled: true,
      phrases: [{ en: "  Nice light  ", bn: " সুন্দর আলো " }, { bn: "no english" }, { en: long }, ...Array(20).fill({ en: "More" })],
    });
    expect(s.phrases[0]).toEqual({ en: "Nice light", bn: "সুন্দর আলো" });
    expect(s.phrases[1].en.length).toBe(MAX_PHRASE_LENGTH);
    expect(s.phrases.length).toBe(MAX_SUGGESTIONS);
  });

  it("a language without its own text falls back to English; switched off shows none", () => {
    const s = readSuggestions({ enabled: true, phrases: [{ en: "Nice light", bn: "সুন্দর আলো" }] });
    expect(suggestionTexts(s, "bn")).toEqual(["সুন্দর আলো"]);
    expect(suggestionTexts(s, "hi")).toEqual(["Nice light"]);
    expect(suggestionTexts({ ...s, enabled: false }, "en")).toEqual([]);
  });
});
