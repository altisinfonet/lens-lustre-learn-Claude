// Admin > Employment > Employee — office staff records + public ID verification.
// Each staff member gets an ID number; the public can verify it at
// /IDverification (or directly /IDverification=<ID>). Admin can download a
// QR code that encodes that URL for printing on physical ID cards.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { generateImagePath, uploadImage } from "@/lib/imageUpload";
import { compressImageToFiles } from "@/lib/imageCompression";
import { scanFileWithToast } from "@/lib/fileSecurityScanner";
import QRCode from "qrcode";
import {
  Plus, Pencil, Trash2, Loader2, QrCode, Search, ExternalLink, BadgeCheck, UserX,
} from "lucide-react";

const SITE_URL = "https://50mmretina.com";
const verificationUrl = (idNumber: string) =>
  `${SITE_URL}/IDverification=${encodeURIComponent(idNumber.trim())}`;

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", ""];

export interface OfficeStaff {
  id: string;
  id_number: string;
  full_name: string;
  designation: string;
  photo_url: string | null;
  blood_group: string;
  about: string;
  active_from: string | null;
  expires_on: string | null;
  job_status: "active" | "inactive";
  created_at: string;
  updated_at: string;
}

const emptyForm = {
  id_number: "",
  full_name: "",
  designation: "",
  photo_url: "" as string | null,
  blood_group: "",
  about: "",
  active_from: "",
  expires_on: "",
  job_status: "active" as "active" | "inactive",
};

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
const labelClass = "mb-1 block text-sm font-medium text-foreground";

