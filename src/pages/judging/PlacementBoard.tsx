/**
 * PlacementBoard — Phase 8 deliverable (SOW R4 Placements & Mandatory Awards).
 *
 * Surfaces the three mandatory Round-4 award slots (Winner, 1st Runner-Up, 2nd Runner-Up)
 * and renders a blocking banner while any of them is unassigned. Optional awards
 * (Honorary Mention, Special Jury Award) are rendered as informational slots only
 * and never contribute to the blocker.
 *
 * Source of truth: live reads from `judging_tags` + `judge_tag_assignments`.
 * No local state of placements — DOM mirrors DB exactly.
 *
 * Scope-locked per Phase 8 SOW. Does not mutate data; read-only status board.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, Trophy, Medal, Award } from "lucide-react";

interface PlacementBoardProps {
  competitionId: string;
}

interface AwardSlot {
  key: string;           // normalized label (lowercase)
  displayLabel: string;  // human label
  required: boolean;
  icon: React.ReactNode;
  assigned: { entryId: string; title?: string }[];
}

// Mirrors server-side REQUIRED_AWARDS in supabase/functions/complete-round/index.ts
const REQUIRED_AWARD_KEYS = new Set(["winner", "1st runner up", "2nd runner up"]);

export const PlacementBoard = ({ competitionId }: PlacementBoardProps) => {
  const [loading, setLoading] = useState(true);
  const [slots, setSlots] = useState<AwardSlot[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);

      // 1. Fetch R4 tag definitions
      const { data: tags, error: tagErr } = await supabase
        .from("judging_tags")
        .select("id, label, visible_in_round");
      if (tagErr) { if (!cancelled) { setError(tagErr.message); setLoading(false); } return; }

      const r4Tags = (tags || []).filter(
        (t: any) => Array.isArray(t.visible_in_round) && t.visible_in_round.includes(4),
      );
      const tagIdToKey = new Map<string, string>();
      const tagIdToLabel = new Map<string, string>();
      for (const t of r4Tags) {
        tagIdToKey.set(t.id, String(t.label).toLowerCase().trim());
        tagIdToLabel.set(t.id, t.label);
      }

      // 2. Fetch entries in R4 for this competition
      const { data: entries, error: entErr } = await supabase
        .from("competition_entries")
        .select("id, title")
        .eq("competition_id", competitionId)
        .eq("current_round", "4");
      if (entErr) { if (!cancelled) { setError(entErr.message); setLoading(false); } return; }

      const entryMap = new Map<string, string>();
      (entries || []).forEach((e: any) => entryMap.set(e.id, e.title));

      // 3. Fetch tag assignments for those entries
      const entryIds = (entries || []).map((e: any) => e.id);
      let assignments: any[] = [];
      if (entryIds.length > 0) {
        const { data: rows, error: asgErr } = await supabase
          .from("judge_tag_assignments")
          .select("entry_id, tag_id")
          .in("entry_id", entryIds);
        if (asgErr) { if (!cancelled) { setError(asgErr.message); setLoading(false); } return; }
        assignments = rows || [];
      }

      // 4. Build slots
      const keyToAssigned = new Map<string, { entryId: string; title?: string }[]>();
      for (const a of assignments) {
        const key = tagIdToKey.get(a.tag_id);
        if (!key) continue;
        const list = keyToAssigned.get(key) || [];
        if (!list.find((x) => x.entryId === a.entry_id)) {
          list.push({ entryId: a.entry_id, title: entryMap.get(a.entry_id) });
        }
        keyToAssigned.set(key, list);
      }

      const built: AwardSlot[] = r4Tags.map((t: any) => {
        const key = String(t.label).toLowerCase().trim();
        const required = REQUIRED_AWARD_KEYS.has(key);
        const icon =
          key === "winner" ? <Trophy className="h-4 w-4" /> :
          key.includes("runner up") ? <Medal className="h-4 w-4" /> :
          <Award className="h-4 w-4" />;
        return {
          key,
          displayLabel: t.label,
          required,
          icon,
          assigned: keyToAssigned.get(key) || [],
        };
      });

      // Sort: required first (winner → 1st RU → 2nd RU), then optional alphabetically
      const orderKey = (s: AwardSlot) => {
        if (s.key === "winner") return 0;
        if (s.key === "1st runner up") return 1;
        if (s.key === "2nd runner up") return 2;
        return 10;
      };
      built.sort((a, b) => {
        const oa = orderKey(a); const ob = orderKey(b);
        if (oa !== ob) return oa - ob;
        return a.displayLabel.localeCompare(b.displayLabel);
      });

      if (!cancelled) { setSlots(built); setLoading(false); }
    };
    load();
    return () => { cancelled = true; };
  }, [competitionId]);

  const missingRequired = useMemo(
    () => slots.filter((s) => s.required && s.assigned.length === 0).map((s) => s.displayLabel),
    [slots],
  );

  const allRequiredMet = slots.length > 0 && missingRequired.length === 0
    && slots.filter((s) => s.required).length === REQUIRED_AWARD_KEYS.size;

  if (loading) return <div className="text-sm text-muted-foreground">Loading placement board…</div>;
  if (error) return <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="h-5 w-5" />
          Round 4 — Placement Board
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {missingRequired.length > 0 ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Round 4 cannot be finalized yet</AlertTitle>
            <AlertDescription>
              The following mandatory placement{missingRequired.length > 1 ? "s have" : " has"} not been assigned:
              <strong className="ml-1">{missingRequired.join(", ")}</strong>.
              All three — Winner, 1st Runner-Up, and 2nd Runner-Up — are required. Honorary Mention
              and Special Jury Award are optional and do not block closure.
            </AlertDescription>
          </Alert>
        ) : allRequiredMet ? (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>All mandatory placements assigned</AlertTitle>
            <AlertDescription>
              Winner, 1st Runner-Up, and 2nd Runner-Up are all in place. Round 4 is ready to be finalized.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {slots.map((slot) => (
            <div
              key={slot.key}
              className={`border rounded-md p-3 ${
                slot.required && slot.assigned.length === 0
                  ? "border-destructive/40 bg-destructive/5"
                  : "border-border"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {slot.icon}
                  <span>{slot.displayLabel}</span>
                </div>
                <Badge variant={slot.required ? "default" : "secondary"}>
                  {slot.required ? "Mandatory" : "Optional"}
                </Badge>
              </div>
              {slot.assigned.length === 0 ? (
                <div className="text-xs text-muted-foreground">No entry assigned</div>
              ) : (
                <ul className="text-xs space-y-1">
                  {slot.assigned.map((a) => (
                    <li key={a.entryId} className="truncate">
                      {a.title || a.entryId}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default PlacementBoard;
