import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  CERT_TYPES,
  CERT_TYPE_GROUPS,
  certTypeLabel,
  certTypeDef,
  isManualCertType,
} from "@/components/admin/certificateTypes";

/**
 * ADMIN CERTIFICATES — THE DEFECTS THIS FILE EXISTS TO PREVENT
 *
 * All observed on production, 2026-08-24:
 *
 *  1. The form offered `achievement` and `custom`; the CHECK constraint
 *     permitted neither, so both produced "Create failed" with no reason.
 *  2. Opening EDIT on a certificate whose type was not one of the four
 *     hard-coded options set a <select> to a value with no matching <option>,
 *     which silently falls back to the FIRST option. The form then read
 *     `course_completion` while showing a Runner-Up certificate; saving
 *     rewrote the type or created a duplicate. Production carries three rows
 *     titled "Catch the Ball — 2nd Runner-Up Certificate" with three types.
 *  3. Delete never read its error, so the toast said "Deleted" regardless.
 *  4. Recipient lookup was `.ilike(full_name).limit(1)` with no email — first
 *     row wins, silently. Staging has 25 profiles named "Zara Kim".
 *  5. The list was `.limit(50)` with no paging; at 51 the oldest vanished.
 *
 * ⚠ These are SOURCE PINS, not execution tests (project rule 7). They prove
 * the specific mistakes have not been reintroduced. The execution proof is
 * the staging run recorded alongside this change.
 */

const ROOT = join(__dirname, "..", "..");
const COMPONENT = readFileSync(join(ROOT, "src/components/admin/AdminCertificates.tsx"), "utf8");

/**
 * Executable source only. `doc.save()` is named in the comment that explains
 * why it must never be called, so a naive scan of the whole file would flag
 * its own warning. Stripping comments keeps the assertion about CODE.
 */
const CODE = COMPONENT
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
  .join("\n");

function migrationSource(fragment = "certificate_types_and_admin_search"): string {
  const dir = join(ROOT, "supabase/migrations");
  const f = readdirSync(dir).find((n) => n.includes(fragment));
  if (!f) throw new Error(`the ${fragment} migration is missing`);
  return readFileSync(join(dir, f), "utf8");
}

describe("certificate type registry", () => {
  const SQL = migrationSource();

  it("lists exactly the types the CHECK constraint permits — no more, no fewer", () => {
    // The constraint is the authority. If these ever diverge, either the form
    // offers something the database refuses (defect 1) or a stored type has
    // no <option> and the select silently rewrites it (defect 2).
    const start = SQL.indexOf("add constraint certificates_type_check");
    expect(start, "the constraint is not in the migration").toBeGreaterThan(-1);
    const constraint = SQL.slice(start, SQL.indexOf(";", start));
    const inSql = [...constraint.matchAll(/'([a-z0-9_]+)'::text/g)].map((m) => m[1]).sort();
    const inRegistry = CERT_TYPES.map((t) => t.value).sort();

    expect(inSql.length, "the constraint parse found nothing — this test is vacuous").toBeGreaterThan(10);
    expect(inRegistry).toEqual(inSql);
  });

  it("includes the two types the database used to refuse", () => {
    expect(CERT_TYPES.map((t) => t.value)).toContain("achievement");
    expect(CERT_TYPES.map((t) => t.value)).toContain("custom");
  });

  it("marks only the hand-issued kinds as manual", () => {
    const manual = CERT_TYPES.filter((t) => t.manual).map((t) => t.value).sort();
    expect(manual).toEqual(["achievement", "course_completion", "custom"]);
  });

  it("classifies every competition award as automatic", () => {
    for (const t of CERT_TYPES.filter((x) => x.value.startsWith("competition_"))) {
      expect(isManualCertType(t.value), `${t.value} must not be hand-issuable`).toBe(false);
    }
  });

  it("has no duplicate values and every type belongs to a known group", () => {
    const values = CERT_TYPES.map((t) => t.value);
    expect(new Set(values).size).toBe(values.length);
    for (const t of CERT_TYPES) expect(CERT_TYPE_GROUPS).toContain(t.group);
  });

  it("labels a known type, and degrades legibly for an unknown one", () => {
    expect(certTypeLabel("competition_runner_up_2")).toBe("2nd Runner-Up");
    expect(certTypeLabel("something_new")).toBe("something new");
    expect(certTypeDef("no_such_type")).toBeUndefined();
  });
});

