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
    expect(isSafeImageUrl("https://abcdefghijklmnopqrst.supabase.co/a.jpg")).toBe(false);   // someone else's project
    expect(isSafeImageUrl("https://jtdtehuqtinjxropkkcn.supabase.co/storage/v1/object/public/a.jpg")).toBe(true);
    expect(isSafeImageUrl("https://cdn.50mmretina.com:8443/a.jpg")).toBe(false);
    expect(isSafeImageUrl("https://u:p@cdn.50mmretina.com/a.jpg")).toBe(false);
    const m = buildFcmMessage({ ...base, imageUrl: "https://evil.example/a.jpg" });
    expect(m.notification.image).toBeUndefined();
    expect(m.android.notification).toBeUndefined();
  });

  it("carries the action category in data and iOS aps — never as Android click_action", () => {
    const m = buildFcmMessage({ ...base, category: "reply_like" });
    expect(m.apns.payload.aps.category).toBe("reply_like");
    expect(m.data?.category).toBe("reply_like");
    expect(m.android.notification).toBeUndefined();
  });

  it("ignores an unsafe category or group key", () => {
    const m = buildFcmMessage({ ...base, category: "a b\nc", groupKey: "x".repeat(65) });
    expect(m.apns.payload.aps.category).toBeUndefined();
    expect(m.android.notification).toBeUndefined();
    expect(m.data).toEqual(base.data);
  });

  it("the centre's category and delivery id win over caller data with the same keys", () => {
    const m = buildFcmMessage({ ...base, data: { category: "x", delivery_id: "y" }, category: "reply_like", deliveryId: 7 });
    expect(m.data).toEqual({ category: "reply_like", delivery_id: "7" });
  });

  it("carries the delivery id so the app can report 'opened'", () => {
    const m = buildFcmMessage({ ...base, deliveryId: 42 });
    expect(m.data?.delivery_id).toBe("42");
  });

  it("every data value is a string, exactly as before (null → \"null\"); no data → no data object; {} stays {}", () => {
    const m = buildFcmMessage({ ...base, data: { n: 3, ok: true, gone: null } });
    expect(m.data).toEqual({ n: "3", ok: "true", gone: "null" });
    expect(buildFcmMessage({ token: "t", title: "x" }).data).toBeUndefined();
    expect(buildFcmMessage({ token: "t", title: "x", data: {} }).data).toEqual({});
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
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(fileURLToPath(new URL("../../supabase/functions/send-push/index.ts", import.meta.url)), "utf8");
    expect(src).toMatch(/import \{ buildFcmMessage \} from "\.\.\/_shared\/pushMessage\.ts"/);
    expect(src).toMatch(/buildFcmMessage\(\{/);
    expect(src).not.toMatch(/notification:\s*\{\s*title/);
  });
});
