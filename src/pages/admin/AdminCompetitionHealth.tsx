import JudgeUIvsDBGateAudit from "@/components/admin/JudgeUIvsDBGateAudit";
import JudgingInvariantsAudit from "@/components/admin/JudgingInvariantsAudit";
import JudgingDriftAudit from "@/components/admin/JudgingDriftAudit";
import JudgingForensicDriftAudit from "@/components/admin/JudgingForensicDriftAudit";
import EntryStatusDriftAudit from "@/components/admin/EntryStatusDriftAudit";
import AwardsIntegrityAudit from "@/components/admin/AwardsIntegrityAudit";
import CollusionAudit from "@/components/admin/CollusionAudit";
import UnjudgedParityAudit from "@/components/admin/UnjudgedParityAudit";
import CertificateDriftAudit from "@/components/admin/CertificateDriftAudit";

export default function AdminCompetitionHealth() {
  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <h1
          className="text-lg font-semibold text-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Competition Health
        </h1>
        <p className="text-xs text-muted-foreground">
          Per-entry forensic — Judge UI eligible photos vs database gate
          (decisions / 10-criteria scores / R4 verification), plus judging
          invariants (live + nightly cron drift).
        </p>
      </header>

      {/* Phase B0 — Forensic Drift (F1..F5) — read-only diagnostic */}
      <JudgingForensicDriftAudit />

      {/* Phase B1.7 — Entry Status Drift (stored vs derived) — read-only */}
      <EntryStatusDriftAudit />

      {/* R4 Hardening — Judging Invariants (live + nightly cron drift) */}
      <JudgingInvariantsAudit />

      {/* Phase 2.3 — Judging Progression Drift Audit (global) */}
      <JudgingDriftAudit />

      {/* Phase 2.4 — Round 4 Awards Integrity Audit (global) */}
      <AwardsIntegrityAudit />

      {/* Phase K — Cross-Judge Collusion Detector (global) */}
      <CollusionAudit />

      {/* J-03 — Unjudged Parity Check (single judge · tag-only) */}
      <UnjudgedParityAudit />

      {/* Phase L — Certificate Forensic Drift Audit (global) */}
      <CertificateDriftAudit />

      <JudgeUIvsDBGateAudit />
    </div>
  );
}
