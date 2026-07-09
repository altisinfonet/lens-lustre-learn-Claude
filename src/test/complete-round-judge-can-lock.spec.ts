/**
 * CR-A regression lock (2026-07-03).
 *
 * Spec: mem://judging/round-declaration-by-admin
 *   Lock (writes closed_at) → performed by JUDGE or ADMIN via complete-round.
 *   Declare (writes published_at) → admin-only via publish-round.
 *
 * Prior bug: complete-round hard-required admin role, returning
 *   { error: "Forbidden: admin role required" } (HTTP 403) for every judge
 * caller — proven by a live 3-JWT curl matrix on 2026-07-03.
 *
 * This test guards the auth branch in supabase/functions/complete-round/index.ts
 * so no future refactor silently re-narrows the role gate.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(
  join(process.cwd(), "supabase/functions/complete-round/index.ts"),
  "utf8",
);

describe("complete-round · CR-A judge Lock authority", () => {
  it("does NOT restrict the user-JWT branch to role = 'admin'", () => {
    // The old hard filter must not reappear anywhere in the file.
    expect(SRC).not.toMatch(/\.eq\(\s*["']role["']\s*,\s*["']admin["']\s*\)/);
    // The old 403 copy must not reappear.
    expect(SRC).not.toContain("Forbidden: admin role required");
  });

  it("accepts both admin and judge roles via .in(['admin','judge'])", () => {
    expect(SRC).toMatch(/\.in\(\s*["']role["']\s*,\s*\[\s*["']admin["']\s*,\s*["']judge["']\s*\]\s*\)/);
    expect(SRC).toContain('Forbidden: judge or admin role required');
  });

  it("preserves callerRole so audit rows distinguish judge vs admin locks", () => {
    expect(SRC).toMatch(/let callerRole:\s*"admin"\s*\|\s*"judge"\s*\|\s*"service_role"/);
    expect(SRC).toMatch(/callerRole\s*=\s*roleSet\.has\(["']admin["']\)\s*\?\s*["']admin["']/);
  });
});
