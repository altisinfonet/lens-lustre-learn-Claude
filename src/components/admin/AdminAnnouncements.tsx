import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { Plus, Trash2, Eye, EyeOff, GripVertical, Pencil, XCircle } from "lucide-react";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { useConfirmAction } from "@/hooks/admin/useConfirmAction";
import { Switch } from "@/components/ui/switch";
import { User } from "@supabase/supabase-js";

interface Announcement {
  id: string;
  message: string;
  link_url: string;
  link_text: string;
  bg_color: string;
  text_color: string;
  is_active: boolean;
  is_dismissible: boolean;
  priority: number;
  starts_at: string;
  expires_at: string;
}

const defaultAnnouncement: Omit<Announcement, "id"> = {
  message: "",
  link_url: "",
  link_text: "Learn More",
  bg_color: "hsl(var(--primary))",
  text_color: "hsl(var(--primary-foreground))",
  is_active: true,
  is_dismissible: true,
  priority: 0,
  starts_at: "",
  expires_at: "",
};

const AdminAnnouncements = ({ user }: { user: User | null }) => {
  const qc = useQueryClient();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { confirm: confirmAction, dialogProps } = useConfirmAction();
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [showForm, setShowForm] = useState(false);

  const fetchAnnouncements = async () => {
    const { data } = await supabase
      .from("site_settings")
      .select("value")
      .eq("key", "announcements")
      .maybeSingle();
    if (data?.value && Array.isArray(data.value)) {
      setAnnouncements(data.value as unknown as Announcement[]);
    }
    setLoading(false);
  };

  useEffect(() => { fetchAnnouncements(); }, []);

  const persist = async (items: Announcement[]) => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from("site_settings").upsert(
      { key: "announcements", value: items as any, updated_at: new Date().toISOString(), updated_by: user.id },
      { onConflict: "key" }
    );
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      setAnnouncements(items);
      qc.setQueryData(["site-setting", "announcements"], items);
      qc.invalidateQueries({ queryKey: ["dashboard-init"] });
      toast({ title: "Announcements saved" });
    }
  };

  const openNew = () => {
    setEditing({ ...defaultAnnouncement, id: crypto.randomUUID() } as Announcement);
    setShowForm(true);
  };

  const openEdit = (a: Announcement) => {
    setEditing({ ...a });
    setShowForm(true);
  };

  const handleSave = () => {
    if (!editing || !editing.message.trim()) {
      toast({ title: "Message is required", variant: "destructive" });
      return;
    }
    const exists = announcements.find((a) => a.id === editing.id);
    const updated = exists
      ? announcements.map((a) => (a.id === editing.id ? editing : a))
      : [...announcements, editing];
    persist(updated);
    setShowForm(false);
    setEditing(null);
  };

  const handleDelete = (id: string) => {
    confirmAction({
      title: "Delete this announcement?",
      onConfirm: () => persist(announcements.filter((a) => a.id !== id)),
    });
  };

  const toggleActive = (id: string) => {
    persist(announcements.map((a) => (a.id === id ? { ...a, is_active: !a.is_active } : a)));
  };

  if (loading) return <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-light" style={{ fontFamily: "var(--font-display)" }}>
            Announcement <em className="italic text-primary">Bars</em>
          </h2>
          <p className="text-xs text-muted-foreground mt-1">Site-wide banners visible to all visitors</p>
        </div>
        <button
          onClick={openNew}
          className="inline-flex items-center gap-2 text-xs tracking-[0.15em] uppercase px-5 py-2.5 bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          <Plus className="h-3.5 w-3.5" /> New Announcement
        </button>
      </div>

      {/* Editor */}
      {showForm && editing && (
        <div className="border border-border p-6 space-y-5">
          <div className="flex items-center justify-between">
            <span className="text-xs tracking-[0.2em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>
              {announcements.find((a) => a.id === editing.id) ? "Edit" : "New"} Announcement
            </span>
            <button onClick={() => { setShowForm(false); setEditing(null); }} className="text-muted-foreground hover:text-foreground">
              <XCircle className="h-4 w-4" />
            </button>
          </div>

          <div>
            <label className="block text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2" style={{ fontFamily: "var(--font-heading)" }}>Message *</label>
            <textarea
              value={editing.message}
              onChange={(e) => setEditing({ ...editing, message: e.target.value })}
              rows={2}
              className="w-full bg-transparent border border-border focus:border-primary outline-none p-3 text-sm resize-none"
              placeholder="🎉 New competition is live! Submit your best shots now."
            />
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            <div>
              <label className="block text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2" style={{ fontFamily: "var(--font-heading)" }}>Link URL</label>
              <input value={editing.link_url} onChange={(e) => setEditing({ ...editing, link_url: e.target.value })} className="w-full bg-transparent border-b border-border focus:border-primary outline-none py-2 text-sm" placeholder="https://..." />
            </div>
            <div>
              <label className="block text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2" style={{ fontFamily: "var(--font-heading)" }}>Link Text</label>
              <input value={editing.link_text} onChange={(e) => setEditing({ ...editing, link_text: e.target.value })} className="w-full bg-transparent border-b border-border focus:border-primary outline-none py-2 text-sm" placeholder="Learn More" />
            </div>
            <div>
              <label className="block text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2" style={{ fontFamily: "var(--font-heading)" }}>Background Color</label>
              <div className="flex items-center gap-3">
                <input type="color" value={editing.bg_color.startsWith("#") ? editing.bg_color : "#6366f1"} onChange={(e) => setEditing({ ...editing, bg_color: e.target.value })} className="h-8 w-8 border-0 cursor-pointer" />
                <input value={editing.bg_color} onChange={(e) => setEditing({ ...editing, bg_color: e.target.value })} className="flex-1 bg-transparent border-b border-border focus:border-primary outline-none py-2 text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2" style={{ fontFamily: "var(--font-heading)" }}>Text Color</label>
              <div className="flex items-center gap-3">
                <input type="color" value={editing.text_color.startsWith("#") ? editing.text_color : "#ffffff"} onChange={(e) => setEditing({ ...editing, text_color: e.target.value })} className="h-8 w-8 border-0 cursor-pointer" />
                <input value={editing.text_color} onChange={(e) => setEditing({ ...editing, text_color: e.target.value })} className="flex-1 bg-transparent border-b border-border focus:border-primary outline-none py-2 text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2" style={{ fontFamily: "var(--font-heading)" }}>Starts At</label>
              <input type="datetime-local" value={editing.starts_at} onChange={(e) => setEditing({ ...editing, starts_at: e.target.value })} className="w-full bg-transparent border-b border-border focus:border-primary outline-none py-2 text-sm" />
            </div>
            <div>
              <label className="block text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2" style={{ fontFamily: "var(--font-heading)" }}>Expires At</label>
              <input type="datetime-local" value={editing.expires_at} onChange={(e) => setEditing({ ...editing, expires_at: e.target.value })} className="w-full bg-transparent border-b border-border focus:border-primary outline-none py-2 text-sm" />
            </div>
          </div>

          <div className="flex items-center gap-8">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={editing.is_active} onCheckedChange={(v) => setEditing({ ...editing, is_active: v })} />
              Active
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={editing.is_dismissible} onCheckedChange={(v) => setEditing({ ...editing, is_dismissible: v })} />
              Dismissible
            </label>
            <div className="flex items-center gap-2">
              <label className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>Priority</label>
              <input type="number" value={editing.priority} onChange={(e) => setEditing({ ...editing, priority: parseInt(e.target.value) || 0 })} className="w-16 bg-transparent border-b border-border focus:border-primary outline-none py-1 text-sm text-center" />
            </div>
          </div>

          {/* Preview */}
          <div>
            <label className="block text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2" style={{ fontFamily: "var(--font-heading)" }}>Preview</label>
            <div className="rounded px-4 py-2.5 text-sm flex items-center justify-center gap-3" style={{ backgroundColor: editing.bg_color, color: editing.text_color }}>
              <span>{editing.message || "Your announcement here…"}</span>
              {editing.link_url && <a href="#" className="underline font-medium" style={{ color: editing.text_color }}>{editing.link_text || "Learn More"}</a>}
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="text-xs tracking-[0.15em] uppercase px-6 py-2.5 bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {saving ? "Saving…" : "Save Announcement"}
          </button>
        </div>
      )}

      {/* List */}
      {announcements.length === 0 && !showForm && (
        <p className="text-sm text-muted-foreground py-12 text-center">No announcements yet. Create one to display a site-wide banner.</p>
      )}

      <div className="space-y-2">
        {announcements
          .sort((a, b) => a.priority - b.priority)
          .map((a) => (
            <div key={a.id} className="border border-border p-4 flex items-center gap-4">
              <div className="w-3 h-8 rounded-sm" style={{ backgroundColor: a.bg_color }} />
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{a.message}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Priority: {a.priority} · {a.is_dismissible ? "Dismissible" : "Persistent"}
                  {a.expires_at && ` · Expires: ${new Date(a.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
                </p>
              </div>
              <button onClick={() => toggleActive(a.id)} className="text-muted-foreground hover:text-foreground" title={a.is_active ? "Deactivate" : "Activate"}>
                {a.is_active ? <Eye className="h-4 w-4 text-green-500" /> : <EyeOff className="h-4 w-4" />}
              </button>
              <button onClick={() => openEdit(a)} className="text-muted-foreground hover:text-foreground"><Pencil className="h-4 w-4" /></button>
              <button onClick={() => handleDelete(a.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
      </div>
    <ConfirmDialog {...dialogProps} />
  </div>
  );
};

export default AdminAnnouncements;
