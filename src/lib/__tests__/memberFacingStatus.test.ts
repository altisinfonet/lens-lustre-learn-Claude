import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
import { memberFacingFailure, memberFacingMessage, failureKind } from "@/lib/reportClientError";

const http = (status: number, message = "Edge Function returned a non-2xx status code") =>
  Object.assign(new Error(message), { name: "FunctionsHttpError", context: { status } });

describe("S11 — a member reads what to DO, not a status code", () => {
  it("classifies by status, PostgREST/Postgres code and transport signature", () => {
    expect(failureKind(http(401))).toBe("auth");
    expect(failureKind({ message: "JWT expired", code: "PGRST301" })).toBe("auth");
    expect(failureKind(http(403))).toBe("forbidden");
    expect(failureKind({ message: "permission denied for table posts", code: "42501" })).toBe("forbidden");
    // Every object kind Postgres names, not a hand-picked few (review of 1a19f06).
    for (const kind of ["materialized view posts_mv", "foreign table x", "large object 1", "type t", "procedure p", "database postgres", "tablespace pg_default"]) {
      expect(failureKind({ message: `permission denied for ${kind}`, code: "42501" })).toBe("forbidden");
    }
    expect(failureKind({ message: "new row violates row-level security policy for table \"posts\"", code: "42501" })).toBe("forbidden");
    // our own trigger's refusal with 42501 keeps its words and its code
    expect(failureKind({ message: "VID-UP-003: video posts are not enabled for this member", code: "42501" })).toBeNull();
    expect(failureKind(http(429))).toBe("rate");
    expect(failureKind({ status: 429, message: "Too Many Requests" })).toBe("rate");
    for (const s of [500, 502, 503, 504]) expect(failureKind(http(s))).toBe("server");
    expect(failureKind(Object.assign(new Error("Failed to send a request to the Edge Function"), { name: "FunctionsFetchError" }))).toBe("offline");
    expect(failureKind(new TypeError("Failed to fetch"))).toBe("offline");
    expect(failureKind(new TypeError("Load failed"))).toBe("offline");
    expect(failureKind({ message: "TypeError: Failed to fetch", code: "" })).toBe("offline"); // postgrest-js shape
    expect(failureKind(Object.assign(new Error("Failed to fetch"), { name: "AuthRetryableFetchError", status: 0 }))).toBe("offline");
    expect(failureKind(Object.assign(new Error("relay"), { name: "FunctionsRelayError" }))).toBe("server");
    // A refusal the DATABASE wrote for people is not reclassified.
    expect(failureKind({ message: "You are posting too quickly", code: "P0001" })).toBeNull();
  });

  it("memberFacingFailure turns each into a sentence and keeps the code", () => {
    expect(memberFacingFailure(http(401), "DRAFT-2002")).toBe("Your sign-in has expired. Please sign in again. (DRAFT-2002)");
    expect(memberFacingFailure(http(403), "X-1")).toBe("You don't have permission to do that. (X-1)");
    expect(memberFacingFailure(http(429), "X-1")).toBe("Too many tries in a short time. Please wait a minute and try again. (X-1)");
    expect(memberFacingFailure(http(503), "X-1")).toBe("The service is busy right now. Please try again in a moment. (X-1)");
    expect(memberFacingFailure(new TypeError("Failed to fetch"), "X-1")).toBe("Couldn't reach the service. Check your connection and try again. (X-1)");
    expect(memberFacingFailure({ message: "You are posting too quickly" }, "X-1")).toBe("You are posting too quickly (X-1)");
    expect(memberFacingFailure(new TypeError("Cannot read properties of undefined (reading 'rest')"), "X-1"))
      .toBe("Something went wrong on our side. Nothing was lost — please try again. (X-1)");
  });

  it("memberFacingMessage (no code) maps the same failures and keeps people-written text", () => {
    expect(memberFacingMessage(http(401))).toBe("Your sign-in has expired. Please sign in again.");
    expect(memberFacingMessage({ message: "Please add a profile photo first" })).toBe("Please add a profile photo first");
  });
});
