/**
 * 1-D2-02 — the honeypot/time-trap path, and the no-enumeration guarantee it
 * replaced.
 *
 * PR #252 (46ab60e) removed the `email_exists` RPC call and the "No Account
 * Found" screen from ForgotPassword.tsx, and added a honeypot field
 * (`company_fax`, off-screen and untabbable) plus a 1.2s render-to-submit
 * time trap. Both signals — a filled honeypot, or a submit inside the
 * window — collapse to the SAME response as a genuine submission: the normal
 * "Check Your Email" success view, with nothing sent to the wire. The
 * Addendum's gate for this unit (§1.9, 1-D2-02) asks for "a test proving the
 * two responses render identically" for a registered vs. an unregistered
 * address; that evidence did not exist anywhere in the repo before this file
 * (the PR itself touched only ForgotPassword.tsx, no test).
 *
 * What this proves, directly against the code, not a document:
 *   - the honeypot and the time-trap each short-circuit BEFORE any network
 *     call — no captcha token requested, no resetPasswordForEmail call, no
 *     rpc call of any kind;
 *   - a genuine submission past the trap window requests a Turnstile token
 *     and calls resetPasswordForEmail with it;
 *   - the component no longer has ANY code path that branches on account
 *     existence — proven by driving it exactly as Supabase's own
 *     /auth/v1/recover behaves (resolves { error: null } whether or not the
 *     address is registered — see claude/2026-09-16-phase1-verified-status.md
 *     for that behaviour measured live against production) and diffing the
 *     rendered output byte-for-byte;
 *   - the withdrawn "No Account Found" screen and the withdrawn email_exists
 *     call cannot silently come back.
 *
 * Real timers throughout — the 1.2s window is real time, not simulated, so
 * this test exercises the same clock the browser does.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const resetPasswordForEmailMock = vi.fn();
const rpcMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: (...args: unknown[]) => resetPasswordForEmailMock(...args),
    },
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

const getCaptchaTokenMock = vi.fn();
vi.mock("@/lib/turnstile", () => ({
  getCaptchaToken: () => getCaptchaTokenMock(),
}));

vi.mock("@/i18n/I18nContext", () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}));

import ForgotPassword from "@/pages/ForgotPassword";

const TRAP_WINDOW_MS = 1200;
const PAST_TRAP_MS = TRAP_WINDOW_MS + 150;

const renderPage = () =>
  render(
    <MemoryRouter>
      <ForgotPassword />
    </MemoryRouter>,
  );

const fillEmail = (value: string) => {
  fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value } });
};

const submit = () => {
  fireEvent.click(screen.getByRole("button", { name: /sendResetLink/i }));
};

const honeypotInput = () =>
  document.querySelector<HTMLInputElement>('input[name="company_fax"]')!;

/** Real sleep, so the trap is exercised against the real clock. */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  resetPasswordForEmailMock.mockReset().mockResolvedValue({ error: null });
  rpcMock.mockReset();
  getCaptchaTokenMock.mockReset().mockResolvedValue("tok_test_abc123");
});

