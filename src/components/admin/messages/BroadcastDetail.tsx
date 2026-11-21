/**
 * M12 · one broadcast: what was sent, the totals (delivered · failed · read · not read yet), the batches one by one,
 * and every member with their tick. Actions: pause / resume / cancel / retry the failed / withdraw.
 * The numbers come from the server (admin_message_broadcast_report / _recipients); while it is still going out the
 * page re-reads them every 30 seconds.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, PauseCircle, PlayCircle, RefreshCw, RotateCw, Undo2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/core/use-toast";
import AdminDataTable, { type DTColumn } from "@/components/admin/AdminDataTable";
import { MemberAvatar } from "@/components/admin/users/memberUi";
import AutoBadge from "@/components/AutoBadge";
import { adminMessageCall } from "@/hooks/admin/useAdminMessages";
import {
  useBroadcastReport, useBroadcastRecipients, useRefreshBroadcasts,
  type BcBatch, type BcRecipient, type BcRecipientFilter,
} from "@/hooks/admin/useAdminBroadcasts";
import { BatchChip, BcStatusChip, CountCard, EngineWarning, Ticks, audienceText, fmtWhen, pct } from "./BroadcastParts";

type Action = "send" | "pause" | "resume" | "cancel" | "retry_failed" | "withdraw";
const ACTION_TEXT: Record<Action, { title: string; body: string; button: string; destructive?: boolean }> = {
  send: { title: "Send this draft now?", body: "It goes out in batches of 500, a minute apart. You can pause, cancel or withdraw it afterwards.", button: "Send now" },
  pause: { title: "Pause this broadcast?", body: "The batch that is running finishes; the rest wait until you resume.", button: "Pause" },
  resume: { title: "Resume this broadcast?", body: "The waiting batches go out again, one a minute.", button: "Resume" },
  cancel: { title: "Cancel this broadcast?", body: "Batches that have not run are dropped. Messages already delivered stay in the boxes (withdraw removes them).", button: "Cancel broadcast", destructive: true },
  retry_failed: { title: "Retry the failed members?", body: "Only members who failed are tried again. Nobody gets a second copy.", button: "Retry" },
  withdraw: { title: "Withdraw this broadcast?", body: "The message is removed from every member's message box, with its pictures, in batches. This cannot be undone.", button: "Withdraw", destructive: true },
};

export default function BroadcastDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const report = useBroadcastReport(id);
  const refresh = useRefreshBroadcasts();
  const [filter, setFilter] = useState<BcRecipientFilter>("all");
  const [searchText, setSearchText] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [ask, setAsk] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const t = setTimeout(() => { setQ(searchText); setPage(0); }, 300); return () => clearTimeout(t); }, [searchText]);
  const people = useBroadcastRecipients(id, filter, q, page, pageSize);

  const r = report.data;
  const b = r?.broadcast;
  const t = r?.totals;

  const act = async (a: Action) => {
    setBusy(true);
    try {
      if (a === "send") await adminMessageCall("admin_message_broadcast_send", { _id: id, _at: null });
      else if (a === "withdraw") await adminMessageCall("admin_message_broadcast_withdraw", { _id: id });
      else await adminMessageCall("admin_message_broadcast_control", { _id: id, _action: a });
      toast({ title: "Done", description: ACTION_TEXT[a].title.replace("?", "") });
      await refresh();
      setAsk(null);
    } catch (e) {
      toast({ title: "Not done", description: e instanceof Error ? e.message : "request failed", variant: "destructive" });
    } finally { setBusy(false); }
  };

  const batchCols = useMemo<DTColumn<BcBatch>[]>(() => [
    { key: "seq", header: "Batch", cell: (x) => <span className="font-medium tabular-nums">#{x.seq}</span> },
    { key: "status", header: "Status", cell: (x) => <BatchChip status={x.status} /> },
    { key: "size", header: "Members", cell: (x) => <span className="tabular-nums">{x.size.toLocaleString()}</span> },
    { key: "delivered", header: "Delivered", cell: (x) => <span className="tabular-nums">{x.delivered.toLocaleString()}</span> },
    { key: "failed", header: "Failed", cell: (x) => <span className={x.failed > 0 ? "tabular-nums text-destructive" : "tabular-nums text-muted-foreground"}>{x.failed.toLocaleString()}</span> },
    { key: "attempts", header: "Tries", cell: (x) => <span className="tabular-nums">{x.attempts}</span> },
    { key: "run", header: "Runs at", className: "whitespace-nowrap", cell: (x) => <span className="text-sm text-muted-foreground">{fmtWhen(x.run_at)}</span> },
    { key: "fin", header: "Finished", className: "whitespace-nowrap", cell: (x) => <span className="text-sm text-muted-foreground">{fmtWhen(x.finished_at)}</span> },
    { key: "err", header: "Last error", className: "max-w-[220px]", cell: (x) => <span className="block truncate text-xs text-destructive" title={x.last_error ?? ""}>{x.last_error ?? ""}</span> },
  ], []);

  const peopleCols = useMemo<DTColumn<BcRecipient>[]>(() => [
    { key: "member", header: "Member", className: "max-w-[320px]", cell: (m) => (
      <div className="flex items-center gap-3"><MemberAvatar m={{ avatar_url: m.avatar_url, full_name: m.full_name, email: null }} />
        <div className="min-w-0"><p className="flex items-center gap-1 font-medium"><span className="truncate">{m.full_name || (m.username ? `@${m.username}` : m.user_id.slice(0, 8))}</span><AutoBadge userId={m.user_id} only="verified" /></p>
          {m.username && <p className="truncate text-xs text-muted-foreground">@{m.username}</p>}</div></div>) },
    { key: "state", header: "Status", cell: (m) => {
      const s = m.status === "delivered" && m.read ? "read" : m.status;
      return <div className="flex items-center gap-2" data-testid="bc-person-state"><Ticks state={s} />
        <span className="text-sm">{s === "read" ? "Read" : s === "delivered" ? "Delivered" : s === "failed" ? "Failed" : s === "withdrawn" ? "Withdrawn" : "Waiting"}</span></div>; } },
    { key: "when", header: "Delivered", className: "whitespace-nowrap", cell: (m) => <span className="text-sm text-muted-foreground">{fmtWhen(m.delivered_at)}</span> },
    { key: "read", header: "Read at", className: "whitespace-nowrap", cell: (m) => <span className="text-sm text-muted-foreground">{fmtWhen(m.read_at)}</span> },
    { key: "err", header: "Reason", className: "max-w-[240px]", cell: (m) => <span className="block truncate text-xs text-destructive" title={m.error ?? ""}>{m.error ?? ""}</span> },
  ], []);

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["Name", "Username", "Status", "Read", "Delivered at", "Read at", "Reason"].join(",")]
      .concat((people.data?.rows ?? []).map((m) => [m.full_name, m.username, m.status, m.read ? "yes" : "no", m.delivered_at, m.read_at, m.error].map(esc).join(",")));
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `broadcast-${id}-members.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const canSend = b?.status === "draft";
  const canPause = b && ["sending", "scheduled"].includes(b.status);
  const canResume = b?.status === "paused";
  const canCancel = b && ["scheduled", "sending", "paused"].includes(b.status);
  const canRetry = b && ["done", "sending", "paused"].includes(b.status) && (t?.failed ?? 0) > 0;
  const canWithdraw = b && ["sending", "paused", "done", "cancelled"].includes(b.status) && (t?.delivered ?? 0) > 0;
  const c = people.data?.counts;

  return (
    <div className="space-y-4" data-testid="bc-detail">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />All broadcasts</Button>
        <Button variant="outline" size="sm" onClick={() => { void report.refetch(); void people.refetch(); }}><RefreshCw className="mr-1 h-4 w-4" aria-hidden="true" />Refresh</Button>
        <div className="ml-auto flex flex-wrap gap-2">
          {canSend && <Button size="sm" onClick={() => setAsk("send")} data-testid="bc-send-draft"><PlayCircle className="mr-1 h-4 w-4" aria-hidden="true" />Send now</Button>}
          {canPause && <Button size="sm" variant="outline" onClick={() => setAsk("pause")}><PauseCircle className="mr-1 h-4 w-4" aria-hidden="true" />Pause</Button>}
          {canResume && <Button size="sm" onClick={() => setAsk("resume")}><PlayCircle className="mr-1 h-4 w-4" aria-hidden="true" />Resume</Button>}
          {canRetry && <Button size="sm" variant="outline" onClick={() => setAsk("retry_failed")}><RotateCw className="mr-1 h-4 w-4" aria-hidden="true" />Retry failed</Button>}
          {canCancel && <Button size="sm" variant="outline" onClick={() => setAsk("cancel")}><XCircle className="mr-1 h-4 w-4" aria-hidden="true" />Cancel</Button>}
          {canWithdraw && <Button size="sm" variant="outline" className="text-destructive" onClick={() => setAsk("withdraw")}><Undo2 className="mr-1 h-4 w-4" aria-hidden="true" />Withdraw</Button>}
          {b && b.status !== "draft" && (
            <Button size="sm" variant="outline" data-testid="bc-allow-replies" onClick={async () => {
              try {
                const n = Number(await adminMessageCall("admin_message_broadcast_unlock", { _id: id }));
                toast({ title: n > 0 ? "Replies allowed" : "Nothing to open", description: n > 0 ? `${n} chat${n === 1 ? "" : "s"} can reply again.` : "No chat of this broadcast was announcement-only." });
              } catch (e) { toast({ title: "Not done", description: e instanceof Error ? e.message : "request failed", variant: "destructive" }); }
            }}>Allow replies</Button>
          )}
        </div>
      </div>

      {report.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {report.error && <p role="alert" className="text-sm text-destructive">Could not read this broadcast: {(report.error as Error).message}</p>}

      {r && b && t && (
        <>
          <EngineWarning on={r.engine_on || ["done", "cancelled", "withdrawn", "draft"].includes(b.status)} />
          <section className="rounded-xl border border-border bg-card p-4" aria-label="Broadcast">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold">{b.title}</h3><BcStatusChip status={b.status} />
              <span className="text-xs text-muted-foreground">{audienceText(b.audience)} · {b.push ? "with push notification" : "no push notification"}</span>
            </div>
            {b.body && <p className="mt-2 whitespace-pre-wrap break-words text-sm">{b.body}</p>}
            {b.photos.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{b.photos.length} picture{b.photos.length === 1 ? "" : "s"} attached</p>}
            <p className="mt-2 text-xs text-muted-foreground">
              Created {fmtWhen(b.created_at)} · {b.send_at ? `scheduled for ${fmtWhen(b.send_at)} · ` : ""}started {fmtWhen(b.started_at)} · finished {fmtWhen(b.finished_at)}
              · batches of {b.batch_size.toLocaleString()}, {b.batch_gap_seconds} s apart
            </p>
          </section>

          <section className="grid grid-cols-2 gap-2 md:grid-cols-5" aria-label="Totals">
            <CountCard label="Audience" value={t.audience} testId="bc-total-audience" />
            <CountCard label="Delivered" value={t.delivered + t.withdrawn} sub={`${pct(t.delivered + t.withdrawn, t.audience)}% of audience`} testId="bc-total-delivered" />
            <CountCard label="Read" value={t.read} tone="blue" sub={`${pct(t.read, t.delivered)}% of delivered`} testId="bc-total-read" />
            <CountCard label="Not read yet" value={t.unread} testId="bc-total-unread" />
            <CountCard label="Failed" value={t.failed} tone="bad" sub={t.waiting > 0 ? `${t.waiting.toLocaleString()} still waiting` : undefined} testId="bc-total-failed" />
          </section>
          <div className="space-y-1">
            <Progress value={pct(t.delivered + t.failed + t.withdrawn, t.audience)} aria-label="Sending progress" />
            <p className="text-xs text-muted-foreground">{(t.delivered + t.failed + t.withdrawn).toLocaleString()} of {t.audience.toLocaleString()} members done · {r.batches.filter((x) => ["done", "failed"].includes(x.status)).length} of {r.batches.length} batches</p>
          </div>

          <section aria-label="Batches" className="space-y-2">
            <h3 className="text-sm font-semibold">Batches</h3>
            <AdminDataTable<BcBatch> testId="bc-batches" rows={r.batches} rowKey={(x) => String(x.id)} columns={batchCols} emptyText="No batches yet." />
          </section>

          <section aria-label="Members" className="space-y-2">
            <h3 className="text-sm font-semibold">Every member</h3>
            <AdminDataTable<BcRecipient>
              testId="bc-people"
              rows={people.data?.rows ?? []}
              rowKey={(m) => m.user_id}
              columns={peopleCols}
              tabs={[
                { key: "all", label: "All", count: c?.all ?? null },
                { key: "delivered", label: "Delivered", count: c?.delivered ?? null },
                { key: "read", label: "Read", count: c?.read ?? null },
                { key: "unread", label: "Not read", count: c?.unread ?? null },
                { key: "failed", label: "Failed", count: c?.failed ?? null, warn: true },
                { key: "waiting", label: "Waiting", count: c?.waiting ?? null },
              ]}
              tab={filter}
              onTab={(k) => { setFilter(k as BcRecipientFilter); setPage(0); }}
              search={searchText}
              onSearch={setSearchText}
              searchPlaceholder="Search name or @handle"
              toolbar={<Button variant="outline" size="sm" className="h-9" onClick={exportCsv} disabled={!people.data?.rows.length}><Download className="mr-1 h-4 w-4" aria-hidden="true" />Export this page</Button>}
              page={page} pageSize={pageSize} total={people.data?.total ?? 0} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(0); }}
              loading={people.isLoading} fetching={people.isFetching}
              error={people.error ? `Could not load members: ${(people.error as Error).message}` : null}
              emptyText="No members here."
              phoneCard={(m) => (
                <div className="flex items-center gap-3"><MemberAvatar m={{ avatar_url: m.avatar_url, full_name: m.full_name, email: null }} size={36} />
                  <div className="min-w-0 flex-1"><p className="truncate font-medium">{m.full_name || m.user_id.slice(0, 8)}</p>
                    <p className="text-xs text-muted-foreground">{m.read ? `Read ${fmtWhen(m.read_at)}` : m.status === "delivered" ? "Delivered" : m.error ?? m.status}</p></div>
                  <Ticks state={m.status === "delivered" && m.read ? "read" : m.status} /></div>)}
            />
          </section>
        </>
      )}

      <AlertDialog open={!!ask} onOpenChange={(o) => { if (!o && !busy) setAsk(null); }}>
        <AlertDialogContent>
          {ask && (
            <>
              <AlertDialogHeader><AlertDialogTitle>{ACTION_TEXT[ask].title}</AlertDialogTitle><AlertDialogDescription>{ACTION_TEXT[ask].body}</AlertDialogDescription></AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>Not now</AlertDialogCancel>
                <AlertDialogAction disabled={busy} className={ACTION_TEXT[ask].destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
                  onClick={(e) => { e.preventDefault(); void act(ask); }}>{ACTION_TEXT[ask].button}</AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
