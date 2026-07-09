/**
 * Admin diagnostic: /admin → Tag Semantics (Audit)
 * --------------------------------------------------
 * READ-ONLY page that loads every judging tag from the DB and renders:
 *   1. Its semantic classification (from src/lib/judging/tagSemantics.ts)
 *   2. The number of times judges have actually assigned it
 *      (per-tag count from the admin-only RPC `get_judging_tag_assignment_counts`)
 *   3. Whether the tag has a downstream HANDLER mapped — so award tags whose
 *      label does not map to a known `competition_entries.placement` key
 *      (and `unknown` family tags) are flagged loudly.
 *
 * Together these three signals catch every variant of an "orphan tag":
 *   • Tag exists in catalog but no judge has ever used it (zero assignments)
 *   • Tag exists and is being assigned but no downstream code consumes it
 *   • Tag exists with an unrecognized label (UNKNOWN family)
 *
 * Performs zero writes.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, ShieldCheck, AlertTriangle, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { classifyTag, type TagFamily } from "@/lib/judging/tagSemantics";

interface DbTag {
  id: string;
  label: string;
  is_system: boolean;
  is_active: boolean;
  is_visible: boolean | null;
  visible_in_round: number[] | null;
  sort_order: number;
}

const FAMILY_STYLE: Record<TagFamily, { label: string; cls: string }> = {
  progression_pass: { label: "Progression · Pass", cls: "text-primary border-primary/40 bg-primary/5" },
  progression_fail: { label: "Progression · Fail", cls: "text-destructive border-destructive/40 bg-destructive/5" },
  
  rejection: { label: "Rejection", cls: "text-destructive border-destructive/60 bg-destructive/10" },
  verification: { label: "Verification Hold", cls: "text-accent-foreground border-accent bg-accent/30" },
  needs_review: { label: "Needs Review", cls: "text-amber-600 border-amber-500/40 bg-amber-500/10" },
  award: { label: "Award · Honor", cls: "text-primary border-primary/60 bg-primary/10" },
  unknown: { label: "Unknown · No-op", cls: "text-muted-foreground border-border bg-muted/30" },
};

/**
 * Award labels that have a downstream handler.
 * Spec v3 §4.3 palette + auto-tier output. Hyphenated and non-hyphenated
 * forms both accepted because the DB stores hyphenated ("1st Runner-Up").
 */
const MAPPED_AWARD_LABELS = new Set<string>([
  "winner",
  "1st runner up",
  "1st runner-up",
  "2nd runner up",
  "2nd runner-up",
  "honorary mention",
  "honorable mention",
  "special jury",
  "special jury award",
  "top 50",
  "top 100",
  "qualified for final",
]);

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Returns true when this tag is wired into a downstream handler.
 *  - progression_pass / progression_fail / rejection / verification: handled by
 *    the round progression engine + verification edge functions.
 *  - award: only handled if its label is in MAPPED_AWARD_LABELS.
 *  - unknown: never handled.
 */
function isHandlerMapped(family: TagFamily, label: string): boolean {
  if (family === "unknown") return false;
  if (family === "award") return MAPPED_AWARD_LABELS.has(norm(label));
  return true;
}

const f = { fontFamily: "var(--font-heading)" };
const fb = { fontFamily: "var(--font-body)" };

