/**
 * S5 · Admin → Uploads → Upload Resume. The Owner switches `photo_upload_resume`
 * himself (Off / Selected members / All members), on the same feature_access
 * screen as Personal Feed and video.
 *
 * What the app reads is still site_settings `photo_upload_resume`; a trigger in
 * 20261103_0601 writes it from the admin's mode in the same transaction:
 *   All members → "on"   (exactly what builds 1.2.29+ read: no app update)
 *   Selected    → "selected" (old builds compare === "on": they read OFF, safe)
 *   Off         → "off"
 * This file proves the chain end to end on the client side: the mapping the
 * SQL stores → what photoResumeOn() answers, and what an old build answers.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const db = vi.hoisted(() => ({
  rows: [] as { key: string; value: unknown }[],
  allowed: false as boolean,
  rpcFails: false,
  rpcRefused: false,
  settingsFail: false,
  rpcCalls: [] as Array<{ fn: string; args: unknown }>,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (fn: string, args: unknown) => {
      db.rpcCalls.push({ fn, args });
      if (db.rpcFails) return { data: null, error: { message: "TypeError: Failed to fetch" } };
      if (db.rpcRefused) return { data: null, error: { message: "permission denied", code: "42501" } };
      return { data: db.allowed, error: null };
    },
    from: () => ({ select: () => ({ in: async () => {
      if (db.settingsFail) throw new TypeError("Failed to fetch");
      return { data: db.rows, error: null };
    } }) }),
  },
}));

const { photoResumeOn } = await import("@/lib/upload/photoJobDeps");
const { invalidateSiteSetting } = await import("@/lib/siteSettingsCache");
const { FEATURE_INFO, parseFeatureState } = await import("@/lib/admin/featureSwitches");

const MIGRATION = resolve(__dirname, "../../../../supabase/migrations/20261103_0601_s5_photo_resume_admin_switch.sql");
const sql = () => readFileSync(MIGRATION, "utf8");

/** What the 0601 trigger stores for a mode — read from the SQL itself, not restated. */
function storedFor(mode: "off" | "selected" | "everyone"): string {
  const m = sql().match(/CASE\s+NEW\.mode\s+WHEN\s+'everyone'\s+THEN\s+'(\w+)'\s+WHEN\s+'selected'\s+THEN\s+'(\w+)'\s+ELSE\s+'(\w+)'\s+END/);
  if (!m) throw new Error("0601: the mode → site_settings CASE was not found");
  return mode === "everyone" ? m[1] : mode === "selected" ? m[2] : m[3];
}

/** Builds 1.2.29 … today: `st.value === "on"` and nothing else. */
const oldBuildReads = (v: unknown) => v === "on";

const ME = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  localStorage.clear();
  invalidateSiteSetting();
  db.rows = []; db.allowed = false; db.rpcFails = false; db.rpcRefused = false; db.settingsFail = false; db.rpcCalls = [];
});

const setStored = (mode: "off" | "selected" | "everyone") => {
  invalidateSiteSetting();
  db.rows = [{ key: "photo_upload_resume", value: storedFor(mode) }];
};

