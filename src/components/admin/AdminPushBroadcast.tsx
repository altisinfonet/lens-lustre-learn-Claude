/**
 * AdminPushBroadcast — send one push notification to every app user.
 *
 * Owner request 2026-08-01: "From Admin Panel Push Notification for All needs to
 * be done. Admin can send images text anything from Push Notification to App
 * users."
 *
 * Two deliberate safety rails, because this is the one action in the panel that
 * cannot be undone — once a phone buzzes, it has buzzed:
 *   1. "Check who will get it" runs a DRY RUN first, so the real audience size
 *      is known BEFORE anything is sent.
 *   2. Sending requires typing SEND to confirm. No single mis-click can message
 *      the whole community.
 *
 * Only devices that have opened the Android app and signed in are reachable —
 * web-only members have no device token and cannot receive a push. The audience
 * figure shown is the real count from `push_tokens`, never an estimate.
 */
import { useRef, useState } from "react";
import { Loader2, Send, Upload, Trash2, Users, ImageIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { compressImageToFiles } from "@/lib/imageCompression";
import { generateImagePath, uploadImage } from "@/lib/imageUpload";

const hFont = { fontFamily: "var(--font-heading)" };
const bFont = { fontFamily: "var(--font-body)" };
const inputCls =
  "w-full bg-background border border-border rounded-sm px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary";
const label = "block text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-1";

interface SendResult {
  sent?: number;
  devices?: number;
  people?: number;
  pruned?: number;
  note?: string;
  errors?: string[];
  dry_run?: boolean;
}

const AdminPushBroadcast = () => {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [link, setLink] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState<"check" | "send" | "upload" | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const call = async (dryRun: boolean) => {
    if (!title.trim()) {
      toast({ title: "A title is required", variant: "destructive" });
      return;
    }
    setBusy(dryRun ? "check" : "send");
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("send-broadcast-push", {
        body: {
          title: title.trim(),
          body: body.trim(),
          image_url: imageUrl.trim() || undefined,
          link: link.trim() || undefined,
          dry_run: dryRun,
        },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);

      setResult(data as SendResult);
      const d = data as SendResult;
      if (dryRun) {
        toast({ title: `${d.people ?? 0} people · ${d.devices ?? 0} devices would receive this` });
      } else {
        toast({ title: `Sent to ${d.sent ?? 0} device${d.sent === 1 ? "" : "s"} ✅` });
        setConfirm("");
      }
    } catch (err) {
      const msg = (err as Error)?.message || "Please try again";
      toast({ title: dryRun ? "Could not check" : "Send failed", description: msg, variant: "destructive" });
      setResult({ errors: [msg] });
    } finally {
      setBusy(null);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please choose an image file (jpg / png / webp)", variant: "destructive" });
      return;
    }
    setBusy("upload");
    try {
      const { webpFile } = await compressImageToFiles(file, "push-broadcast", { maxDimension: 1200 });
      const path = generateImagePath({ type: "ad", ext: "webp" });
      const { url } = await uploadImage({
        bucket: "journal-images", file: webpFile, path, type: "ad", fileName: "push-broadcast.webp",
      });
      setImageUrl(url);
      toast({ title: "Picture ready ✅" });
    } catch (err) {
      toast({ title: "Upload failed", description: (err as Error)?.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const canSend = !!title.trim() && confirm.trim().toUpperCase() === "SEND" && !busy;

  return (
    <div className="border border-primary/25 bg-primary/5 rounded-sm p-4 space-y-4 mb-6">
      <div>
        <p className="text-sm font-semibold text-foreground flex items-center gap-2" style={hFont}>
          <Send className="h-4 w-4 text-primary" /> Send a notification to everyone
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5" style={bFont}>
          Goes to every phone that has the app installed and signed in. Members who only use the website cannot
          receive these. This cannot be taken back once sent.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="md:col-span-2">
          <label className={label}>Title (required)</label>
          <input className={inputCls} style={bFont} value={title} maxLength={80}
            onChange={(e) => setTitle(e.target.value)} placeholder="e.g. New competition is open" />
        </div>
        <div className="md:col-span-2">
          <label className={label}>Message</label>
          <textarea className={`${inputCls} min-h-[64px]`} style={bFont} value={body} maxLength={240}
            onChange={(e) => setBody(e.target.value)} placeholder="A short line people will read on the lock screen." />
          <p className="text-[10px] text-muted-foreground mt-0.5" style={bFont}>{body.length}/240</p>
        </div>
        <div>
          <label className={label}>Where it opens when tapped (optional)</label>
          <input className={inputCls} style={bFont} value={link}
            onChange={(e) => setLink(e.target.value)} placeholder="/competitions" />
        </div>
        <div>
          <label className={label}>Picture (optional)</label>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
          {imageUrl ? (
            <div className="flex items-center gap-2">
              <img src={imageUrl} alt="Notification" className="h-12 w-12 object-cover rounded-sm border border-border" />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={!!busy}
                className="text-[11px] px-2 py-1.5 rounded-sm border border-border hover:border-primary disabled:opacity-50" style={hFont}>
                Change
              </button>
              <button type="button" onClick={() => setImageUrl("")}
                className="text-muted-foreground hover:text-destructive" title="Remove picture">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => fileRef.current?.click()} disabled={!!busy}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-sm border border-border text-[11px] hover:border-primary disabled:opacity-50" style={hFont}>
              {busy === "upload" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {busy === "upload" ? "Uploading…" : "Add a picture"}
            </button>
          )}
        </div>
      </div>

      {/* Lock-screen preview — what a member will actually see. */}
      <div className="rounded-sm border border-border bg-background p-3">
        <p className={label}>Preview</p>
        <div className="flex gap-2.5 items-start">
          {imageUrl
            ? <img src={imageUrl} alt="" className="h-10 w-10 rounded-sm object-cover shrink-0" />
            : <div className="h-10 w-10 rounded-sm bg-muted/40 flex items-center justify-center shrink-0"><ImageIcon className="h-4 w-4 text-muted-foreground" /></div>}
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground truncate" style={hFont}>{title || "Title goes here"}</p>
            <p className="text-[11px] text-muted-foreground line-clamp-2" style={bFont}>{body || "Your message will appear here."}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => call(true)} disabled={!!busy || !title.trim()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-sm border border-border text-[11px] hover:border-primary disabled:opacity-50" style={hFont}>
          {busy === "check" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
          Check who will get it
        </button>

        <input className={`${inputCls} w-32`} style={bFont} value={confirm}
          onChange={(e) => setConfirm(e.target.value)} placeholder="Type SEND" aria-label="Type SEND to confirm" />

        <button type="button" onClick={() => call(false)} disabled={!canSend}
          className="inline-flex items-center gap-2 px-5 py-2 rounded-sm bg-primary text-primary-foreground text-[11px] uppercase tracking-[0.15em] disabled:opacity-40" style={hFont}>
          {busy === "send" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Send to everyone
        </button>
      </div>

      {result && (
        <div className="text-[11px] rounded-sm border border-border bg-background p-3 space-y-1" style={bFont}>
          {result.dry_run ? (
            <p className="text-foreground">
              This would reach <strong>{result.people ?? 0}</strong> {result.people === 1 ? "person" : "people"} on{" "}
              <strong>{result.devices ?? 0}</strong> {result.devices === 1 ? "device" : "devices"}. Nothing was sent.
            </p>
          ) : (
            <p className="text-foreground">
              Delivered to <strong>{result.sent ?? 0}</strong> of {result.devices ?? 0} devices
              {typeof result.pruned === "number" && result.pruned > 0
                ? ` · removed ${result.pruned} device${result.pruned === 1 ? "" : "s"} that no longer exist`
                : ""}.
            </p>
          )}
          {result.note && <p className="text-muted-foreground">{result.note}</p>}
          {result.errors?.map((e, i) => <p key={i} className="text-destructive">{e}</p>)}
        </div>
      )}
    </div>
  );
};

export default AdminPushBroadcast;
