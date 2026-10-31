/**
 * F-AUD-1 — every build names its commit; the P15 push job waits for it.
 * (C-34: each decision and each stamp shape is shown failing.)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolveBuildCommit, stampHtml, readStamp } from "../../scripts/web-build-commit.mjs";
import { decide, selfTest } from "../../scripts/web-wait-for-deploy.mjs";

const A = "a".repeat(40);
const B = "b".repeat(40);

describe("build-commit stamp", () => {
  it("prefers CF_PAGES_COMMIT_SHA, then GITHUB_SHA, then git, else 'unknown'", () => {
    expect(resolveBuildCommit({ CF_PAGES_COMMIT_SHA: A, GITHUB_SHA: B }, () => B)).toBe(A);
    expect(resolveBuildCommit({ GITHUB_SHA: B }, () => A)).toBe(B);
    expect(resolveBuildCommit({}, () => A)).toBe(A);
    expect(resolveBuildCommit({ CF_PAGES_COMMIT_SHA: "not-a-sha" }, () => { throw new Error("no git"); })).toBe("unknown");
  });
  it("stamps once, before </head>, and reads back", () => {
    const html = "<html><head><title>x</title></head><body></body></html>";
    const once = stampHtml(html, A);
    expect(readStamp(once)).toBe(A);
    expect(once.indexOf("build-commit")).toBeLessThan(once.indexOf("</head>"));
    const twice = stampHtml(once, B);
    expect(readStamp(twice)).toBe(B);
    expect(twice.match(/build-commit/g)).toHaveLength(1);
  });
  it("no stamp -> null", () => expect(readStamp("<html><head></head></html>")).toBeNull());
  it("vite.config.ts registers the plugin", () => {
    expect(readFileSync("vite.config.ts", "utf8")).toMatch(/buildCommitPlugin\(\),/);
  });
});

describe("the waiter", () => {
  it("self-test", () => expect(selfTest()).toEqual([]));
  it("waits while an older build is served; proceeds on ours or a newer one containing ours", () => {
    expect(decide(B, A, () => false).done).toBe(false);
    expect(decide(A, A, () => false).done).toBe(true);
    expect(decide(B, A, () => true).done).toBe(true);
    expect(decide(null, A, () => true).done).toBe(false);
  });
  it("the P15 push job runs the waiter BEFORE measuring", () => {
    const wf = readFileSync(".github/workflows/d2-compression.yml", "utf8");
    const wait = wf.indexOf("node scripts/web-wait-for-deploy.mjs \"$ORIGIN\" \"$PUSHED_SHA\"");
    const measure = wf.indexOf("node scripts/web-compression-check.mjs \"$ORIGIN\"");
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThan(measure);
    expect(wf).toMatch(/fetch-depth: 0/);
  });
});