describe("admin mode → stored value → photoResumeOn()", () => {
  it("All members stores exactly \"on\" and the app reads ON (old builds too)", async () => {
    expect(storedFor("everyone")).toBe("on");
    setStored("everyone");
    expect(await photoResumeOn(ME)).toBe(true);
    expect(await photoResumeOn()).toBe(true);
    expect(oldBuildReads(storedFor("everyone"))).toBe(true);
  });

  it("Off stores \"off\" and every build reads OFF", async () => {
    setStored("everyone");
    expect(await photoResumeOn(ME)).toBe(true);
    setStored("off");
    expect(await photoResumeOn(ME)).toBe(false);
    expect(oldBuildReads(storedFor("off"))).toBe(false);
  });

  it("Selected: old builds read OFF (safe); this build asks the server for the signed-in member", async () => {
    expect(storedFor("selected")).toBe("selected");
    expect(oldBuildReads(storedFor("selected"))).toBe(false);
    setStored("selected");
    db.allowed = true;
    expect(await photoResumeOn(ME)).toBe(true);
    expect(db.rpcCalls).toEqual([{ fn: "feature_allowed_me", args: { _feature: "photo_upload_resume" } }]);
    db.allowed = false;
    expect(await photoResumeOn(ME)).toBe(false);
  });

  it("Selected, fail-closed: no member, a refusal, or any unknown value reads OFF", async () => {
    setStored("selected");
    db.allowed = true;
    expect(await photoResumeOn()).toBe(false);
    expect(await photoResumeOn(null)).toBe(false);
    db.rpcRefused = true;
    expect(await photoResumeOn(ME)).toBe(false);
    invalidateSiteSetting();
    db.rpcRefused = false;
    db.rows = [{ key: "photo_upload_resume", value: "ON" }];
    expect(await photoResumeOn(ME)).toBe(false);
    invalidateSiteSetting();
    db.rows = [{ key: "photo_upload_resume", value: true }];
    expect(await photoResumeOn(ME)).toBe(false);
  });

  it("Selected + network lost (S7b-5b): the last answer this member saw; never seen: off", async () => {
    setStored("selected");
    db.rpcFails = true;
    expect(await photoResumeOn(ME)).toBe(false);          // never seen
    db.rpcFails = false; db.allowed = true;
    expect(await photoResumeOn(ME)).toBe(true);           // seen on
    db.rpcFails = true;
    expect(await photoResumeOn(ME)).toBe(true);           // lost network: last seen
    // another member on this phone never inherits it
    expect(await photoResumeOn("22222222-2222-2222-2222-222222222222")).toBe(false);
    // and the whole settings read failing offline keeps the same rule
    invalidateSiteSetting();
    db.settingsFail = true;
    expect(await photoResumeOn(ME)).toBe(true);
  });

  it("seen ON as a selected member, then switched Off, then offline: off", async () => {
    setStored("selected");
    db.allowed = true;
    expect(await photoResumeOn(ME)).toBe(true);
    setStored("off");
    expect(await photoResumeOn(ME)).toBe(false);
    invalidateSiteSetting();
    db.settingsFail = true;
    expect(await photoResumeOn(ME)).toBe(false);
  });
});

describe("the admin screen knows the switch", () => {
  it("label and plain help", () => {
    expect(FEATURE_INFO.photo_upload_resume).toEqual({
      title: "Upload resume",
      blurb: "Photo and video uploads keep trying on a bad network and continue after the app is closed. Each post is published once.",
    });
  });
  it("feature_admin_state rows for photo_upload_resume are shown, not dropped", () => {
    const out = parseFeatureState([{ feature: "photo_upload_resume", mode: "selected", members: [], history: [] }]);
    expect(out.map((s) => [s.feature, s.mode])).toEqual([["photo_upload_resume", "selected"]]);
  });
});

describe("0601 SQL shape", () => {
  it("adds the key to the feature list, seeds it from today's value, mirrors every mode change, and never turns anything on", () => {
    const s = sql();
    expect(s).toMatch(/'photo_upload_resume'/);
    expect(s).toMatch(/AFTER INSERT OR UPDATE OF mode ON public\.feature_access/);
    expect(s).toMatch(/WHEN \(NEW\.feature = 'photo_upload_resume'\)/);
    // the seed keeps the lane's current state: "on" → everyone, anything else → off
    expect(s).toMatch(/WHEN 'on' THEN 'everyone' ELSE 'off'/);
    // it never sets a mode itself (no UPDATE of the switch, no call of the setter)
    expect(s).not.toMatch(/UPDATE\s+public\.feature_access\s+SET/i);
    expect(s).not.toMatch(/(SELECT|PERFORM)\s+public\.feature_set_mode/i);
  });
});