const AdminTagSemanticsAudit = () => {
  const [tags, setTags] = useState<DbTag[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [countsError, setCountsError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const tagsP = supabase
        .from("judging_tags" as any)
        .select("id, label, is_system, is_active, is_visible, visible_in_round, sort_order")
        .order("sort_order", { ascending: true });
      const countsP = supabase.rpc("get_judging_tag_assignment_counts" as any);

      const [tagsRes, countsRes] = await Promise.all([tagsP, countsP]);

      if (!tagsRes.error) setTags((tagsRes.data as any as DbTag[]) || []);

      if (countsRes.error) {
        setCountsError(countsRes.error.message);
      } else {
        const map: Record<string, number> = {};
        for (const row of (countsRes.data as Array<{ tag_id: string; assignment_count: number | string }>) || []) {
          map[row.tag_id] = Number(row.assignment_count) || 0;
        }
        setCounts(map);
      }

      setLoading(false);
    })();
  }, []);

  const rows = useMemo(
    () =>
      tags.map((t) => {
        const semantic = classifyTag(t);
        const assignments = counts[t.id] ?? 0;
        const handlerMapped = isHandlerMapped(semantic.family, t.label);
        const isOrphan = assignments === 0;
        const isUnmapped = !handlerMapped;
        return { tag: t, semantic, assignments, handlerMapped, isOrphan, isUnmapped };
      }),
    [tags, counts]
  );

  const familyCounts = useMemo(() => {
    const c: Record<TagFamily, number> = {
      progression_pass: 0,
      progression_fail: 0,
      
      rejection: 0,
      verification: 0,
      needs_review: 0,
      award: 0,
      unknown: 0,
    };
    rows.forEach((r) => (c[r.semantic.family] += 1));
    return c;
  }, [rows]);

  const orphanCount = rows.filter((r) => r.isOrphan).length;
  const unmappedCount = rows.filter((r) => r.isUnmapped).length;
  const unknowns = rows.filter((r) => r.semantic.family === "unknown");

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-xs">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading tags…
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 max-w-6xl mx-auto">
      <header>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-px bg-primary" />
          <span className="text-[10px] tracking-[0.3em] uppercase text-primary" style={f}>
            Diagnostic
          </span>
        </div>
        <h1 className="text-2xl md:text-3xl font-light tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
          Tag Semantics <em className="italic text-primary">Audit</em>
        </h1>
        <p className="text-xs text-muted-foreground mt-2 max-w-2xl" style={fb}>
          Read-only audit of every judging tag — its semantic family, how many times
          judges have assigned it, and whether a downstream handler exists. Orphan or
          unmapped tags can be deleted in <strong>Judging Tags</strong>. Nothing on
          this page writes to the database.
        </p>
      </header>

      {/* Top alert banner — orphan + unmapped totals */}
      {(orphanCount > 0 || unmappedCount > 0 || countsError) && (
        <div className="border border-destructive/40 bg-destructive/5 px-4 py-3 flex items-start gap-2">
          <ShieldAlert className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          <div className="text-[11px] text-destructive space-y-1" style={fb}>
            {countsError && (
              <div>
                <strong>Assignment counts unavailable:</strong> {countsError}
              </div>
            )}
            {orphanCount > 0 && (
              <div>
                <strong>{orphanCount} orphan tag{orphanCount === 1 ? "" : "s"}</strong> —
                exist in the catalog but have never been assigned by any judge.
              </div>
            )}
            {unmappedCount > 0 && (
              <div>
                <strong>{unmappedCount} unmapped tag{unmappedCount === 1 ? "" : "s"}</strong> —
                no downstream handler consumes the assignment (no placement, no badge,
                no certificate effect).
              </div>
            )}
          </div>
        </div>
      )}

      {/* Summary chips — semantic families */}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(familyCounts) as TagFamily[]).map((fam) => (
          <div
            key={fam}
            className={`px-3 py-1.5 border text-[10px] tracking-[0.15em] uppercase ${FAMILY_STYLE[fam].cls}`}
            style={f}
          >
            {FAMILY_STYLE[fam].label} · {familyCounts[fam]}
          </div>
        ))}
      </div>

      {unknowns.length > 0 && (
        <div className="border border-destructive/40 bg-destructive/5 px-4 py-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          <div className="text-[11px] text-destructive" style={fb}>
            <strong>{unknowns.length} tag(s)</strong> are not classified and will be IGNORED
            by downstream phases. Review the rows marked “Unknown · No-op” below.
          </div>
        </div>
      )}

      {/* Table */}
      <div className="border border-border overflow-x-auto">
        <table className="w-full text-xs" style={fb}>
          <thead className="bg-muted/40 text-[9px] tracking-[0.2em] uppercase text-muted-foreground" style={f}>
            <tr>
              <th className="text-left px-3 py-2">Label</th>
              <th className="text-left px-3 py-2">Round</th>
              <th className="text-left px-3 py-2">Visibility</th>
              <th className="text-left px-3 py-2">Classification</th>
              <th className="text-left px-3 py-2">Effect</th>
              <th className="text-right px-3 py-2">Assignments</th>
              <th className="text-left px-3 py-2">Handler</th>
              <th className="text-left px-3 py-2">Explanation</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(({ tag, semantic, assignments, handlerMapped, isOrphan, isUnmapped }) => {
              const style = FAMILY_STYLE[semantic.family];
              const effect =
                semantic.family === "progression_pass" && semantic.advancesToRound
                  ? `→ R${semantic.advancesToRound}`
                  : semantic.family === "progression_fail" && semantic.blocksFromRound
                  ? `✗ R${semantic.blocksFromRound}`
                  : semantic.family === "verification" && semantic.verificationRound
                  ? `Hold · R${semantic.verificationRound}`
                  : semantic.family === "needs_review"
                  ? "Defer"
                  : semantic.family === "rejection"
                  ? "Terminate"
                  : semantic.family === "award"
                  ? "Honor"
                  : "—";
              const rowFlag = isOrphan || isUnmapped;
              return (
                <tr
                  key={tag.id}
                  className={`${tag.is_active ? "" : "opacity-50"} ${rowFlag ? "bg-destructive/5" : ""}`}
                >
                  <td className="px-3 py-2">
                    <div className="font-medium">{tag.label}</div>
                    {tag.is_system && (
                      <div className="text-[8px] tracking-[0.2em] uppercase text-primary/70 mt-0.5" style={f}>
                        System
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {Array.isArray(tag.visible_in_round) && tag.visible_in_round.length > 0
                      ? `R${tag.visible_in_round.join(", R")}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {tag.is_visible === false ? (
                      <span className="inline-block px-2 py-1 border border-border bg-muted/40 text-muted-foreground text-[9px] tracking-[0.15em] uppercase" style={f}>
                        Hidden
                      </span>
                    ) : (
                      <span className="inline-block px-2 py-1 border border-primary/30 bg-primary/5 text-primary text-[9px] tracking-[0.15em] uppercase" style={f}>
                        Visible
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-block px-2 py-1 border text-[9px] tracking-[0.15em] uppercase ${style.cls}`} style={f}>
                      {style.label}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px]">{effect}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {countsError ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className={isOrphan ? "text-destructive font-bold" : "text-foreground"}>
                        {assignments.toLocaleString()}
                      </span>
                    )}
                    {isOrphan && !countsError && (
                      <div className="text-[8px] tracking-[0.2em] uppercase text-destructive/80 mt-0.5" style={f}>
                        Orphan
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {handlerMapped ? (
                      <span className="inline-block px-2 py-1 border border-primary/30 bg-primary/5 text-primary text-[9px] tracking-[0.15em] uppercase" style={f}>
                        Mapped
                      </span>
                    ) : (
                      <span className="inline-block px-2 py-1 border border-destructive/50 bg-destructive/10 text-destructive text-[9px] tracking-[0.15em] uppercase" style={f}>
                        Unmapped
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{semantic.explanation}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <footer className="flex items-center gap-2 text-[10px] text-muted-foreground pt-2" style={fb}>
        <ShieldCheck className="h-3 w-3 text-primary" />
        Read-only audit. Counts pulled live via admin-only RPC. Handler-mapping list lives in
        <code className="ml-1 px-1 bg-muted rounded">src/pages/admin/AdminTagSemanticsAudit.tsx</code>
        — keep MAPPED_AWARD_LABELS in sync with ParticipantStageBadge.
      </footer>
    </div>
  );
};

export default AdminTagSemanticsAudit;
