/**
 * N7b · the row badge and the "Turn off this kind" switch follow the
 * notification centre's type registry (20261104_0110), never a guess:
 *   badge  — heart → like, comment/reply → comment, follows_friends → follow,
 *            competitions → competition, tag → mention; anything else none;
 *   turn off — only a member type the registry lets a member disable
 *            (member_can_disable) and that has a bell setting (pref_in_app),
 *            and it writes exactly that column.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { badgeFor, bellSettingFor } from "@/lib/notifications/kinds";

const sql = readFileSync(resolve(__dirname, "../../../../supabase/migrations/20261104_0110_notification_centre.sql"), "utf8");
type Row = { type: string; audience: string; group: string; icon: string; canOff: boolean; inApp: string | null };
const registry: Row[] = [];
for (const m of sql.matchAll(
  /^\s*\('([a-z_]+)',\s*'(member|admin)',\s*'([a-z_]+)',\s*'([a-z-]+)',\s*'\{[^}]*\}',\s*(true|false),\s*(NULL|'[a-z_]+')/gm,
)) {
  registry.push({ type: m[1], audience: m[2], group: m[3], icon: m[4], canOff: m[5] === "true", inApp: m[6] === "NULL" ? null : m[6].slice(1, -1) });
}

describe("row badge and Turn off follow the registry (20261104_0110)", () => {
  it("reads the registry", () => {
    expect(registry.length).toBeGreaterThanOrEqual(49);
  });

  it("every member type gets the badge its registry entry implies", () => {
    for (const r of registry.filter((x) => x.audience === "member")) {
      const want =
        r.group === "follows_friends" ? "follow"
        : r.group === "competitions" ? "competition"
        : r.icon === "heart" ? "like"
        : r.icon === "comment" || r.icon === "reply" ? "comment"
        : r.icon === "tag" ? "mention"
        : null;
      expect([r.type, badgeFor(r.type)]).toEqual([r.type, want]);
    }
  });

  it("Turn off is offered only where a member may turn it off, and writes the registry's bell column", () => {
    for (const r of registry) {
      const want = r.audience === "member" && r.canOff && r.inApp ? r.inApp : null;
      expect([r.type, bellSettingFor(r.type)]).toEqual([r.type, want]);
    }
  });

  it("an unknown type gets no badge and no Turn off", () => {
    expect(badgeFor("not_a_type")).toBeNull();
    expect(bellSettingFor("not_a_type")).toBeNull();
  });
});
