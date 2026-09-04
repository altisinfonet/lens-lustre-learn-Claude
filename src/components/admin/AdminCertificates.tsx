import { useEffect, useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cachedFetchProfilesByIds } from "@/lib/profileBatch";
import { toast } from "@/hooks/core/use-toast";
import { Plus, Pencil, Trash2, XCircle, Loader2, Award, Upload, Image as ImageIcon, Ban, ShieldCheck, Download, Search } from "lucide-react";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { useConfirmAction } from "@/hooks/admin/useConfirmAction";
import type { User } from "@supabase/supabase-js";
import { uploadImage } from "@/lib/imageUpload";
import { compressImageToFiles } from "@/lib/imageCompression";
import { saveBlob } from "@/lib/saveFile";
import { clearCertificateAssetCache } from "@/lib/generateCertificatePdf";
import {
  CERT_TYPES,
  CERT_TYPE_GROUPS,
  certTypeLabel,
  certTypeClass,
  isManualCertType,
} from "@/components/admin/certificateTypes";

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
  /** Human-facing id printed on the PDF. Null until the BEFORE INSERT trigger fills it. */
  certificate_id: string | null;
  /** Custom certificates only — the line under CERTIFICATE. Null = the type's own wording. */
  heading: string | null;
}

/** One row from admin_search_certificate_recipients. */
interface RecipientMatch {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  total_count: number;
}

