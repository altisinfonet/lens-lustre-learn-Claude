/**
 * M12 · write a broadcast: the message (text, emoji, web links), pictures, who gets it (with the honest count),
 * push on/off, send now or at a time. The right side shows it as the member will see it. "Send" saves the draft and asks
 * the server to send; the server cuts the audience into batches (500, a minute apart) — nothing goes out from the browser.
 */
import { useMemo, useRef, useState } from "react";
import { ArrowLeft, BadgeCheck, ImagePlus, Loader2, Send, Smile, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/core/use-toast";
import { useAuth } from "@/hooks/core/useAuth";
import ProfileTypeaheadPicker from "@/components/admin/ProfileTypeaheadPicker";
import { useMemberLabels } from "@/components/admin/users/memberUi";
import { LinkedText } from "@/components/messages/MessageParts";
import { EMOJI_SETS } from "@/lib/messages/emoji";
import { prepareAndUploadPhoto } from "@/lib/messages/photoUpload";
import { adminMessageCall } from "@/hooks/admin/useAdminMessages";
import { useBroadcastAudience, useRefreshBroadcasts } from "@/hooks/admin/useAdminBroadcasts";
import { TemplatesBar } from "./BroadcastExtras";
import type { PushAudience } from "@/hooks/admin/usePushCentre";
import { cn } from "@/lib/utils";

const MAX_PHOTOS = 10;
const BATCH = 500;
interface Pic { path: string; width: number; height: number; preview: string }

const AUDIENCES: { key: string; label: string; make: () => PushAudience }[] = [
  { key: "all", label: "Everyone", make: () => ({ kind: "all" }) },
  { key: "a7", label: "Active in the last 7 days", make: () => ({ kind: "active", days: 7 }) },
  { key: "a30", label: "Active in the last 30 days", make: () => ({ kind: "active", days: 30 }) },
  { key: "role", label: "One role", make: () => ({ kind: "role", role: "judge" }) },
  { key: "members", label: "Chosen members", make: () => ({ kind: "members", ids: [] }) },
];
const keyOf = (a: PushAudience) => (a.kind === "active" ? (a.days === 7 ? "a7" : "a30") : a.kind === "badge" ? "all" : a.kind);

export default function BroadcastComposer({ onBack, onSent }: { onBack: () => void; onSent: (id: number) => void }) {
  const { user } = useAuth();
  const labels = useMemberLabels();
  const refresh = useRefreshBroadcasts();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pics, setPics] = useState<Pic[]>([]);
  const [audience, setAudience] = useState<PushAudience>({ kind: "all" });
  const [chosen, setChosen] = useState<{ id: string; name: string }[]>([]);
  const [push, setPush] = useState(true);
  const [announcementOnly, setAnnouncementOnly] = useState(false);
  const [when, setWhen] = useState<"now" | "later">("now");
  const [at, setAt] = useState("");
  const [emoji, setEmoji] = useState(false);
  const [emojiTab, setEmojiTab] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pk, setPk] = useState(0);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const effective: PushAudience = audience.kind === "members" ? { kind: "members", ids: chosen.map((c) => c.id) } : audience;
  const count = useBroadcastAudience(effective);
  const willReceive = count.data?.will_receive ?? null;
  const batches = willReceive ? Math.ceil(willReceive / BATCH) : 0;
  const empty = body.trim() === "" && pics.length === 0;
  const laterIso = at ? new Date(at).toISOString() : null;
  const laterBad = when === "later" && (!at || Number.isNaN(new Date(at).getTime()) || new Date(at).getTime() < Date.now() - 60_000);
  const canSend = !!title.trim() && !empty && !busy && !uploading && (willReceive ?? 0) > 0 && !laterBad;

  const addEmoji = (e: string) => {
    const el = areaRef.current;
    const from = el?.selectionStart ?? body.length;
    const to = el?.selectionEnd ?? from;
    setBody((b) => (b.slice(0, from) + e + b.slice(to)).slice(0, 4000));
    window.requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(from + e.length, from + e.length); });
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || !user || uploading) return;
    setUploading(true);
    try {
      const next: Pic[] = [];
      for (const f of Array.from(files).slice(0, MAX_PHOTOS - pics.length)) {
        const up = await prepareAndUploadPhoto(f, user.id);
        next.push({ ...up, preview: URL.createObjectURL(f) });
      }
      setPics((p) => [...p, ...next].slice(0, MAX_PHOTOS));
    } catch {
      toast({ title: "A picture could not be added", description: "Use a normal photo (JPEG, PNG or WebP).", variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const fields = () => ({ title: title.trim(), body: body.trim(), photos: pics.map((p) => ({ path: p.path, width: p.width, height: p.height })), audience: effective, push, announcement_only: announcementOnly });

  const saveDraft = async () => {
    setBusy(true);
    try {
      const id = await adminMessageCall("admin_message_broadcast_save", { _id: null, _fields: fields() });
      toast({ title: "Draft saved", description: title.trim() });
      await refresh();
      onSent(Number(id));
    } catch (e) {
      toast({ title: "Not saved", description: e instanceof Error ? e.message : "request failed", variant: "destructive" });
    } finally { setBusy(false); }
  };

  const send = async () => {
    setBusy(true);
    try {
      const id = Number(await adminMessageCall("admin_message_broadcast_save", { _id: null, _fields: fields() }));
      await adminMessageCall("admin_message_broadcast_send", { _id: id, _at: when === "later" ? laterIso : null });
      toast({ title: when === "later" ? "Scheduled" : "Sending started", description: `${(willReceive ?? 0).toLocaleString()} members in ${batches} batch${batches === 1 ? "" : "es"}` });
      setConfirm(false);
      await refresh();
      onSent(id);
    } catch (e) {
      toast({ title: "Not sent", description: e instanceof Error ? e.message : "request failed", variant: "destructive" });
    } finally { setBusy(false); }
  };

  const eta = useMemo(() => (batches > 1 ? `about ${batches} minutes` : "within a minute"), [batches]);

  return (
    <div className="space-y-4" data-testid="bc-composer">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />All broadcasts</Button>
        <h3 className="text-base font-semibold">New broadcast</h3>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <TemplatesBar title={title} body={body} onLoad={(t) => { setTitle(t.title); setBody(t.body); }} />
          <label className="block space-y-1 text-sm"><span className="font-medium">Title <span className="font-normal text-muted-foreground">(only you see it)</span></span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="e.g. Welcome to private messages" data-testid="bc-title" /></label>

          <div className="space-y-1 text-sm">
            <span className="font-medium">Message</span>
            <div className="rounded-lg border border-border">
              <Textarea ref={areaRef} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} rows={6} data-testid="bc-body"
                placeholder="Write the message. Emoji and web links (https://…) work." className="resize-y border-0 focus-visible:ring-0" aria-label="Message" />
              <div className="flex flex-wrap items-center gap-2 border-t border-border p-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => setEmoji((v) => !v)} aria-expanded={emoji}><Smile className="mr-1 h-4 w-4" aria-hidden="true" />Emoji</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => fileRef.current?.click()} disabled={uploading || pics.length >= MAX_PHOTOS}>
                  {uploading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" /> : <ImagePlus className="mr-1 h-4 w-4" aria-hidden="true" />}Add pictures ({pics.length}/{MAX_PHOTOS})
                </Button>
                <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void onFiles(e.target.files)} aria-label="Add pictures" />
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">{body.length}/4000</span>
              </div>
              {emoji && (
                <div className="border-t border-border p-2">
                  <div className="mb-1 flex gap-1" role="tablist">
                    {EMOJI_SETS.map((s, i) => (
                      <button key={s.id} type="button" role="tab" aria-selected={emojiTab === i} onClick={() => setEmojiTab(i)} aria-label={s.label}
                        className={cn("rounded-md px-2 py-1 text-lg", emojiTab === i ? "bg-primary/15" : "hover:bg-muted")}>{s.icon}</button>
                    ))}
                  </div>
                  <div className="flex max-h-32 flex-wrap gap-0.5 overflow-y-auto">
                    {EMOJI_SETS[emojiTab].items.map((e) => <button key={e} type="button" onClick={() => addEmoji(e)} className="grid h-9 w-9 place-items-center rounded-md text-xl hover:bg-muted">{e}</button>)}
                  </div>
                </div>
              )}
            </div>
            {pics.length > 0 && (
              <ul className="flex flex-wrap gap-2 pt-1" aria-label="Pictures">
                {pics.map((p) => (
                  <li key={p.path} className="relative h-20 w-20 overflow-hidden rounded-lg border border-border bg-muted bg-cover bg-center" style={{ backgroundImage: `url(${p.preview})` }}>
                    <button type="button" aria-label="Remove picture" onClick={() => setPics((x) => x.filter((y) => y.path !== p.path))}
                      className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-white"><X className="h-3 w-3" /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <section className="space-y-2" aria-label="Who gets it">
            <span className="text-sm font-medium">Who gets it</span>
            <div role="radiogroup" aria-label="Audience" className="flex flex-wrap gap-2">
              {AUDIENCES.map((a) => (
                <button key={a.key} type="button" role="radio" aria-checked={keyOf(audience) === a.key} data-testid={`bc-aud-${a.key}`} onClick={() => setAudience(a.make())}
                  className={cn("min-h-9 rounded-full border px-3 text-sm", keyOf(audience) === a.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/60")}>{a.label}</button>
              ))}
            </div>
            {audience.kind === "role" && (
              <select className="h-9 rounded-md border border-border bg-background px-2 text-sm" value={audience.role} aria-label="Role"
                onChange={(e) => setAudience({ kind: "role", role: e.target.value })}>
                {labels.allRoles.filter((r) => r !== "user").map((r) => <option key={r} value={r}>{labels.role(r).label}</option>)}
              </select>
            )}
            {audience.kind === "members" && (
              <div className="space-y-2">
                <ProfileTypeaheadPicker key={`pick-${pk}`} label="Add a member" hint="Search by name or e-mail. Up to 500 members." value={null}
                  onChange={(p) => { if (p && !chosen.some((c) => c.id === p.id) && chosen.length < 500) setChosen((c) => [...c, { id: p.id, name: p.full_name || p.id.slice(0, 8) }]); if (p) setPk((n) => n + 1); }} />
                {chosen.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5" aria-label="Chosen members">
                    {chosen.map((c) => (
                      <li key={c.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-card py-0.5 pl-2.5 pr-1 text-sm">
                        {c.name}<button type="button" aria-label={`Remove ${c.name}`} onClick={() => setChosen((x) => x.filter((y) => y.id !== c.id))} className="grid h-5 w-5 place-items-center rounded-full hover:bg-muted"><X className="h-3 w-3" /></button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <p className="text-sm" data-testid="bc-audience-count" aria-live="polite">
              {count.isLoading ? "Counting…" : count.data
                ? <><b>{count.data.will_receive.toLocaleString()}</b> member{count.data.will_receive === 1 ? "" : "s"} will receive it{count.data.left_out > 0 ? <span className="text-muted-foreground"> · {count.data.left_out.toLocaleString()} left out (cannot receive messages)</span> : null}</>
                : <span className="text-muted-foreground">Choose who gets it.</span>}
            </p>
          </section>

          <section className="space-y-3 rounded-xl border border-border bg-card p-3" aria-label="Delivery">
            <label className="flex items-center justify-between gap-3 text-sm" htmlFor="bc-push">
              <span><b>Push notification</b><span className="block text-xs text-muted-foreground">Each member's phone shows "50mm Retina World · sent you a message" — never the text.</span></span>
              <Switch id="bc-push" checked={push} onCheckedChange={setPush} />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm" htmlFor="bc-announce">
              <span><b>Announcement only</b><span className="block text-xs text-muted-foreground">Members cannot reply in this chat — they see "Only 50mm Retina World can write here". You can open it for replies again later from the broadcast's report.</span></span>
              <Switch id="bc-announce" checked={announcementOnly} onCheckedChange={setAnnouncementOnly} data-testid="bc-announce" />
            </label>
            <div role="radiogroup" aria-label="When" className="flex flex-wrap items-center gap-2">
              <button type="button" role="radio" aria-checked={when === "now"} onClick={() => setWhen("now")}
                className={cn("min-h-9 rounded-full border px-3 text-sm", when === "now" ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/60")}>Send now</button>
              <button type="button" role="radio" aria-checked={when === "later"} onClick={() => setWhen("later")}
                className={cn("min-h-9 rounded-full border px-3 text-sm", when === "later" ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/60")}>Schedule</button>
              {when === "later" && <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="h-9 w-auto" aria-label="Send at" />}
            </div>
            {laterBad && when === "later" && <p className="text-xs text-destructive">Pick a time in the future.</p>}
            <p className="text-xs text-muted-foreground">It goes out in batches of {BATCH}, a minute apart, so the site stays fast. You can pause, cancel or withdraw it afterwards.</p>
          </section>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setConfirm(true)} disabled={!canSend} data-testid="bc-review"><Send className="mr-1 h-4 w-4" aria-hidden="true" />Review and send</Button>
            <Button variant="outline" onClick={() => void saveDraft()} disabled={!title.trim() || empty || busy}>Save as draft</Button>
          </div>
        </div>

        <aside aria-label="Preview" className="lg:sticky lg:top-20 lg:self-start">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Preview — as the member sees it</p>
          <div className="overflow-hidden rounded-[28px] border border-border bg-gradient-to-b from-background to-muted/30 shadow-sm" data-testid="bc-preview">
            <div className="flex items-center gap-2.5 border-b border-border/70 px-3 py-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-primary/15 text-sm font-bold text-primary">50</span>
              <span className="text-sm font-bold">50mm Retina World</span><BadgeCheck className="h-4 w-4 text-sky-500" aria-label="Official" />
            </div>
            <div className="min-h-[180px] space-y-1 px-3 py-4">
              {empty ? <p className="px-2 py-8 text-center text-sm text-muted-foreground">Your message appears here.</p> : (
                <div className="max-w-[88%] overflow-hidden whitespace-pre-wrap break-words rounded-[22px] rounded-tl-md bg-foreground/10 text-[15px] leading-[1.35]">
                  {pics.length > 0 && (
                    <div className={cn("grid gap-0.5", pics.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
                      {pics.slice(0, 4).map((p) => <div key={p.path} className="aspect-square bg-muted bg-cover bg-center" style={{ backgroundImage: `url(${p.preview})` }} />)}
                    </div>
                  )}
                  {body.trim() && <div className="px-3.5 py-2"><LinkedText text={body.trim()} /></div>}
                </div>
              )}
              {pics.length > 4 && <p className="px-1 text-[11px] text-muted-foreground">+{pics.length - 4} more pictures</p>}
            </div>
          </div>
        </aside>
      </div>

      <AlertDialog open={confirm} onOpenChange={(o) => { if (!o && !busy) setConfirm(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{when === "later" ? "Schedule this broadcast?" : "Send this broadcast?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {(willReceive ?? 0).toLocaleString()} member{willReceive === 1 ? "" : "s"} will get it in {batches} batch{batches === 1 ? "" : "es"} ({eta} {when === "later" ? "once it starts" : "from now"}).
              {push ? " Their phones get a push notification." : " No push notification."} You can pause, cancel or withdraw it afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Not yet</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void send(); }} data-testid="bc-confirm">
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}{when === "later" ? "Schedule" : "Send"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
