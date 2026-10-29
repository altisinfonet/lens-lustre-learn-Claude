import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));

import { buildsOverWindow } from "@/components/admin/AdminAppHealth";

describe("S2 App health — crash rate per build includes native crashes and OOM (20261031_0100)", () => {
  it("sums crashes, OOM and ANR per build over the window; crash rate = (crashes + OOM) per 100 starts", () => {
    const rows = buildsOverWindow([
      { day: "2026-10-29", platform: "android", app_build: "v1133", starts: 100, errors: 4, errors_per_100_starts: 4, crashes: 2, oom: 1, anr: 1 },
      { day: "2026-10-28", platform: "android", app_build: "v1133", starts: 100, errors: 0, errors_per_100_starts: 0, crashes: 1, oom: 0, anr: 0 },
      { day: "2026-10-29", platform: "web", app_build: "unknown", starts: 50, errors: 1, errors_per_100_starts: 2, crashes: 0, oom: 0, anr: 0 },
    ]);
    expect(rows.native).toBe(true);
    const a = rows.find((r) => r.app_build === "v1133")!;
    expect([a.starts, a.crashes, a.oom, a.anr, a.errors]).toEqual([200, 3, 1, 1, 4]);
    expect(a.crashRate).toBe(2);
    expect(a.rate).toBe(2);
  });

  it("a lane without 20261031_0100 (no native columns) is reported as such, not as zero crashes", () => {
    const rows = buildsOverWindow([
      { day: "2026-10-29", platform: "android", app_build: "v1132", starts: 10, errors: 1, errors_per_100_starts: 10 },
    ]);
    expect(rows.native).toBe(false);
    expect(rows[0].rate).toBe(10);
  });
});
