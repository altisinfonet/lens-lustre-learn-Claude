/**
 * M26 · Admin → Messages → Broadcast: saved templates (title + text) and the welcome message for new members.
 *   TemplatesBar   — in the composer: pick a saved template to fill the title and text, or save the current ones.
 *   WelcomeCard    — on the Broadcast list: one message sent to each NEW member 5 minutes after they join, only to
 *                    members who have the chat facility, never twice.
 * Everything here is an admin database call (admin_message_template*, admin_message_welcome_*); the server checks the admin.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/core/use-toast";
import { adminMessageCall } from "@/hooks/admin/useAdminMessages";

interface Template { id: number; title: string; body: string }

function parseTemplates(data: unknown): Template[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((r) => (r && typeof r === "object" && typeof (r as Record<string, unknown>).id === "number"
    ? [{ id: (r as Record<string, unknown>).id as number, title: String((r as Record<string, unknown>).title ?? ""), body: String((r as Record<string, unknown>).body ?? "") }] : []));
}

const fail = (e: unknown) => toast({ title: "Not done", description: e instanceof Error ? e.message : "request failed", variant: "destructive" });

export function TemplatesBar({ title, body, onLoad }: { title: string; body: string; onLoad: (t: { title: string; body: string }) => void }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["admin-broadcast-templates"], queryFn: async () => parseTemplates(await adminMessageCall("admin_message_templates", {})), staleTime: 60_000 });
  const [picked, setPicked] = useState("");
  const save = useMutation({
    mutationFn: () => adminMessageCall("admin_message_template_save", { _title: title.trim(), _body: body.trim(), _photos: [] }),
    onSuccess: () => { toast({ title: "Template saved", description: title.trim() }); void qc.invalidateQueries({ queryKey: ["admin-broadcast-templates"] }); },
    onError: fail,
  });
  const del = useMutation({
    mutationFn: (id: number) => adminMessageCall("admin_message_template_delete", { _id: id }),
    onSuccess: () => { setPicked(""); void qc.invalidateQueries({ queryKey: ["admin-broadcast-templates"] }); },
    onError: fail,
  });
  const rows = list.data ?? [];
  const current = rows.find((t) => String(t.id) === picked);
  return (
    <section className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3" aria-label="Templates" data-testid="bc-templates">
      <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <select
        value={picked} aria-label="Saved templates" data-testid="bc-template-select"
        onChange={(e) => { setPicked(e.target.value); const t = rows.find((x) => String(x.id) === e.target.value); if (t) onLoad({ title: t.title, body: t.body }); }}
        className="h-9 min-w-[180px] flex-1 rounded-md border border-border bg-background px-2 text-sm"
      >
        <option value="">{rows.length === 0 ? "No saved templates yet" : "Use a saved template…"}</option>
        {rows.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
      </select>
      {current && <Button type="button" variant="outline" size="sm" onClick={() => del.mutate(current.id)} aria-label="Delete this template"><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>}
      <Button type="button" variant="outline" size="sm" disabled={!title.trim() || save.isPending} onClick={() => save.mutate()} data-testid="bc-template-save">Save as template</Button>
    </section>
  );
}

interface Welcome { enabled: boolean; body: string; push: boolean }

export function WelcomeCard() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["admin-message-welcome"],
    queryFn: async (): Promise<Welcome> => {
      const r = (await adminMessageCall("admin_message_welcome_get", {})) as Record<string, unknown> | null;
      return { enabled: r?.enabled === true, body: typeof r?.body === "string" ? r.body : "", push: r?.push === true };
    },
    staleTime: 60_000,
  });
  const [draft, setDraft] = useState<Welcome | null>(null);
  const w = draft ?? q.data ?? { enabled: false, body: "", push: false };
  const save = useMutation({
    mutationFn: (v: Welcome) => adminMessageCall("admin_message_welcome_set", { _enabled: v.enabled, _body: v.body, _push: v.push }),
    onSuccess: () => { setDraft(null); toast({ title: "Welcome message saved" }); void qc.invalidateQueries({ queryKey: ["admin-message-welcome"] }); },
    onError: fail,
  });
  return (
    <section className="space-y-2 rounded-xl border border-border bg-card p-3" aria-label="Welcome message" data-testid="bc-welcome">
      <label className="flex items-center justify-between gap-3 text-sm" htmlFor="bc-welcome-on">
        <span><b>Welcome message for new members</b><span className="block text-xs text-muted-foreground">Sent from your account 5 minutes after a member joins — only to members who have the chat facility, once each.</span></span>
        <Switch id="bc-welcome-on" checked={w.enabled} onCheckedChange={(v) => setDraft({ ...w, enabled: v })} />
      </label>
      <Textarea value={w.body} maxLength={4000} rows={3} placeholder="Write the welcome message…" aria-label="Welcome message text" onChange={(e) => setDraft({ ...w, body: e.target.value })} />
      <label className="flex items-center justify-between gap-3 text-sm" htmlFor="bc-welcome-push">
        <span>Send a push notification with it</span>
        <Switch id="bc-welcome-push" checked={w.push} onCheckedChange={(v) => setDraft({ ...w, push: v })} />
      </label>
      <Button size="sm" disabled={!draft || save.isPending} onClick={() => save.mutate(w)} data-testid="bc-welcome-save">Save welcome message</Button>
    </section>
  );
}
