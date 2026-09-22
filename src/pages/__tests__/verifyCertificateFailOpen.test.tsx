/**
 * P31 · BLOCKER A — the certificate search must not call a refusal an absence.
 *
 * THE DEFECT THIS REPRODUCES. VerifyCertificate.handleSearchByDetails collapsed
 * three different outcomes into one branch:
 *
 *     if (error || !data || data.length === 0) setNotFound(true);
 *
 * so "Postgres refused you" and "nothing matched" both rendered
 * "No Certificates Found". On the day anon's EXECUTE on search_certificates is
 * revoked, a member holding a REAL certificate is told, calmly, that no
 * certificate matched. That reads as a forgery, and nobody reports a forgery.
 *
 * THE TWO GUARD TESTS ARE NOT PADDING. "a genuine empty result still says not
 * found" and "an unrelated error still says not found" pass BOTH before and
 * after the fix, on purpose. A fix that classified every failure as
 * "unavailable" would satisfy the headline assertion and be a worse bug than
 * the one it replaced. These two are the only thing standing in the way of it.
 *
 * The P31 revoke migration is not yet written and is D1's lane; this file
 * names the unit, not a guessed filename (F-75).
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { isSearchUnavailableError } from "@/pages/verifyCertificateErrors";
import VerifyCertificate from "@/pages/VerifyCertificate";

// ---- mocks: keep the page hermetic (no network) ----

const rpcMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

// framer-motion: render plain elements so the result panel is synchronous.
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => {
          const { initial, animate, exit, transition, ...rest } = props as Record<string, unknown>;
          void initial; void animate; void exit; void transition;
          return <div {...(rest as Record<string, unknown>)}>{children}</div>;
        },
    },
  ),
}));

/** Drive the "By Name / Course" search — the only path that calls
 *  search_certificates, which is the only call site of it in the app. */
const runDetailsSearch = async () => {
  render(
    <MemoryRouter>
      <VerifyCertificate />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByPlaceholderText("e.g. John Doe"), {
    target: { value: "Jane Member" },
  });
  fireEvent.click(screen.getByRole("button", { name: /search certificates/i }));
  await waitFor(() => expect(rpcMock).toHaveBeenCalled());
};

// The refusal PostgREST returns once EXECUTE is revoked and the schema cache
// still lists the function: Postgres itself refuses the caller.
const REFUSAL_42501 = {
  code: "42501",
  message: "permission denied for function search_certificates",
};

// The refusal PostgREST returns once its schema cache has reloaded and no
// longer lists the function for this role: the call never reaches Postgres.
const REFUSAL_PGRST202 = {
  code: "PGRST202",
  message: "Could not find the function public.search_certificates",
};

/** Drive the "By Certificate ID" path — verify_certificate, the OTHER collapse
 *  site in this file. It is the path the Search Unavailable panel sends people
 *  to, so it must not carry the same defect the panel is redirecting them away
 *  from. verify_certificate is NOT on the revocation list; this is not blocking
 *  a revoke, it is refusing to move the bug instead of removing it. */
const runIdVerify = async () => {
  render(
    <MemoryRouter>
      <VerifyCertificate />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: /by certificate id/i }));
  fireEvent.change(screen.getByPlaceholderText(/a1b2c3d4/i), {
    target: { value: "CERT-2026ABCD" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^verify$/i }));
  await waitFor(() => expect(rpcMock).toHaveBeenCalled());
};

// A transport failure as @supabase/postgrest-js actually reports it: its own
// .catch() returns a RESOLVED response with code as an EMPTY STRING (not
// undefined, not a Postgres code). Read from PostgrestBuilder.ts:250-291.
const TRANSPORT_FAILURE = {
  message: "TypeError: Failed to fetch",
  details: "FetchError: TypeError: Failed to fetch",
  hint: "",
  code: "",
};

beforeEach(() => {
  rpcMock.mockReset();
});

describe("isSearchUnavailableError — the classifier, exercised directly", () => {
  it("treats 42501 as a withdrawn grant", () => {
    expect(isSearchUnavailableError(REFUSAL_42501)).toBe(true);
  });

  it("treats PGRST202 as a withdrawn grant — the schema cache has reloaded", () => {
    expect(isSearchUnavailableError(REFUSAL_PGRST202)).toBe(true);
  });

  it("falls back to the message when a proxy stripped the code", () => {
    expect(
      isSearchUnavailableError({ message: "Permission denied for function search_certificates" }),
    ).toBe(true);
  });

  it("is false for absent, primitive and unrelated-shape errors", () => {
    expect(isSearchUnavailableError(null)).toBe(false);
    expect(isSearchUnavailableError(undefined)).toBe(false);
    expect(isSearchUnavailableError("permission denied")).toBe(false);
    expect(isSearchUnavailableError({})).toBe(false);
  });

  it("is false for PGRST116 — zero rows is an absence, not a refusal", () => {
    expect(
      isSearchUnavailableError({ code: "PGRST116", message: "The result contains 0 rows" }),
    ).toBe(false);
  });

  it("is false for a transport failure — that is not a withdrawn grant", () => {
    expect(isSearchUnavailableError({ message: "Failed to fetch" })).toBe(false);
  });
});