/** 100 per page, matching AdminUsers and AdminTransactions. */
const CERTS_PAGE_SIZE = 100;

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
  const [form, setForm] = useState({ title: "", description: "", heading: "", type: "course_completion", user_search: "" });
  const [resolvedUserId, setResolvedUserId] = useState<string | null>(null);
  const [resolvedUserName, setResolvedUserName] = useState("");
  const { confirm: confirmAction, dialogProps } = useConfirmAction();

  /** Recipient search: every match, with email, so two people sharing a name
   *  can be told apart. The old lookup was `.limit(1)` — first row wins,
   *  silently, no email. Staging has 25 profiles named "Zara Kim". */
  const [matches, setMatches] = useState<RecipientMatch[]>([]);
  const [matchTotal, setMatchTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);

  /** Paging + filtering over the whole certificate table. */
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [typeFilter, setTypeFilter] = useState("");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  /**
   * LIVE PREVIEW — the certificate redraws as the admin types.
   *
   * ⚠ Why this matters rather than being a nicety: a certificate cannot be
   * edited once the recipient has downloaded it. Until now the only way to see
   * what the wording actually looked like was to issue it to a real member and
   * then look. The admin was composing a document blind.
   *
   * Debounced at 180ms, not rendered per keystroke: a full render is ~240ms of
   * canvas work, so keying it to every character would queue renders faster
   * than they complete and the picture would trail the typing. 180ms redraws
   * between words, which is what "live" actually feels like.
   *
   * `previewSeq` discards a slow render whose input has already changed —
   * without it, a render started three characters ago can land last and paint
   * stale text over current text.
   */
  const [previewPng, setPreviewPng] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewSeq = useRef(0);

  /**
   * ⚠ THIS WAS `.order(issued_at).limit(50)` WITH NO PAGING.
   * At 51 certificates the oldest silently disappeared and nothing said so —
   * the same defect that hid the owner's own account from the member list.
   * `admin_list_certificates` pages, filters by type, and returns the true
   * total so the footer can never overstate what is on screen.
   */
  const fetchCerts = async (opts: { page?: number; type?: string } = {}) => {
    const p = opts.page ?? page;
    const t = opts.type ?? typeFilter;
    setPage(p);

    const { data, error } = await (supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown[] | null; error: { message: string } | null }>)(
      // Call position, never stored — see src/lib/media/postMediaWrite.ts.
      "admin_list_certificates",
      { _query: "", _type: t || null, _limit: CERTS_PAGE_SIZE, _offset: p * CERTS_PAGE_SIZE },
    );

    if (error) {
      toast({ title: "Could not load certificates", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as Array<Omit<CertRow, "user_name"> & { total_count: number }>;

    if (rows.length > 0) {
      // total_count repeats on every row (count(*) over ()). It is the size of
      // the FILTERED set before limit/offset — counting `rows` would report
      // 100 for ever, which is the silent lie this fix exists to remove.
      setTotalCount(Number(rows[0].total_count ?? rows.length));
      const userIds = [...new Set(rows.map((c) => c.user_id))];
      const map = await cachedFetchProfilesByIds(userIds);
      setCerts(rows.map((c) => ({ ...c, user_name: map.get(c.user_id) || null })));
    } else {
      setCerts([]);
      setTotalCount(0);
      // An empty page beyond the first means the set shrank underneath us.
      if (p > 0) { void fetchCerts({ page: 0, type: t }); return; }
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!showForm) { setPreviewPng(null); setPreviewError(null); return; }
    const seq = ++previewSeq.current;
    const timer = setTimeout(async () => {
      setPreviewing(true);
      try {
        const { renderCertificateToPng } = await import("@/lib/generateCertificatePdf");
        // Editing an existing certificate previews ITS date and id, not
        // today's — otherwise the admin is shown something the member will
        // never receive, which is the defect the member view had.
        const existing = editingId ? certs.find((c) => c.id === editingId) : undefined;
        const png = await renderCertificateToPng({
          recipientName: resolvedUserName || existing?.user_name || "Recipient name",
          courseTitle: form.title.trim() || "Certificate title",
          issueDate: new Date(existing?.issued_at ?? Date.now()).toLocaleDateString("en-US", {
            year: "numeric", month: "long", day: "numeric",
          }),
          certificateId: existing?.id ?? "preview",
          displayCertificateId: existing?.certificate_id ?? "CERT-PREVIEW",
          type: form.type as never,
          description: form.description,
          heading: form.type === "custom" ? form.heading : null,
        });
        if (seq !== previewSeq.current) return;
        setPreviewPng(png);
        setPreviewError(null);
      } catch (err) {
        if (seq !== previewSeq.current) return;
        setPreviewError(err instanceof Error ? err.message : "Could not draw the preview.");
      } finally {
        if (seq === previewSeq.current) setPreviewing(false);
      }
    }, 180);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showForm, form.title, form.description, form.type, resolvedUserName, editingId]);

  // Load page 1 on mount. fetchCerts is deliberately not a dependency: it is
  // recreated on every render, so listing it would refetch continuously.
  useEffect(() => {
    void fetchCerts({ page: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetForm = () => {
    setForm({ title: "", description: "", heading: "", type: "course_completion", user_search: "" });
    setEditingId(null);
    setResolvedUserId(null);
    setResolvedUserName("");
    setMatches([]);
    setMatchTotal(0);
    setShowForm(false);
  };

  /**
   * ⚠ THIS WAS `.ilike(full_name).limit(1)` AND IT COULD CERTIFY THE WRONG PERSON.
   * One row was taken, silently, with no email selected — and email is the only
   * field that separates two members with the same name. Staging carries 25
   * profiles named "Zara Kim"; the old lookup returned whichever Postgres
   * happened to return first and the admin had no way to notice.
   *
   * Now: every match, each with its email, plus the true total so the UI can
   * say "showing 20 of 25". The admin picks; the code never guesses.
   *
   * `searchSeq` discards out-of-order responses — typing "pra" then "prad" can
   * otherwise land the slower "pra" result last and show the wrong list.
   */
  const runRecipientSearch = async (raw: string) => {
    const q = raw.trim();
    const seq = ++searchSeq.current;

    if (q.length < 2) {
      setMatches([]);
      setMatchTotal(0);
      setSearching(false);
      return;
    }

    setSearching(true);
    const { data, error } = await (supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown[] | null; error: { message: string } | null }>)(
      "admin_search_certificate_recipients",
      { _query: q, _limit: 20 },
    );

    if (seq !== searchSeq.current) return; // a newer keystroke already answered

    if (error) {
      setSearching(false);
      toast({ title: "Recipient search failed", description: error.message, variant: "destructive" });
      return;
    }

    const rows = (data ?? []) as RecipientMatch[];
    setMatches(rows);
    setMatchTotal(rows.length > 0 ? Number(rows[0].total_count ?? rows.length) : 0);
    setSearching(false);
  };

  /** Debounced so a fast typist does not fire a request per keystroke. */
  useEffect(() => {
    if (editingId) return; // recipient is fixed while editing
    const q = form.user_search;
    const id = window.setTimeout(() => { void runRecipientSearch(q); }, 250);
    return () => window.clearTimeout(id);
  }, [form.user_search, editingId]);

  const chooseRecipient = (m: RecipientMatch) => {
    setResolvedUserId(m.id);
    setResolvedUserName(m.full_name || m.email || "Member");
    setMatches([]);
    setMatchTotal(0);
    setForm((f) => ({ ...f, user_search: m.full_name || m.email || "" }));
  };

  const handleSave = async () => {
    if (!form.title.trim()) { toast({ title: "Title required", variant: "destructive" }); return; }
    setSaving(true);
    if (editingId) {
      const { error } = await supabase.from("certificates").update({
        title: form.title.trim(),
        description: form.description.trim() || null,
        type: form.type,
        // A CHECK constraint refuses a heading on any other type, so send NULL
        // rather than carrying a stale one across a type change.
        heading: form.type === "custom" ? (form.heading.trim() || null) : null,
      }).eq("id", editingId);
      if (error) toast({ title: "Update failed", variant: "destructive" });
      else { toast({ title: "Updated" }); qc.invalidateQueries({ queryKey: ["certificates"] }); resetForm(); fetchCerts(); }
    } else {
      if (!resolvedUserId) { toast({ title: "Look up a user first", variant: "destructive" }); setSaving(false); return; }
      const { error } = await supabase.from("certificates").insert({
        title: form.title.trim(),
        description: form.description.trim() || null,
        type: form.type,
        heading: form.type === "custom" ? (form.heading.trim() || null) : null,
        user_id: resolvedUserId,
      });
      if (error) toast({ title: "Create failed", variant: "destructive" });
      else { toast({ title: "Certificate issued" }); qc.invalidateQueries({ queryKey: ["certificates"] }); resetForm(); fetchCerts(); }
    }
    setSaving(false);
  };

  /**
   * ⚠ THE OLD BODY WAS `await supabase…delete(); toast("Deleted")`.
   * The error was never read, so the toast said "Deleted" whatever happened —
   * a failed delete and a successful one were indistinguishable. Nothing here
   * is allowed to claim success it did not verify.
   *
   * `.select("id")` makes the deleted rows come back, so a delete that
   * matched NOTHING (already gone, or refused by a policy) is detected rather
   * than assumed. Verified 2026-08-24 against both databases: an admin CAN
   * delete, and deleting removes the verification token with the row, so the
   * certificate stops verifying publicly at the same instant.
   * `certificate_testimonials` cascades. No PDF is stored server-side
   * (0 of 23 rows carry file_url), so nothing is orphaned.
   */
  const deleteCert = async (cert: CertRow) => {
    confirmAction({
      title: "Delete this certificate?",
      description:
        `"${cert.title}" for ${cert.user_name || "this member"} will be removed permanently. ` +
        `Public verification will stop working immediately, any testimonial attached to it is deleted, ` +
        `and the member's "New Certificate!" notification is removed so it cannot link to nothing. ` +
        `This cannot be undone — to withdraw a certificate but keep the record, use Revoke instead.`,
      onConfirm: async () => {
        const { data, error } = await supabase
          .from("certificates")
          .delete()
          .eq("id", cert.id)
          .select("id");

        if (error) {
          toast({ title: "Delete failed", description: error.message, variant: "destructive" });
          return;
        }
        if (!data || data.length === 0) {
          toast({
            title: "Nothing was deleted",
            description: "The certificate was not removed — it may already be gone, or a policy refused it. The list has been refreshed.",
            variant: "destructive",
          });
          void fetchCerts();
          return;
        }

        toast({ title: "Certificate deleted" });
        qc.invalidateQueries({ queryKey: ["certificates"] });
        void fetchCerts();
      },
    });
  };

  /**
   * The same PDF the member downloads, from the admin side.
   * Previously the admin could not see the artefact they had issued at all —
   * generateCertificatePdf was imported only by the member-facing pages.
   *
   * `saveBlob`, never `doc.save()`: jsPDF's save() builds an <a download> and
   * clicks it, which an Android WebView swallows silently.
   */
  const downloadPdf = async (c: CertRow) => {
    if (c.is_revoked) {
      toast({ title: "Revoked certificates cannot be downloaded", variant: "destructive" });
      return;
    }
    setDownloadingId(c.id);
    try {
      const { generateCertificatePdf } = await import("@/lib/generateCertificatePdf");
      const doc = await generateCertificatePdf({
        recipientName: c.user_name || "Member",
        courseTitle: c.title,
        issueDate: new Date(c.issued_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
        certificateId: c.id,
        displayCertificateId: c.certificate_id || undefined,
        type: c.type as never,
        // The admin's own words, which the renderer ignored until 2026-08-25.
        description: c.description,
        heading: c.heading,
      });
      await saveBlob(
        doc.output("blob"),
        `50mmRetina-Certificate-${(c.certificate_id || c.id).slice(0, 12)}.pdf`,
      );
    } catch (err) {
      toast({
        title: "PDF generation failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDownloadingId(null);
    }
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
    // The type is set from the row and the dropdown now renders ALL 16 types,
    // so an unmatched value can no longer fall back to the first option and
    // silently rewrite a Runner-Up into a Course certificate.
    setForm({ title: c.title, description: c.description || "", heading: c.heading || "", type: c.type, user_search: "" });
    setResolvedUserId(c.user_id);
    setResolvedUserName(c.user_name || "");
    setShowForm(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          {/* totalCount, not certs.length — the latter is only this page and
              would have read "50 certificates" for ever. */}
          <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
            {totalCount} certificate{totalCount !== 1 ? "s" : ""}
            {typeFilter ? ` · ${certTypeLabel(typeFilter)}` : ""}
          </span>
          <select
            value={typeFilter}
            onChange={(e) => { const v = e.target.value; setTypeFilter(v); void fetchCerts({ page: 0, type: v }); }}
            className="bg-transparent border border-border rounded-sm px-2 py-1 text-[10px] outline-none cursor-pointer"
          >
            <option value="">All types</option>
            {CERT_TYPE_GROUPS.map((g) => (
              <optgroup key={g} label={g}>
                {CERT_TYPES.filter((t) => t.group === g).map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
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
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                  <input
                    value={form.user_search}
                    onChange={(e) => { setForm((f) => ({ ...f, user_search: e.target.value })); setResolvedUserId(null); }}
                    placeholder="Search recipient by name or email…"
                    autoComplete="off"
                    className="w-full bg-transparent border border-border rounded-sm pl-7 pr-3 py-1.5 text-xs outline-none focus:border-primary"
                  />
                  {searching && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-muted-foreground" />}
                </div>
                {resolvedUserId && (
                  <span className="text-xs text-primary shrink-0 inline-flex items-center gap-1">✓ {resolvedUserName}</span>
                )}
              </div>

              {/* Every match, with the email that tells two same-named members
                  apart. The old UI showed one name and no email. */}
              {!resolvedUserId && matches.length > 0 && (
                <div className="border border-border rounded-sm divide-y divide-border max-h-56 overflow-y-auto">
                  {matches.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => chooseRecipient(m)}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-primary/10 transition-colors"
                    >
                      {m.avatar_url
                        ? <img src={m.avatar_url} alt="" className="h-5 w-5 rounded-full object-cover shrink-0" />
                        : <span className="h-5 w-5 rounded-full bg-muted shrink-0" />}
                      <span className="text-xs truncate">{m.full_name || "(no name)"}</span>
                      <span className="text-[10px] text-muted-foreground truncate ml-auto">{m.email || "no email"}</span>
                    </button>
                  ))}
                  {matchTotal > matches.length && (
                    <p className="px-2.5 py-1.5 text-[10px] text-muted-foreground">
                      Showing {matches.length} of {matchTotal} matches — refine the search to narrow it.
                    </p>
                  )}
                </div>
              )}

              {!resolvedUserId && !searching && form.user_search.trim().length >= 2 && matches.length === 0 && (
                <p className="text-[10px] text-muted-foreground">No member matches that name or email.</p>
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Certificate title *"
              className="flex-1 bg-transparent border border-border rounded-sm px-3 py-1.5 text-xs outline-none focus:border-primary" />
            {/* ⚠ ALL 16 TYPES, ALWAYS. A <select> whose value matches no
                <option> silently shows the first one — that is how editing a
                Runner-Up certificate rewrote it to a Course certificate and
                produced duplicates. Automatic types are rendered but disabled
                for NEW issues, because hand-issuing a competition award would
                bypass the competition that earns it. */}
            <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              className="bg-transparent border border-border rounded-sm px-2 py-1.5 text-xs outline-none cursor-pointer max-w-[14rem]">
              {CERT_TYPE_GROUPS.map((g) => (
                <optgroup key={g} label={g}>
                  {CERT_TYPES.filter((t) => t.group === g).map((t) => (
                    <option
                      key={t.value}
                      value={t.value}
                      disabled={!t.manual && !editingId}
                      title={t.origin}
                    >
                      {t.label}{!t.manual && !editingId ? " (automatic)" : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-1.5 text-[10px] tracking-wider uppercase bg-primary text-primary-foreground hover:opacity-90 rounded-sm disabled:opacity-50"
              style={{ fontFamily: "var(--font-heading)" }}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : editingId ? "Update" : "Issue"}
            </button>
          </div>
          {/*
            ⚠ CUSTOM ONLY — and deliberately so.

            The line under CERTIFICATE is OF COMPLETION for a course, OF MERIT
            for a Top 50, and so on: it states what the member earned, so it
            must not be free text on those types. A CHECK constraint enforces
            that (`certificates_heading_only_for_custom`); this field simply
            does not appear for anything but `custom`, so the rule is visible
            in the UI as well as guaranteed underneath it.
          */}
          {form.type === "custom" && (
            <div className="space-y-1">
              <input
                value={form.heading}
                onChange={(e) => setForm((f) => ({ ...f, heading: e.target.value }))}
                placeholder="OF ACHIEVEMENT"
                spellCheck
                lang="en"
                maxLength={60}
                className="w-full bg-transparent border border-border rounded-sm px-3 py-1.5 text-xs outline-none focus:border-primary tracking-[0.15em] uppercase"
              />
              <p className="text-[10px] text-muted-foreground">
                {form.heading.trim()
                  ? <>Printed under the word <span className="text-foreground">CERTIFICATE</span>.</>
                  : <>Printed under the word <span className="text-foreground">CERTIFICATE</span>. Leave blank for <span className="text-foreground">OF ACHIEVEMENT</span>.</>}
              </p>
            </div>
          )}

          {/*
            ⚠ A TEXTAREA, SPELL-CHECKED, AND IT NOW REACHES THE CERTIFICATE.

            This was a single-line <input> whose value the PDF renderer never
            read — the admin typed it, the database stored it, and the printed
            certificate ignored it. It is now the closing line beneath the
            title, so it is the sentence the recipient actually reads, and a
            typo in it is a typo on a certificate that cannot be edited once
            downloaded. `spellCheck` gives the red underline and the
            right-click correction the browser already knows how to do; a
            textarea gives room to see the whole sentence before issuing it.
          */}
          <div className="space-y-1">
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder={isManualCertType(form.type)
                ? "Wording printed beneath the title — e.g. \u201cfor outstanding service to the community throughout 2026.\u201d"
                : "Description (optional) — replaces the standard closing line"}
              rows={2}
              spellCheck
              lang="en"
              maxLength={300}
              className="w-full bg-transparent border border-border rounded-sm px-3 py-1.5 text-xs outline-none focus:border-primary resize-y leading-relaxed"
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] text-muted-foreground">
                {form.description.trim()
                  ? "This replaces the standard closing line on the certificate."
                  : `Left blank, the certificate uses the standard wording for ${certTypeLabel(form.type)}.`}
              </p>
              <span className={`text-[10px] shrink-0 ${form.description.length > 260 ? "text-destructive" : "text-muted-foreground"}`}>
                {form.description.length}/300
              </span>
            </div>
          </div>

          {/* ── Live preview ──────────────────────────────────────────────
              What the recipient will actually receive, redrawn as the admin
              types. Same `drawCertificate` routine as the PDF, so this is the
              document itself and not an impression of it. */}
          <div className="border-t border-border pt-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                Live preview
              </span>
              <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1.5">
                {previewing && <Loader2 className="h-3 w-3 animate-spin" />}
                {previewing ? "drawing…" : previewError ? "" : "updates as you type"}
              </span>
            </div>

            <div className="relative bg-muted/20 rounded-sm overflow-hidden border border-border">
              {/* A4 landscape, so the box never jumps height between renders. */}
              <div style={{ aspectRatio: "297 / 210" }} className="w-full">
                {previewPng ? (
                  <img
                    src={previewPng}
                    alt="Live certificate preview"
                    className={`w-full h-full object-contain transition-opacity duration-150 ${previewing ? "opacity-60" : "opacity-100"}`}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    {previewError
                      ? <span className="text-[10px] text-destructive px-4 text-center">{previewError}</span>
                      : <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
                  </div>
                )}
              </div>
            </div>

            <p className="text-[10px] text-muted-foreground">
              {resolvedUserId || editingId
                ? "This is the certificate that will be issued."
                : "Choose a recipient above and their name replaces the placeholder."}
            </p>
          </div>
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
                  <span className={`text-[8px] px-1.5 py-0.5 border rounded-sm uppercase tracking-wider shrink-0 ${certTypeClass(c.type)}`}>
                    {certTypeLabel(c.type)}
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
                <button
                  onClick={() => void downloadPdf(c)}
                  disabled={c.is_revoked || downloadingId === c.id}
                  className="p-1.5 hover:text-primary transition-colors rounded-sm hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed"
                  title={c.is_revoked ? "Revoked certificates cannot be downloaded" : "Download the member's PDF"}
                >
                  {downloadingId === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                </button>
                <button onClick={() => openEdit(c)} className="p-1.5 hover:text-primary transition-colors rounded-sm hover:bg-primary/10" title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                <button
                  onClick={() => revokeCert(c.id, c.is_revoked)}
                  className={`p-1.5 transition-colors rounded-sm ${c.is_revoked ? "hover:text-emerald-500 hover:bg-emerald-500/10" : "hover:text-destructive hover:bg-destructive/10"}`}
                  title={c.is_revoked ? "Restore (un-revoke)" : "Revoke"}
                >
                  {c.is_revoked ? <ShieldCheck className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                </button>
                <button onClick={() => deleteCert(c)} className="p-1.5 hover:text-destructive transition-colors rounded-sm hover:bg-destructive/10" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 border border-dashed border-border rounded-sm">
          <Award className="h-5 w-5 text-muted-foreground mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">
            {typeFilter ? `No ${certTypeLabel(typeFilter)} certificates` : "No certificates yet"}
          </p>
        </div>
      )}

      {/* Pager. Shown only when the filtered set exceeds one page; the count
          above always tells the truth either way. */}
      {totalCount > CERTS_PAGE_SIZE && (() => {
        const pageCount = Math.ceil(totalCount / CERTS_PAGE_SIZE);
        const go = (n: number) => { if (n >= 0 && n < pageCount && !loading) void fetchCerts({ page: n }); };
        const start = Math.max(0, Math.min(page - 3, pageCount - 7));
        const end = Math.min(pageCount, Math.max(page + 4, 7));
        const nums: number[] = [];
        for (let i = Math.max(0, start); i < end; i++) nums.push(i);
        return (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border">
            <p className="text-[10px] tracking-wider uppercase text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
              Page {page + 1} of {pageCount} — {totalCount.toLocaleString()} certificates
            </p>
            <div className="flex items-center gap-1">
              <button onClick={() => go(page - 1)} disabled={page === 0 || loading}
                className="px-2 py-1 text-[10px] tracking-wider uppercase border border-border rounded-sm hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Prev</button>
              {nums[0] > 0 && (
                <>
                  <button onClick={() => go(0)} className="px-2 py-1 text-[10px] border border-border rounded-sm hover:bg-primary/10 transition-colors">1</button>
                  {nums[0] > 1 && <span className="px-1 text-[10px] text-muted-foreground">…</span>}
                </>
              )}
              {nums.map((n) => (
                <button key={n} onClick={() => go(n)} disabled={loading}
                  className={`px-2 py-1 text-[10px] border rounded-sm transition-colors ${n === page ? "bg-primary/15 border-primary/40 text-primary font-medium" : "border-border hover:bg-primary/10"}`}>{n + 1}</button>
              ))}
              {nums[nums.length - 1] < pageCount - 1 && (
                <>
                  {nums[nums.length - 1] < pageCount - 2 && <span className="px-1 text-[10px] text-muted-foreground">…</span>}
                  <button onClick={() => go(pageCount - 1)} className="px-2 py-1 text-[10px] border border-border rounded-sm hover:bg-primary/10 transition-colors">{pageCount}</button>
                </>
              )}
              <button onClick={() => go(page + 1)} disabled={page >= pageCount - 1 || loading}
                className="px-2 py-1 text-[10px] tracking-wider uppercase border border-border rounded-sm hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Next</button>
            </div>
          </div>
        );
      })()}

      {/*
        ⚠ WITHOUT THIS LINE, DELETE, REVOKE AND RESTORE ALL DO NOTHING.

        `useConfirmAction` is only a state holder: `confirmAction({...})` stores
        the config and flips `open` to true. Something has to RENDER the dialog
        that reads `open`, and until 2026-08-25 nothing in this component did.
        The hook was called, the state was set, and `onConfirm` was never
        reached — so the admin pressed Delete and nothing happened at all. No
        error, no toast, no request. Revoke was worse: it prompted for a reason
        first, then discarded it.

        Reported by the owner as "delete certificate from admin and everywhere
        is not working", and they were right. The database was never the
        problem — the audit log shows the delete never reached the server.
      */}
      <ConfirmDialog {...dialogProps} />
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
      // The renderer holds certificate assets for the life of the page so the
      // live preview is not refetching them on every keystroke. Drop them now,
      // or the preview keeps drawing the logo that was just replaced.
      clearCertificateAssetCache();
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
        else {
          setUrl(null);
          clearCertificateAssetCache();
          toast({ title: `${title} removed` });
        }
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
          <p className="text-[7px] text-[#6e6964] tracking-wider uppercase">Authorized Signatory</p>
        </div>
      </div>
    </div>
  );
};

export default AdminCertificates;
