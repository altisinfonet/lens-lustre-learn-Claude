/**
 * Camera-details component family against the Owner-approved fix
 * (2026-11-03, _control/out/OWNER/50mm-camera-line-FIX.html v2): ONE small
 * line, web and app. EVERYONE: that line only — no arrow, not clickable,
 * nothing expands. SITE ADMINS: an arrow that opens Lens + Taken in place
 * (max-height + opacity, 0.25 s, not sticky). The line comes into focus once
 * per photo ("lens focus", option A; none with reduced motion). Type is 12 px,
 * the site's readability floor. No full-screen ⓘ or sheet (one design); no camera
 * information → nothing in the feed; no "Location removed" text anywhere; the
 * author's "hidden" hint. Where the line sits in a card:
 * cameraLineApproved.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { CameraLine, __resetCameraLineFocus, __lensFocusTicker } from "@/components/post/CameraDetails";
import type { CameraState } from "@/lib/photoCameraDisplay";

const info: CameraState = {
  kind: "info",
  hidden: false,
  info: { camera: "Sony α7 IV", lens: "FE 85 mm F1.8", focal_length: 85, aperture: 1.8, shutter: "1/250", iso: 200, taken_at: "2026-10-12T18:42:00" },
};
const none: CameraState = { kind: "none" };
const hidden: CameraState = { ...info, hidden: true } as CameraState;
const LOCATION = /Location removed|owner can hide this|Location is always removed/;

describe("EVERYONE's camera line (members and the post's owner)", () => {
  it("one line: no arrow, not clickable, no 2nd line", () => {
    const { container } = render(<CameraLine state={info} />);
    const line = container.querySelector("[data-camera-line]") as HTMLElement;
    expect(line.textContent).toContain("Sony α7 IV · 85 mm · f/1.8 · 1/250 s · ISO 200");
    expect(screen.queryByRole("button")).toBeNull();
    expect(line.querySelector("[aria-expanded]")).toBeNull();
    expect(line.querySelectorAll("svg")).toHaveLength(1);
    expect(line.textContent).not.toContain("FE 85 mm F1.8");
    expect(line.textContent).not.toContain("12 Oct 2026");
    expect(line.textContent).not.toMatch(LOCATION);
    expect(line.className).not.toMatch(/sticky|fixed|\bborder\b|rounded-lg|bg-/);
  });

  it("each item (icon, camera, focal, f/, shutter, ISO) is its own focus item, in order; the rejected fade + rise is not shipped", () => {
    const { container } = render(<CameraLine state={info} />);
    const line = container.querySelector("[data-camera-line]") as HTMLElement;
    expect(line.classList.contains("camLineEnter")).toBe(true);
    expect(line.className).not.toMatch(/animate-in|fade-in|slide-in/);
    const items = Array.from(container.querySelectorAll<HTMLElement>(".camW"));
    expect(items).toHaveLength(6);
    expect(items.map((s) => s.style.getPropertyValue("--cam-i"))).toEqual(["0", "1", "2", "3", "4", "5"]);
    expect(items[1].textContent).toBe("Sony α7 IV");
    expect(items[5].textContent).toBe(" · ISO 200");
  });
});

describe("'lens focus' entry (Owner-approved option A)", () => {
  type Rec = { cb: (e: { isIntersecting: boolean; intersectionRatio: number }[]) => void; threshold?: number; disconnected: boolean };
  let observers: Rec[] = [];
  let reduce = false;
  class FakeIO {
    rec: Rec;
    constructor(cb: Rec["cb"], opts?: { threshold?: number }) {
      this.rec = { cb, threshold: opts?.threshold, disconnected: false };
      observers.push(this.rec);
    }
    observe() {}
    unobserve() {}
    disconnect() { this.rec.disconnected = true; }
  }
  beforeEach(() => {
    observers = [];
    reduce = false;
    __resetCameraLineFocus();
    vi.stubGlobal("IntersectionObserver", FakeIO);
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: reduce && q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetCameraLineFocus();
  });
  const lineOf = (c: HTMLElement) => c.querySelector("[data-camera-line]") as HTMLElement;

  /*
   * REPEAT (Owner, 3 Nov 2026 ~15:50Z: "repeat every 5 seconds while the line is
   * on screen"). Written to FAIL on main 5dc3fcd4 / staging 8c3081b4, where the
   * entry waited for 30 % and then played ONCE per photo for the whole session.
   */
  const firstItem = (c: HTMLElement) => lineOf(c).querySelector(".camW") as HTMLElement;

  it("plays the moment the line ENTERS the screen, then again every 5 s while it stays there (the items are redrawn so the CSS animation restarts)", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<CameraLine state={info} focusKey="p1:a" />);
      expect(observers).toHaveLength(1);
      expect(observers[0].threshold).toBe(0); // entry, not 30 %
      expect(lineOf(container).classList.contains("camLineWait")).toBe(true);
      act(() => observers[0].cb([{ isIntersecting: true, intersectionRatio: 0.01 }]));
      expect(lineOf(container).classList.contains("camLinePlay")).toBe(true);
      const first = firstItem(container);
      act(() => { vi.advanceTimersByTime(4999); });
      expect(firstItem(container)).toBe(first); // not yet
      act(() => { vi.advanceTimersByTime(1); });
      const second = firstItem(container);
      expect(second).not.toBe(first); // replayed at 5 s
      act(() => { vi.advanceTimersByTime(5000); });
      expect(firstItem(container)).not.toBe(second); // and at 10 s
      expect(__lensFocusTicker()).toEqual({ lines: 1, running: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("off screen → no replays and the shared timer stops; back on screen → it plays and repeats again", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<CameraLine state={info} focusKey="p1:a" />);
      act(() => observers[0].cb([{ isIntersecting: true, intersectionRatio: 1 }]));
      act(() => observers[0].cb([{ isIntersecting: false, intersectionRatio: 0 }]));
      expect(__lensFocusTicker()).toEqual({ lines: 0, running: false });
      const off = firstItem(container);
      act(() => { vi.advanceTimersByTime(20000); });
      expect(firstItem(container)).toBe(off); // nothing happened while away
      act(() => observers[0].cb([{ isIntersecting: true, intersectionRatio: 1 }]));
      act(() => { vi.advanceTimersByTime(5000); });
      expect(firstItem(container)).not.toBe(off);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a hidden tab pauses the shared timer; ONE timer serves every line on screen", () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(globalThis, "setInterval");
    try {
      render(<CameraLine state={info} focusKey="p1:a" />);
      render(<CameraLine state={info} focusKey="p2:b" />);
      render(<CameraLine state={info} focusKey="p3:c" />);
      for (const o of observers) act(() => o.cb([{ isIntersecting: true, intersectionRatio: 1 }]));
      expect(__lensFocusTicker()).toEqual({ lines: 3, running: true });
      expect(spy.mock.calls.filter((c) => c[1] === 5000)).toHaveLength(1); // one timer, not three
      // hidden tab → no replays at all (P10's visibility interval stops the timer)
      const lines = [...document.querySelectorAll("[data-camera-line]")] as HTMLElement[];
      const firstOf = (l: HTMLElement) => l.querySelector(".camW");
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      act(() => { document.dispatchEvent(new Event("visibilitychange")); });
      const before = lines.map(firstOf);
      act(() => { vi.advanceTimersByTime(20000); });
      lines.forEach((l, i) => expect(firstOf(l)).toBe(before[i])); // same nodes: toEqual would pass on a fresh identical remount
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      act(() => { document.dispatchEvent(new Event("visibilitychange")); });
      act(() => { vi.advanceTimersByTime(5000); });
      expect(lines.map(firstOf).every((n, i) => n !== before[i])).toBe(true); // replays again
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    }
  });

  it("another photo plays its own entry", () => {
    render(<CameraLine state={info} focusKey="p1:a" />);
    act(() => observers[0].cb([{ isIntersecting: true, intersectionRatio: 0.4 }]));
    const b = render(<CameraLine state={info} focusKey="p2:b" />);
    expect(lineOf(b.container).classList.contains("camLineWait")).toBe(true);
  });

  it("prefers-reduced-motion → no animation, shown at once, nothing observed", () => {
    reduce = true;
    const { container } = render(<CameraLine state={info} focusKey="p1:a" />);
    expect(lineOf(container).className).not.toMatch(/camLineWait|camLinePlay/);
    expect(observers).toHaveLength(0);
  });

  it("the CSS: blur → focus, 0.9 s, cubic-bezier(.22,1,.36,1), 0.09 s stagger, NO movement; hiding only without reduced motion", () => {
    const css = readFileSync(resolve(__dirname, "../../../index.css"), "utf8");
    const block = css.slice(css.indexOf("CAMERA LINE ENTRY"));
    expect(block).toMatch(/0%\s*\{\s*opacity:\s*0;\s*filter:\s*blur\(5px\);\s*\}/);
    expect(block).toMatch(/60%\s*\{\s*opacity:\s*0\.85;\s*filter:\s*blur\(1px\);\s*\}/);
    expect(block).toMatch(/100%\s*\{\s*opacity:\s*1;\s*filter:\s*blur\(0\);\s*\}/);
    expect(block).not.toMatch(/translate|transform/);
    expect(block).toMatch(/animation:\s*camFocusIn 0\.9s cubic-bezier\(0\.22, 1, 0\.36, 1\) forwards/);
    expect(block).toMatch(/animation-delay:\s*calc\(var\(--cam-i, 0\) \* 0\.09s\)/);
    const media = block.indexOf("@media (prefers-reduced-motion: no-preference)");
    expect(media).toBeGreaterThan(-1);
    expect(block.indexOf(".camLineWait .camW")).toBeGreaterThan(media);
    expect(block.indexOf(".camLinePlay .camW")).toBeGreaterThan(media);
  });
});

