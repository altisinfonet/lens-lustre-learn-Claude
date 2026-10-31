/**
 * Admin → Notification Centre (N6).
 *
 * One page for everything the notification centre does:
 *   1. SWITCHES — per group, and the new member screens: Off / Only me /
 *      Chosen members / Everyone. These are the Owner's buttons for the staged
 *      rollout (N8). Every change is recorded with who and when.
 *   2. TYPES — every notification type with its numbers (written 24 h / 7 d;
 *      centre sent / skipped), on/off (where its group is switched on), channels, wording with a
 *      live preview, and its change history. "Send a test to me" per type.
 *   3. MEMBER LOOKUP — read-only: a member's notification settings, quiet
 *      hours and block counts, for support.
 *
 * Reads and writes only through the admin_notif_* functions (20261104_0120),
 * each of which refuses anyone who is not an admin.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Bell, History, Loader2, Search, Send } from "lucide-react";

type Mode = "off" | "me" | "members" | "everyone";
interface SwitchRow { key: string; label: string; mode: Mode; members: number }
interface TypeRow {
  type: string; audience: "member" | "admin"; group_key: string; icon: string; channels: string[];
  default_on: boolean; member_can_disable: boolean; enabled: boolean; wording_en: string | null;
  rows_24h: number; rows_7d: number; centre_sent_24h: number; centre_skipped_24h: number;
  centre_sent_7d: number; centre_skipped_7d: number;
}
interface HistoryRow { changed_at: string; changed_by_name: string; subject: string; field: string; old_value: unknown; new_value: unknown }

const MODE_LABEL: Record<Mode, string> = { off: "Off", me: "Only me", members: "Chosen members", everyone: "Everyone" };
const GROUP_LABEL: Record<string, string> = {
  likes_comments: "Likes and comments", follows_friends: "Follows and friends", competitions: "Competitions and judging",
  announcements: "Announcements", account: "Account", wallet_support_roles: "Wallet, support and roles", admin_alerts: "Admin alerts",
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The admin_notif_* functions are newer than the generated database types,
 *  so the client's rpc is narrowed through `unknown` to this one shape. */
type RpcResult<T> = { data: T | null; error: { message: string } | null };
type LooseRpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult<unknown>>;
const rpc = async <T,>(fn: string, args?: Record<string, unknown>): Promise<RpcResult<T>> =>
  (await (supabase.rpc as unknown as LooseRpc)(fn, args)) as RpcResult<T>;

export default function AdminNotificationCentre() {
  const [switches, setSwitches] = useState<SwitchRow[] | null>(null);
  const [types, setTypes] = useState<TypeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [s, t] = await Promise.all([rpc<SwitchRow[]>("admin_notif_switches"), rpc<TypeRow[]>("admin_notif_types")]);
    if (s.error || t.error) { setError((s.error ?? t.error)!.message); return; }
    setSwitches(s.data ?? []);
    setTypes(t.data ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const setSwitch = async (key: string, mode: Mode, users?: string[]) => {
    setBusy(key); setNotice(null);
    const { error: e } = await rpc("admin_notif_switch_set", { _key: key, _mode: mode, _users: users ?? null });
    setBusy(null);
    if (e) { setError(e.message); return; }
    setNotice(`Saved: ${switches?.find((s) => s.key === key)?.label ?? key} → ${MODE_LABEL[mode]}`);
    void load();
  };

  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-lg font-semibold flex items-center gap-2" style={{ fontFamily: "var(--font-heading)" }}>
          <Bell className="h-4 w-4" aria-hidden="true" /> Notification Centre
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Every switch starts Off. Turn a group on for yourself first, then for a few members, then for everyone.
        </p>
      </header>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm text-foreground">{notice}</p>}

      <section aria-labelledby="nc-switches">
        <h3 id="nc-switches" className="text-sm font-semibold mb-2">Switches</h3>
        {!switches ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Loading" /> : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {switches.map((s) => (
              <SwitchItem key={s.key} row={s} busy={busy === s.key} onSet={setSwitch} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="nc-types">
        <h3 id="nc-types" className="text-sm font-semibold mb-2">Notification types</h3>
        {!types ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Loading" /> : (
          <TypesTable rows={types} onChanged={load} onError={setError} onNotice={setNotice} />
        )}
      </section>

      <section aria-labelledby="nc-announce">
        <h3 id="nc-announce" className="text-sm font-semibold mb-2">Send an announcement</h3>
        <AnnounceBox />
      </section>

      <section aria-labelledby="nc-lookup">
        <h3 id="nc-lookup" className="text-sm font-semibold mb-2">Look up a member's notification settings</h3>
        <MemberLookup />
      </section>
    </div>
  );
}