describe("VerifyCertificate — a refusal must not be rendered as an absence", () => {
  it("shows the unavailable panel, and NOT 'No Certificates Found', on 42501", async () => {
    rpcMock.mockResolvedValue({ data: null, error: REFUSAL_42501 });
    await runDetailsSearch();

    await waitFor(() => {
      expect(screen.getByText(/search unavailable/i)).toBeTruthy();
    });
    expect(screen.queryByText(/no certificates found/i)).toBeNull();
  });

  it("shows the unavailable panel, and NOT 'No Certificates Found', on PGRST202", async () => {
    rpcMock.mockResolvedValue({ data: null, error: REFUSAL_PGRST202 });
    await runDetailsSearch();

    await waitFor(() => {
      expect(screen.getByText(/search unavailable/i)).toBeTruthy();
    });
    expect(screen.queryByText(/no certificates found/i)).toBeNull();
  });

  it("never shows a raw error message to a member", async () => {
    rpcMock.mockResolvedValue({ data: null, error: REFUSAL_42501 });
    await runDetailsSearch();

    await waitFor(() => expect(screen.getByText(/search unavailable/i)).toBeTruthy());
    expect(screen.queryByText(/permission denied/i)).toBeNull();
    expect(screen.queryByText(/42501/)).toBeNull();
  });

  // ---- guards: these two pass BEFORE and AFTER the fix, deliberately ----

  it("GUARD still says 'No Certificates Found' for a genuine empty result", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await runDetailsSearch();

    await waitFor(() => {
      expect(screen.getByText(/no certificates found/i)).toBeTruthy();
    });
    expect(screen.queryByText(/search unavailable/i)).toBeNull();
  });

  it("GUARD does not claim 'Search Unavailable' for an unrelated error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "Failed to fetch" } });
    await runDetailsSearch();

    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    expect(screen.queryByText(/search unavailable/i)).toBeNull();
  });
});

describe("VerifyCertificate — the by-ID path must not carry the same defect", () => {
  it("shows the unavailable panel, and NOT 'No Certificates Found', on 42501", async () => {
    rpcMock.mockResolvedValue({ data: null, error: REFUSAL_42501 });
    await runIdVerify();

    await waitFor(() => expect(screen.getByText(/verification unavailable/i)).toBeTruthy());
    expect(screen.queryByText(/no certificates found/i)).toBeNull();
  });

  it("uses by-ID wording, not the by-name wording, on the ID path", async () => {
    rpcMock.mockResolvedValue({ data: null, error: REFUSAL_PGRST202 });
    await runIdVerify();

    await waitFor(() => expect(screen.getByText(/verification unavailable/i)).toBeTruthy());
    // The by-name panel tells people to use the certificate ID. On the ID path
    // that advice is circular, so it must not appear.
    expect(screen.queryByText(/you can still verify a certificate using its certificate id/i)).toBeNull();
    // and it must not imply the certificate is in doubt
    expect(screen.getByText(/does not mean the certificate is invalid/i)).toBeTruthy();
  });

  it("never shows a raw error message to a member on the ID path", async () => {
    rpcMock.mockResolvedValue({ data: null, error: REFUSAL_42501 });
    await runIdVerify();

    await waitFor(() => expect(screen.getByText(/verification unavailable/i)).toBeTruthy());
    expect(screen.queryByText(/permission denied/i)).toBeNull();
    expect(screen.queryByText(/42501/)).toBeNull();
  });

  it("GUARD still says 'No Certificates Found' for a genuine unknown ID", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await runIdVerify();

    await waitFor(() => expect(screen.getByText(/no certificates found/i)).toBeTruthy());
    expect(screen.queryByText(/verification unavailable/i)).toBeNull();
  });
});

describe("VerifyCertificate — a transport failure is its own third state", () => {
  it("by name: does NOT say 'No Certificates Found' when the network failed", async () => {
    rpcMock.mockResolvedValue({ data: null, error: TRANSPORT_FAILURE });
    await runDetailsSearch();

    await waitFor(() => expect(screen.getByText(/could not be completed/i)).toBeTruthy());
    expect(screen.queryByText(/no certificates found/i)).toBeNull();
  });

  it("by name: does NOT claim the search was withdrawn — it may work on retry", async () => {
    rpcMock.mockResolvedValue({ data: null, error: TRANSPORT_FAILURE });
    await runDetailsSearch();

    await waitFor(() => expect(screen.getByText(/could not be completed/i)).toBeTruthy());
    // "no longer available … use the certificate ID" is FALSE here: the search
    // still exists and retrying may well work.
    expect(screen.queryByText(/no longer available/i)).toBeNull();
    expect(screen.getByText(/try again/i)).toBeTruthy();
  });

  it("by ID: does NOT say 'No Certificates Found' when the network failed", async () => {
    rpcMock.mockResolvedValue({ data: null, error: TRANSPORT_FAILURE });
    await runIdVerify();

    await waitFor(() => expect(screen.getByText(/could not be completed/i)).toBeTruthy());
    expect(screen.queryByText(/no certificates found/i)).toBeNull();
  });

  it("never leaks the transport error text to a member", async () => {
    rpcMock.mockResolvedValue({ data: null, error: TRANSPORT_FAILURE });
    await runDetailsSearch();

    await waitFor(() => expect(screen.getByText(/could not be completed/i)).toBeTruthy());
    expect(screen.queryByText(/failed to fetch/i)).toBeNull();
    expect(screen.queryByText(/fetcherror/i)).toBeNull();
  });

  it("GUARD a refusal still shows the withdrawn-search panel, not the retry panel", async () => {
    rpcMock.mockResolvedValue({ data: null, error: REFUSAL_42501 });
    await runDetailsSearch();

    await waitFor(() => expect(screen.getByText(/search unavailable/i)).toBeTruthy());
    expect(screen.queryByText(/could not be completed/i)).toBeNull();
  });

  it("GUARD a genuine empty result still says 'No Certificates Found'", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await runDetailsSearch();

    await waitFor(() => expect(screen.getByText(/no certificates found/i)).toBeTruthy());
    expect(screen.queryByText(/could not be completed/i)).toBeNull();
  });
});
