/**
 * N4 · the push message builder used by send-push (ready to deploy; edge
 * deploys need the Owner's SUPABASE_ACCESS_TOKEN). Pins what each platform gets.
 */
import { describe, it, expect } from "vitest";
import { buildFcmMessage, isSafeImageUrl } from "../../supabase/functions/_shared/pushMessage";

const base = { token: "tok", title: "Anindita liked your photo", body: "", data: { type: "post_reaction", reference_id: "p1" } };
/** Hosts are made up: lane hosts come from each lane's environment, never from code. */
const HOSTS = ["cdn.example-lane.test", "abcdefghijklmnopqrst.supabase.co"];

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
    const img = "https://cdn.example-lane.test/p/1.jpg";
    const m = buildFcmMessage({ ...base, imageUrl: img, imageHosts: HOSTS });
    expect(m.notification.image).toBe(img);
    expect(m.android.notification?.image).toBe(img);
    expect(m.apns.payload.aps["mutable-content"]).toBe(1);
    expect(m.apns.fcm_options?.image).toBe(img);
  });

  it("drops an image that is not https, not on this lane's hosts, or has a port / user:pass", () => {
    expect(isSafeImageUrl("http://cdn.example-lane.test/a.jpg", HOSTS)).toBe(false);
    expect(isSafeImageUrl("https://evil.example/a.jpg", HOSTS)).toBe(false);
    expect(isSafeImageUrl("javascript:alert(1)", HOSTS)).toBe(false);
    expect(isSafeImageUrl("https://zzzzzzzzzzzzzzzzzzzz.supabase.co/a.jpg", HOSTS)).toBe(false);   // another project
    expect(isSafeImageUrl("https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/a.jpg", HOSTS)).toBe(true);
    expect(isSafeImageUrl("https://cdn.example-lane.test:8443/a.jpg", HOSTS)).toBe(false);
    expect(isSafeImageUrl("https://u:p@cdn.example-lane.test/a.jpg", HOSTS)).toBe(false);
    expect(isSafeImageUrl("https://cdn.example-lane.test/a.jpg", [])).toBe(false);                // no lane config → no image
    const m = buildFcmMessage({ ...base, imageUrl: "https://evil.example/a.jpg", imageHosts: HOSTS });
    expect(m.notification.image).toBeUndefined();
    expect(m.android.notification).toBeUndefined();
  });

  it("an image with no host list is dropped (never a default host)", () => {
    expect(buildFcmMessage({ ...base, imageUrl: "https://cdn.example-lane.test/a.jpg" }).notification.image).toBeUndefined();
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
    // Repo-root relative, like the other source-reading tests here (vitest runs from the root).
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(process.cwd(), "supabase/functions/send-push/index.ts"), "utf8");
    expect(src).toMatch(/import \{ buildFcmMessage \} from "\.\.\/_shared\/pushMessage\.ts"/);
    expect(src).toMatch(/buildFcmMessage\(\{/);
    expect(src).not.toMatch(/notification:\s*\{\s*title/);
    expect(src).toMatch(/image_url \? laneImageHosts\(\) : \[\]/);
  });
});
