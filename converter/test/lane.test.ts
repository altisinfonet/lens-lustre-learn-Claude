// @vitest-environment node
/**
 * S7 · the LIVE lane's files, as `setup.sh --lane live` renders them from the
 * staging files (deploy/lane-lib.sh). The rendered worker unit's own Environment=
 * lines, fed to the worker's loadConfig, must route EVERY path to the live lane
 * (credentials, secrets, state, jobs) and every sandbox run to converter-live-ff@;
 * no staging path may survive anywhere except the one line that hides the staging
 * lane from it. The staging files render to themselves (the staging install is
 * unchanged).
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config";

const DEPLOY = path.join(__dirname, "..", "deploy");
const render = (lane: string, file: string) =>
  execFileSync("bash", ["lane-lib.sh", "render", lane, file], { cwd: DEPLOY, encoding: "utf8" });
const directives = (unit: string) => unit.split("\n").filter((l) => l && !l.startsWith("#"));
const unitEnv = (unit: string): NodeJS.ProcessEnv =>
  Object.fromEntries(directives(unit).filter((l) => l.startsWith("Environment=")).map((l) => {
    const kv = l.slice("Environment=".length);
    return [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)];
  }));
/** a staging path or name, outside the line that hides the staging lane */
const STAGING = /\/var\/lib\/converter(\/|$|\s)|\/etc\/converter\/converter\.env|\/opt\/converter\/worker\.mjs|=converter$|=ffjob$|=convjob$|=converter-ff$|var-lib-converter-jobs\.mount/;

describe("converter · the live lane's rendered units", () => {
  const live = render("live", "converter.service");
  const liveFf = render("live", "converter-ff@.service");
  const liveMount = render("live", "var-lib-converter-jobs.mount");

  it("the worker's env overrides in converter-live.service route every path to /var/lib/converter-live", () => {
    const c = loadConfig({ ...unitEnv(live), CONVERTER_LAUNCHER: "direct" }, { requireNetwork: false });
    expect(c).toMatchObject({
      credentialsFile: "/var/lib/converter-live/secrets/credentials.json",
      secretsDir: "/var/lib/converter-live/secrets",
      stateFile: "/var/lib/converter-live/state/claim.json",
      jobsRoot: "/var/lib/converter-live/jobs",
      unitPrefix: "converter-live-ff",
    });
  });

  it("converter.service's own overrides are the staging defaults (nothing changes for staging)", () => {
    const staging = readFileSync(path.join(DEPLOY, "converter.service"), "utf8");
    expect(render("staging", "converter.service")).toBe(staging);
    const env = { CONVERTER_LAUNCHER: "direct" };
    expect(loadConfig({ ...unitEnv(staging), ...env }, { requireNetwork: false }))
      .toMatchObject({ ...loadConfig(env, { requireNetwork: false }), launcher: "direct" });
  });

  it("converter-live.service: its own user, env file, bundle, mount; staging hidden; no staging path left", () => {
    const d = directives(live);
    expect(d).toEqual(expect.arrayContaining([
      "User=converter-live", "Group=converter-live", "SupplementaryGroups=convjob-live",
      "EnvironmentFile=/etc/converter/converter-live.env", "WorkingDirectory=/var/lib/converter-live",
      "ExecStart=@NODE_BIN@ /opt/converter-live/worker.mjs",
      "ReadWritePaths=/var/lib/converter-live/state /var/lib/converter-live/jobs",
      "InaccessiblePaths=-/var/lib/converter",
      "Requires=var-lib-converter\\x2dlive-jobs.mount",
    ]));
    expect(d.filter((l) => l !== "InaccessiblePaths=-/var/lib/converter" && STAGING.test(l))).toEqual([]);
  });

  it("converter-live-ff@.service: user ffjob-live, its own job dir only, BOTH lanes' secrets/state hidden", () => {
    const d = directives(liveFf);
    expect(d).toEqual(expect.arrayContaining([
      "User=ffjob-live", "Group=ffjob-live", "SupplementaryGroups=convjob-live",
      "RequiresMountsFor=/var/lib/converter-live/jobs/%i",
      "ExecStart=/usr/local/lib/converter/ffjob-run %i /var/lib/converter-live/jobs",
      "ReadWritePaths=/var/lib/converter-live/jobs/%i",
      "InaccessiblePaths=-/var/lib/converter-live/secrets -/var/lib/converter-live/state -/etc/converter",
      "InaccessiblePaths=-/var/lib/converter",
      "PrivateNetwork=yes",
    ]));
    expect(d.filter((l) => l !== "InaccessiblePaths=-/var/lib/converter" && STAGING.test(l))).toEqual([]);
  });

  it("the staging sandbox and worker hide the live lane", () => {
    expect(directives(readFileSync(path.join(DEPLOY, "converter-ff@.service"), "utf8"))).toContain("InaccessiblePaths=-/var/lib/converter-live");
    expect(directives(readFileSync(path.join(DEPLOY, "converter.service"), "utf8"))).toContain("InaccessiblePaths=-/var/lib/converter-live");
  });

  it("the live job space is its own image at its own mount point", () => {
    expect(directives(liveMount)).toEqual(expect.arrayContaining([
      "What=/var/lib/converter-live/jobs.img", "Where=/var/lib/converter-live/jobs", "Options=loop,nodev,nosuid,noexec",
    ]));
    expect(directives(liveMount).filter((l) => STAGING.test(l))).toEqual([]);
  });

  it("each lane's session file (its refresh token) is in its own writable state dir, and hidden from the OTHER lane's worker and from BOTH lanes' FFmpeg runs", () => {
    const staging = readFileSync(path.join(DEPLOY, "converter.service"), "utf8");
    const stagingFf = readFileSync(path.join(DEPLOY, "converter-ff@.service"), "utf8");
    const sessionOf = (unit: string) => loadConfig({ ...unitEnv(unit), CONVERTER_LAUNCHER: "direct" }, { requireNetwork: false }).sessionFile;
    const hidden = (unit: string) => directives(unit).filter((l) => l.startsWith("InaccessiblePaths="))
      .flatMap((l) => l.slice("InaccessiblePaths=".length).split(/\s+/)).map((p) => p.replace(/^-/, ""));
    const writable = (unit: string) => directives(unit).filter((l) => l.startsWith("ReadWritePaths=")).flatMap((l) => l.slice("ReadWritePaths=".length).split(/\s+/));
    const under = (file: string, dirs: string[]) => dirs.some((d) => file === d || file.startsWith(`${d}/`));
    const s = sessionOf(staging), l = sessionOf(live);
    expect(s).toBe("/var/lib/converter/state/session.json");
    expect(l).toBe("/var/lib/converter-live/state/session.json");
    // its own worker may write it
    expect(under(s, writable(staging))).toBe(true);
    expect(under(l, writable(live))).toBe(true);
    // the other lane's worker cannot even see it
    expect(under(s, hidden(live))).toBe(true);
    expect(under(l, hidden(staging))).toBe(true);
    // no FFmpeg run of either lane can see either lane's session
    for (const ff of [stagingFf, liveFf]) {
      expect(under(s, hidden(ff))).toBe(true);
      expect(under(l, hidden(ff))).toBe(true);
    }
  });
});
