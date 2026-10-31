/**
 * S7b-4 · what the member opened online opens again with no network: a post
 * page, and a comment thread with its authors' names. Per member, on the
 * phone's device store (wiped on sign-out).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { memoryBackend, setBackend } from "@/lib/offline/deviceStore";
import { rememberPost, savedPost, rememberThread, savedThread } from "@/lib/offline/seenContent";

const ME = "me-1";
beforeEach(() => setBackend(memoryBackend()));

describe("seen content", () => {
  it("a post page opened online is there offline, for that member only", async () => {
    await rememberPost(ME, { id: "p1", content: "hello" });
    expect(await savedPost(ME, "p1")).toEqual({ id: "p1", content: "hello" });
    expect(await savedPost("someone-else", "p1")).toBeNull();
    expect(await savedPost(ME, "p2")).toBeNull();
  });

  it("a comment thread keeps its rows AND its authors' names", async () => {
    const rows = [{ id: "c1", user_id: "u1", content: "nice" }];
    const authors = { u1: { full_name: "Asha", avatar_url: null, custom_url: "asha" } };
    await rememberThread(ME, "p1", rows, authors);
    expect(await savedThread(ME, "p1")).toEqual({ rows, authors });
    expect(await savedThread("someone-else", "p1")).toBeNull();
  });

  it("sign-out wipes it", async () => {
    await rememberPost(ME, { id: "p1" });
    const { wipeMemberDataOnSignOut } = await import("@/lib/offline/signOutWipe");
    await wipeMemberDataOnSignOut();
    expect(await savedPost(ME, "p1")).toBeNull();
  });
});
