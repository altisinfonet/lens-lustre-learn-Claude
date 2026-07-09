/**
 * Phase R3 — Judging invariants test
 * ----------------------------------
 * Calls the SQL function `judging_invariants_check()` (admin-only) and asserts
 * that every check returns status='ok'. The same function is invoked by the
 * nightly cron (`judging-invariants-nightly` edge fn), so a green test here
 * guarantees a green production check.
 *
 * The test is SKIPPED automatically in environments where service-role
 * credentials are not available (e.g. PR runs without secrets) so it never
 * red-flags a contributor who can't reach the live DB.
 */
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const canRun = Boolean(URL && SERVICE_KEY);

describe.skipIf(!canRun)("Phase R3 — judging data invariants", () => {
  it("judging_invariants_check returns all 'ok'", async () => {
    const admin = createClient(URL!, SERVICE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Service-role bypasses the admin-only guard via direct SQL access.
    // We piggy-back on the SAME function the cron uses, so test parity is exact.
    const { data, error } = await admin.rpc("judging_invariants_check" as any);
    if (error) throw error;

    const rows = (data as any[]) ?? [];
    expect(rows.length).toBeGreaterThan(0);

    const failures = rows.filter((r) => r.status !== "ok");
    if (failures.length > 0) {
      // Surface useful context in the test output, not just a boolean failure.
      // eslint-disable-next-line no-console
      console.error("Invariant failures:", JSON.stringify(failures, null, 2));
    }
    expect(failures).toEqual([]);
  });
});
