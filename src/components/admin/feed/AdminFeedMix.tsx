/**
 * S12-F6 · Admin → Feed → Personal Feed: the mix and the before/after numbers.
 *
 * Gate: "Admin weights (… fair %, suggested %) with no release; new mix shown to
 * a small % first; measure time spent, likes per view, return rate — Measured
 * before/after". (Owner 2026-10-18: no video boost — there is no video weight.)
 *
 *   · MIX — friends & follows / suggested / fair-share slots per page of 10.
 *     Saved by feed_mix_set (admin only; the server refuses a non-admin and any
 *     mix that does not add up to 10, and writes one audit row — it shows in
 *     the history on this page). The next page any member loads uses it; no
 *     release.
 *   · WHO GETS IT — the switch above (Off / Selected members / All members):
 *     "a small % first" = Selected members. There is no percentage mode: the
 *     switch (feature_allowed) is shared with the video features' upload
 *     checks, and a third mode there is not a small change.
 *   · NUMBERS — feed_mix_admin_stats (admin only): last 7 days, members WITH the
 *     personal feed vs WITHOUT.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
const rpc: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args);

export interface Mix { circle: number; suggested: number; fair: number }
interface Group { members: number; feed_views: number; likes: number; likes_per_view: number | null; avg_time_on_post_s: number | null; returning_share: number | null }
interface Stats { days: number; mix: Mix; groups: { with: Group; without: Group } }

export const MIX_TOTAL = 10;
export const mixSum = (m: Mix) => m.circle + m.suggested + m.fair;

export function mixErrorMessage(e: { message?: string } | null | undefined): string {
  const m = e?.message ?? "";
  if (m.includes("FEEDMIX-001")) return "Only an admin can change this.";
  if (m.includes("FEEDMIX-002")) return "The three numbers must add up to 10.";
  return "Couldn't save — try again.";
}

const SLIDERS: ReadonlyArray<{ key: keyof Mix; label: string; help: string }> = [
  { key: "circle", label: "Friends & follows", help: "posts from people they know or follow" },
  { key: "suggested", label: "Suggested", help: "posts matched to their interests" },
  { key: "fair", label: "Fair share", help: "less-seen photographers" },
];

const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(0)} %`);
const num = (v: number | null, d = 2) => (v == null ? "—" : v.toFixed(d));

export default function AdminFeedMix() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<Mix | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    const { data, error } = await rpc("feed_mix_admin_stats", { _days: 7 });
    if (error || !data || typeof data !== "object") { setFailed(true); return; }
    const s = data as Stats;
    setStats(s);
    setDraft({ circle: Number(s.mix?.circle ?? 6), suggested: Number(s.mix?.suggested ?? 2), fair: Number(s.mix?.fair ?? 2) });
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!draft || mixSum(draft) !== MIX_TOTAL) return;
    setSaving(true);
    const { error } = await rpc("feed_mix_set", { _circle: draft.circle, _suggested: draft.suggested, _fair: draft.fair });
    setSaving(false);
    if (error) { toast({ title: mixErrorMessage(error), variant: "destructive" }); return; }
    toast({ title: "Feed mix saved", description: "Members get it on the next page they load." });
    void load();
  };

  const card = "rounded-lg border border-border bg-card p-4";
  const label = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
  if (failed) {
    return (
      <div className={`mx-auto max-w-5xl ${card} text-sm text-muted-foreground`} data-testid="feed-mix-failed">
        Couldn't load the feed mix and numbers. <button type="button" className="text-primary underline" onClick={() => void load()}>Try again</button>
      </div>
    );
  }
  if (!stats || !draft) {
    return <div className="mx-auto max-w-5xl flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }
  const sum = mixSum(draft);
  const dirty = draft.circle !== Number(stats.mix.circle) || draft.suggested !== Number(stats.mix.suggested) || draft.fair !== Number(stats.mix.fair);
  const rows: Array<[string, (g: Group) => string]> = [
    ["Members", (g) => g.members.toLocaleString()],
    ["Feed views", (g) => g.feed_views.toLocaleString()],
    ["Likes per view", (g) => num(g.likes_per_view, 3)],
    ["Average time on a post", (g) => (g.avg_time_on_post_s == null ? "—" : `${num(g.avg_time_on_post_s, 1)} s`)],
    ["Came back on 2+ days", (g) => pct(g.returning_share)],
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-4" data-testid="feed-mix">
      <section className={card} aria-labelledby="feed-mix-h">
        <h3 id="feed-mix-h" className={label}>Feed mix — posts per page of 10</h3>
        <div className="mt-3 space-y-3">
          {SLIDERS.map(({ key, label: l, help }) => (
            <label key={key} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-sm">
              <span>{l} <span className="text-xs text-muted-foreground">— {help}</span></span>
              <span className="w-6 text-right font-semibold tabular-nums" data-testid={`feed-mix-value-${key}`}>{draft[key]}</span>
              <input
                type="range" min={0} max={MIX_TOTAL} step={1}
                value={draft[key]}
                onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })}
                className="col-span-2 w-full accent-primary"
                aria-label={l}
                data-testid={`feed-mix-${key}`}
              />
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className={`text-xs ${sum === MIX_TOTAL ? "text-muted-foreground" : "text-destructive"}`} data-testid="feed-mix-sum">
            Total {sum} of {MIX_TOTAL}{sum === MIX_TOTAL ? "" : " — must add up to 10"}
          </span>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !dirty || sum !== MIX_TOTAL}
            className="ml-auto rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            data-testid="feed-mix-save"
          >
            {saving ? "Saving…" : "Save mix"}
          </button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Who gets the personal feed is the switch above — use Selected members to try a new mix on a few people first.
        </p>
      </section>

      <section className={card} aria-labelledby="feed-nums-h">
        <h3 id="feed-nums-h" className={label}>Last {stats.days} days — with vs without the personal feed</h3>
        <table className="mt-3 w-full text-sm" data-testid="feed-mix-stats">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1 font-medium" />
              <th className="py-1 text-right font-medium">With</th>
              <th className="py-1 text-right font-medium">Without</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, f]) => (
              <tr key={name} className="border-t border-border">
                <td className="py-1.5">{name}</td>
                <td className="py-1.5 text-right tabular-nums">{f(stats.groups.with)}</td>
                <td className="py-1.5 text-right tabular-nums">{f(stats.groups.without)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted-foreground">
          Members who opened the feed in the window, grouped by whether they have the personal feed now. Likes are all likes they gave in the window.
        </p>
      </section>
    </div>
  );
}
