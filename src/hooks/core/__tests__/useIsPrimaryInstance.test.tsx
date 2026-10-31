/**
 * Tests for "exactly one instance does the side effect".
 *
 * WHY THIS EXISTS
 *   The notification bell is mounted twice — a desktop copy and a mobile copy,
 *   one hidden by CSS. Verified on production 2026-08-01:
 *   `document.querySelectorAll('button[aria-label="Notifications"]')` returned
 *   2, one with a zero-width box. CSS hides; it does not unmount. So the
 *   realtime subscription was created twice on the same channel topic, and the
 *   notification sound played twice on every arrival.
 *
 *   These pin the three properties the fix depends on: exactly one primary,
 *   leadership survives the primary unmounting, and nobody is primary before
 *   the effects have run.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import {
  useIsPrimaryInstance,
  __resetPrimaryInstanceRegistry,
} from "@/hooks/core/useIsPrimaryInstance";

const Probe = ({ label, groupKey }: { label: string; groupKey: string }) => {
  const primary = useIsPrimaryInstance(groupKey);
  return <div data-testid={label}>{primary ? "primary" : "secondary"}</div>;
};

const roleOf = (label: string) => screen.getByTestId(label).textContent;

beforeEach(() => {
  __resetPrimaryInstanceRegistry();
});

describe("useIsPrimaryInstance", () => {
  it("names exactly one primary when the same thing is mounted twice", () => {
    // This is the bell: desktop copy + mobile copy, same key.
    render(
      <>
        <Probe label="desktop" groupKey="bell:user-1" />
        <Probe label="mobile" groupKey="bell:user-1" />
      </>,
    );

    const roles = [roleOf("desktop"), roleOf("mobile")];
    expect(roles.filter((r) => r === "primary")).toHaveLength(1);
    expect(roles.filter((r) => r === "secondary")).toHaveLength(1);
  });

  it("gives it to the first one mounted", () => {
    render(
      <>
        <Probe label="first" groupKey="bell:user-1" />
        <Probe label="second" groupKey="bell:user-1" />
      </>,
    );

    expect(roleOf("first")).toBe("primary");
    expect(roleOf("second")).toBe("secondary");
  });

  it("promotes the survivor when the primary unmounts", () => {
    // Without this, unmounting the hidden bell would stop the realtime
    // subscription and the sound for good — the effect must MOVE, not die.
    const Host = ({ showFirst }: { showFirst: boolean }) => (
      <>
        {showFirst && <Probe label="first" groupKey="bell:user-1" />}
        <Probe label="second" groupKey="bell:user-1" />
      </>
    );

    const { rerender } = render(<Host showFirst />);
    expect(roleOf("second")).toBe("secondary");

    act(() => {
      rerender(<Host showFirst={false} />);
    });

    expect(roleOf("second")).toBe("primary");
  });

  it("keeps separate groups independent", () => {
    // Two different users, or two different effects, must not compete.
    render(
      <>
        <Probe label="a" groupKey="bell:user-1" />
        <Probe label="b" groupKey="bell:user-2" />
      </>,
    );

    expect(roleOf("a")).toBe("primary");
    expect(roleOf("b")).toBe("primary");
  });

  it("is nobody's primary while the key is empty", () => {
    // The "not ready" state — no user id yet. Claiming primacy here would let a
    // logged-out render start a subscription.
    render(<Probe label="none" groupKey="" />);
    expect(roleOf("none")).toBe("secondary");
  });
});
