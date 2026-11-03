/**
 * Camera name cleanup (Owner-approved fix 2026-11-03, 50mm-camera-line-FIX.html):
 * no doubled maker names, brand in normal case, Nikon "_2" → "II", Sony model
 * codes → their names. Works on the maker + model pair AND on the joined string
 * live already stores (src/lib/exifExtract.ts joins Make + Model at upload).
 */
import { describe, it, expect } from "vitest";
import { cameraDisplayName, cleanCameraName } from "@/lib/cameraName";
import { cameraLine, cameraRows } from "@/lib/photoCameraDisplay";

describe("cleanCameraName(maker, model)", () => {
  it.each([
    ["NIKON CORPORATION", "NIKON Z 6_2", "Nikon Z 6II"],
    ["NIKON CORPORATION", "NIKON Z 7_2", "Nikon Z 7II"],
    ["NIKON CORPORATION", "NIKON D850", "Nikon D850"],
    ["NIKON CORPORATION", "NIKON D3_3", "Nikon D3III"],
    ["Canon", "Canon EOS R5", "Canon EOS R5"],
    ["SONY", "ILCE-7M4", "Sony α7 IV"],
    ["SONY", "ILCE-7RM5", "Sony α7R V"],
    ["SONY", "ILCE-6400", "Sony α6400"],
    ["samsung", "SM-S918B", "Samsung SM-S918B"],
    ["FUJIFILM", "X-T5", "Fujifilm X-T5"],
    ["Apple", "iPhone 15 Pro", "Apple iPhone 15 Pro"],
    ["Google", "Pixel 8 Pro", "Google Pixel 8 Pro"],
    ["OLYMPUS CORPORATION", "E-M1MarkII", "Olympus E-M1MarkII"],
    ["LEICA CAMERA AG", "LEICA Q2", "Leica Q2"],
    ["RICOH IMAGING COMPANY, LTD.", "RICOH GR III", "Ricoh GR III"],
    ["Panasonic", "DC-S5M2", "Panasonic DC-S5M2"],
    ["HUAWEI", "HUAWEI P30 Pro", "Huawei P30 Pro"],
  ])("%s + %s → %s", (maker, model, want) => {
    expect(cleanCameraName(maker, model)).toBe(want);
  });

  it("unknown maker → tidy 'Brand Model' (no doubling, brand in normal case)", () => {
    expect(cleanCameraName("ACME", "ACME Snap 3")).toBe("Acme Snap 3");
    expect(cleanCameraName("zorki", "Z-4K")).toBe("Zorki Z-4K");
    expect(cleanCameraName("  ", "  X100  ")).toBe("X100");
    expect(cleanCameraName("DJI", "FC3582")).toBe("DJI FC3582");
  });

  it("nothing → undefined", () => {
    expect(cleanCameraName(undefined, undefined)).toBeUndefined();
    expect(cleanCameraName("", " ")).toBeUndefined();
  });
});

describe("cameraDisplayName(stored joined string)", () => {
  it.each([
    ["NIKON CORPORATION NIKON Z 6_2", "Nikon Z 6II"],
    ["Canon Canon EOS R5", "Canon EOS R5"],
    ["Canon EOS R5", "Canon EOS R5"],
    ["SONY ILCE-7M4", "Sony α7 IV"],
    ["ILCE-7M4", "Sony α7 IV"],
    ["samsung SM-S918B", "Samsung SM-S918B"],
    ["NIKON Z 6_2", "Nikon Z 6II"],
    ["Sony α7 IV", "Sony α7 IV"],
    ["Nikon Z6", "Nikon Z6"],
  ])("%s → %s", (raw, want) => {
    expect(cameraDisplayName(raw)).toBe(want);
  });
});

describe("the display text uses the clean name", () => {
  it("summary line and the Camera row", () => {
    const info = { camera: "NIKON CORPORATION NIKON Z 6_2", focal_length: 24, aperture: 7.1, shutter: "1/125", iso: 5000 };
    expect(cameraLine(info)).toBe("Nikon Z 6II · 24 mm · f/7.1 · 1/125 s · ISO 5000");
    expect(cameraRows(info)[0]).toEqual({ label: "Camera", value: "Nikon Z 6II" });
  });
});
