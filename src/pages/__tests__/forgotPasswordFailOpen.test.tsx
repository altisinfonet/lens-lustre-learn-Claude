/**
 * P30 · Pin the fail-open behaviour the revoke was cleared ON.
 *
 * WHY THIS EXISTS. `docs/gates/P1-revocation-list.md` §2.1 cleared
 * `email_exists(text)` for revocation on exactly one ground:
 *
 *   "D2 measured the only call site as fail-open: ForgotPassword.tsx:39 is
 *    wrapped in try/catch, any error sets exists = null, and the page falls
 *    back to the generic reset flow."
 *
 * That revoke is now LIVE — merged as 20260910_0001_p30_email_exists_revoke.sql
 * on staging at 12090ab. So the fallback is no longer a rarely-taken branch: for
 * anon it is the ONLY branch, on every password reset the product performs.
 *
 * And nothing was pinning it. The measurement that justified the revoke lived in
 * a document; the code was free to drift out from under it. Anyone "tidying" that
 * try/catch — or changing `exists === false` to `!exists` — turns the reset page
 * into one that tells every single user "No Account Found", which is both a lie
 * and a lockout, and no test would have said a word.
 *
 * The two GUARD tests below are what stop this file being satisfied by simply
 * deleting the feature: the account-exists check must still work when the RPC
 * answers.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import ForgotPassword from "@/pages/ForgotPassword";

const rpcMock = vi.fn();
const resetMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    auth: {
      resetPasswordForEmail: (...args: unknown[]) => resetMock(...args),
    },
  },
}));

vi.mock("@/lib/turnstile", () => ({ getCaptchaToken: () => Promise.resolve("captcha-stub") }));
vi.mock("@/i18n/I18nContext", () => ({ useT: () => (k: string) => k }));

/** The refusal PostgREST returns once EXECUTE is revoked. */
const REFUSAL_42501 = {
  code: "42501",
  message: "permission denied for function email_exists",
};

/** The "No Account Found" screen, addressed by its heading. A bare
 *  /no account/i matches BOTH the h1 and the body paragraph, and an ambiguous
 *  query is one that can pass or fail for reasons other than the one it names. */
const noAccountHeading = () =>
  screen.queryByRole("heading", { name: /no account\s+found/i });

const submit = async (email = "member@example.com") => {
  render(
    <MemoryRouter>
      <ForgotPassword />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
    target: { value: email },
  });
  fireEvent.click(screen.getByRole("button", { name: /reset|send|continue/i }));
};

beforeEach(() => {
  rpcMock.mockReset();
  resetMock.mockReset();
  resetMock.mockResolvedValue({ error: null });
});

describe("P30 · ForgotPassword stays fail-open now that email_exists is revoked", () => {
  it("still sends the reset when the RPC is refused (42501)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: REFUSAL_42501 });
    await submit();

    await waitFor(() => expect(resetMock).toHaveBeenCalledTimes(1));
    expect(resetMock.mock.calls[0][0]).toBe("member@example.com");
    expect(noAccountHeading()).toBeNull();
  });

  it("still sends the reset when the RPC promise rejects", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    await submit();

    await waitFor(() => expect(resetMock).toHaveBeenCalledTimes(1));
    expect(noAccountHeading()).toBeNull();
  });

  it("never shows the member a raw error from the refused check", async () => {
    rpcMock.mockResolvedValue({ data: null, error: REFUSAL_42501 });
    await submit();

    await waitFor(() => expect(resetMock).toHaveBeenCalled());
    expect(screen.queryByText(/permission denied/i)).toBeNull();
    expect(screen.queryByText(/42501/)).toBeNull();
  });

  // ---- guards: the feature must still work when the RPC actually answers ----

  it("GUARD still says 'No Account Found' when the RPC answers false", async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });
    await submit();

    await waitFor(() => expect(noAccountHeading()).toBeTruthy());
    expect(resetMock).not.toHaveBeenCalled();
  });

  it("GUARD still sends the reset when the RPC answers true", async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    await submit();

    await waitFor(() => expect(resetMock).toHaveBeenCalledTimes(1));
    expect(noAccountHeading()).toBeNull();
  });
});
