/**
 * AdminVoteRewardLedger — A-06 (Audit v6).
 *
 * Surfaces every wallet_transactions row of type vote_reward / unvote_penalty
 * with a join chain back to its source competition + entry, the voter and the
 * entry owner side of the same vote (paired via reference_id), and per-comp
 * roll-ups so admin can see net payout per competition at a glance.
 *
 * Pure read-only. No mutations. Reuses the cached profile batcher used by
 * AdminTransactions for consistent name resolution.
 *
 * Design tokens only — semantic colors (primary, muted-foreground, destructive,
 * accent amber for drift). Mirrors the visual density of WalletReconciliationAudit
 * and JudgingDriftAudit so the admin UI stays uniform.
 */
import { useState, useEffect, useMemo } from "react";
import { Loader2, Vote, Search, RefreshCw, ArrowDownLeft, ArrowUpRight, Filter } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cachedFetchProfilesByIds } from "@/lib/profileBatch";
import { formatUSDFixed } from "@/lib/currencyFormat";

interface RewardRow {
  id: string;
  user_id: string;
  user_name: string | null;
  type: "vote_reward" | "unvote_penalty";
  amount: number;
  description: string | null;
  reference_id: string | null;
  created_at: string;
  // joined
  vote_id: string | null;
  entry_id: string | null;
  entry_title: string | null;
  competition_id: string | null;
  competition_title: string | null;
  // role inferred from description prefix
  role: "voter" | "owner" | "unknown";
}

const PAGE_SIZE = 100;

