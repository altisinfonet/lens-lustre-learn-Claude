// Phase 7 / Task 7.3 — Component-level QA harness for the 16-Key Frozen Contract.
// Renders ParticipantStageBadge for each cert-eligible stage so we can capture
// canonical screenshots without seeding fake competition_entries rows.
// Public route is fine — no DB access, no PII, pure presentational.
import ParticipantStageBadge from "@/components/judge/ParticipantStageBadge";
import { participantStageLabel } from "@/lib/judging/participantStageLabels";
import { STAGE_CATALOG } from "@/lib/judging/stageCatalog";

const CASES: { id: string; round: string; statusKey: string; certEligible: boolean }[] = [
  { id: "r1-accepted",      round: "Round 1", statusKey: "round1_qualified", certEligible: false },
  { id: "r2-qualified-r3",  round: "Round 2", statusKey: "round2_qualified", certEligible: true  },
  { id: "r3-qualified-final",round:"Round 3", statusKey: "qualified_final",  certEligible: true  },
  { id: "r4-top-50",        round: "Round 4", statusKey: "top_50",           certEligible: true  },
];

export default function Phase7BadgesQA() {
  return (
    <div className="min-h-screen bg-background text-foreground p-12">
      <h1 className="text-2xl font-semibold mb-2">Phase 7 — Stage Badge Contract QA</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Source of truth: <code>v3_stage_catalog</code> → <code>participantWording.ts</code> →
        <code>ParticipantStageBadge</code>. Labels below are byte-identical to the 16-Key Frozen Contract.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl">
        {CASES.map((c) => (
          <div
            key={c.id}
            id={`badge-${c.id}`}
            className="border border-border rounded-lg p-6 bg-card"
          >
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
              {c.round}
            </div>
            <div className="flex items-center gap-3 mb-4">
              <ParticipantStageBadge status={c.statusKey} tags={[]} />
            </div>
            <div className="text-xs text-muted-foreground space-y-1 font-mono">
              <div>statusKey: <span className="text-foreground">{c.statusKey}</span></div>
              <div>label:     <span className="text-foreground">{participantStageLabel(c.statusKey)}</span></div>
              <div>certEligible: <span className="text-foreground">{String(c.certEligible)}</span></div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-12 max-w-4xl">
        <h2 className="text-lg font-semibold mb-3">Active Catalog (16 rows)</h2>
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2">stage_key</th>
                <th className="px-3 py-2">tag_label_canonical</th>
                <th className="px-3 py-2">round</th>
                <th className="px-3 py-2">cert</th>
              </tr>
            </thead>
            <tbody>
              {STAGE_CATALOG.filter((s) => s.is_active).map((s) => (
                <tr key={s.stage_key} className="border-t border-border">
                  <td className="px-3 py-1.5 font-mono">{s.stage_key}</td>
                  <td className="px-3 py-1.5">{s.tag_label_canonical}</td>
                  <td className="px-3 py-1.5">{s.round_number}</td>
                  <td className="px-3 py-1.5">{s.cert_eligible ? "✓" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