describe("admin certificates component", () => {
  it("renders the dropdown from the registry, never a hard-coded list", () => {
    expect(CODE).toMatch(/CERT_TYPE_GROUPS\.map/);
    expect(CODE).toMatch(/CERT_TYPES\.filter/);
    // The exact four options that caused the silent fallback.
    expect(COMPONENT).not.toMatch(/<option value="course_completion">Course<\/option>/);
    expect(COMPONENT).not.toMatch(/<option value="achievement">Achievement<\/option>/);
  });

  it("checks the delete error instead of always claiming success", () => {
    expect(CODE).toMatch(/\.delete\(\)[\s\S]{0,80}\.select\("id"\)/);
    expect(COMPONENT).toMatch(/Delete failed/);
    expect(COMPONENT).toMatch(/Nothing was deleted/);
    // The original: an unconditional success toast.
    expect(COMPONENT).not.toMatch(/await supabase\.from\("certificates"\)\.delete\(\)\.eq\("id", id\);\s*\n\s*toast\(\{ title: "Deleted" \}\)/);
  });

  it("searches recipients through the RPC, with no .limit(1)", () => {
    // CODE, not COMPONENT: the RPC name also appears in the comment that
    // explains the defect, so scanning the whole file would let a mutant that
    // guts the actual call slip through. (Caught by mutation M3.)
    expect(CODE).toMatch(/"admin_search_certificate_recipients"/);
    expect(CODE).not.toMatch(/\.ilike\("full_name"[\s\S]{0,60}\.limit\(1\)/);
  });

  it("shows the email for each match, so two same-named members differ", () => {
    expect(COMPONENT).toMatch(/m\.email/);
    expect(COMPONENT).toMatch(/Showing \{matches\.length\} of \{matchTotal\}/);
  });

  it("debounces the search and discards out-of-order responses", () => {
    expect(CODE).toMatch(/setTimeout\([\s\S]{0,60}250\)/);
    expect(CODE).toMatch(/searchSeq/);
    expect(CODE).toMatch(/if \(seq !== searchSeq\.current\) return/);
  });

  it("pages the list through the RPC and reports the true total", () => {
    expect(CODE).toMatch(/"admin_list_certificates"/);
    expect(CODE).toMatch(/const CERTS_PAGE_SIZE = 100;/);
    expect(COMPONENT).toMatch(/_offset: p \* CERTS_PAGE_SIZE/);
    expect(COMPONENT).toMatch(/Page \{page \+ 1\} of \{pageCount\}/);
    // Counting the page would report 100 for ever.
    expect(COMPONENT).not.toMatch(/setTotalCount\(\s*certs\.length\s*\)/);
    // The original cap.
    expect(COMPONENT).not.toMatch(/\.order\("issued_at"[\s\S]{0,60}\.limit\(50\)/);
  });

  it("offers the member's own PDF from the admin side", () => {
    expect(CODE).toMatch(/generateCertificatePdf/);
    // saveBlob, not doc.save() — an Android WebView swallows <a download>.
    expect(CODE).toMatch(/saveBlob\(/);
    expect(CODE, "doc.save() builds an <a download> that an Android WebView swallows").not.toMatch(/doc\.save\(/);
    expect(COMPONENT).toMatch(/Revoked certificates cannot be downloaded/);
  });

  it("keeps supabase.rpc in call position (Standing Rule 1)", () => {
    expect(CODE).toMatch(/\(supabase\.rpc as unknown as/);
    expect(COMPONENT).not.toMatch(/(?:const|let|var)\s+\w+\s*=\s*supabase\.rpc\s*;/);
  });

  it("warns what delete actually destroys before doing it", () => {
    expect(COMPONENT).toMatch(/Public verification will stop working immediately/);
    expect(COMPONENT).toMatch(/use Revoke instead/);
    // Measured on staging 2026-08-25: deleting a certificate used to leave the
    // member's "New Certificate!" notification behind, pointing at nothing.
    // The trigger now removes it, and the dialog says so.
    expect(COMPONENT).toMatch(/notification is removed so it cannot link to nothing/);
  });
});

describe("the migration", () => {
  const SQL = migrationSource();

  it("restates the constraint rather than dropping it silently", () => {
    expect(SQL).toMatch(/drop constraint if exists certificates_type_check/);
    expect(SQL).toMatch(/add constraint certificates_type_check check/);
  });

  it("gates both new RPCs on the admin role", () => {
    const search = SQL.slice(SQL.indexOf("admin_search_certificate_recipients"));
    expect(search).toMatch(/has_role\(auth\.uid\(\), 'admin'\)/);
    expect(search).toMatch(/raise exception 'Not authorized'/);
    const list = SQL.slice(SQL.indexOf("admin_list_certificates"));
    expect(list).toMatch(/has_role\(auth\.uid\(\), 'admin'\)/);
  });

  it("returns the count of the filtered set, not of the page", () => {
    expect((SQL.match(/count\(\*\) over \(\) as total_count/g) || []).length).toBe(2);
  });

  it("orders by a total order so pages cannot overlap or skip", () => {
    expect(SQL).toMatch(/order by m\.issued_at desc, m\.id desc/);
  });

  it("refuses an empty recipient query rather than returning everyone", () => {
    expect(SQL).toMatch(/if v_q = '' then\s*\n\s*return;/);
  });

  it("closes both functions to anon", () => {
    expect(SQL).toMatch(/revoke all on function public\.admin_search_certificate_recipients[^\n]*from anon/);
    expect(SQL).toMatch(/revoke all on function public\.admin_list_certificates[^\n]*from anon/);
  });

  it("indexes the ordering it depends on", () => {
    expect(SQL).toMatch(/create index if not exists idx_certificates_issued_at_id_desc/);
  });
});

describe("delete removes what still points at the certificate", () => {
  /**
   * ⚠ THE DEFECT THIS BLOCK EXISTS TO PREVENT.
   *
   * `certificates` has exactly one FK pointing at it (certificate_testimonials,
   * ON DELETE CASCADE) and one column that points at it with NO foreign key:
   * `user_notifications.reference_id`. Deleting a certificate therefore left
   * the member holding a "New Certificate! You've earned: …" notification for
   * a certificate that no longer existed.
   *
   * Measured 2026-08-25: staging carried 3 such orphans, PRODUCTION carried 1.
   * Every other loose reference column in the schema was checked against
   * certificates and holds zero certificate ids.
   */
  const SQL = migrationSource("certificate_delete_removes_notifications");

  it("cleans up through a trigger, not through the admin button", () => {
    // The admin screen is one delete path. SQL, a support script and any future
    // cascade are others. A trigger is the only place that covers all of them.
    expect(SQL).toMatch(/create trigger trg_cleanup_certificate_references/);
    expect(SQL).toMatch(/before delete on public\.certificates/);
    expect(SQL).toMatch(/for each row/);
  });

  it("is SECURITY DEFINER, because the admin is not the notification's owner", () => {
    // user_notifications carries "Users can delete own notifications"
    // USING (auth.uid() = user_id). Without SECURITY DEFINER an admin deleting
    // ANOTHER member's certificate would delete zero notifications, silently —
    // the exact failure class this whole change is about.
    expect(SQL).toMatch(/security definer/);
    expect(SQL).toMatch(/set search_path to 'public'/);
  });

  it("deletes only rows keyed to the certificate being removed", () => {
    expect(SQL).toMatch(/delete from public\.user_notifications\s*\n?\s*where reference_id = OLD\.id;/);
    // No branch, no dynamic SQL: the statement cannot widen.
    expect(SQL).not.toMatch(/execute\s+format/i);
    expect(SQL).not.toMatch(/truncate/i);
  });

  it("does not touch the historical orphans inside a schema migration", () => {
    // Removing rows from members' existing notification lists is a separate
    // decision with a separate blast radius. It is documented, not performed.
    const executable = SQL.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(executable).not.toMatch(/delete from public\.user_notifications\s+where not exists/i);
  });

  it("closes the trigger function to every client role", () => {
    expect(SQL).toMatch(/revoke all on function public\.cleanup_certificate_references\(\) from anon/);
    expect(SQL).toMatch(/revoke all on function public\.cleanup_certificate_references\(\) from authenticated/);
  });
});
