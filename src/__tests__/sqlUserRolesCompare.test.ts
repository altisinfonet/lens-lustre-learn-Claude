/**
 * PROBE_20261030_0700 failed on staging after apply (apply-migration run
 * 41042014241): `operator does not exist: text = app_role` at
 * `WHERE ur.role = 'admin'::public.app_role` (PROBE line 83). user_roles.role
 * was created as public.app_role, but on the staging lane it is text today, so
 * the type differs by lane. `ur.role::text = 'admin'` works on either type.
 * This guard covers SQL written from 2026-10-30 on (older files are applied
 * history and are not rewritten).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIRS = ["supabase/migrations", "supabase/rollback"];
const FROM = 20261030;
const BAD = /\b(?:ur|user_roles)\.role\s*(?:=|<>|!=|IN)\s*\(?\s*'[a-z_]+'\s*::\s*(?:public\.)?app_role/i;

function dated(name: string): number {
  const m = name.match(/(?:^|_)(20\d{6})/);
  return m ? Number(m[1]) : 0;
}

describe("SQL compares user_roles.role in a lane-proof way", () => {
  it("no SQL from 2026-10-30 on compares user_roles.role to an app_role literal", () => {
    const offenders: string[] = [];
    for (const d of DIRS) {
      for (const f of readdirSync(d)) {
        if (!f.endsWith(".sql") || dated(f) < FROM) continue;
        readFileSync(join(d, f), "utf8").split("\n").forEach((line, i) => {
          if (BAD.test(line)) offenders.push(`${d}/${f}:${i + 1}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});
