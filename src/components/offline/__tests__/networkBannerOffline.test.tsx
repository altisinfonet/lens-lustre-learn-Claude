/**
 * S7b-5 · the bar at the top says plainly "No internet — showing saved", and
 * how many of the member's actions will send when the network is back.
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { enqueue, startOutbox, memoryOutboxStore, __setOutboxStore, __setOutboxOnline, __resetOutbox } from "@/lib/offline/outbox";

vi.mock("@/hooks/core/useNetworkQuality", () => ({ useNetworkQuality: () => ({ online: false, slow: true, reason: "offline" }) }));
const { default: NetworkBanner } = await import("@/components/NetworkBanner");
const U = "11111111-1111-4111-8111-111111111111";

beforeEach(() => { __resetOutbox(); __setOutboxStore(memoryOutboxStore()); __setOutboxOnline(() => false); startOutbox(U, async () => ({ ok: true })); });
afterEach(() => { __resetOutbox(); __setOutboxOnline(undefined); });

describe("offline bar", () => {
  it("says 'No internet — showing saved' and counts what will send", async () => {
    render(<NetworkBanner />);
    expect(screen.getByTestId("network-banner").textContent).toMatch(/No internet — showing saved/);
    await act(async () => {
      await enqueue(U, { kind: "follow", targetId: "t" });
      await enqueue(U, { kind: "react", postId: "p", reactionType: "like", replace: false });
    });
    expect(await screen.findByText(/2 actions will send when online/)).toBeTruthy();
  });
});
