/**
 * M12 · Admin → Messages → "Broadcast": send one message (text, emoji, pictures, web links) into the message box of
 * every member you choose. It goes out in batches (500 at a time, a minute apart) on the job engine; every broadcast
 * shows delivered / failed / read per batch and per member. List → New broadcast → one broadcast's report.
 */
import { useMemo, useState } from "react";
import { Megaphone, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import AdminDataTable, { type DTColumn } from "@/components/admin/AdminDataTable";
import { useBroadcasts, type BcRow, type BcStatus } from "@/hooks/admin/useAdminBroadcasts";
import BroadcastComposer from "./BroadcastComposer";
import BroadcastDetail from "./BroadcastDetail";
import { WelcomeCard } from "./BroadcastExtras";
import { BcStatusChip, Ticks, audienceText, fmtWhen, pct } from "./BroadcastParts";

type View = { kind: "list" } | { kind: "new" } | { kind: "detail"; id: number };

export default function BroadcastPanel() {
  const [view, setView] = useState<View>({ kind: "list" });
  const [tab, setTab] = useState<"all" | BcStatus>("all");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const list = useBroadcasts(tab === "all" ? null : tab, page, pageSize);
  const counts = list.data?.counts ?? {};
  const all = Object.values(counts).reduce((a, n) => a + (n ?? 0), 0);

  const columns = useMemo<DTColumn<BcRow>[]>(() => [
    { key: "title", header: "Broadcast", className: "max-w-[340px]", cell: (b) => (
      <div className="min-w-0"><p className="truncate font-medium">{b.title}</p>
        <p className="truncate text-xs text-muted-foreground">{b.body || (b.photos > 0 ? `${b.photos} picture${b.photos === 1 ? "" : "s"}` : "")}{b.photos > 0 && b.body ? ` · ${b.photos} 📷` : ""}</p></div>) },
    { key: "audience", header: "Audience", className: "whitespace-nowrap", cell: (b) => <span className="text-sm">{audienceText(b.audience)}{b.total_members != null ? <span className="text-muted-foreground"> · {b.total_members.toLocaleString()}</span> : null}</span> },
    { key: "status", header: "Status", cell: (b) => <BcStatusChip status={b.status} /> },
    { key: "progress", header: "Progress", className: "min-w-[150px]", cell: (b) => b.total_members ? (
      <div className="space-y-1"><Progress value={pct(b.delivered + b.failed, b.total_members)} aria-label="Progress" className="h-1.5" />
        <p className="text-[11px] text-muted-foreground">batch {b.batches_done} of {b.batches_total}</p></div>) : <span className="text-muted-foreground">—</span> },
    { key: "delivered", header: "Delivered", cell: (b) => <span className="inline-flex items-center gap-1 tabular-nums"><Ticks state="delivered" />{b.delivered.toLocaleString()}</span> },
    { key: "read", header: "Read", cell: (b) => <span className="inline-flex items-center gap-1 tabular-nums"><Ticks state="read" />{b.read.toLocaleString()}{b.delivered > 0 ? <span className="text-xs text-muted-foreground"> ({pct(b.read, b.delivered)}%)</span> : null}</span> },
    { key: "failed", header: "Failed", cell: (b) => <span className={b.failed > 0 ? "tabular-nums text-destructive" : "tabular-nums text-muted-foreground"}>{b.failed.toLocaleString()}</span> },
    { key: "when", header: "Started", className: "whitespace-nowrap", cell: (b) => <span className="text-sm text-muted-foreground">{fmtWhen(b.started_at ?? b.send_at ?? b.created_at)}</span> },
  ], []);

  if (view.kind === "new") return <BroadcastComposer onBack={() => setView({ kind: "list" })} onSent={(id) => setView({ kind: "detail", id })} />;
  if (view.kind === "detail") return <BroadcastDetail id={view.id} onBack={() => setView({ kind: "list" })} />;

  return (
    <div className="space-y-3" data-testid="messages-broadcast">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          Send one message, with pictures, emoji and links, into the message box of every member you choose. It goes out in batches of 500, a minute apart,
          and you see who got it and who read it.
        </p>
        <Button onClick={() => setView({ kind: "new" })} data-testid="bc-new"><Plus className="mr-1 h-4 w-4" aria-hidden="true" />New broadcast</Button>
      </div>
      <WelcomeCard />
      <AdminDataTable<BcRow>
        testId="bc-table"
        rows={list.data?.rows ?? []}
        rowKey={(b) => String(b.id)}
        columns={columns}
        tabs={[
          { key: "all", label: "All", count: all },
          { key: "sending", label: "Sending", count: counts.sending ?? 0 },
          { key: "scheduled", label: "Scheduled", count: counts.scheduled ?? 0 },
          { key: "done", label: "Done", count: counts.done ?? 0 },
          { key: "draft", label: "Drafts", count: counts.draft ?? 0 },
          { key: "paused", label: "Paused", count: counts.paused ?? 0, warn: true },
          { key: "cancelled", label: "Cancelled", count: counts.cancelled ?? 0 },
          { key: "withdrawn", label: "Withdrawn", count: counts.withdrawn ?? 0 },
        ]}
        tab={tab}
        onTab={(k) => { setTab(k as "all" | BcStatus); setPage(0); }}
        page={page} pageSize={pageSize} total={list.data?.total ?? 0} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(0); }}
        loading={list.isLoading} fetching={list.isFetching}
        error={list.error ? `Could not load broadcasts: ${(list.error as Error).message}` : null}
        emptyText={tab === "all" ? "No broadcasts yet. Press “New broadcast” to write the first one." : "Nothing here."}
        onRowClick={(b) => setView({ kind: "detail", id: b.id })}
        phoneCard={(b) => (
          <div className="space-y-1">
            <div className="flex items-center gap-2"><Megaphone className="h-4 w-4 text-muted-foreground" aria-hidden="true" /><p className="min-w-0 flex-1 truncate font-medium">{b.title}</p><BcStatusChip status={b.status} /></div>
            <p className="truncate text-xs text-muted-foreground">{audienceText(b.audience)}{b.total_members != null ? ` · ${b.total_members.toLocaleString()} members` : ""}</p>
            <p className="flex flex-wrap items-center gap-x-3 text-xs"><span className="inline-flex items-center gap-1"><Ticks state="delivered" />{b.delivered.toLocaleString()}</span>
              <span className="inline-flex items-center gap-1"><Ticks state="read" />{b.read.toLocaleString()}</span>{b.failed > 0 && <span className="text-destructive">{b.failed} failed</span>}</p>
          </div>)}
      />
    </div>
  );
}
