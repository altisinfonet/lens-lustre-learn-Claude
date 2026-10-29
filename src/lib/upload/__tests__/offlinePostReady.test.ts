/**
 * S7b-5b · A NEW POST WITH PHOTOS MADE WITH NO NETWORK. The resumable photo
 * job (S5) keeps such a post on the phone and publishes it once (idempotency
 * key) when the network is back — but only when two answers say yes: the
 * switch `photo_upload_resume` and "is R2 storage on". Offline both answers
 * failed and read as NO (isS3Enabled even cached false for a minute), so a post
 * made in flight mode never took the job path and failed instead.
 * Now: a failed read means "the last answer this phone saw", never a new no.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const db = vi.hoisted(() => ({ s3: true as boolean | null, s3Fails: false, rows: [] as { key: string; value: unknown }[], settingsFail: false }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async () => (db.s3Fails ? { data: null, error: { message: "TypeError: Failed to fetch" } } : { data: db.s3, error: null }),
    from: () => ({ select: () => ({ in: async () => {
      if (db.settingsFail) throw new TypeError("Failed to fetch");
      return { data: db.rows, error: null };
    } }) }),
  },
}));

const { isS3Enabled, clearS3Cache } = await import("@/lib/s3Upload");
const { photoResumeOn } = await import("@/lib/upload/photoJobDeps");
const { invalidateSiteSetting } = await import("@/lib/siteSettingsCache");

beforeEach(() => {
  localStorage.clear();
  clearS3Cache();
  invalidateSiteSetting();
  db.s3 = true; db.s3Fails = false; db.rows = []; db.settingsFail = false;
});

describe("storage switch offline", () => {
  it("a failed read is the last answer seen, not 'off'", async () => {
    expect(await isS3Enabled()).toBe(true);
    clearS3Cache();
    db.s3Fails = true;
    expect(await isS3Enabled()).toBe(true);
  });
  it("never seen: off (nothing is switched on by a failure)", async () => {
    db.s3Fails = true;
    expect(await isS3Enabled()).toBe(false);
  });
});

describe("photo_upload_resume offline", () => {
  it("a failed read is the last answer seen", async () => {
    db.rows = [{ key: "photo_upload_resume", value: "on" }];
    expect(await photoResumeOn()).toBe(true);
    invalidateSiteSetting();
    db.settingsFail = true;
    expect(await photoResumeOn()).toBe(true);
  });
  it("off stays off; never seen + failed read: off", async () => {
    db.settingsFail = true;
    expect(await photoResumeOn()).toBe(false);
    db.settingsFail = false;
    db.rows = [{ key: "photo_upload_resume", value: "off" }];
    invalidateSiteSetting();
    expect(await photoResumeOn()).toBe(false);
  });
});
