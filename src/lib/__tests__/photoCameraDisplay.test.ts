/**
 * Photo plan U2 — what the camera-details surfaces SAY, and which URL a grid or
 * a blur placeholder uses. Pure functions; the components only lay these out.
 */
import { describe, expect, it } from "vitest";
import {
  cameraChips, cameraLine, cameraRows, cameraStateFor, takenText,
} from "@/lib/photoCameraDisplay";
import { photoSetBlurUrl, photoSetGridUrl } from "@/lib/imageLadder";

const CDN = "https://cdn.50mmretina.com/post-images/u/posts/1762000000000-abc";
const L4 = `${CDN}-w2048h1365-l4.webp`;
const L4F = `${CDN}-w6000h4000-l4f.webp`;
const L3 = `${CDN}-w1920h1280-l3.webp`;
const PLAIN = `${CDN}-w1920h1280.webp`;

const full = { camera: "Sony α7 IV", lens: "FE 85 mm F1.8", focal_length: 85, aperture: 1.8, shutter: "1/250", iso: 200, taken_at: "2026-10-12T18:42:00" };

describe("the one-line summary (app feed line, web strip)", () => {
  it("camera · focal · aperture · shutter · ISO, as in the approved samples", () => {
    expect(cameraLine(full)).toBe("Sony α7 IV · 85 mm · f/1.8 · 1/250 s · ISO 200");
  });
  it("skips what the photo does not carry, never prints an empty slot", () => {
    expect(cameraLine({ aperture: 2.8, iso: 100 })).toBe("f/2.8 · ISO 100");
    expect(cameraLine({ focal_length: 23.5, shutter: "0.8" })).toBe("23.5 mm · 0.8 s");
    expect(cameraLine({})).toBe("");
  });
});

describe("the full details (sheet / opened strip)", () => {
  it("chips: aperture, shutter, ISO, focal — value + label", () => {
    expect(cameraChips(full)).toEqual([
      { value: "f/1.8", label: "Aperture" },
      { value: "1/250 s", label: "Shutter" },
      { value: "200", label: "ISO" },
      { value: "85 mm", label: "Focal" },
    ]);
  });
  it("rows: Camera, Lens, Taken (date only, wall clock, never shifted by time zone)", () => {
    expect(cameraRows(full)).toEqual([
      { label: "Camera", value: "Sony α7 IV" },
      { label: "Lens", value: "FE 85 mm F1.8" },
      { label: "Taken", value: "12 Oct 2026" },
    ]);
    expect(takenText("2026-01-01T00:10:00")).toBe("1 Jan 2026");
    expect(takenText("nonsense")).toBeUndefined();
  });
});

describe("which state a photo is in", () => {
  const rows = [{ ord: 0, info: full, hidden: false }];
  it("loading or failed read → no UI at all (never a wrong 'no details' line)", () => {
    expect(cameraStateFor(undefined, 0, L4)).toBeNull();
  });
  it("a row for this photo → its details", () => {
    expect(cameraStateFor(rows, 0, L4)).toEqual({ kind: "info", info: full, hidden: false });
  });
  it("the author of a hidden post gets the details plus the hidden flag", () => {
    expect(cameraStateFor([{ ord: 0, info: full, hidden: true }], 0, L4)).toEqual({ kind: "info", info: full, hidden: true });
  });
  it("a NEW photo (-l4 / -l4f) with no row → the no-camera-information state", () => {
    expect(cameraStateFor([], 0, L4)).toEqual({ kind: "none" });
    expect(cameraStateFor(rows, 1, L4F)).toEqual({ kind: "none" });
  });
  it("an OLD photo with no row → nothing (its details were never read)", () => {
    expect(cameraStateFor([], 0, L3)).toBeNull();
    expect(cameraStateFor([], 0, PLAIN)).toBeNull();
  });
});

describe("grid copy (320) and blur placeholder — only for v2 photos", () => {
  it("grids: -l4 / -l4f → the 320 copy; every other URL unchanged", () => {
    expect(photoSetGridUrl(L4)).toBe(`${CDN}-w2048h1365-l4-r320.webp`);
    expect(photoSetGridUrl(L4F)).toBe(`${CDN}-w6000h4000-l4f-r320.webp`);
    expect(photoSetGridUrl(L3)).toBe(L3);
    expect(photoSetGridUrl(PLAIN)).toBe(PLAIN);
    expect(photoSetGridUrl("https://x.supabase.co/storage/v1/object/public/a/b.jpg")).toBe("https://x.supabase.co/storage/v1/object/public/a/b.jpg");
  });
  it("blur: -l4 → the 320 copy; a photo too small to have one → null (nothing to gain); old URLs → null", () => {
    expect(photoSetBlurUrl(L4)).toBe(`${CDN}-w2048h1365-l4-r320.webp`);
    expect(photoSetBlurUrl(`${CDN}-w300h200-l4.webp`)).toBeNull();
    expect(photoSetBlurUrl(L3)).toBeNull();
    expect(photoSetBlurUrl(PLAIN)).toBeNull();
  });
});