export default function AdminEmployee() {
  const [items, setItems] = useState<OfficeStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<OfficeStaff | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<OfficeStaff | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [qrBusy, setQrBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("office_staff" as any)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      toast({ title: "Failed to load staff", description: error.message, variant: "destructive" });
    }
    setItems(((data as any) ?? []) as OfficeStaff[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((s) =>
      [s.full_name, s.id_number, s.designation].some((v) => (v ?? "").toLowerCase().includes(q)),
    );
  }, [items, search]);

  const openCreate = () => { setEditing(null); setForm({ ...emptyForm }); setFormOpen(true); };
  const openEdit = (s: OfficeStaff) => {
    setEditing(s);
    setForm({
      id_number: s.id_number,
      full_name: s.full_name,
      designation: s.designation ?? "",
      photo_url: s.photo_url,
      blood_group: s.blood_group ?? "",
      about: s.about ?? "",
      active_from: s.active_from ?? "",
      expires_on: s.expires_on ?? "",
      job_status: s.job_status,
    });
    setFormOpen(true);
  };

  const handlePhoto = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      const safe = await scanFileWithToast(file, toast, { allowedTypes: "image" });
      if (!safe) return;
      const baseName = `staff-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const { webpFile } = await compressImageToFiles(file, baseName);
      const path = generateImagePath({ type: "staff-id", ext: "webp" });
      const result = await uploadImage({
        bucket: "journal-images",
        file: webpFile,
        path,
        type: "staff-id",
        fileName: `${baseName}.webp`,
      });
      if (!result?.url) throw new Error("Upload failed");
      setForm((f) => ({ ...f, photo_url: result.url }));
      toast({ title: "Photo uploaded" });
    } catch (e: any) {
      toast({ title: "Photo upload failed", description: e?.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    const idn = form.id_number.trim();
    if (!idn) { toast({ title: "ID Number is required", variant: "destructive" }); return; }
    if (!form.full_name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    setSaving(true);
    const payload: any = {
      id_number: idn,
      full_name: form.full_name.trim(),
      designation: form.designation.trim(),
      photo_url: form.photo_url || null,
      blood_group: form.blood_group,
      about: form.about,
      active_from: form.active_from || null,
      expires_on: form.expires_on || null,
      job_status: form.job_status,
    };
    const q = editing
      ? supabase.from("office_staff" as any).update(payload).eq("id", editing.id)
      : supabase.from("office_staff" as any).insert(payload);
    const { error } = await q;
    setSaving(false);
    if (error) {
      const msg = /office_staff_id_number_uq|duplicate/i.test(error.message)
        ? `ID Number "${idn}" already exists — ID numbers must be unique.`
        : error.message;
      toast({ title: "Save failed", description: msg, variant: "destructive" });
      return;
    }
    toast({ title: editing ? "Staff updated" : "Staff added" });
    setFormOpen(false);
    load();
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from("office_staff" as any).delete().eq("id", deleteTarget.id);
    setDeleting(false);
    setDeleteTarget(null);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Staff removed" });
    load();
  };

  const downloadQR = async (s: OfficeStaff) => {
    setQrBusy(s.id);
    try {
      const url = verificationUrl(s.id_number);
      const dataUrl = await QRCode.toDataURL(url, { width: 600, margin: 2, errorCorrectionLevel: "M" });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `staff-id-${s.id_number.replace(/[^\w.-]+/g, "_")}-qr.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast({ title: "QR code downloaded", description: url });
    } catch (e: any) {
      toast({ title: "QR generation failed", description: e?.message, variant: "destructive" });
    } finally {
      setQrBusy(null);
    }
  };

  const isExpired = (s: OfficeStaff) =>
    !!s.expires_on && new Date(s.expires_on + "T23:59:59") < new Date();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Employees</h2>
          <p className="text-sm text-muted-foreground">
            Office staff ID records. Public verification at{" "}
            <a href={`${SITE_URL}/IDverification`} target="_blank" rel="noreferrer" className="underline">
              /IDverification <ExternalLink className="inline h-3 w-3" />
            </a>
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Add Employee
        </button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name / ID / designation…"
          className={`${inputClass} pl-9`}
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No staff records{search ? " match your search" : " yet — add the first employee"}.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Staff</th>
                <th className="px-4 py-3 font-medium">ID Number</th>
                <th className="px-4 py-3 font-medium">Designation</th>
                <th className="px-4 py-3 font-medium">Active From</th>
                <th className="px-4 py-3 font-medium">Expiry</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((s) => (
                <tr key={s.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {s.photo_url ? (
                        <img src={s.photo_url} alt={s.full_name} className="h-10 w-10 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                          {s.full_name.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div className="font-medium">{s.full_name}</div>
                        {s.blood_group && <div className="text-xs text-muted-foreground">Blood: {s.blood_group}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono">{s.id_number}</td>
                  <td className="px-4 py-3">{s.designation}</td>
                  <td className="px-4 py-3">{s.active_from ?? "—"}</td>
                  <td className="px-4 py-3">{s.expires_on ?? "—"}</td>
                  <td className="px-4 py-3">
                    {s.job_status === "active" && !isExpired(s) ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                        <BadgeCheck className="h-3 w-3" /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300">
                        <UserX className="h-3 w-3" /> {isExpired(s) ? "Expired" : "Inactive"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button
                        title="Download QR code"
                        onClick={() => downloadQR(s)}
                        disabled={qrBusy === s.id}
                        className="rounded p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        {qrBusy === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
                      </button>
                      <a
                        title="Open public verification page"
                        href={verificationUrl(s.id_number)}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                      <button
                        title="Edit"
                        onClick={() => openEdit(s)}
                        className="rounded p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        title="Delete"
                        onClick={() => setDeleteTarget(s)}
                        className="rounded p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
          <div className="mt-8 w-full max-w-2xl rounded-lg bg-background p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold">{editing ? "Edit Employee" : "Add Employee"}</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass}>ID Number *</label>
                <input
                  className={`${inputClass} font-mono`}
                  value={form.id_number}
                  onChange={(e) => setForm((f) => ({ ...f, id_number: e.target.value }))}
                  placeholder="e.g. 50MM-EMP-0001"
                />
              </div>
              <div>
                <label className={labelClass}>Full Name *</label>
                <input
                  className={inputClass}
                  value={form.full_name}
                  onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelClass}>Designation</label>
                <input
                  className={inputClass}
                  value={form.designation}
                  onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))}
                  placeholder="e.g. Office Manager"
                />
              </div>
              <div>
                <label className={labelClass}>Blood Group</label>
                <select
                  className={inputClass}
                  value={form.blood_group}
                  onChange={(e) => setForm((f) => ({ ...f, blood_group: e.target.value }))}
                >
                  {BLOOD_GROUPS.map((bg) => (
                    <option key={bg || "none"} value={bg}>{bg || "— not set —"}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Active From</label>
                <input
                  type="date"
                  className={inputClass}
                  value={form.active_from}
                  onChange={(e) => setForm((f) => ({ ...f, active_from: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelClass}>Expiry</label>
                <input
                  type="date"
                  className={inputClass}
                  value={form.expires_on}
                  onChange={(e) => setForm((f) => ({ ...f, expires_on: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelClass}>Job Status</label>
                <select
                  className={inputClass}
                  value={form.job_status}
                  onChange={(e) => setForm((f) => ({ ...f, job_status: e.target.value as "active" | "inactive" }))}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Photo</label>
                <div className="flex items-center gap-3">
                  {form.photo_url && (
                    <img src={form.photo_url} alt="" className="h-10 w-10 rounded-full object-cover" />
                  )}
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted">
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    {form.photo_url ? "Replace photo" : "Upload photo"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={uploading}
                      onChange={(e) => handlePhoto(e.target.files?.[0] ?? null)}
                    />
                  </label>
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass}>About the Staff (short brief)</label>
                <textarea
                  className={`${inputClass} min-h-[90px]`}
                  value={form.about}
                  onChange={(e) => setForm((f) => ({ ...f, about: e.target.value }))}
                  placeholder="A short public bio shown on the verification page."
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setFormOpen(false)}
                className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving || uploading}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editing ? "Save changes" : "Add employee"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
        title="Delete this staff record?"
        description={deleteTarget ? `${deleteTarget.full_name} (${deleteTarget.id_number}) will no longer verify publicly. This cannot be undone.` : undefined}
        confirmLabel="Delete"
        variant="destructive"
        loading={deleting}
        onConfirm={remove}
      />
    </div>
  );
}
