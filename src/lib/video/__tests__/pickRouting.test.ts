/**
 * VID-1 · one picker for photos AND videos, like Instagram / Facebook.
 *
 * Owner, 2026-10-11: "in post video not able to post mp4 files — not supported
 * showing … Instagram and Meta allow for Facebook and Instagram — keep same
 * format here too." The composer's photo picker rejected every video with
 * "File format not supported", and the separate video button was hidden while
 * `video_posts` was off for the member, so an MP4 could never reach the video
 * uploader from the place members actually pick files.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isVideoFile, routePickedFiles, VIDEO_PICK_EXTENSIONS } from "../pickRouting";

const f = (name: string, type = "") => new File([new Uint8Array(4)], name, { type });

describe("isVideoFile: the formats Instagram and Facebook accept", () => {
  it.each([
    ["clip.mp4", "video/mp4"],
    ["IMG_0001.MOV", "video/quicktime"],
    ["clip.m4v", "video/x-m4v"],
    ["clip.webm", "video/webm"],
    ["clip.mkv", "video/x-matroska"],
    ["clip.3gp", "video/3gpp"],
    ["clip.mp4", ""],
    ["IMG_0001.mov", ""],
    ["no-extension", "video/mp4"],
  ])("%s (%s) is a video", (name, type) => {
    expect(isVideoFile(f(name, type))).toBe(true);
  });

  it.each([
    ["photo.jpg", "image/jpeg"],
    ["photo.png", ""],
    ["photo.heic", "image/heic"],
    ["notes.pdf", "application/pdf"],
  ])("%s (%s) is not a video", (name, type) => {
    expect(isVideoFile(f(name, type))).toBe(false);
  });

  it("covers MP4 and MOV at least (the two Instagram names)", () => {
    expect(VIDEO_PICK_EXTENSIONS).toEqual(expect.arrayContaining(["mp4", "mov"]));
  });
});

describe("routePickedFiles", () => {
  it("photos only → all photos, no video", () => {
    const r = routePickedFiles([f("a.jpg", "image/jpeg"), f("b.png", "image/png")]);
    expect(r.photos.map((x) => x.name)).toEqual(["a.jpg", "b.png"]);
    expect(r.video).toBeNull();
    expect(r.droppedForVideo).toBe(0);
  });

  it("one video → the video, no photos", () => {
    const r = routePickedFiles([f("clip.mp4", "video/mp4")]);
    expect(r.video?.name).toBe("clip.mp4");
    expect(r.photos).toEqual([]);
  });

  it("a video among other files → the first video alone; the rest are counted, not silently lost", () => {
    const r = routePickedFiles([f("a.jpg", "image/jpeg"), f("one.mov", "video/quicktime"), f("two.mp4", "video/mp4")]);
    expect(r.video?.name).toBe("one.mov");
    expect(r.photos).toEqual([]);
    expect(r.droppedForVideo).toBe(2);
  });
});

describe("WallPosts routes picked and dropped files through routePickedFiles", () => {
  const src = readFileSync("src/components/WallPosts.tsx", "utf8");

  it("the photo picker, the drop zone and the native gallery all go through one router", () => {
    expect(src).toMatch(/routePickedFiles\(/);
    expect(src).not.toMatch(/files\.forEach\(\s*(file\s*=>\s*processFile\(file\)|processFile)\s*\)/);
  });

  it("a video opens the video uploader when video_posts is on, and says why when it is off", () => {
    expect(src).toMatch(/useFeatureAllowed\("video_posts"\)/);
    expect(src).toMatch(/<VideoPostComposer[\s\S]*initialFile=\{pickedVideo\}/);
    expect(src).toMatch(/Video posts aren't switched on for your account yet/);
  });

  it("the picker offers videos when video_posts is on", () => {
    expect(src).toMatch(/accept=\{videoAllowed \? "image\/\*,video\/\*" : "image\/\*"\}/);
  });
});
