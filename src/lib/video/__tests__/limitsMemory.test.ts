/**
 * No time limit (Owner A3.2); the one honest bound is this device's memory
 * while the web encoder holds the whole sound track (A4.7).
 */
import { describe, expect, it } from "vitest";
import { deviceMemoryBudget, encodeMemoryBytes, memoryProblem, videoLimitProblems, type VideoFacts } from "../limits";

const hd = (minutes: number, mb: number): VideoFacts => ({ durationSeconds: minutes * 60, bytes: mb * 1_048_576, width: 1080, height: 1920 });
const desktop = deviceMemoryBudget({ deviceMemory: 8 });
const phone = deviceMemoryBudget({ deviceMemory: 4 });

describe("no time limit", () => {
  it("7:28, 1 h and 3 h raise no time problem", () => {
    for (const m of [7.5, 60, 180]) expect(videoLimitProblems(hd(m, 300), "post")).toEqual([]);
  });
  it("500 MB is still the limit for the picked file", () => {
    expect(videoLimitProblems(hd(10, 600), "post").join()).toMatch(/up to 500 MB/);
  });
});

describe("this device's memory", () => {
  it("the Owner's 7:28 / 91 MB video fits a phone and a computer", () => {
    expect(memoryProblem(hd(7.5, 91), false, phone)).toBeNull();
    expect(memoryProblem(hd(7.5, 91), false, desktop)).toBeNull();
  });
  it("an hour with sound fits a computer", () => {
    expect(memoryProblem(hd(60, 300), false, desktop)).toBeNull();
  });
  it("an hour with sound is too much for a 4 GB phone's browser — and Remove sound is the way out", () => {
    const p = memoryProblem(hd(60, 300), false, phone);
    expect(p).toMatch(/Remove sound/);
    expect(memoryProblem(hd(60, 300), true, phone)).toBeNull();
  });
  it("without sound the estimate drops by the decoded track (~1.4 GB per hour)", () => {
    const d = encodeMemoryBytes(hd(60, 300), false) - encodeMemoryBytes(hd(60, 300), true);
    expect(d / 1e9).toBeGreaterThan(1.3);
  });
  it("a browser that does not report its memory is planned as 4 GB", () => {
    expect(deviceMemoryBudget({})).toBe(phone);
  });
});
