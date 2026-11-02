/**
 * Photo plan U2 — the camera-details component family, against the
 * Owner-approved samples (2026-11-02): app feed line → sheet, app full-screen ⓘ
 * → sheet (chips + rows), web compact strip that slides open (not sticky), the
 * no-camera-information states, the author's "hidden" hint, keyboard and
 * reduced-motion behaviour.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { CameraInfoButton, CameraLine, CameraStrip } from "@/components/post/CameraDetails";
import type { CameraState } from "@/lib/photoCameraDisplay";

const info: CameraState = {
  kind: "info",
  hidden: false,
  info: { camera: "Sony α7 IV", lens: "FE 85 mm F1.8", focal_length: 85, aperture: 1.8, shutter: "1/250", iso: 200, taken_at: "2026-10-12T18:42:00" },
};
const none: CameraState = { kind: "none" };
const hidden: CameraState = { ...info, hidden: true } as CameraState;

describe("APP feed line", () => {
  it("one small line under the photo; a tap opens the full details in a sheet", () => {
    render(<CameraLine state={info} />);
    const line = screen.getByRole("button", { name: /camera details/i });
    expect(line.textContent).toContain("Sony α7 IV · 85 mm · f/1.8 · 1/250 s · ISO 200");
    fireEvent.click(line);
    const sheet = screen.getByRole("dialog", { name: "Camera details" });
    expect(within(sheet).getByText("f/1.8")).toBeTruthy();
    expect(within(sheet).getByText("Aperture")).toBeTruthy();
    expect(within(sheet).getByText("FE 85 mm F1.8")).toBeTruthy();
    expect(within(sheet).getByText("12 Oct 2026")).toBeTruthy();
    expect(within(sheet).getByText(/Location is always removed/)).toBeTruthy();
    // Focus moves INTO the sheet.
    expect(sheet.contains(document.activeElement)).toBe(true);
  });

  it("no camera information → nothing at all in the feed", () => {
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
  it("the ⓘ opens chips + rows", () => {
    render(<CameraInfoButton state={info} />);
    fireEvent.click(screen.getByRole("button", { name: "Camera details" }));
    const sheet = screen.getByRole("dialog", { name: "Camera details" });
    for (const [v, l] of [["f/1.8", "Aperture"], ["1/250 s", "Shutter"], ["200", "ISO"], ["85 mm", "Focal"]]) {
      expect(within(sheet).getByText(v)).toBeTruthy();
      expect(within(sheet).getByText(l)).toBeTruthy();
    }
    expect(within(sheet).getByText("Sony α7 IV")).toBeTruthy();
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

describe("WEB compact strip under the caption", () => {
  it("closed: one line, aria-expanded=false; click → soft slide open (max-height + opacity, 0.25 s), not sticky", () => {
    render(<CameraStrip state={info} />);
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
    expect(within(panel).getByText(/Location removed · owner can hide this/)).toBeTruthy();
    const strip = button.closest("[data-camera-strip]") as HTMLElement;
    expect(strip.className).not.toMatch(/sticky|fixed/);
  });

  it("respects prefers-reduced-motion (no slide)", () => {
    render(<CameraStrip state={info} />);
    const button = screen.getByRole("button", { name: /camera details/i });
    const panel = document.getElementById(button.getAttribute("aria-controls")!)!;
    expect(panel.className).toMatch(/motion-reduce:transition-none/);
  });

  it("is a real button, so Enter / Space work from the keyboard", () => {
    render(<CameraStrip state={info} />);
    const button = screen.getByRole("button", { name: /camera details/i });
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
  });

  it("no camera information → one quiet grey line", () => {
    render(<CameraStrip state={none} />);
    const line = screen.getByText("No camera details for this photo");
    expect(line.closest("[data-camera-strip]")!.className).toMatch(/text-muted-foreground/);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("unknown → nothing", () => {
    const { container } = render(<CameraStrip state={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("the author of a hidden post sees the 'hidden' hint", () => {
    render(<CameraStrip state={hidden} />);
    expect(screen.getByText(/hidden/i)).toBeTruthy();
  });
});
