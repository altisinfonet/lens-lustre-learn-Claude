/** S7b-5b · the composer knows when there is no network for a post that cannot be kept. */
import { describe, it, expect, afterEach } from "vitest";
import { onlineManager } from "@tanstack/react-query";
import { noNetworkForPost, OFFLINE_NOT_SENT } from "@/lib/upload/offlineCompose";

afterEach(() => onlineManager.setOnline(true));
describe("offline compose", () => {
  it("no network -> true; online -> false", () => {
    onlineManager.setOnline(false);
    expect(noNetworkForPost()).toBe(true);
    onlineManager.setOnline(true);
    expect(noNetworkForPost()).toBe(false);
  });
  it("the message keeps the post and says when to post it", () => {
    expect(OFFLINE_NOT_SENT.title).toMatch(/No internet/);
    expect(OFFLINE_NOT_SENT.description).toMatch(/still here/);
  });
});