const AdminVoteRewardLedger = () => {
  const [rows, setRows] = useState<RewardRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [typeFilter, setTypeFilter] = useState<"all" | "vote_reward" | "unvote_penalty">("all");
  const [roleFilter, setRoleFilter] = useState<"all" | "voter" | "owner">("all");
  const [competitionFilter, setCompetitionFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const fetchPage = async (pageNum: number) => {
    setLoading(true);
    setError(null);
    try {
      const from = pageNum * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data: txns, error: txErr } = await supabase
        .from("wallet_transactions")
        .select("id, user_id, type, amount, description, reference_id, created_at")
        .in("type", ["vote_reward", "unvote_penalty"])
        .order("created_at", { ascending: false })
        .range(from, to);

      if (txErr) throw txErr;

      if (!txns || txns.length === 0) {
        if (pageNum === 0) setRows([]);
        setHasMore(false);
        setHasRun(true);
        return;
      }

      // Resolve voters + entry owners
      const voteIds = [...new Set(txns.map((t) => t.reference_id).filter((v): v is string => !!v))];

      const { data: votes } = voteIds.length
        ? await supabase
            .from("competition_votes")
            .select("id, entry_id, competition_entries:entry_id(id, title, competition_id, competitions:competition_id(id, title))")
            .in("id", voteIds)
        : { data: [] as Array<{ id: string; entry_id: string; competition_entries: { id: string; title: string; competition_id: string; competitions: { id: string; title: string } | null } | null }> };

      const voteMap = new Map<string, { entry_id: string; entry_title: string; competition_id: string; competition_title: string }>();
      (votes || []).forEach((v: any) => {
        const ent = v.competition_entries;
        if (!ent) return;
        const comp = ent.competitions;
        voteMap.set(v.id, {
          entry_id: ent.id,
          entry_title: ent.title ?? "—",
          competition_id: comp?.id ?? "",
          competition_title: comp?.title ?? "—",
        });
      });

      const userIds = [...new Set(txns.map((t) => t.user_id))];
      const profileMap = await cachedFetchProfilesByIds(userIds);

      const mapped: RewardRow[] = txns.map((t) => {
        const j = t.reference_id ? voteMap.get(t.reference_id) : undefined;
        const desc = (t.description ?? "").toLowerCase();
        const role: RewardRow["role"] = desc.startsWith("vote reward")
          ? "voter"
          : desc.startsWith("someone voted")
            ? "owner"
            : t.type === "unvote_penalty"
              ? "voter"
              : "unknown";
        return {
          id: t.id,
          user_id: t.user_id,
          user_name: profileMap.get(t.user_id) ?? null,
          type: t.type as RewardRow["type"],
          amount: Number(t.amount),
          description: t.description,
          reference_id: t.reference_id,
          created_at: t.created_at,
          vote_id: t.reference_id,
          entry_id: j?.entry_id ?? null,
          entry_title: j?.entry_title ?? null,
          competition_id: j?.competition_id ?? null,
          competition_title: j?.competition_title ?? null,
          role,
        };
      });

      setRows((prev) => (pageNum === 0 ? mapped : [...prev, ...mapped]));
      setHasMore(txns.length === PAGE_SIZE);
      setHasRun(true);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load vote reward ledger");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPage(0);
  }, []);

  const competitions = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach((r) => {
      if (r.competition_id) m.set(r.competition_id, r.competition_title ?? "—");
    });
    return [...m.entries()];
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      if (roleFilter !== "all" && r.role !== roleFilter) return false;
      if (competitionFilter !== "all" && r.competition_id !== competitionFilter) return false;
      if (q) {
        const hay = `${r.user_name ?? ""} ${r.user_id} ${r.entry_title ?? ""} ${r.competition_title ?? ""} ${r.description ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, typeFilter, roleFilter, competitionFilter, search]);

  const totals = useMemo(() => {
    let paid = 0,
      clawed = 0;
    for (const r of filtered) {
      if (r.type === "vote_reward") paid += r.amount;
      else clawed += r.amount;
    }
    return { paid, clawed, net: paid + clawed, count: filtered.length };
  }, [filtered]);

  return (
    <div className="border border-border rounded-sm">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2 p-4 border-b border-border">
        <div>
          <span className="text-[10px] tracking-[0.2em] uppercase text-primary block" style={{ fontFamily: "var(--font-heading)" }}>
            <Vote className="h-3.5 w-3.5 inline mr-2" />
            Vote Reward Ledger
          </span>
          <p className="text-[11px] text-muted-foreground mt-1" style={{ fontFamily: "var(--font-body)" }}>
            Every <code className="text-[10px]">vote_reward</code> + <code className="text-[10px]">unvote_penalty</code> wallet movement, joined to its source vote / entry / competition.
          </p>
        </div>
        <button
          onClick={() => {
            setPage(0);
            fetchPage(0);
          }}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border text-[10px] tracking-[0.15em] uppercase rounded-sm hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="grid md:grid-cols-4 gap-2 p-3 border-b border-border bg-muted/20">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search user, entry, competition…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-background border border-border rounded-sm pl-7 pr-2 py-1.5 text-xs outline-none focus:border-primary"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
          className="bg-background border border-border rounded-sm px-2 py-1.5 text-xs outline-none focus:border-primary"
        >
          <option value="all">All types</option>
          <option value="vote_reward">Vote reward</option>
          <option value="unvote_penalty">Unvote penalty</option>
        </select>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)}
          className="bg-background border border-border rounded-sm px-2 py-1.5 text-xs outline-none focus:border-primary"
        >
          <option value="all">All roles</option>
          <option value="voter">Voter side</option>
          <option value="owner">Entry owner side</option>
        </select>
        <select
          value={competitionFilter}
          onChange={(e) => setCompetitionFilter(e.target.value)}
          className="bg-background border border-border rounded-sm px-2 py-1.5 text-xs outline-none focus:border-primary"
        >
          <option value="all">All competitions</option>
          {competitions.map(([id, title]) => (
            <option key={id} value={id}>
              {title}
            </option>
          ))}
        </select>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border">
        <div className="bg-background p-3">
          <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground block" style={{ fontFamily: "var(--font-heading)" }}>
            Rows
          </span>
          <span className="text-base font-medium tabular-nums">{totals.count}</span>
        </div>
        <div className="bg-background p-3">
          <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground block" style={{ fontFamily: "var(--font-heading)" }}>
            Paid out
          </span>
          <span className="text-base font-medium tabular-nums text-primary">+{formatUSDFixed(totals.paid, 4)}</span>
        </div>
        <div className="bg-background p-3">
          <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground block" style={{ fontFamily: "var(--font-heading)" }}>
            Clawed back
          </span>
          <span className="text-base font-medium tabular-nums text-destructive">{formatUSDFixed(totals.clawed, 4)}</span>
        </div>
        <div className="bg-background p-3">
          <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground block" style={{ fontFamily: "var(--font-heading)" }}>
            Net
          </span>
          <span className="text-base font-medium tabular-nums">{formatUSDFixed(totals.net, 4)}</span>
        </div>
      </div>

      {/* Errors */}
      {error && (
        <div className="border-t border-destructive/30 bg-destructive/5 p-3">
          <p className="text-[11px] text-destructive">{error}</p>
        </div>
      )}

      {/* Table */}
      <div className="max-h-[480px] overflow-y-auto">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur z-10">
            <tr className="border-b border-border">
              <th className="text-left px-3 py-2 font-normal text-[9px] tracking-[0.15em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                When
              </th>
              <th className="text-left px-3 py-2 font-normal text-[9px] tracking-[0.15em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                User
              </th>
              <th className="text-left px-3 py-2 font-normal text-[9px] tracking-[0.15em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                Role
              </th>
              <th className="text-left px-3 py-2 font-normal text-[9px] tracking-[0.15em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                Competition / Entry
              </th>
              <th className="text-right px-3 py-2 font-normal text-[9px] tracking-[0.15em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                Amount
              </th>
              <th className="text-left px-3 py-2 font-normal text-[9px] tracking-[0.15em] uppercase text-muted-foreground w-8" style={{ fontFamily: "var(--font-heading)" }} />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground italic">
                  {hasRun ? "No matching reward movements." : "Loading ledger…"}
                </td>
              </tr>
            )}
            {filtered.map((r) => (
              <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-3 py-2 text-muted-foreground tabular-nums">
                  {new Date(r.created_at).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium">{r.user_name ?? <span className="text-muted-foreground font-mono text-[10px]">{r.user_id.slice(0, 8)}…</span>}</div>
                </td>
                <td className="px-3 py-2">
                  {r.role === "voter" && (
                    <span className="text-[9px] tracking-[0.15em] uppercase px-1.5 py-0.5 border border-primary/40 text-primary rounded-sm" style={{ fontFamily: "var(--font-heading)" }}>
                      Voter
                    </span>
                  )}
                  {r.role === "owner" && (
                    <span className="text-[9px] tracking-[0.15em] uppercase px-1.5 py-0.5 border border-emerald-500/40 text-emerald-500 rounded-sm" style={{ fontFamily: "var(--font-heading)" }}>
                      Owner
                    </span>
                  )}
                  {r.role === "unknown" && (
                    <span className="text-[9px] tracking-[0.15em] uppercase px-1.5 py-0.5 border border-amber-500/40 text-amber-500 rounded-sm" style={{ fontFamily: "var(--font-heading)" }}>
                      Unknown
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {r.competition_title ? (
                    <>
                      <span className="text-foreground">{r.competition_title}</span>
                      {r.entry_title && <span className="text-muted-foreground"> · {r.entry_title}</span>}
                    </>
                  ) : (
                    <span className="italic">Orphan — vote deleted</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <span className={r.type === "vote_reward" ? "text-primary" : "text-destructive"}>
                    {r.type === "vote_reward" ? "+" : ""}
                    {formatUSDFixed(r.amount, 4)}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {r.type === "vote_reward" ? (
                    <ArrowDownLeft className="h-3 w-3 text-primary" />
                  ) : (
                    <ArrowUpRight className="h-3 w-3 text-destructive" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between p-3 border-t border-border">
        <span className="text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
          <Filter className="h-2.5 w-2.5 inline mr-1" />
          Showing {filtered.length} of {rows.length} loaded
        </span>
        {hasMore && (
          <button
            onClick={() => {
              const next = page + 1;
              setPage(next);
              fetchPage(next);
            }}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border text-[10px] tracking-[0.15em] uppercase rounded-sm hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {loading && <Loader2 className="h-3 w-3 animate-spin" />}
            Load older
          </button>
        )}
      </div>
    </div>
  );
};

export default AdminVoteRewardLedger;
