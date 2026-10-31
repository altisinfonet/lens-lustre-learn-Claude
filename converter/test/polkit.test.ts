// @vitest-environment node
/**
 * S7 · the polkit rule (deploy/50-converter-ff.rules), evaluated as polkitd does:
 * the file's JavaScript is run against a stand-in `polkit` and the registered rule
 * is asked about every case. Each worker may start/stop ONLY its own lane's
 * sandbox units — converter → converter-ff@<uuid>.service, converter-live →
 * converter-live-ff@<uuid>.service — never the other lane's, never another verb,
 * never another unit, never another action. Everything else is NOT_HANDLED
 * (polkit's default for manage-units is then "auth_admin", which a system user
 * without a session cannot answer: denied).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

type Rule = (action: { id: string; lookup: (k: string) => string | undefined }, subject: { user: string }) => string;

const RESULT = { YES: "yes", NO: "no", NOT_HANDLED: "not_handled", AUTH_ADMIN: "auth_admin", AUTH_SELF: "auth_self" };

function loadRule(): Rule {
  const src = readFileSync(path.join(__dirname, "..", "deploy", "50-converter-ff.rules"), "utf8");
  const rules: Rule[] = [];
  const polkit = { Result: RESULT, addRule: (r: Rule) => rules.push(r), log: () => undefined };
  new Function("polkit", src)(polkit);
  expect(rules).toHaveLength(1);
  return rules[0];
}

const MANAGE = "org.freedesktop.systemd1.manage-units";
const U = "0f8b2c4e-1a2b-4c3d-8e9f-0123456789ab";
const ask = (rule: Rule, user: string, unit: string, verb = "start", id = MANAGE) =>
  rule({ id, lookup: (k) => (k === "unit" ? unit : k === "verb" ? verb : undefined) }, { user });

describe("converter · polkit rule: each lane's worker, its own sandbox units only", () => {
  const rule = loadRule();

  it("staging: converter may start and stop converter-ff@<uuid>.service", () => {
    expect(ask(rule, "converter", `converter-ff@${U}.service`, "start")).toBe(RESULT.YES);
    expect(ask(rule, "converter", `converter-ff@${U}.service`, "stop")).toBe(RESULT.YES);
  });

  it("live: converter-live may start and stop converter-live-ff@<uuid>.service", () => {
    expect(ask(rule, "converter-live", `converter-live-ff@${U}.service`, "start")).toBe(RESULT.YES);
    expect(ask(rule, "converter-live", `converter-live-ff@${U}.service`, "stop")).toBe(RESULT.YES);
  });

  it("neither lane may touch the OTHER lane's sandbox units", () => {
    for (const verb of ["start", "stop"]) {
      expect(ask(rule, "converter", `converter-live-ff@${U}.service`, verb)).toBe(RESULT.NOT_HANDLED);
      expect(ask(rule, "converter-live", `converter-ff@${U}.service`, verb)).toBe(RESULT.NOT_HANDLED);
    }
  });

  it("no other verb (restart, reload, kill, enable…)", () => {
    for (const verb of ["restart", "reload", "reload-or-restart", "try-restart", "kill", "enable", "", "START"]) {
      expect(ask(rule, "converter", `converter-ff@${U}.service`, verb)).toBe(RESULT.NOT_HANDLED);
      expect(ask(rule, "converter-live", `converter-live-ff@${U}.service`, verb)).toBe(RESULT.NOT_HANDLED);
    }
  });

  it("no other unit: the workers themselves, the template, system units, look-alike names", () => {
    const units = [
      "converter.service", "converter-live.service", "converter-ff@.service", "converter-live-ff@.service",
      "systemd-journald.service", "polkit.service", "ssh.service", "var-lib-converter-jobs.mount",
      `converter-ff@${U.toUpperCase()}.service`, `converter-ff@${U}.service.d`, `converter-ff@${U}.socket`,
      `converter-ff@${U}.service\n`, `xconverter-ff@${U}.service`, `converter-ff@${U}x.service`,
      `converter-ff@not-a-uuid.service`, `converter-live-ff@${U}.timer`, `converter-x-ff@${U}.service`, "",
    ];
    for (const u of units) {
      expect(ask(rule, "converter", u)).toBe(RESULT.NOT_HANDLED);
      expect(ask(rule, "converter-live", u)).toBe(RESULT.NOT_HANDLED);
    }
  });

  it("no other user: the FFmpeg users, root, look-alikes", () => {
    for (const user of ["ffjob", "ffjob-live", "root", "ubuntu", "converter-staging", "Converter", "converter-live2", ""]) {
      expect(ask(rule, user, `converter-ff@${U}.service`)).toBe(RESULT.NOT_HANDLED);
      expect(ask(rule, user, `converter-live-ff@${U}.service`)).toBe(RESULT.NOT_HANDLED);
    }
  });

  it("no other action (transient units, unit files, reload of the daemon)", () => {
    for (const id of ["org.freedesktop.systemd1.manage-unit-files", "org.freedesktop.systemd1.reload-daemon", "org.freedesktop.systemd1.set-environment"]) {
      expect(ask(rule, "converter", `converter-ff@${U}.service`, "start", id)).toBe(RESULT.NOT_HANDLED);
      expect(ask(rule, "converter-live", `converter-live-ff@${U}.service`, "start", id)).toBe(RESULT.NOT_HANDLED);
    }
  });
});
