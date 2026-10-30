import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));

import { describeOpsAlarms } from "@/lib/opsAlarms";

const now = new Date("2026-10-30T12:00:00Z");

describe("Foundation fix U3 — Admin → Health alarm banner (20261103_0300)", () => {
  it("shows every open alarm", () => {
    const b = describeOpsAlarms(
      [{ alarm_key: "uptime:https://www.50mmretina.com/", summary: "[production] https://www.50mmretina.com/ is DOWN", opened_at: "2026-10-30T11:50:00Z" }],
      "2026-10-30T11:58:00Z",
      now,
      true,
    );
    expect(b.level).toBe("alarm");
    expect(b.level === "alarm" && b.lines[0]).toContain("is DOWN");
  });

  it("a stopped in-database monitor is an alarm, not silence", () => {
    const b = describeOpsAlarms([], "2026-10-30T11:00:00Z", now, true);
    expect(b.level).toBe("alarm");
    expect(b.level === "alarm" && b.lines[0]).toContain("has not run since");
  });

  it("a monitor that never ran is an alarm", () => {
    expect(describeOpsAlarms([], null, now, true).level).toBe("alarm");
  });

  it("nothing open and a fresh check shows no banner", () => {
    expect(describeOpsAlarms([], "2026-10-30T11:56:00Z", now, true).level).toBe("none");
  });

  it("a lane without the migration says so instead of claiming all clear", () => {
    expect(describeOpsAlarms(null, null, now, false).level).toBe("unknown");
  });
});
