import { useEffect, useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cachedFetchProfilesByIds } from "@/lib/profileBatch";
import { toast } from "@/hooks/core/use-toast";
import { Plus, Pencil, Trash2, XCircle, Loader2, Award, Upload, Image as ImageIcon, Ban, ShieldCheck } from "lucide-react";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { useConfirmAction } from "@/hooks/admin/useConfirmAction";
import type { User } from "@supabase/supabase-js";
import { uploadImage } from "@/lib/imageUpload";
import { compressImageToFiles } from "@/lib/imageCompression";

interface CertRow {
  id: string;
  title: string;
  description: string | null;
  type: string;
  issued_at: string;
  user_id: string;
  user_name: string | null;
  is_revoked: boolean;
  revoked_at: string | null;
  revoked_reason: string | null;
}

type TabKey = "certificates" | "signature";

const AdminCertificates = ({ user }: { user: User | null }) => {
  const [activeTab, setActiveTab] = useState<TabKey>("certificates");

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex items-center gap-0 border-b border-border">
        {(["certificates", "signature"] as TabKey[]).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-4 py-2 text-[10px] tracking-[0.2em] uppercase transition-colors border-b-2 ${
              activeTab === t
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {t === "certificates" ? "Certificates" : "Signature"}
          </button>
        ))}
      </div>

      {activeTab === "certificates" && <CertificatesList user={user} />}
      {activeTab === "signature" && <SignatureManager />}
    </div>
  );
};

