/**
 * Photo plan U1b — EXIF (read from the ORIGINAL file) → the items
 * `set_post_photo_camera(p_post_id, p_items)` accepts
 * (supabase/migrations/20261110_0100_photo_camera_info.sql):
 *
 *   [{ ord, camera, lens, focal_length, aperture, shutter, iso, taken_at }]  — flat items
 *   camera/lens text ≤100 · shutter text "1/250" or "2.5" · taken_at ISO 8601 text ·
 *   focal_length (0, 5000] · aperture [0.5, 128] · iso whole 1..10 000 000
 *
 * The call is all-or-nothing, so the mapper must never emit a value the RPC
 * refuses — and it must NEVER emit a location key or value.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CAMERA_KEYS,
  cameraInfoFromExif,
  cameraItems,
  localWallClock,
  shutterText,
} from "@/lib/photoCamera";

describe("cameraInfoFromExif — only the seven keys, never GPS", () => {
  it("maps a full EXIF read to the seven keys", () => {
    const taken = new Date(2026, 9, 31, 18, 42, 7).toISOString(); // what extractExif hands back
    const info = cameraInfoFromExif({
      camera: "Canon EOS R5", make: "Canon", model: "EOS R5", lens: "RF 24-70mm F2.8 L IS USM",
      iso: 400, aperture: 2.8, shutter_speed: 0.004, focal_length: 50, date_taken: taken,
    });
    expect(info).toEqual({
      camera: "Canon EOS R5", lens: "RF 24-70mm F2.8 L IS USM", focal_length: 50, aperture: 2.8,
      shutter: "1/250", iso: 400, taken_at: "2026-10-31T18:42:07",
    });
    expect([...CAMERA_KEYS]).toEqual(["camera", "lens", "focal_length", "aperture", "shutter", "iso", "taken_at"]);
  });

  it("GPS / location keys are NEVER emitted, whatever the reader returns", () => {
    const hostile = {
      camera: "Pixel 8", GPSLatitude: 22.57, GPSLongitude: 88.36, latitude: 22.57, longitude: 88.36,
      gps: { lat: 1 }, location: "Kolkata", make: "Google", model: "Pixel 8", altitude: 9,
    } as unknown as Parameters<typeof cameraInfoFromExif>[0];
    const info = cameraInfoFromExif(hostile)!;
    for (const k of Object.keys(info)) expect(CAMERA_KEYS as readonly string[]).toContain(k);
    expect(JSON.stringify(info)).not.toMatch(/gps|lat|lon|locat|altitude|22\.57|88\.36|Kolkata/i);
  });

  it("drops a text value that looks like a position (the RPC would refuse the whole post's details)", () => {
    expect(cameraInfoFromExif({ camera: "Cam 22.5726, 88.3639", lens: "50mm 12°" })).toBeNull();
  });

  it("no EXIF → null (nothing is sent for that photo)", () => {
    expect(cameraInfoFromExif({})).toBeNull();
    expect(cameraInfoFromExif(null)).toBeNull();
    expect(cameraInfoFromExif({ make: "Canon" })).toBeNull(); // make alone is not a key; camera is
  });

  it("keeps values inside the RPC's ranges, drops the rest", () => {
    const info = cameraInfoFromExif({
      camera: "X".repeat(140), iso: 0, aperture: 200, focal_length: -1, shutter_speed: Number.NaN, lens: "a\u0007b",
    })!;
    expect(Array.from(info.camera!).length).toBe(100);
    expect(info.iso).toBeUndefined();
    expect(info.aperture).toBeUndefined();
    expect(info.focal_length).toBeUndefined();
    expect(info.shutter).toBeUndefined();
    expect(info.lens).toBe("ab"); // control character removed
    expect(cameraInfoFromExif({ iso: 125.4, aperture: 1.7999, focal_length: 6.8601 })).toEqual({ iso: 125, aperture: 1.8, focal_length: 6.86 });
  });
});

describe("taken_at — local wall clock, the timezone offset stripped", () => {
  it("a Date-derived ISO string (extractExif) goes back to the camera's local wall clock", () => {
    expect(localWallClock(new Date(2025, 0, 2, 3, 4, 5).toISOString())).toBe("2025-01-02T03:04:05");
  });
  it("strips an explicit offset and keeps the wall clock as written", () => {
    expect(localWallClock("2026-10-31T18:42:07+05:30")).toBe("2026-10-31T18:42:07");
    expect(localWallClock("2026-10-31T18:42:07-0800")).toBe("2026-10-31T18:42:07");
    expect(localWallClock("2026-10-31 18:42")).toBe("2026-10-31T18:42:00");
  });
  it("reads the raw EXIF form 'YYYY:MM:DD HH:MM:SS'", () => {
    expect(localWallClock("2026:10:31 18:42:07")).toBe("2026-10-31T18:42:07");
    expect(localWallClock("2026:10:31 18:42:07+01:00")).toBe("2026-10-31T18:42:07");
  });
  it("refuses what is not a real date-time (the RPC casts to timestamptz)", () => {
    expect(localWallClock("2026-13-40T25:61:00")).toBeUndefined();
    expect(localWallClock("0000:00:00 00:00:00")).toBeUndefined();
    expect(localWallClock("yesterday")).toBeUndefined();
    expect(localWallClock(undefined)).toBeUndefined();
  });
  it("the result always matches the RPC's accepted pattern, with no offset", () => {
    const re = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$/;
    for (const v of ["2026-10-31T18:42:07Z", "2026:10:31 18:42:07", "2026-10-31T18:42:07.123+05:30"]) {
      expect(localWallClock(v), v).toMatch(re);
    }
  });
});

describe("shutterText — the RPC's '1/250' or '2.5' form", () => {
  it("fast speeds as a fraction, slow ones as seconds", () => {
    expect(shutterText(0.004)).toBe("1/250");
    expect(shutterText(1 / 8000)).toBe("1/8000");
    expect(shutterText(0.5)).toBe("1/2");
    expect(shutterText(0.8)).toBe("0.8");
    expect(shutterText(2.5)).toBe("2.5");
    expect(shutterText(30)).toBe("30");
    expect(shutterText(0)).toBeUndefined();
    expect(shutterText(-1)).toBeUndefined();
  });
  it("always matches the RPC's pattern", () => {
    for (const t of [0.004, 0.3, 0.8, 1, 1.3, 15, 120]) expect(shutterText(t)).toMatch(/^[0-9]+(\.[0-9]+)?(\/[0-9]+(\.[0-9]+)?)?$/);
  });
});

describe("cameraItems — ord = the photo's index in posts.image_urls; no EXIF → nothing for that ord", () => {
  it("flat items with ord, skipping photos without details", () => {
    expect(cameraItems([{ camera: "A" }, null, { iso: 100, camera: "B" }])).toEqual([
      { ord: 0, camera: "A" },
      { ord: 2, camera: "B", iso: 100 },
    ]);
    expect(cameraItems([null, null])).toEqual([]);
  });
});

describe("savePostPhotoCamera — one call, and a failure never fails the post", () => {
  const rpc = vi.fn();
  beforeEach(() => {
    rpc.mockReset();
    vi.resetModules();
    vi.doMock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
  });

  it("calls set_post_photo_camera once with the post id and the items", async () => {
    rpc.mockResolvedValue({ data: 1, error: null });
    const { savePostPhotoCamera } = await import("@/lib/photoCamera");
    expect(await savePostPhotoCamera("p1", [{ ord: 0, camera: "A" }])).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("set_post_photo_camera", { p_post_id: "p1", p_items: [{ ord: 0, camera: "A" }] });
  });

  it("sends nothing when no photo has details", async () => {
    const { savePostPhotoCamera } = await import("@/lib/photoCamera");
    expect(await savePostPhotoCamera("p1", [])).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a refusal or a thrown error resolves false — it never throws", async () => {
    const { savePostPhotoCamera } = await import("@/lib/photoCamera");
    rpc.mockResolvedValueOnce({ data: null, error: { message: "PHOTO-CAM-007: not switched on", code: "42501" } });
    await expect(savePostPhotoCamera("p1", [{ ord: 0, camera: "A" }])).resolves.toBe(false);
    rpc.mockRejectedValueOnce(new Error("Failed to fetch"));
    await expect(savePostPhotoCamera("p1", [{ ord: 0, camera: "A" }])).resolves.toBe(false);
  });
});
