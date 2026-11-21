import { describe, expect, it } from "vitest";
import { parseConversations, parseSendResult, parseThread, parseUnread, refusalFrom } from "../api";

describe("messages data layer", () => {
  it("maps the server's refusal codes", () => {
    expect(refusalFrom("MSG-040: you can message members you follow")).toBe("no_link");
    expect(refusalFrom("ACCOUNT_UNDER_REVIEW")).toBe("under_review");
    expect(refusalFrom("MSG-060: this message cannot be sent")).toBe("word_guard");
    expect(refusalFrom("MSG-023: photos")).toBe("photos_off");
    expect(refusalFrom("something else")).toBe("unknown");
    expect(refusalFrom(undefined)).toBe("unknown");
  });

  it("drops malformed rows instead of half-showing them", () => {
    expect(parseConversations("x")).toEqual([]);
    expect(parseConversations([{ nope: 1 }, { conversation_id: "c1", unread: 2, other: { user_id: "u2", full_name: "Asha" } }])).toEqual([
      { conversationId: "c1", kind: "direct", title: null, folder: "inbox", muted: false, announcementOnly: false, lastMessageAt: null, other: { userId: "u2", fullName: "Asha", username: null, avatarUrl: null }, last: null, unread: 2 },
    ]);
    expect(parseThread([{ id: "1" }, { id: 7, sender_id: "u", created_at: "t", body: "<b>hi</b>", kind: "text" }])).toEqual([
      { id: 7, senderId: "u", kind: "text", body: "<b>hi</b>", createdAt: "t", status: "sent", tick: null, reply: null, photos: [] },
    ]);
  });

  it("reads the tick only when it is one of the three known words", () => {
    const rows = parseThread([
      { id: 3, sender_id: "u", created_at: "t", body: "a", tick: "read" },
      { id: 2, sender_id: "u", created_at: "t", body: "b", tick: "delivered" },
      { id: 1, sender_id: "u", created_at: "t", body: "c", tick: "<script>" },
    ]);
    expect(rows.map((r) => r.tick)).toEqual(["read", "delivered", null]);
    expect(parseConversations([{ conversation_id: "c", last: { id: 1, sender_id: "u", created_at: "t", tick: "sent" } }])[0].last?.tick).toBe("sent");
  });

  it("reads a reply quote only when it has an id and a sender", () => {
    const rows = parseThread([
      { id: 3, sender_id: "u", created_at: "t", body: "a", reply: { id: 2, sender_id: "v", body: "<b>orig</b>", photo: true } },
      { id: 2, sender_id: "v", created_at: "t", body: "b", reply: { id: "x" } },
      { id: 1, sender_id: "u", created_at: "t", body: "c" },
    ]);
    expect(rows[0].reply).toEqual({ id: 2, senderId: "v", body: "<b>orig</b>", photo: true });
    expect(rows[1].reply).toBeNull();
    expect(rows[2].reply).toBeNull();
  });

  it("keeps the body as plain text and only the sender's own held status", () => {
    const [m] = parseThread([{ id: 1, sender_id: "u", created_at: "t", body: "x", kind: "photo", status: "held", photos: [{ path: "u/a.webp", width: 4, height: 3 }, { nope: 1 }] }]);
    expect(m.status).toBe("held");
    expect(m.photos).toEqual([{ path: "u/a.webp", width: 4, height: 3, expired: false }]);
  });

  it("reads which photos the server deleted after 30 days", () => {
    const [m] = parseThread([{ id: 2, sender_id: "u", created_at: "t", body: "", kind: "photo", status: "sent", photos: [
      { path: "u/old.webp", width: 4, height: 3, expired: true }, { path: "u/new.webp", width: 4, height: 3, expired: false }, { path: "u/odd.webp", expired: "yes" }] }]);
    expect(m.photos.map((p) => p.expired)).toEqual([true, false, false]);
  });

  it("reads counts and send results defensively", () => {
    expect(parseUnread(null)).toEqual({ inbox: 0, requests: 0 });
    expect(parseUnread({ inbox: 3, requests: 1 })).toEqual({ inbox: 3, requests: 1 });
    expect(parseSendResult({ message_id: 5, conversation_id: "c", duplicate: false, status: "held", folder: "requests", help: true })).toEqual({
      messageId: 5, conversationId: "c", duplicate: false, status: "held", folder: "requests", help: true,
    });
    expect(parseSendResult({})).toBeNull();
  });
});
