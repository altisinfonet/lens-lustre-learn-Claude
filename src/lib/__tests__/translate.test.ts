import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { needsTranslation, detectScript } from "@/lib/translate";

describe("translate script detection", () => {
  it("latin post for Bengali reader -> needs translation", () => {
    expect(needsTranslation("In every walk with nature, one receives far more than he seeks.", "bn")).toBe(true);
  });
  it("bengali post for Bengali reader -> no link", () => {
    expect(needsTranslation("আমি একজন ফটোগ্রাফার", "bn")).toBe(false);
  });
  it("bengali post for English reader -> needs translation", () => {
    expect(needsTranslation("আমি একজন ফটোগ্রাফার", "en")).toBe(true);
  });
  it("latin post for English reader -> no link", () => {
    expect(needsTranslation("Great photography is patience.", "en")).toBe(false);
  });
  it("emoji/number-only post -> no link", () => {
    expect(detectScript("🔥🔥 2026!!")).toBe(null);
    expect(needsTranslation("🔥🔥 2026!!", "bn")).toBe(false);
  });
  it("hindi/marathi share Devanagari -> hindi post, marathi reader, no link", () => {
    expect(needsTranslation("मैं एक फोटोग्राफर हूँ", "mr")).toBe(false);
  });
});
