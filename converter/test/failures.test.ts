// @vitest-environment node
/**
 * The fixed failure codes (20261012_0002 video_source_fail) and the scrub
 * that keeps presigned URLs, tokens and passwords out of logs and `detail`.
 */
import { describe, it, expect } from "vitest";
import { FAIL_CODES as SERVER_CODES } from "../../functions/api/video/convert/finish";
import { classifyToolFailure, FAIL_CODES, JobFailure, scrub, toFailure, vidCode } from "../src/failures";
import { jsonLogger } from "../src/log";

const run = (stderr: string, o: Partial<{ exitCode: number | null; timedOut: boolean; killed: boolean }> = {}) =>
  classifyToolFailure("ffmpeg", { exitCode: 1, timedOut: false, killed: false, stderr, ...o }).code;

describe("converter · failure codes", () => {
  it("are exactly the server's list", () => {
    expect([...FAIL_CODES]).toEqual([...SERVER_CODES]);
  });

  it("FFmpeg's complaints: the FILE (final code) or this run (internal)", () => {
    expect(run("source: Invalid data found when processing input")).toBe("damaged");
    expect(run("[h264 @ 0x1] error while decoding MB 3 4")).toBe("damaged");
    expect(run("Decoder (codec prores_raw) not found for input stream #0:0")).toBe("unsupported_format");
    expect(run("Format not on whitelist 'mov,mp4'")).toBe("unsupported_format");
    expect(run("No space left on device")).toBe("internal");
    expect(run("Cannot allocate memory")).toBe("internal");
    expect(run("anything", { timedOut: true })).toBe("internal");
    expect(run("Invalid data found", { killed: true })).toBe("internal");
    expect(run("something we have never seen")).toBe("internal");
    expect(classifyToolFailure("ffprobe", { exitCode: 1, timedOut: false, killed: false, stderr: "source: Invalid data found when processing input" }).code).toBe("unsupported_format");
    expect(classifyToolFailure("ffprobe", { exitCode: 1, timedOut: false, killed: false, stderr: "[mov,mp4] moov atom not found" }).code).toBe("damaged");
  });

  it("toFailure: a JobFailure keeps its code; anything else is internal", () => {
    expect(toFailure(new JobFailure("too_long", "16 h"))).toEqual({ code: "too_long", detail: "16 h" });
    expect(toFailure(new TypeError("boom")).code).toBe("internal");
    expect(toFailure("x").code).toBe("internal");
  });

  it("scrub removes presigned query strings, bearer tokens, JWTs and passwords", () => {
    const url = "https://acct.r2.cloudflarestorage.com/bucket/upload/source/x/source?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=KEY%2F20261012&X-Amz-Signature=abcdef0123";
    // A JWT-shaped string, assembled here so the repo's secret scan never sees a token literal in the source.
    const jwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "c2lnbmF0dXJlLXZhbHVl"].join(".");
    const s = scrub(`GET ${url} failed; Authorization: Bearer abc.def.ghi; token ${jwt} {"password":"hunter2hunter2","refresh_token":"r-123"}`);
    expect(s).not.toMatch(/X-Amz-Signature=abcdef|KEY%2F|hunter2|r-123|eyJhbGci|abc\.def\.ghi/);
    expect(s).toContain("https://acct.r2.cloudflarestorage.com/bucket/upload/source/x/source?[redacted]");
    expect(s).toContain("Bearer [redacted]");
  });

  it("the logger scrubs every string field", () => {
    const lines: string[] = [];
    jsonLogger((l) => lines.push(l))("x", { error: "PUT https://h/p?X-Amz-Signature=deadbeef failed", n: 3 });
    expect(lines[0]).not.toContain("deadbeef");
    expect(JSON.parse(lines[0])).toMatchObject({ event: "x", n: 3 });
  });

  it("vidCode finds the database's code inside a message", () => {
    expect(vidCode("rpc video_source_heartbeat 403: VID-CONV-002: this claim is not held")).toBe("VID-CONV-002");
    expect(vidCode("nothing here")).toBeUndefined();
  });
});
