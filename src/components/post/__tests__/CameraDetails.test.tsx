/**
 * Camera-details component family against the Owner-approved fix
 * (2026-11-03, _control/out/OWNER/50mm-camera-line-FIX.html v2): ONE small
 * line, web and app. EVERYONE: that line only — no arrow, not clickable,
 * nothing expands. SITE ADMINS: an arrow that opens Lens + Taken in place
 * (max-height + opacity, 0.25 s, not sticky). The line fades in and rises 4 px
 * (0.35 s; none with reduced motion). The app full-screen ⓘ → sheet; no camera
 * information → nothing in the feed; no "Location removed" text anywhere; the
 * author's "hidden" hint. Where the line sits in a card:
 * cameraLineApproved.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { CameraInfoButton, CameraLine, __resetCameraLineFocus } from "@/components/post/CameraDetails";
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
  type Rec = { cb: (e: { isIntersecting: boolean }[]) => void; threshold?: number; disconnected: boolean };
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

  it("waits (soft) until ≥ 30 % on screen, then plays ONCE; a re-render does not re-apply it; the same photo never replays", () => {
    const { container, rerender, unmount } = render(<CameraLine state={info} focusKey="p1:a" />);
    expect(observers).toHaveLength(1);
    expect(observers[0].threshold).toBe(0.3);
    expect(lineOf(container).classList.contains("camLineWait")).toBe(true);
    expect(lineOf(container).classList.contains("camLinePlay")).toBe(false);
    act(() => observers[0].cb([{ isIntersecting: false }]));
    expect(lineOf(container).classList.contains("camLineWait")).toBe(true);
    act(() => observers[0].cb([{ isIntersecting: true }]));
    expect(lineOf(container).classList.contains("camLinePlay")).toBe(true);
    expect(observers[0].disconnected).toBe(true);
    const node = lineOf(container);
    rerender(<CameraLine state={{ ...info }} focusKey="p1:a" />);
    expect(lineOf(container)).toBe(node);
    expect(lineOf(container).classList.contains("camLinePlay")).toBe(true);
    expect(observers).toHaveLength(1);
    unmount();
    // Scrolled away and back (remounted): shown at once, no animation, nothing observed.
    const again = render(<CameraLine state={info} focusKey="p1:a" />);
    expect(lineOf(again.container).className).not.toMatch(/camLineWait|camLinePlay/);
    expect(observers).toHaveLength(1);
  });

  it("another photo plays its own entry", () => {
    render(<CameraLine state={info} focusKey="p1:a" />);
    act(() => observers[0].cb([{ isIntersecting: true }]));
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

  it("small muted type (~11.5 px)", () => {
    const { container } = render(<CameraLine admin state={info} />);
    const line = container.querySelector("[data-camera-line]") as HTMLElement;
    expect(line.className).toMatch(/text-\[11\.5px\]/);
    expect(line.className).toMatch(/text-muted-foreground/);
  });

  it("app: Lens and Taken on their own lines; web: one line", () => {
    const a = render(<CameraLine admin state={info} stacked />);
    expect(a.container.querySelector(".flex-col")).not.toBeNull();
    a.unmount();
    const b = render(<CameraLine admin state={info} stacked={false} />);
    expect(b.container.querySelector(".flex-col")).toBeNull();
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

describe("APP full screen ⓘ → bottom sheet", () => {
  it("the ⓘ opens chips + rows; no location line", () => {
    render(<CameraInfoButton state={info} />);
    fireEvent.click(screen.getByRole("button", { name: "Camera details" }));
    const sheet = screen.getByRole("dialog", { name: "Camera details" });
    for (const [v, l] of [["f/1.8", "Aperture"], ["1/250 s", "Shutter"], ["200", "ISO"], ["85 mm", "Focal"]]) {
      expect(within(sheet).getByText(v)).toBeTruthy();
      expect(within(sheet).getByText(l)).toBeTruthy();
    }
    expect(within(sheet).getByText("Sony α7 IV")).toBeTruthy();
    expect(within(sheet).getByText("FE 85 mm F1.8")).toBeTruthy();
    expect(within(sheet).getByText("12 Oct 2026")).toBeTruthy();
    expect(sheet.textContent).not.toMatch(LOCATION);
    // Focus moves INTO the sheet.
    expect(sheet.contains(document.activeElement)).toBe(true);
  });

  it("no camera information → the sheet says so, with the reason line", () => {
    render(<CameraInfoButton state={none} />);
    fireEvent.click(screen.getByRole("button", { name: "Camera details" }));
    const sheet = screen.getByRole("dialog", { name: "Camera details" });
    expect(within(sheet).getByText("This photo has no camera information.")).toBeTruthy();
    expect(within(sheet).getByText("Edited photos, screenshots and photos sent by chat apps often lose it.")).toBeTruthy();
  });

  it("an old photo (state unknown) shows no ⓘ at all", () => {
    const { container } = render(<CameraInfoButton state={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("clicks inside the sheet never reach the viewer behind it (it would close)", () => {
    let outer = 0;
    render(<div onClick={() => { outer += 1; }}><CameraInfoButton state={info} /></div>);
    fireEvent.click(screen.getByRole("button", { name: "Camera details" }));
    fireEvent.click(screen.getByText("Sony α7 IV"));
    expect(outer).toBe(0);
  });
});
