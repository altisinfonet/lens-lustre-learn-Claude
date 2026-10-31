import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { reportPushOpened } from "@/lib/notifications/pushOpened";

describe("reportPushOpened (N4 receipts)", () => {
  // Block body on purpose: a function RETURNED from beforeEach is run by vitest
  // as a teardown, and returning the mock made vitest call it after each test.
  beforeEach(() => {
    rpc.mockReset().mockResolvedValue({ data: true, error: null });
  });

  it("reports the delivery id carried by the push", async () => {
    await reportPushOpened({ type: "post_reaction", delivery_id: "42" });
    expect(rpc).toHaveBeenCalledWith("notification_delivery_opened", { _id: 42 });
  });

  it("does nothing for a push without a receipt (today's pushes)", async () => {
    await reportPushOpened({ type: "post_reaction" });
    await reportPushOpened({ delivery_id: "" });
    await reportPushOpened({ delivery_id: "abc" });
    await reportPushOpened({ delivery_id: "-3" });
    await reportPushOpened({ delivery_id: "1.5" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("never throws, whatever the server does", async () => {
    rpc.mockRejectedValue(new Error("offline"));
    await expect(reportPushOpened({ delivery_id: "7" })).resolves.toBeUndefined();
  });
});
