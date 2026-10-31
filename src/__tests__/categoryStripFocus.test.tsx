/**
 * The feed's category chips must survive the strip's own re-render.
 *
 * Bug (P23 a11y "screen-feed @ iphone-390: B:tab-unreached", flaky since at
 * least #757): `Chip` and `Arrow` were components declared INSIDE
 * CategoryStrip's render. Every render made them new component types, so React
 * threw away and rebuilt every chip button. Tabbing into the strip scrolls it,
 * the scroll handler flips canLeft/canRight, the strip re-renders — and the
 * focused chip is destroyed, so keyboard focus falls to <body>.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    data: [
      { slug: "landscape", name: "Landscape", icon_name: null },
      { slug: "portrait", name: "Portrait", icon_name: null },
    ],
  }),
}));
vi.mock("@/i18n/I18nContext", () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}));

import CategoryStrip from "@/components/feed/CategoryStrip";

describe("CategoryStrip keeps the focused chip when it re-renders", () => {
  it("a scroll that changes the arrow state does not destroy the focused chip", () => {
    render(<CategoryStrip value="all" onChange={() => {}} />);
    const group = screen.getByRole("group", { name: "Categories" });
    const chip = screen.getByRole("button", { name: /Portrait/ });
    chip.focus();
    expect(document.activeElement).toBe(chip);

    // jsdom has no layout: give the scroller an overflow and a scroll position
    // so measure() flips canLeft and canRight, forcing a re-render.
    Object.defineProperty(group, "scrollWidth", { configurable: true, value: 1000 });
    Object.defineProperty(group, "clientWidth", { configurable: true, value: 300 });
    Object.defineProperty(group, "scrollLeft", { configurable: true, value: 200 });
    fireEvent.scroll(group);

    expect(chip.isConnected).toBe(true);
    expect(document.activeElement).toBe(chip);
  });
});
