/**
 * A FAILED PHOTO UPLOAD MUST SAY WHY.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT HAPPENED (2026-08-02, reported by the owner with a screenshot)
 *
 * A new member reached the last step of signing up and got:
 *
 *     Upload failed
 *     Please try another image
 *
 * A profile photo is mandatory to finish, so that member could not join. And
 * "please try another image" is not advice — it is the app admitting it has no
 * idea what went wrong.
 *
 * It had no idea because of one line. `HTMLImageElement.onerror` hands its
 * listener a DOM **Event**, and the loader did `reject(err)` with that Event.
 * An Event has no `.message`, so `err?.message || "Please try another image"`
 * printed the fallback every single time. The upload never even reached the
 * network: the browser could not turn the chosen file into pixels.
 *
 * These tests pin the two things that make it visible next time:
 *   1. a real Error, carrying the file's own MIME type;
 *   2. a second decode attempt before giving up.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compressImage, ImageDecodeError } from "@/lib/imageCompression";

/** An <img> that always fails to decode — what a phone's newer photo format does. */
function stubUndecodableImage() {
  class FailingImage {
    onload: (() => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    naturalWidth = 0;
    naturalHeight = 0;
    set src(_v: string) {
      // Event, not Error — exactly what the browser gives you, and exactly what
      // used to be handed to the toast.
      setTimeout(() => this.onerror?.(new Event("error")), 0);
    }
  }
  vi.stubGlobal("Image", FailingImage as unknown as typeof Image);
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => "blob:stub",
    revokeObjectURL: () => {},
  });
}

const fakeFile = (type: string) =>
  new File([new Uint8Array([1, 2, 3, 4])], "photo.heic", { type });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("when the browser cannot open the chosen photo", () => {
  it("throws a real Error, not a DOM Event", async () => {
    stubUndecodableImage();
    vi.stubGlobal("createImageBitmap", () => Promise.reject(new Error("no decoder")));

    await expect(compressImage(fakeFile("image/heic"))).rejects.toBeInstanceOf(ImageDecodeError);
  });

  it("says something a member can act on, and never an empty message", async () => {
    stubUndecodableImage();
    vi.stubGlobal("createImageBitmap", () => Promise.reject(new Error("no decoder")));

    // This is the whole point: the toast prints err.message. If it is empty,
    // the member is told nothing and is stuck on a mandatory step.
    await expect(compressImage(fakeFile("image/heic"))).rejects.toThrow(/could not open that photo/i);
    await expect(compressImage(fakeFile("image/heic"))).rejects.toThrow(/most compatible photo setting/i);
  });

  it("names NO format or vendor in anything a member reads", async () => {
    // Owner's standing rule: no third-party format or brand name in app UI.
    // The type is still needed to diagnose, so it lives on the error object and
    // in the console — never in the sentence.
    stubUndecodableImage();
    vi.stubGlobal("createImageBitmap", () => Promise.reject(new Error("no decoder")));

    const err = await compressImage(fakeFile("image/heic")).catch((e) => e);
    expect(err.message).not.toMatch(/heic|heif|jpe?g|png|webp|iphone|android|samsung|apple/i);
    // …but the diagnostic detail is still there for us.
    expect(err.fileType).toBe("image/heic");
    expect(err.fileSize).toBeGreaterThan(0);
  });

  it("tries a second decoder before giving up", async () => {
    // createImageBitmap is a different code path from <img> and succeeds on
    // files the element rejects. If it works, the member never sees an error.
    stubUndecodableImage();
    const bitmap = { width: 10, height: 10, close() {} };
    vi.stubGlobal("createImageBitmap", vi.fn(() => Promise.resolve(bitmap)));

    // jsdom has no real canvas, so the call still fails — but it must fail
    // AFTER the second attempt, i.e. not as an ImageDecodeError.
    const err = await compressImage(fakeFile("image/heic")).catch((e) => e);
    expect(err).not.toBeInstanceOf(ImageDecodeError);
    expect(createImageBitmap).toHaveBeenCalled();
  });
});

describe("the shape of the bug cannot come back", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/imageCompression.ts"), "utf8")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  it("never rejects a promise with whatever onerror was handed", () => {
    // `img.onerror = (err) => reject(err)` is the original defect, verbatim.
    expect(src).not.toMatch(/onerror\s*=\s*\(?\s*\w+\s*\)?\s*=>\s*\{?[^}]*reject\(\s*\w+\s*\)/);
  });

  it("still exports the error type the UI keys off", () => {
    expect(src).toContain("class ImageDecodeError");
    expect(src).toContain('this.name = "ImageDecodeError"');
  });
});