/* ───────────── Certificates List (original) ───────────── */
const CertificatesList = ({ user }: { user: User | null }) => {
  const qc = useQueryClient();
  const [certs, setCerts] = useState<CertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", type: "course_completion", user_search: "" });
  const [resolvedUserId, setResolvedUserId] = useState<string | null>(null);
  const [resolvedUserName, setResolvedUserName] = useState("");
  const { confirm: confirmAction, dialogProps } = useConfirmAction();

  const fetchCerts = async () => {
    const { data } = await supabase.from("certificates")
      .select("id, title, description, type, issued_at, user_id, is_revoked, revoked_at, revoked_reason")
      .order("issued_at", { ascending: false })
      .limit(50);

    if (data && data.length > 0) {
      const userIds = [...new Set(data.map((c) => c.user_id))];
      const map = await cachedFetchProfilesByIds(userIds);
      setCerts(data.map((c) => ({ ...c, user_name: map.get(c.user_id) || null })));
    } else {
      setCerts([]);
    }
    setLoading(false);
  };

  useEffect(() => { fetchCerts(); }, []);

  const resetForm = () => {
    setForm({ title: "", description: "", type: "course_completion", user_search: "" });
    setEditingId(null);
    setResolvedUserId(null);
    setResolvedUserName("");
    setShowForm(false);
  };

  const lookupUser = async () => {
    if (!form.user_search.trim()) return;
    const { data } = await supabase.from("profiles").select("id, full_name").ilike("full_name", `%${form.user_search.trim()}%`).limit(1);
    if (data && data.length > 0) {
      setResolvedUserId(data[0].id);
      setResolvedUserName(data[0].full_name || "User");
      toast({ title: `Found: ${data[0].full_name}` });
    } else {
      toast({ title: "User not found", variant: "destructive" });
    }
  };

  const handleSave = async () => {
    if (!form.title.trim()) { toast({ title: "Title required", variant: "destructive" }); return; }
    setSaving(true);
    if (editingId) {
      const { error } = await supabase.from("certificates").update({
        title: form.title.trim(), description: form.description.trim() || null, type: form.type,
      }).eq("id", editingId);
      if (error) toast({ title: "Update failed", variant: "destructive" });
      else { toast({ title: "Updated" }); qc.invalidateQueries({ queryKey: ["certificates"] }); resetForm(); fetchCerts(); }
    } else {
      if (!resolvedUserId) { toast({ title: "Look up a user first", variant: "destructive" }); setSaving(false); return; }
      const { error } = await supabase.from("certificates").insert({
        title: form.title.trim(), description: form.description.trim() || null, type: form.type, user_id: resolvedUserId,
      });
      if (error) toast({ title: "Create failed", variant: "destructive" });
      else { toast({ title: "Certificate issued" }); qc.invalidateQueries({ queryKey: ["certificates"] }); resetForm(); fetchCerts(); }
    }
    setSaving(false);
  };

  const deleteCert = async (id: string) => {
    confirmAction({
      title: "Delete this certificate?",
      onConfirm: async () => {
        await supabase.from("certificates").delete().eq("id", id);
        toast({ title: "Deleted" });
        qc.invalidateQueries({ queryKey: ["certificates"] });
        fetchCerts();
      },
    });
  };

  const revokeCert = async (id: string, currentlyRevoked: boolean) => {
    if (currentlyRevoked) {
      // Un-revoke: confirm + clear flags
      confirmAction({
        title: "Restore this certificate?",
        description: "The certificate will be valid again and downloadable by the recipient.",
        onConfirm: async () => {
          const { error } = await supabase.from("certificates")
            .update({ is_revoked: false, revoked_at: null, revoked_reason: null })
            .eq("id", id);
          if (error) toast({ title: "Restore failed", variant: "destructive" });
          else { toast({ title: "Restored" }); qc.invalidateQueries({ queryKey: ["certificates"] }); fetchCerts(); }
        },
      });
      return;
    }
    const reason = window.prompt("Reason for revoking this certificate? (shown to the recipient and on public verification)");
    if (!reason || !reason.trim()) return;
    confirmAction({
      title: "Revoke this certificate?",
      description: "It will be marked REVOKED on public verification and the user's dashboard. PDF download will be blocked.",
      onConfirm: async () => {
        const { error } = await supabase.from("certificates")
          .update({ is_revoked: true, revoked_at: new Date().toISOString(), revoked_reason: reason.trim() })
          .eq("id", id);
        if (error) toast({ title: "Revoke failed", variant: "destructive" });
        else { toast({ title: "Revoked" }); qc.invalidateQueries({ queryKey: ["certificates"] }); fetchCerts(); }
      },
    });
  };

  const openEdit = (c: CertRow) => {
    setEditingId(c.id);
    setForm({ title: c.title, description: c.description || "", type: c.type, user_search: "" });
    setResolvedUserId(c.user_id);
    setResolvedUserName(c.user_name || "");
    setShowForm(true);
  };

  const typeStyle = (t: string) => {
    if (t === "competition_winner") return "bg-yellow-500/10 text-yellow-600 border-yellow-500/30";
    if (t === "course_completion") return "bg-primary/10 text-primary border-primary/30";
    return "bg-muted text-muted-foreground border-border";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
          {certs.length} certificate{certs.length !== 1 ? "s" : ""}
        </span>
        <button onClick={() => { resetForm(); setShowForm(true); }}
          className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase px-4 py-2 bg-primary text-primary-foreground hover:opacity-90 transition-opacity rounded-sm"
          style={{ fontFamily: "var(--font-heading)" }}>
          <Plus className="h-3 w-3" /> Issue Certificate
        </button>
      </div>

      {showForm && (
        <div className="border border-border p-4 rounded-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] tracking-[0.2em] uppercase text-primary font-medium" style={{ fontFamily: "var(--font-heading)" }}>
              {editingId ? "Edit Certificate" : "Issue New"}
            </span>
            <button onClick={resetForm} className="text-muted-foreground hover:text-foreground"><XCircle className="h-4 w-4" /></button>
          </div>
          {!editingId && (
            <div className="flex items-center gap-2">
              <input value={form.user_search} onChange={(e) => setForm((f) => ({ ...f, user_search: e.target.value }))} placeholder="Search user by name..."
                className="flex-1 bg-transparent border border-border rounded-sm px-3 py-1.5 text-xs outline-none focus:border-primary" />
              <button onClick={lookupUser} className="px-3 py-1.5 text-[10px] uppercase border border-border hover:border-primary rounded-sm" style={{ fontFamily: "var(--font-heading)" }}>Find</button>
              {resolvedUserName && <span className="text-xs text-primary">✓ {resolvedUserName}</span>}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Certificate title *"
              className="flex-1 bg-transparent border border-border rounded-sm px-3 py-1.5 text-xs outline-none focus:border-primary" />
            <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              className="bg-transparent border border-border rounded-sm px-2 py-1.5 text-xs outline-none cursor-pointer">
              <option value="course_completion">Course</option>
              <option value="competition_winner">Winner</option>
              <option value="achievement">Achievement</option>
              <option value="custom">Custom</option>
            </select>
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-1.5 text-[10px] tracking-wider uppercase bg-primary text-primary-foreground hover:opacity-90 rounded-sm disabled:opacity-50"
              style={{ fontFamily: "var(--font-heading)" }}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : editingId ? "Update" : "Issue"}
            </button>
          </div>
          <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Description (optional)"
            className="w-full bg-transparent border border-border rounded-sm px-3 py-1.5 text-xs outline-none focus:border-primary" />
        </div>
      )}

      {certs.length > 0 ? (
        <div className="border border-border rounded-sm overflow-hidden divide-y divide-border">
          {certs.map((c) => (
            <div key={c.id} className={`flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 transition-colors group ${c.is_revoked ? "bg-destructive/5" : ""}`}>
              <Award className={`h-4 w-4 shrink-0 ${c.is_revoked ? "text-destructive" : "text-muted-foreground"}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-sm font-medium truncate ${c.is_revoked ? "line-through decoration-destructive/40 text-muted-foreground" : ""}`} style={{ fontFamily: "var(--font-body)" }}>{c.title}</span>
                  <span className={`text-[8px] px-1.5 py-0.5 border rounded-sm uppercase tracking-wider shrink-0 ${typeStyle(c.type)}`}>
                    {c.type.replace(/_/g, " ")}
                  </span>
                  {c.is_revoked && (
                    <span className="text-[8px] px-1.5 py-0.5 border border-destructive/40 bg-destructive/10 text-destructive rounded-sm uppercase tracking-wider shrink-0 inline-flex items-center gap-1">
                      <Ban className="h-2.5 w-2.5" /> Revoked
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground flex-wrap">
                  <span>{c.user_name || "Unknown"}</span>
                  <span>·</span>
                  <span>{new Date(c.issued_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}</span>
                  {c.is_revoked && c.revoked_reason && (
                    <>
                      <span>·</span>
                      <span className="text-destructive/80 italic truncate" title={c.revoked_reason}>{c.revoked_reason}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => openEdit(c)} className="p-1.5 hover:text-primary transition-colors rounded-sm hover:bg-primary/10" title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                <button
                  onClick={() => revokeCert(c.id, c.is_revoked)}
                  className={`p-1.5 transition-colors rounded-sm ${c.is_revoked ? "hover:text-emerald-500 hover:bg-emerald-500/10" : "hover:text-destructive hover:bg-destructive/10"}`}
                  title={c.is_revoked ? "Restore (un-revoke)" : "Revoke"}
                >
                  {c.is_revoked ? <ShieldCheck className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                </button>
                <button onClick={() => deleteCert(c.id)} className="p-1.5 hover:text-destructive transition-colors rounded-sm hover:bg-destructive/10" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 border border-dashed border-border rounded-sm">
          <Award className="h-5 w-5 text-muted-foreground mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">No certificates yet</p>
        </div>
      )}
    </div>
  );
};

/* ───────────── Signature & Logo Manager ───────────── */
const SignatureManager = () => {
  return (
    <div className="space-y-8">
      <AssetUploader
        settingsKey="certificate_logo"
        title="Certificate Logo"
        description="Upload the brand logo that appears at the top of all certificates. Use a transparent PNG. Auto-compressed to WebP, max 1024px, target <100 KB."
        previewLabel="Current Logo"
        emptyText="Click to upload certificate logo"
        emptyHint="Transparent PNG · auto WebP · max 1024px · <100 KB"
        maxPreviewH="max-h-20"
      />

      <div className="border-t border-border" />

      <AssetUploader
        settingsKey="certificate_signature"
        title="Certificate Signature"
        description="Upload a signature image. Use a transparent PNG. Auto-compressed to WebP, max 1024px, target <100 KB."
        previewLabel="Current Signature"
        emptyText="Click to upload signature image"
        emptyHint="Transparent PNG · auto WebP · max 1024px · <100 KB"
        maxPreviewH="max-h-16"
      />

      {/* Combined Preview */}
      <CertificatePreviewCard />
    </div>
  );
};

/* ───────────── Reusable Asset Uploader ───────────── */
const AssetUploader = ({
  settingsKey,
  title,
  description,
  previewLabel,
  emptyText,
  emptyHint,
  maxPreviewH = "max-h-16",
}: {
  settingsKey: string;
  title: string;
  description: string;
  previewLabel: string;
  emptyText: string;
  emptyHint: string;
  maxPreviewH?: string;
}) => {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { confirm: confirmAction, dialogProps: assetDialogProps } = useConfirmAction();

  const fetchAsset = async () => {
    try {
      const { data } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", settingsKey)
        .maybeSingle();
      if (data?.value) {
        const v = data.value as unknown;
        if (typeof v === "string") {
          const trimmed = (v as string).replace(/^"+|"+$/g, "");
          if (trimmed) setUrl(trimmed);
        } else if (v && typeof v === "object" && "url" in (v as any)) {
          setUrl((v as any).url);
        }
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchAsset(); }, []);

  const saveUrl = async (newUrl: string) => {
    const { error } = await supabase
      .from("site_settings")
      .upsert({ key: settingsKey, value: JSON.stringify(newUrl) }, { onConflict: "key" });
    if (error) {
      toast({ title: "Failed to save", variant: "destructive" });
    } else {
      setUrl(newUrl);
      toast({ title: `${title} saved successfully` });
    }
    setUploading(false);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please upload an image file", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      // Iterative WebP compression: max-dim 1024 (preserves aspect + transparency),
      // step quality down until <100 KB (TARGET). Hard fail if smallest result > 250 KB.
      const TARGET_BYTES = 100 * 1024;
      const HARD_FAIL_BYTES = 250 * 1024;
      const QUALITIES = [0.92, 0.85, 0.75, 0.65, 0.55, 0.45];
      let chosen: { webpFile: File; size: number } | null = null;
      for (const q of QUALITIES) {
        const { webpFile } = await compressImageToFiles(file, settingsKey, {
          maxDimension: 1024,
          webpQuality: q,
        });
        const size = webpFile.size;
        if (!chosen || size < chosen.size) chosen = { webpFile, size };
        if (size <= TARGET_BYTES) break;
      }
      if (!chosen) throw new Error("Compression produced no output");
      if (chosen.size > HARD_FAIL_BYTES) {
        toast({
          title: "Image too large after compression",
          description: `Final size ${(chosen.size / 1024).toFixed(0)} KB exceeds 250 KB limit. Please upload a simpler/smaller source image.`,
          variant: "destructive",
        });
        return;
      }
      const path = `certificates/${settingsKey}.webp`;
      const result = await uploadImage({
        bucket: "site-assets",
        file: chosen.webpFile,
        path,
        type: "certificate-template",
        upsertOverride: true,
      });
      const cacheBustedUrl = `${result.url}?t=${Date.now()}`;
      await saveUrl(cacheBustedUrl);
      toast({
        title: `${title} optimized`,
        description: `Saved at ${(chosen.size / 1024).toFixed(1)} KB (WebP, max 1024px).`,
      });
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : "Could not upload image", variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async () => {
    confirmAction({
      title: `Remove ${title.toLowerCase()} from all future certificates?`,
      onConfirm: async () => {
        const { error } = await supabase
          .from("site_settings")
          .upsert({ key: settingsKey, value: JSON.stringify("") }, { onConflict: "key" });
        if (error) toast({ title: "Failed to remove", variant: "destructive" });
        else { setUrl(null); toast({ title: `${title} removed` }); }
      },
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[10px] tracking-[0.2em] uppercase text-foreground font-medium mb-1" style={{ fontFamily: "var(--font-heading)" }}>
          {title}
        </h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>

      {url ? (
        <div className="border border-border rounded-sm p-6 bg-muted/20 flex flex-col items-center gap-4">
          <p className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
            {previewLabel}
          </p>
          <div className="bg-background border border-border rounded-sm p-4 max-w-[200px]">
            <img loading="lazy" decoding="async" src={url} alt={title} className={`${maxPreviewH} w-auto object-contain`} />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase px-4 py-2 border border-border hover:border-primary rounded-sm transition-colors disabled:opacity-50"
              style={{ fontFamily: "var(--font-heading)" }}>
              {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />} Replace
            </button>
            <button onClick={remove}
              className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase px-4 py-2 border border-destructive/30 text-destructive hover:bg-destructive/10 rounded-sm transition-colors"
              style={{ fontFamily: "var(--font-heading)" }}>
              <Trash2 className="h-3 w-3" /> Remove
            </button>
          </div>
        </div>
      ) : (
        <div onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed border-border rounded-sm p-10 flex flex-col items-center gap-3 cursor-pointer hover:border-primary/50 transition-colors">
          <ImageIcon className="h-8 w-8 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">{emptyText}</p>
          <p className="text-[10px] text-muted-foreground/60">{emptyHint}</p>
          {uploading && <Loader2 className="h-4 w-4 animate-spin text-primary mt-2" />}
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*" onChange={handleUpload} className="hidden" />
      <ConfirmDialog {...assetDialogProps} />
    </div>
  );
};

/* ───────────── Certificate Preview Card ───────────── */
const CertificatePreviewCard = () => {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [sigUrl, setSigUrl] = useState<string | null>(null);

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from("site_settings")
        .select("key, value")
        .in("key", ["certificate_logo", "certificate_signature"]);
      if (data) {
        for (const row of data) {
          const v = row.value as unknown;
          let url = "";
          if (typeof v === "string") url = (v as string).replace(/^"+|"+$/g, "");
          else if (v && typeof v === "object" && "url" in (v as any)) url = (v as any).url;
          if (!url) continue;
          if (row.key === "certificate_logo") setLogoUrl(url);
          if (row.key === "certificate_signature") setSigUrl(url);
        }
      }
    };
    fetch();
  }, []);

  return (
    <div className="border border-border rounded-sm p-4 bg-muted/10">
      <p className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground mb-3" style={{ fontFamily: "var(--font-heading)" }}>
        Certificate Preview
      </p>
      <div className="bg-[#faf8f4] border border-[#c8c8c0] rounded-sm p-6 flex flex-col items-center gap-3 relative">
        {/* Logo */}
        {logoUrl ? (
          <img loading="lazy" decoding="async" src={logoUrl} alt="Logo" className="h-12 w-auto object-contain" />
        ) : (
          <div className="h-12 w-12 rounded-full border-2 border-dashed border-[#b4a078] flex items-center justify-center">
            <ImageIcon className="h-5 w-5 text-[#b4a078]" />
          </div>
        )}
        <p className="text-[9px] font-bold text-[#1e1e1e] tracking-[0.15em] uppercase">50MM RETINA WORLD</p>
        <p className="text-[7px] text-[#6e6964] tracking-[0.25em] uppercase">Certificate of Completion</p>
        <div className="w-16 h-px bg-[#b4a078]" />
        <p className="text-[10px] text-[#a09a94]">This is to certify that</p>
        <p className="text-lg font-bold text-[#1e1e1e]">John Doe</p>
        <p className="text-[10px] text-[#a09a94]">has successfully completed all lessons in</p>
        <p className="text-sm italic text-[#2d2d2d]">Photography Masterclass</p>

        {/* Signature */}
        <div className="mt-3 flex flex-col items-center gap-1">
          {sigUrl ? (
            <img loading="lazy" decoding="async" src={sigUrl} alt="Signature" className="max-h-10 w-auto object-contain" />
          ) : (
            <div className="h-8 w-24 border-b border-dashed border-[#b4a078]" />
          )}
          <div className="w-20 h-px bg-[#b4a078]" />
          <p className="text-[7px] text-[#6e6964] tracking-wider uppercase">Authorized Signature</p>
        </div>
      </div>
    </div>
  );
};

export default AdminCertificates;