describe("ADMIN camera line (web and app): arrow → 2nd line", () => {
  it("closed: one line, aria-expanded=false; click → slides open in place (max-height + opacity, 0.25 s); click again closes", () => {
    const { container } = render(<CameraLine admin state={info} />);
    const button = screen.getByRole("button", { name: /camera details/i });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.textContent).toContain("Sony α7 IV · 85 mm · f/1.8 · 1/250 s · ISO 200");
    const panel = document.getElementById(button.getAttribute("aria-controls")!)!;
    expect(panel.className).toMatch(/max-h-0/);
    expect(panel.className).toMatch(/opacity-0/);
    expect(panel.className).toMatch(/duration-\[250ms\]/);
    expect(panel.className).toMatch(/transition-\[max-height,opacity\]/);
    expect(panel.getAttribute("aria-hidden")).toBe("true");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(panel.className).toMatch(/opacity-100/);
    expect(panel.getAttribute("aria-hidden")).toBe("false");
    expect(within(panel).getByText("FE 85 mm F1.8")).toBeTruthy();
    expect(within(panel).getByText("12 Oct 2026")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    const line = container.querySelector("[data-camera-line]") as HTMLElement;
    expect(line.className).not.toMatch(/sticky|fixed|\bborder\b|rounded-lg|bg-/);
    expect(container.textContent).not.toMatch(LOCATION);
  });

  it("small muted type (12 px — the site readability floor)", () => {
    const { container } = render(<CameraLine admin state={info} />);
    const line = container.querySelector("[data-camera-line]") as HTMLElement;
    expect(line.className).toMatch(/\btext-xs\b/);
    expect(line.className).toMatch(/text-muted-foreground/);
  });

  it("the 2nd line is ONE line of text, 'Lens X · Taken Y' (wraps only if it does not fit)", () => {
    const { container } = render(<CameraLine admin state={info} />);
    fireEvent.click(screen.getByRole("button", { name: /camera details/i }));
    const panel = document.getElementById(screen.getByRole("button").getAttribute("aria-controls")!)!;
    expect(panel.textContent).toBe("Lens FE 85 mm F1.8 · Taken 12 Oct 2026");
    expect(panel.querySelectorAll("p")).toHaveLength(1);
    expect(container.querySelector(".flex-col")).toBeNull();
  });

  it("web and app shell: the SAME markup, member and admin, closed and opened", () => {
    const html = (app: boolean, admin: boolean, open: boolean) => {
      (globalThis as { Capacitor?: unknown }).Capacitor = app ? { isNativePlatform: () => true } : undefined;
      try {
        const r = render(<CameraLine admin={admin} state={info} />);
        if (open) fireEvent.click(r.container.querySelector("button")!);
        const out = r.container.innerHTML.replace(/:r[0-9a-z]+:|«r[0-9a-z]+»|_r_[0-9a-z]+_/g, "ID");
        r.unmount();
        return out;
      } finally {
        (globalThis as { Capacitor?: unknown }).Capacitor = undefined;
      }
    };
    for (const [admin, open] of [[false, false], [true, false], [true, true]] as const) {
      expect(html(true, admin, open)).toBe(html(false, admin, open));
    }
  });

  it("respects prefers-reduced-motion (no slide)", () => {
    render(<CameraLine admin state={info} />);
    const button = screen.getByRole("button", { name: /camera details/i });
    const panel = document.getElementById(button.getAttribute("aria-controls")!)!;
    expect(panel.className).toMatch(/motion-reduce:transition-none/);
  });

  it("is a real button, so Enter / Space work from the keyboard", () => {
    render(<CameraLine admin state={info} />);
    const button = screen.getByRole("button", { name: /camera details/i });
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
  });

  it("nothing to open (no lens, no date) → the line alone, no chevron button", () => {
    render(<CameraLine admin state={{ kind: "info", hidden: false, info: { camera: "Sony α7 IV", iso: 200 } }} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Sony α7 IV")).toBeTruthy();
  });

  it("no camera information → nothing at all", () => {
    const { container } = render(<CameraLine state={none} />);
    expect(container.innerHTML).toBe("");
  });

  it("unknown (loading / failed / old photo) → nothing", () => {
    const { container } = render(<CameraLine state={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("the author of a hidden post sees a small 'hidden' hint", () => {
    render(<CameraLine state={hidden} />);
    expect(screen.getByText(/hidden/i)).toBeTruthy();
  });
});

describe("no layout shift while the details are read (audit M5)", () => {
  it("reserve: an empty block with exactly the members' line box (same wrapper + paragraph classes), hidden from readers", () => {
    const held = render(<CameraLine state={null} reserve />);
    const box = held.container.querySelector("[data-camera-line-reserve]") as HTMLElement;
    expect(box.getAttribute("aria-hidden")).toBe("true");
    expect(box.textContent).toBe("");
    const line = render(<CameraLine state={info} />);
    const real = line.container.querySelector("[data-camera-line]") as HTMLElement;
    // Same box model: wrapper padding / font / line height, and the paragraph's pt-1.5 above one 16 px line
    // (Owner report 3 Nov ~16:20Z: tight under the photo, the caption's left edge — px-3).
    for (const c of ["px-3", "text-xs", "leading-4"]) {
      expect(box.classList.contains(c)).toBe(true);
      expect(real.classList.contains(c)).toBe(true);
    }
    for (const c of ["pt-1.5"]) {
      expect(box.querySelector("p")!.classList.contains(c)).toBe(true);
      expect(real.querySelector("p")!.classList.contains(c)).toBe(true);
    }
    expect(box.querySelector("p > span.block.h-4")).not.toBeNull();
  });

  it("no reserve (an old photo, or the switch off) → nothing at all", () => {
    const { container } = render(<CameraLine state={null} />);
    expect(container.innerHTML).toBe("");
  });
});
