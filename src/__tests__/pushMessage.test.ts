/**
 * N4 · the push message builder used by send-push (ready to deploy; edge
 * deploys need the Owner's SUPABASE_ACCESS_TOKEN). Pins what each platform gets.
 */
import { describe, it, expect } from "vitest";
import { buildFcmMessage, isSafeImageUrl } from "../../supabase/functions/_shared/pushMessage";

const base = { token: "tok", title: "Anindita liked your photo", body: "", data: { type: "post_reaction", reference_id: "p1" } };

describe("buildFcmMessage", () => {
  it("today's message when nothing new is passed (no image, no category, no delivery id)", () => {
    const m = buildFcmMessage(base);
    expect(m).toEqual({
      token: "tok",
      notification: { title: "Anindita liked your photo", body: "" },
      data: { type: "post_reaction", reference_id: "p1" },
      android: { priority: "high" },
      apns: { payload: { aps: { sound: "default" } } },
    });
  });

  it("puts a picture on Android (big picture) and iOS (mutable content + image)", () => {
    const m = buildFcmMessage({ ...base, imageUrl: "https://cdn.50mmretina.com/p/1.jpg" });
    expect(m.notification.image).toBe("https://cdn.50mmretina.com/p/1.jpg");
    expect(m.android.notification?.image).toBe("https://cdn.50mmretina.com/p/1.jpg");
    expect(m.apns.payload.aps["mutable-content"]).toBe(1);
    expect(m.apns.fcm_options?.image).toBe("https://cdn.50mmretina.com/p/1.jpg");
  });

  it("drops an image that is not https, or not on an allowed host", () => {
    expect(isSafeImageUrl("http://cdn.50mmretina.com/a.jpg")).toBe(false);
    expect(isSafeImageUrl("https://evil.example/a.jpg")).toBe(false);
    expect(isSafeImageUrl("javascript:alert(1)")).toBe(false);
    const m = buildFcmMessage({ ...base, imageUrl: "https://evil.example/a.jpg" });
    expect(m.notification.image).toBeUndefined();
    expect(m.android.notification).toBeUndefined();
  });

  it("carries the action category (Reply / Like, used once the app registers it) on both platforms", () => {
    const m = buildFcmMessage({ ...base, category: "reply_like" });
    expect(m.android.notification?.click_action).toBe("reply_like");
    expect(m.apns.payload.aps.category).toBe("reply_like");
    expect(m.data?.category).toBe("reply_like");
  });

  it("carries the delivery id so the app can report 'opened'", () => {
    const m = buildFcmMessage({ ...base, deliveryId: 42 });
    expect(m.data?.delivery_id).toBe("42");
  });

  it("every data value is a string (FCM rejects anything else)", () => {
    const m = buildFcmMessage({ ...base, data: { n: 3 as unknown as string, ok: true as unknown as string } });
    expect(m.data).toEqual({ n: "3", ok: "true" });
  });

  it("groups a member's notifications of one kind with a tag on Android", () => {
    const m = buildFcmMessage({ ...base, groupKey: "post_reaction:p1" });
    expect(m.android.notification?.tag).toBe("post_reaction:p1");
    expect(m.apns.payload.aps["thread-id"]).toBe("post_reaction:p1");
  });
});

describe("send-push uses the builder (so what is tested is what is sent)", () => {
  it("imports buildFcmMessage and no longer shapes the message inline", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("supabase/functions/send-push/index.ts", "utf8");
    expect(src).toMatch(/import \{ buildFcmMessage \} from "\.\.\/_shared\/pushMessage\.ts"/);
    expect(src).toMatch(/buildFcmMessage\(\{/);
    expect(src).not.toMatch(/notification:\s*\{\s*title/);
  });
});
