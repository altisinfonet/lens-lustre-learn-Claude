// @vitest-environment node
/**
 * CREDIT U3 (review of #881): one photo that can never be drawn must not stop
 * the sweep, must not turn it red every 15 minutes, and must not be retried
 * forever. After PARK_AFTER failures it is parked (20261110_0111: retried once a
 * day), the run goes red exactly once for it, and old-credit still runs.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PARK_AFTER, reportFailure, sweepExitCode } from "../../../../tools/media-derivatives/credit-failure.mjs";

const yml = readFileSync(join(__dirname, "../../../../.github/workflows/photo-credit-sweep.yml"), "utf8").replace(/\r\n/g, "\n");
const stats = () => ({ failed: 0, parked_now: 0 });
const answer = (attempts: number) => vi.fn(async () => new Response(JSON.stringify({ attempts }), { status: 200 }));

describe("a photo that fails", () => {
  it("is counted and reported to the route, and does not fail the run while it can still be retried", async () => {
    const s = stats();
    const post = answer(PARK_AFTER - 1);
    await reportFailure(post, { op: "failed", key: "k" }, "source 500", s);
    expect(post).toHaveBeenCalledWith({ op: "failed", key: "k", error: "source 500" });
    expect(s).toEqual({ failed: 1, parked_now: 0 });
    expect(sweepExitCode(s)).toBe(0);
  });

  it("goes red exactly once, on the failure that parks it", async () => {
    const s = stats();
    await reportFailure(answer(PARK_AFTER), { op: "failed", key: "k" }, "bad", s);
    expect(s.parked_now).toBe(1);
    expect(sweepExitCode(s)).toBe(3);
    const daily = stats();
    await reportFailure(answer(PARK_AFTER + 1), { op: "failed", key: "k" }, "bad", daily);
    expect(daily.parked_now).toBe(0);
    expect(sweepExitCode(daily)).toBe(0);
  });

  it("a report that cannot be delivered never stops the rest of the photos", async () => {
    const s = stats();
    await reportFailure(vi.fn(async () => { throw new Error("network"); }), { op: "failed", key: "k" }, "bad", s);
    expect(s).toEqual({ failed: 1, parked_now: 0 });
  });
});

describe("photo-credit-sweep.yml", () => {
  const step = (name: string) => yml.slice(yml.indexOf(`- name: ${name}`)).split("\n      - ")[0];
  it("old-credit runs whatever set-credit did, as long as the sign-in worked", () => {
    expect(yml).toMatch(/- name: Sign in as the worker account[^\n]*\n\s+id: signin\n/);
    expect(step("Uploads that fell back to the old path")).toMatch(/if: \$\{\{ !cancelled\(\) && steps\.signin\.outcome == 'success' \}\}/);
  });
  it("old-credit runs in sweep mode, so a bad old photo is parked too", () => {
    expect(step("Uploads that fell back to the old path")).toMatch(/old-credit\.mjs --site "\$SITE" --sweep/);
  });
  it("no ${{ inside a run script", () => {
    const lines = yml.split("\n");
    let scripts = 0;
    lines.forEach((line, i) => {
      const m = /^( +)(?:- )?run: (.*)$/.exec(line);
      if (!m) return;
      scripts++;
      const body = [m[2]];
      for (let j = i + 1; j < lines.length && (!lines[j].trim() || lines[j].search(/\S/) > m[1].length); j++) body.push(lines[j]);
      expect(body.join("\n")).not.toContain("${{");
    });
    expect(scripts).toBeGreaterThanOrEqual(5);
  });
});