describe("ForgotPassword — honeypot", () => {
  it("is present, off-screen, untabbable, and not a password-manager-guessable name", () => {
    renderPage();
    const trap = honeypotInput();
    expect(trap).toBeTruthy();
    expect(trap.getAttribute("tabindex")).toBe("-1");
    expect(trap.getAttribute("autocomplete")).toBe("off");
    expect(trap.closest('[aria-hidden="true"]')).toBeTruthy();
    // must not collide with anything a password manager autofills
    expect(["email", "name", "phone", "address"]).not.toContain(trap.name);
  });

  it("a filled honeypot renders the normal success view and touches nothing on the wire", async () => {
    renderPage();
    fillEmail("someone@example.com");
    fireEvent.change(honeypotInput(), { target: { value: "http://spam.example" } });
    await sleep(PAST_TRAP_MS); // advance past the time trap too, so only the honeypot signal is under test
    submit();

    expect(await screen.findByText(/check your/i)).toBeTruthy();
    expect(resetPasswordForEmailMock).not.toHaveBeenCalled();
    expect(getCaptchaTokenMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  }, 10_000);
});

describe("ForgotPassword — time trap", () => {
  it("a submit inside 1.2s renders the normal success view and touches nothing on the wire", async () => {
    renderPage();
    fillEmail("someone@example.com");
    submit(); // immediately — well inside the window on any reasonable test machine

    expect(await screen.findByText(/check your/i)).toBeTruthy();
    expect(resetPasswordForEmailMock).not.toHaveBeenCalled();
    expect(getCaptchaTokenMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("a genuine submission past the trap window requests a captcha token and calls resetPasswordForEmail", async () => {
    renderPage();
    fillEmail("real.member@example.com");
    await sleep(PAST_TRAP_MS);
    submit();

    await waitFor(() => expect(resetPasswordForEmailMock).toHaveBeenCalled());
    expect(getCaptchaTokenMock).toHaveBeenCalled();
    expect(resetPasswordForEmailMock).toHaveBeenCalledWith(
      "real.member@example.com",
      expect.objectContaining({ captchaToken: "tok_test_abc123" }),
    );
    expect(await screen.findByText(/check your/i)).toBeTruthy();
  }, 10_000);
});

describe("ForgotPassword — no account-enumeration signal (P30 gate: responses identical either way)", () => {
  /**
   * Supabase's own /auth/v1/recover resolves the same way (error: null)
   * whether or not the address is registered — the platform's own
   * anti-enumeration behaviour, separately measured live against production
   * (docs: claude/2026-09-16-phase1-verified-status.md, negative/positive
   * captcha controls). What this test proves is narrower and belongs to the
   * client: that ForgotPassword.tsx itself no longer has ANY branch that
   * reads existence and renders something different. Both cases below are
   * driven through the identical mock resolution on purpose — that is the
   * point being tested, not a simplification of it.
   */
  const renderAndSubmit = async (email: string) => {
    renderPage();
    fillEmail(email);
    await sleep(PAST_TRAP_MS);
    submit();
    await waitFor(() => expect(resetPasswordForEmailMock).toHaveBeenCalled());
    return screen.findByText(/check your/i);
  };

  it("a registered-address response and an unregistered-address response render identically", async () => {
    const registeredHeading = await renderAndSubmit("registered@example.com");
    const registeredHtml = registeredHeading
      .closest("main")!
      .innerHTML.replace(/registered@example\.com/g, "EMAIL");

    document.body.innerHTML = "";
    resetPasswordForEmailMock.mockClear().mockResolvedValue({ error: null });
    const unregisteredHeading = await renderAndSubmit("unregistered@example.com");
    const unregisteredHtml = unregisteredHeading
      .closest("main")!
      .innerHTML.replace(/unregistered@example\.com/g, "EMAIL");

    expect(unregisteredHtml).toEqual(registeredHtml);
  }, 15_000);

  it("GUARD: no email_exists / rpc call exists in this component, at all, any longer", async () => {
    await renderAndSubmit("anyone@example.com");
    expect(rpcMock).not.toHaveBeenCalled();
  }, 10_000);

  it("GUARD: the withdrawn 'No Account Found' screen never renders, for any outcome", async () => {
    await renderAndSubmit("someone@example.com");
    expect(screen.queryByText(/no account/i)).toBeNull();
    expect(screen.queryByText(/create account/i)).toBeNull();
  }, 10_000);
});

describe("ForgotPassword — a genuine backend error still does not leak existence", () => {
  it("shows an error message, not the success view, on an unrelated failure — and it never mentions the account", async () => {
    resetPasswordForEmailMock.mockResolvedValue({
      error: { message: "captcha protection: request disallowed" } as unknown as Error,
    });
    renderPage();
    fillEmail("someone@example.com");
    await sleep(PAST_TRAP_MS);
    submit();

    await waitFor(() => expect(resetPasswordForEmailMock).toHaveBeenCalled());
    expect(await screen.findByText(/captcha protection/i)).toBeTruthy();
    expect(screen.queryByText(/no account/i)).toBeNull();
    expect(screen.queryByText(/check your/i)).toBeNull();
  }, 10_000);
});
