import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { Plus, Pencil, Trash2, Save, XCircle, Loader2, Award, Shield, Eye, EyeOff, GripVertical } from "lucide-react";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { useConfirmAction } from "@/hooks/admin/useConfirmAction";
import { invalidateBadgeDefs } from "@/hooks/profile/useBadgeDefinitions";
import { invalidateRoleDefs } from "@/hooks/profile/useRoleDefinitions";

const ICON_OPTIONS = ["⭐", "✓", "🔥", "🛡", "🚀", "💎", "🏆", "👑", "🎯", "💫", "🌟", "⚡", "🎖", "📷", "🎓", "⚖", "✎", "🎨", "🎵", "❤️", "👤", "🎁", "🔰", "🏅", "🌈", "✨", "🔱", "🦅"];

const COLOR_PRESETS = [
  { name: "Amber", badge: "bg-amber-500/15 text-amber-600 border-amber-500/30", ribbon: "bg-gradient-to-r from-amber-500 to-yellow-400 text-white shadow-amber-500/30", dot: "#f59e0b" },
  { name: "Blue", badge: "bg-blue-500/15 text-blue-600 border-blue-500/30", ribbon: "bg-gradient-to-r from-blue-500 to-cyan-400 text-white shadow-blue-500/30", dot: "#3b82f6" },
  { name: "Pink", badge: "bg-pink-500/15 text-pink-600 border-pink-500/30", ribbon: "bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-pink-500/30", dot: "#ec4899" },
  { name: "Emerald", badge: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30", ribbon: "bg-gradient-to-r from-emerald-500 to-green-400 text-white shadow-emerald-500/30", dot: "#10b981" },
  { name: "Violet", badge: "bg-violet-500/15 text-violet-600 border-violet-500/30", ribbon: "bg-gradient-to-r from-violet-500 to-purple-400 text-white shadow-violet-500/30", dot: "#8b5cf6" },
  { name: "Red", badge: "bg-red-500/15 text-red-600 border-red-500/30", ribbon: "bg-gradient-to-r from-red-500 to-rose-500 text-white shadow-red-500/30", dot: "#ef4444" },
  { name: "Indigo", badge: "bg-indigo-500/15 text-indigo-600 border-indigo-500/30", ribbon: "bg-gradient-to-r from-indigo-500 to-blue-400 text-white shadow-indigo-500/30", dot: "#6366f1" },
  { name: "Sky", badge: "bg-sky-500/15 text-sky-600 border-sky-500/30", ribbon: "bg-gradient-to-r from-sky-500 to-cyan-400 text-white shadow-sky-500/30", dot: "#0ea5e9" },
  { name: "Orange", badge: "bg-orange-500/15 text-orange-600 border-orange-500/30", ribbon: "bg-gradient-to-r from-orange-500 to-amber-400 text-white shadow-orange-500/30", dot: "#f97316" },
  { name: "Teal", badge: "bg-teal-500/15 text-teal-600 border-teal-500/30", ribbon: "bg-gradient-to-r from-teal-500 to-emerald-400 text-white shadow-teal-500/30", dot: "#14b8a6" },
];

interface BadgeDef {
  id: string;
  type_key: string;
  label: string;
  icon: string;
  badge_class: string;
  ribbon_class: string;
  sort_order: number;
  is_active: boolean;
}

interface RoleDef {
  id: string;
  role_key: string;
  label: string;
  icon: string;
  pill_class: string;
  show_inline: boolean;
  sort_order: number;
}

const AdminBadgeRoleDefinitions = () => {
  const [tab, setTab] = useState<"badges" | "roles">("badges");
  const [badges, setBadges] = useState<BadgeDef[]>([]);
  const [roles, setRoles] = useState<RoleDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Edit state for badges
  const [editBadge, setEditBadge] = useState<BadgeDef | null>(null);
  const [newBadge, setNewBadge] = useState(false);
  const [badgeForm, setBadgeForm] = useState({ type_key: "", label: "", icon: "⭐", badge_class: COLOR_PRESETS[0].badge, ribbon_class: COLOR_PRESETS[0].ribbon });

  // Edit state for roles
  const [editRole, setEditRole] = useState<RoleDef | null>(null);
  const [newRole, setNewRole] = useState(false);
  const [roleForm, setRoleForm] = useState({ role_key: "", label: "", icon: "", pill_class: COLOR_PRESETS[0].badge, show_inline: true });
  const { confirm: confirmAction, dialogProps } = useConfirmAction();

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    const [badgeRes, roleRes] = await Promise.all([
      supabase.from("badge_definitions").select("*").order("sort_order"),
      supabase.from("role_display_config").select("*").order("sort_order"),
    ]);
    setBadges((badgeRes.data as any[]) || []);
    setRoles((roleRes.data as any[]) || []);
    setLoading(false);
  };

  // ---- Badge CRUD ----
  const saveBadge = async () => {
    if (!badgeForm.type_key.trim() || !badgeForm.label.trim()) {
      toast({ title: "Name and key are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    let updated = false;
    if (editBadge) {
      const { error } = await supabase.from("badge_definitions").update({
        label: badgeForm.label.trim(),
        icon: badgeForm.icon,
        badge_class: badgeForm.badge_class,
        ribbon_class: badgeForm.ribbon_class,
      }).eq("id", editBadge.id);
      if (error) toast({ title: "Update failed", description: error.message, variant: "destructive" });
      else {
        updated = true;
        toast({ title: `Badge "${badgeForm.label}" updated` });
      }
    } else {
      const { error } = await supabase.from("badge_definitions").insert({
        type_key: badgeForm.type_key.trim().toLowerCase().replace(/\s+/g, "_"),
        label: badgeForm.label.trim(),
        icon: badgeForm.icon,
        badge_class: badgeForm.badge_class,
        ribbon_class: badgeForm.ribbon_class,
        sort_order: badges.length + 1,
      });
      if (error) {
        if (error.code === "23505") toast({ title: "A badge with this key already exists", variant: "destructive" });
        else toast({ title: "Create failed", description: error.message, variant: "destructive" });
      } else {
        updated = true;
        toast({ title: `Badge "${badgeForm.label}" created` });
      }
    }
    if (updated) invalidateBadgeDefs();
    setEditBadge(null);
    setNewBadge(false);
    await fetchAll();
    setSaving(false);
  };

  const deleteBadge = async (b: BadgeDef) => {
    confirmAction({
      title: `Delete badge "${b.label}"?`,
      description: "This won't remove it from users who already have it.",
      onConfirm: async () => {
        const { error } = await supabase.from("badge_definitions").delete().eq("id", b.id);
        if (error) toast({ title: "Delete failed", variant: "destructive" });
        else {
          invalidateBadgeDefs();
          toast({ title: "Badge deleted" });
          fetchAll();
        }
      },
    });
  };

  const toggleBadgeActive = async (b: BadgeDef) => {
    const { error } = await supabase.from("badge_definitions").update({ is_active: !b.is_active }).eq("id", b.id);
    if (!error) invalidateBadgeDefs();
    fetchAll();
  };

  // ---- Role CRUD ----
  const saveRole = async () => {
    if (!roleForm.role_key.trim() || !roleForm.label.trim()) {
      toast({ title: "Name and key are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    let updated = false;
    if (editRole) {
      const { error } = await supabase.from("role_display_config").update({
        label: roleForm.label.trim(),
        icon: roleForm.icon,
        pill_class: roleForm.pill_class,
        show_inline: roleForm.show_inline,
      }).eq("id", editRole.id);
      if (error) toast({ title: "Update failed", description: error.message, variant: "destructive" });
      else {
        updated = true;
        toast({ title: `Role "${roleForm.label}" updated` });
      }
    } else {
      const { error } = await supabase.from("role_display_config").insert({
        role_key: roleForm.role_key.trim().toLowerCase().replace(/\s+/g, "_"),
        label: roleForm.label.trim(),
        icon: roleForm.icon,
        pill_class: roleForm.pill_class,
        show_inline: roleForm.show_inline,
        sort_order: roles.length + 1,
      });
      if (error) {
        if (error.code === "23505") toast({ title: "A role with this key already exists", variant: "destructive" });
        else toast({ title: "Create failed", description: error.message, variant: "destructive" });
      } else {
        updated = true;
        toast({ title: `Role "${roleForm.label}" created` });
      }
    }
    if (updated) invalidateRoleDefs();
    setEditRole(null);
    setNewRole(false);
    await fetchAll();
    setSaving(false);
  };

  const deleteRole = async (r: RoleDef) => {
    confirmAction({
      title: `Delete role display "${r.label}"?`,
      onConfirm: async () => {
        const { error } = await supabase.from("role_display_config").delete().eq("id", r.id);
        if (error) toast({ title: "Delete failed", variant: "destructive" });
        else {
          invalidateRoleDefs();
          toast({ title: "Role config deleted" });
          fetchAll();
        }
      },
    });
  };

  const startEditBadge = (b: BadgeDef) => {
    setEditBadge(b);
    setNewBadge(false);
    setBadgeForm({ type_key: b.type_key, label: b.label, icon: b.icon, badge_class: b.badge_class, ribbon_class: b.ribbon_class });
  };

  const startNewBadge = () => {
    setEditBadge(null);
    setNewBadge(true);
    setBadgeForm({ type_key: "", label: "", icon: "⭐", badge_class: COLOR_PRESETS[0].badge, ribbon_class: COLOR_PRESETS[0].ribbon });
  };

  const startEditRole = (r: RoleDef) => {
    setEditRole(r);
    setNewRole(false);
    setRoleForm({ role_key: r.role_key, label: r.label, icon: r.icon, pill_class: r.pill_class, show_inline: r.show_inline });
  };

  const startNewRole = () => {
    setEditRole(null);
    setNewRole(true);
    setRoleForm({ role_key: "", label: "", icon: "", pill_class: COLOR_PRESETS[0].badge, show_inline: true });
  };

  const cancelForm = () => {
    setEditBadge(null);
    setNewBadge(false);
    setEditRole(null);
    setNewRole(false);
  };

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      {/* Tab Switcher */}
      <div className="flex items-center gap-1 border border-border rounded-sm overflow-hidden w-fit">
        <button
          onClick={() => { setTab("badges"); cancelForm(); }}
          className={`px-4 py-2 text-[10px] tracking-[0.15em] uppercase flex items-center gap-1.5 transition-colors ${
            tab === "badges" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
          style={{ fontFamily: "var(--font-heading)" }}
        >
          <Award className="h-3.5 w-3.5" /> Badge Types
        </button>
        <button
          onClick={() => { setTab("roles"); cancelForm(); }}
          className={`px-4 py-2 text-[10px] tracking-[0.15em] uppercase flex items-center gap-1.5 transition-colors ${
            tab === "roles" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
          style={{ fontFamily: "var(--font-heading)" }}
        >
          <Shield className="h-3.5 w-3.5" /> Role Types
        </button>
      </div>

      {/* ========== BADGES TAB ========== */}
      {tab === "badges" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
              {badges.length} badge type{badges.length !== 1 ? "s" : ""}
            </span>
            <button onClick={startNewBadge}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] tracking-wider uppercase bg-primary text-primary-foreground hover:opacity-90 rounded-sm"
              style={{ fontFamily: "var(--font-heading)" }}>
              <Plus className="h-3 w-3" /> Add Badge
            </button>
          </div>

          {/* Badge Form (New / Edit) */}
          {(newBadge || editBadge) && (
            <div className="border border-primary/30 bg-primary/5 p-4 rounded-sm space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] tracking-[0.2em] uppercase text-primary font-medium" style={{ fontFamily: "var(--font-heading)" }}>
                  {editBadge ? `Edit: ${editBadge.label}` : "New Badge Type"}
                </span>
                <button onClick={cancelForm} className="text-muted-foreground hover:text-foreground"><XCircle className="h-4 w-4" /></button>
              </div>

              {/* Key + Label */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[9px] tracking-wider uppercase text-muted-foreground mb-1 block" style={{ fontFamily: "var(--font-heading)" }}>
                    Key (unique identifier)
                  </label>
                  <input
                    value={badgeForm.type_key}
                    onChange={(e) => setBadgeForm({ ...badgeForm, type_key: e.target.value })}
                    disabled={!!editBadge}
                    placeholder="e.g. featured_creator"
                    className="w-full bg-transparent border border-border rounded-sm px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="text-[9px] tracking-wider uppercase text-muted-foreground mb-1 block" style={{ fontFamily: "var(--font-heading)" }}>
                    Display Name
                  </label>
                  <input
                    value={badgeForm.label}
                    onChange={(e) => setBadgeForm({ ...badgeForm, label: e.target.value })}
                    placeholder="e.g. Featured Creator"
                    className="w-full bg-transparent border border-border rounded-sm px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </div>
              </div>

              {/* Icon Picker */}
              <div>
                <label className="text-[9px] tracking-wider uppercase text-muted-foreground mb-1.5 block" style={{ fontFamily: "var(--font-heading)" }}>
                  Choose Icon
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {ICON_OPTIONS.map((ico) => (
                    <button
                      key={ico}
                      onClick={() => setBadgeForm({ ...badgeForm, icon: ico })}
                      className={`w-8 h-8 flex items-center justify-center text-base rounded-sm border transition-all ${
                        badgeForm.icon === ico ? "border-primary bg-primary/10 scale-110" : "border-border hover:border-primary/50"
                      }`}
                    >
                      {ico}
                    </button>
                  ))}
                </div>
              </div>

              {/* Color Picker */}
              <div>
                <label className="text-[9px] tracking-wider uppercase text-muted-foreground mb-1.5 block" style={{ fontFamily: "var(--font-heading)" }}>
                  Choose Color
                </label>
                <div className="flex flex-wrap gap-2">
                  {COLOR_PRESETS.map((c) => (
                    <button
                      key={c.name}
                      onClick={() => setBadgeForm({ ...badgeForm, badge_class: c.badge, ribbon_class: c.ribbon })}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[9px] uppercase tracking-wider border rounded-sm transition-all ${
                        badgeForm.badge_class === c.badge ? "ring-2 ring-primary ring-offset-1" : "hover:opacity-80"
                      }`}
                    >
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: c.dot }} />
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Preview */}
              <div className="flex items-center gap-3">
                <span className="text-[9px] tracking-wider uppercase text-muted-foreground shrink-0" style={{ fontFamily: "var(--font-heading)" }}>Preview:</span>
                <span className={`inline-flex items-center gap-0.5 text-[8px] px-1.5 py-0.5 tracking-[0.06em] uppercase font-semibold rounded-sm border shrink-0 leading-none ${badgeForm.badge_class}`}>
                  <span className="text-[8px]">{badgeForm.icon}</span>
                  {badgeForm.label || "Badge"}
                </span>
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-[9px] font-semibold rounded-sm shadow-sm ${badgeForm.ribbon_class}`}>
                  {badgeForm.icon} {badgeForm.label || "Badge"}
                </span>
              </div>

              <button onClick={saveBadge} disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 text-[10px] tracking-wider uppercase bg-primary text-primary-foreground hover:opacity-90 rounded-sm disabled:opacity-50"
                style={{ fontFamily: "var(--font-heading)" }}>
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                {editBadge ? "Update Badge" : "Create Badge"}
              </button>
            </div>
          )}

          {/* Badge List */}
          <div className="border border-border rounded-sm overflow-hidden divide-y divide-border">
            {badges.map((b) => (
              <div key={b.id} className={`flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 transition-colors ${!b.is_active ? "opacity-50" : ""}`}>
                <span className="text-lg shrink-0">{b.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-0.5 text-[8px] px-1.5 py-0.5 tracking-[0.06em] uppercase font-semibold rounded-sm border leading-none ${b.badge_class}`}>
                      {b.icon} {b.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono">{b.type_key}</span>
                  </div>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button onClick={() => toggleBadgeActive(b)} className="p-1.5 hover:text-primary transition-colors rounded-sm hover:bg-primary/10" title={b.is_active ? "Deactivate" : "Activate"}>
                    {b.is_active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </button>
                  <button onClick={() => startEditBadge(b)} className="p-1.5 hover:text-primary transition-colors rounded-sm hover:bg-primary/10" title="Edit">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => deleteBadge(b)} className="p-1.5 hover:text-destructive transition-colors rounded-sm hover:bg-destructive/10" title="Delete">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
            {badges.length === 0 && (
              <div className="text-center py-8 text-xs text-muted-foreground">No badge types defined yet.</div>
            )}
          </div>
        </div>
      )}

      {/* ========== ROLES TAB ========== */}
      {tab === "roles" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
              {roles.length} role type{roles.length !== 1 ? "s" : ""}
            </span>
            <button onClick={startNewRole}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] tracking-wider uppercase bg-primary text-primary-foreground hover:opacity-90 rounded-sm"
              style={{ fontFamily: "var(--font-heading)" }}>
              <Plus className="h-3 w-3" /> Add Role
            </button>
          </div>

          {/* Role Form (New / Edit) */}
          {(newRole || editRole) && (
            <div className="border border-primary/30 bg-primary/5 p-4 rounded-sm space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] tracking-[0.2em] uppercase text-primary font-medium" style={{ fontFamily: "var(--font-heading)" }}>
                  {editRole ? `Edit: ${editRole.label}` : "New Role Type"}
                </span>
                <button onClick={cancelForm} className="text-muted-foreground hover:text-foreground"><XCircle className="h-4 w-4" /></button>
              </div>

              {/* Key + Label */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[9px] tracking-wider uppercase text-muted-foreground mb-1 block" style={{ fontFamily: "var(--font-heading)" }}>
                    Key (unique identifier)
                  </label>
                  <input
                    value={roleForm.role_key}
                    onChange={(e) => setRoleForm({ ...roleForm, role_key: e.target.value })}
                    disabled={!!editRole}
                    placeholder="e.g. moderator"
                    className="w-full bg-transparent border border-border rounded-sm px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="text-[9px] tracking-wider uppercase text-muted-foreground mb-1 block" style={{ fontFamily: "var(--font-heading)" }}>
                    Display Name
                  </label>
                  <input
                    value={roleForm.label}
                    onChange={(e) => setRoleForm({ ...roleForm, label: e.target.value })}
                    placeholder="e.g. Moderator"
                    className="w-full bg-transparent border border-border rounded-sm px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </div>
              </div>

              {/* Icon Picker */}
              <div>
                <label className="text-[9px] tracking-wider uppercase text-muted-foreground mb-1.5 block" style={{ fontFamily: "var(--font-heading)" }}>
                  Choose Icon
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {ICON_OPTIONS.map((ico) => (
                    <button
                      key={ico}
                      onClick={() => setRoleForm({ ...roleForm, icon: ico })}
                      className={`w-8 h-8 flex items-center justify-center text-base rounded-sm border transition-all ${
                        roleForm.icon === ico ? "border-primary bg-primary/10 scale-110" : "border-border hover:border-primary/50"
                      }`}
                    >
                      {ico}
                    </button>
                  ))}
                </div>
              </div>

              {/* Color Picker */}
              <div>
                <label className="text-[9px] tracking-wider uppercase text-muted-foreground mb-1.5 block" style={{ fontFamily: "var(--font-heading)" }}>
                  Choose Color
                </label>
                <div className="flex flex-wrap gap-2">
                  {COLOR_PRESETS.map((c) => (
                    <button
                      key={c.name}
                      onClick={() => setRoleForm({ ...roleForm, pill_class: c.badge })}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[9px] uppercase tracking-wider border rounded-sm transition-all ${
                        roleForm.pill_class === c.badge ? "ring-2 ring-primary ring-offset-1" : "hover:opacity-80"
                      }`}
                    >
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: c.dot }} />
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Show Inline Toggle */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={roleForm.show_inline}
                  onChange={(e) => setRoleForm({ ...roleForm, show_inline: e.target.checked })}
                  className="accent-primary"
                />
                <span className="text-xs text-foreground">Show inline next to username</span>
              </label>

              {/* Preview */}
              <div className="flex items-center gap-3">
                <span className="text-[9px] tracking-wider uppercase text-muted-foreground shrink-0" style={{ fontFamily: "var(--font-heading)" }}>Preview:</span>
                <span className={`inline-flex items-center gap-0.5 text-[8px] px-1.5 py-0.5 tracking-[0.06em] uppercase font-semibold rounded-sm border shrink-0 leading-none ${roleForm.pill_class}`}>
                  {roleForm.icon && <span className="text-[8px]">{roleForm.icon}</span>}
                  {roleForm.label || "Role"}
                </span>
              </div>

              <button onClick={saveRole} disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 text-[10px] tracking-wider uppercase bg-primary text-primary-foreground hover:opacity-90 rounded-sm disabled:opacity-50"
                style={{ fontFamily: "var(--font-heading)" }}>
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                {editRole ? "Update Role" : "Create Role"}
              </button>
            </div>
          )}

          {/* Role List */}
          <div className="border border-border rounded-sm overflow-hidden divide-y divide-border">
            {roles.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 transition-colors">
                <span className="text-lg shrink-0">{r.icon || "👤"}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-0.5 text-[8px] px-1.5 py-0.5 tracking-[0.06em] uppercase font-semibold rounded-sm border leading-none ${r.pill_class}`}>
                      {r.icon && <span className="text-[8px]">{r.icon}</span>}
                      {r.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono">{r.role_key}</span>
                    {!r.show_inline && <span className="text-[8px] text-muted-foreground italic">hidden</span>}
                  </div>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button onClick={() => startEditRole(r)} className="p-1.5 hover:text-primary transition-colors rounded-sm hover:bg-primary/10" title="Edit">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => deleteRole(r)} className="p-1.5 hover:text-destructive transition-colors rounded-sm hover:bg-destructive/10" title="Delete">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
            {roles.length === 0 && (
              <div className="text-center py-8 text-xs text-muted-foreground">No role types defined yet.</div>
            )}
          </div>
        </div>
      )}
      <ConfirmDialog {...dialogProps} />
    </div>
  );
};

export default AdminBadgeRoleDefinitions;