function SwitchItem({ row, busy, onSet }: { row: SwitchRow; busy: boolean; onSet: (k: string, m: Mode, u?: string[]) => void }) {
  const [ids, setIds] = useState("");
  const adminOnly = row.key === "notif_centre_admin_alerts";
  const modes: Mode[] = adminOnly ? ["off", "everyone"] : ["off", "me", "members", "everyone"];
  const parsed = ids.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  const valid = parsed.length > 0 && parsed.every((x) => UUID_RE.test(x));
  return (
    <li className="p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{row.label}</span>
        <span className="text-xs text-muted-foreground">
          Now: <strong className="text-foreground">{MODE_LABEL[row.mode]}</strong>
          {row.mode === "members" ? ` (${row.members})` : ""}
        </span>
      </div>
      <div role="group" aria-label={`${row.label}: who gets it`} className="flex flex-wrap gap-2">
        {modes.map((m) => (
          <button
            key={m}
            type="button"
            disabled={busy || (m === "members" && !valid) || (m === row.mode && m !== "members")}
            aria-pressed={row.mode === m}
            onClick={() => onSet(row.key, m, m === "members" ? parsed : undefined)}
            className={`px-3 py-1.5 tap-44 rounded-md border text-xs ${row.mode === m ? "bg-primary text-primary-foreground border-primary" : "border-border"} disabled:opacity-50`}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>
      {!adminOnly && (
        <label className="block text-xs text-muted-foreground">
          Chosen members (their member ids, separated by commas or spaces)
          <input
            value={ids}
            onChange={(e) => setIds(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
            placeholder="00000000-0000-0000-0000-000000000000"
          />
        </label>
      )}
    </li>
  );
}

function TypesTable({ rows, onChanged, onError, onNotice }: {
  rows: TypeRow[]; onChanged: () => void; onError: (m: string) => void; onNotice: (m: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const groups = useMemo(() => {
    const m = new Map<string, TypeRow[]>();
    for (const r of rows) m.set(r.group_key, [...(m.get(r.group_key) ?? []), r]);
    return [...m.entries()];
  }, [rows]);
  return (
    <div className="space-y-4">
      {groups.map(([g, list]) => (
        <div key={g}>
          <h4 className="text-xs font-semibold text-muted-foreground mb-1">{GROUP_LABEL[g] ?? g}</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th scope="col" className="py-1 pr-2">Type</th>
                  <th scope="col" className="py-1 pr-2">On</th>
                  <th scope="col" className="py-1 pr-2">Channels</th>
                  <th scope="col" className="py-1 pr-2">Written 24 h / 7 d</th>
                  <th scope="col" className="py-1 pr-2">Centre sent / skipped 24 h</th>
                  <th scope="col" className="py-1"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <TypeRowView key={r.type} r={r} open={open === r.type} onToggle={() => setOpen(open === r.type ? null : r.type)}
                    onChanged={onChanged} onError={onError} onNotice={onNotice} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function TypeRowView({ r, open, onToggle, onChanged, onError, onNotice }: {
  r: TypeRow; open: boolean; onToggle: () => void; onChanged: () => void; onError: (m: string) => void; onNotice: (m: string) => void;
}) {
  const [wording, setWording] = useState(r.wording_en ?? "");
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [saving, setSaving] = useState(false);

  const patch = async (p: Record<string, unknown>, label: string) => {
    setSaving(true);
    const { error } = await rpc("admin_notif_type_update", { _type: r.type, _patch: p });
    setSaving(false);
    if (error) { onError(error.message); return; }
    onNotice(`Saved: ${r.type} — ${label}`);
    onChanged();
  };
  const loadHistory = async () => {
    const { data, error } = await rpc<HistoryRow[]>("admin_notif_history", { _subject: r.type, _limit: 20 });
    if (error) { onError(error.message); return; }
    setHistory(data ?? []);
  };
  const sendTest = async () => {
    const { error } = await rpc("notification_centre_send_test", { _type: r.type });
    if (error) { onError(error.message); return; }
    onNotice(`Test sent to you: ${r.type}. Check your bell.`);
  };

  return (
    <>
      <tr className="border-t border-border">
        <th scope="row" className="py-1.5 pr-2 font-mono font-normal text-left">{r.type}</th>
        <td className="py-1.5 pr-2">
          <label className="inline-flex items-center gap-1">
            <input type="checkbox" checked={r.enabled} disabled={saving}
              onChange={(e) => void patch({ enabled: e.target.checked }, e.target.checked ? "on" : "off")} />
            {/* Acts only where the type's group is switched on (the gate, 0140, passes
                rows untouched while a group is off) — the label must not say "everyone". */}
            <span className="sr-only">{r.type} on (for members whose group is switched on)</span>
          </label>
        </td>
        <td className="py-1.5 pr-2">{r.channels.join(", ")}</td>
        <td className="py-1.5 pr-2 tabular-nums">{r.rows_24h} / {r.rows_7d}</td>
        <td className="py-1.5 pr-2 tabular-nums">{r.centre_sent_24h} / {r.centre_skipped_24h}</td>
        <td className="py-1.5 text-right">
          <button type="button" onClick={onToggle} aria-expanded={open} className="underline">
            {open ? "Close" : "Edit"}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} className="pb-3">
            <div className="rounded-md border border-border p-3 space-y-3">
              <fieldset className="flex flex-wrap gap-3">
                <legend className="text-xs font-semibold mb-1">Channels</legend>
                {(["in_app", "push", "email"] as const).map((c) => (
                  <label key={c} className="inline-flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={r.channels.includes(c)} disabled={saving || (c === "in_app" && r.channels.length === 1 && r.channels[0] === "in_app")}
                      onChange={(e) => {
                        const next = e.target.checked ? [...r.channels, c] : r.channels.filter((x) => x !== c);
                        if (next.length) void patch({ channels: next }, `channels ${next.join(", ")}`);
                      }} />
                    {c === "in_app" ? "Bell" : c === "push" ? "Phone push" : "E-mail"}
                  </label>
                ))}
              </fieldset>
              <label className="block text-xs">
                <span className="font-semibold">Wording (English; empty = the app's built-in sentence)</span>
                <input value={wording} maxLength={300} onChange={(e) => setWording(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs" />
              </label>
              <p className="text-xs text-muted-foreground" aria-live="polite">
                Preview: <strong className="text-foreground">Anindita</strong> {wording || "(built-in sentence)"}
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={saving || wording.trim() === (r.wording_en ?? "")}
                  onClick={() => void patch({ wording_en: wording.trim() }, "wording")}
                  className="px-3 py-1.5 tap-44 rounded-md bg-primary text-primary-foreground text-xs disabled:opacity-50">
                  Save wording
                </button>
                <button type="button" onClick={() => void sendTest()}
                  className="px-3 py-1.5 tap-44 rounded-md border border-border text-xs inline-flex items-center gap-1">
                  <Send className="h-3 w-3" aria-hidden="true" /> Send a test to me
                </button>
                <button type="button" onClick={() => void loadHistory()}
                  className="px-3 py-1.5 tap-44 rounded-md border border-border text-xs inline-flex items-center gap-1">
                  <History className="h-3 w-3" aria-hidden="true" /> Change history
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                7 days: written {r.rows_7d}; centre sent {r.centre_sent_7d}, skipped {r.centre_skipped_7d}.
              </p>
              {history && (
                history.length === 0 ? <p className="text-xs text-muted-foreground">No changes yet.</p> : (
                  <ul className="text-xs space-y-1">
                    {history.map((h, i) => (
                      <li key={i}>
                        {new Date(h.changed_at).toLocaleString()} — {h.changed_by_name || "an admin"} changed{" "}
                        <strong>{h.field}</strong>: {JSON.stringify(h.old_value)} → {JSON.stringify(h.new_value)}
                      </li>
                    ))}
                  </ul>
                )
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function MemberLookup() {
  const [id, setId] = useState("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const valid = UUID_RE.test(id.trim());
  const look = async () => {
    setErr(null); setResult(null);
    const { data, error } = await rpc<Record<string, unknown>>("admin_notif_member_settings", { _user: id.trim() });
    if (error) setErr(error.message); else setResult(data);
  };
  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2">
        <label className="block flex-1 text-xs text-muted-foreground">
          Member id
          <input value={id} onChange={(e) => setId(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground" />
        </label>
        <button type="button" disabled={!valid} onClick={() => void look()}
          className="px-3 py-1.5 tap-44 rounded-md border border-border text-xs inline-flex items-center gap-1 disabled:opacity-50">
          <Search className="h-3 w-3" aria-hidden="true" /> Look up
        </button>
      </div>
      {err && <p role="alert" className="text-xs text-destructive">{err}</p>}
      {result && <pre className="text-xs whitespace-pre-wrap rounded-md border border-border p-2">{JSON.stringify(result, null, 2)}</pre>}
    </div>
  );
}

/**
 * N6 · push an announcement to a chosen group (SQL 0220). It goes through the
 * centre, so members whose Announcements row is Off get nothing — the box says
 * so. Everyone needs a second, explicit confirmation. One every 10 minutes.
 */
function AnnounceBox() {
  type Who = "me" | "members" | "everyone";
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [who, setWho] = useState<Who>("me");
  const [ids, setIds] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const members = ids.split(/[\s,]+/).map((x) => x.trim()).filter((x) => UUID_RE.test(x));
  const ready = title.trim().length > 0 && title.trim().length <= 80 && message.trim().length > 0
    && message.trim().length <= 300 && (who !== "members" || members.length > 0);

  const send = async () => {
    setSending(true); setResult(null); setFailure(null); setConfirming(false);
    const { data, error } = await rpc<{ sent: number; asked: number }>("admin_notif_announce", {
      _title: title.trim(), _message: message.trim(), _who: who, _members: who === "members" ? members : null,
    });
    setSending(false);
    if (error) { setFailure(error.message); return; }
    setResult(`Sent to ${data?.sent ?? 0} of ${data?.asked ?? 0}.`);
  };

  return (
    <div className="space-y-3 rounded-md border border-border p-3 text-sm">
      <p className="text-xs text-muted-foreground">
        A bell notification and a phone push, sent through the notification centre. Members whose
        Announcements row is Off get nothing. One announcement every 10 minutes.
      </p>
      <label className="block">
        <span className="text-xs font-medium">Title</span>
        <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)}
          className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-base" />
      </label>
      <label className="block">
        <span className="text-xs font-medium">Message</span>
        <textarea value={message} maxLength={300} rows={3} onChange={(e) => setMessage(e.target.value)}
          className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-base" />
      </label>
      <fieldset>
        <legend className="text-xs font-medium">Who gets it</legend>
        <div className="mt-1 flex flex-wrap gap-4">
          {([["me", "Only me"], ["members", "Chosen members"], ["everyone", "Everyone"]] as const).map(([v, label]) => (
            <label key={v} className="inline-flex items-center gap-1.5">
              <input type="radio" name="announce-who" value={v} checked={who === v}
                onChange={() => { setWho(v); setConfirming(false); }} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      {who === "members" && (
        <label className="block">
          <span className="text-xs font-medium">Member ids (one per line)</span>
          <textarea value={ids} rows={3} onChange={(e) => setIds(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 font-mono text-xs" />
          <span className="text-xs text-muted-foreground">{members.length} valid id(s)</span>
        </label>
      )}
      {(title || message) && (
        <div className="rounded-md bg-muted/40 p-2" aria-label="Preview">
          <p className="font-semibold">{title || "…"}</p>
          <p className="text-muted-foreground">{message || "…"}</p>
        </div>
      )}
      <div className="flex items-center gap-2">
        <button type="button" disabled={!ready || sending}
          onClick={() => (who === "everyone" ? setConfirming(true) : void send())}
          className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-50">
          Send
        </button>
        {confirming && (
          <>
            <button type="button" onClick={() => void send()}
              className="rounded-md border border-destructive px-3 py-1.5 text-destructive">
              Yes, send to everyone
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="rounded-md border border-border px-3 py-1.5">
              Cancel
            </button>
          </>
        )}
        {sending && <Loader2 className="h-4 w-4 animate-spin" aria-label="Sending" />}
      </div>
      {result && <p role="status">{result}</p>}
      {failure && <p role="alert" className="text-destructive">{failure}</p>}
    </div>
  );
}
