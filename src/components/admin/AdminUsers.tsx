import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { useConfirmAction } from "@/hooks/admin/useConfirmAction";
import { Search, Ban, ShieldCheck, Trash2, Pencil, XCircle, Loader2, Mail, User, Calendar, Shield, Plus, X, CheckSquare, Square, Award, ExternalLink, Palette, Smile } from "lucide-react";
import type { User as AuthUser } from "@supabase/supabase-js";
import { useBadgeDefinitions, type BadgeDefinition } from "@/hooks/profile/useBadgeDefinitions";
import { useRoleDefinitions, type RoleDefinition } from "@/hooks/profile/useRoleDefinitions";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { invalidateRoleCache } from "@/components/AutoRole";

const ROLE_LABELS: Record<string, string> = {
  user: "User",
  admin: "Admin",
  judge: "Jury",
  content_editor: "Contributor",
  registered_photographer: "Photographer",
  student: "Student",
};

interface UserRow {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  is_suspended: boolean;
  suspended_until: string | null;
  suspension_reason: string | null;
  created_at: string;
  roles: string[];
  badges: string[];
}

type UserSearchMode = "name" | "email";

interface ActiveUserQuery {
  query: string;
  by: UserSearchMode;
  badge: string;
  role: string;
}

const AdminUsers = ({ user }: { user: AuthUser | null }) => {
  const queryClient = useQueryClient();
  const badgeDefs = useBadgeDefinitions();
  const roleDefs = useRoleDefinitions();

  // Derive dynamic lists from DB definitions
  const badgeTypes = Array.from(badgeDefs.keys());
  const roleTypes = Array.from(roleDefs.keys());
  // Merge DB role keys with hardcoded system roles to ensure all appear
  const ALL_ROLES_SET = new Set([...roleTypes, "user", "admin", "judge", "content_editor", "registered_photographer", "student"]);
  const ALL_ROLES = Array.from(ALL_ROLES_SET);

  const [users, setUsers] = useState<UserRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchBy, setSearchBy] = useState<UserSearchMode>("email");
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [suspendTarget, setSuspendTarget] = useState<UserRow | null>(null);
  const [suspendType, setSuspendType] = useState<"permanent" | "temporary">("temporary");
  const [suspendDays, setSuspendDays] = useState("7");
  const [suspendReason, setSuspendReason] = useState("");

  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editBio, setEditBio] = useState("");
  const [roleTarget, setRoleTarget] = useState<UserRow | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRole, setBulkRole] = useState("");
  const { confirm: confirmAction, dialogProps } = useConfirmAction();
  const [bulkLoading, setBulkLoading] = useState(false);
  const [badgeTarget, setBadgeTarget] = useState<UserRow | null>(null);
  const [badgeFilter, setBadgeFilter] = useState<string>("");
  const [roleFilter, setRoleFilter] = useState<string>("");
  const activeQueryRef = useRef<ActiveUserQuery | null>(null);
  const fetchUsersRef = useRef<((query?: string, by?: UserSearchMode, badge?: string, role?: string, options?: { silent?: boolean }) => Promise<void>) | null>(null);

  const getRoleLabel = (r: string) => {
    const def = roleDefs.get(r);
    if (def) return def.label;
    return ROLE_LABELS[r] || r.replace(/_/g, " ");
  };

  const getRoleIcon = (r: string) => {
    const def = roleDefs.get(r);
    return def?.icon || "";
  };

  const getRolePillClass = (r: string) => {
    const def = roleDefs.get(r);
    if (def) return def.pill_class;
    // Fallback for system roles without DB definition
    if (r === "admin") return "bg-destructive/10 text-destructive border-destructive/30";
    if (r === "judge") return "bg-accent/50 text-accent-foreground border-accent";
    if (r === "content_editor") return "bg-primary/10 text-primary border-primary/30";
    if (r === "registered_photographer") return "bg-secondary text-secondary-foreground border-secondary";
    return "bg-muted text-muted-foreground border-border";
  };

  const getBadgeLabel = (b: string) => {
    const def = badgeDefs.get(b);
    return def?.label || b.replace(/_/g, " ");
  };

  const getBadgeIcon = (b: string) => {
    const def = badgeDefs.get(b);
    return def?.icon || "⭐";
  };

  const getBadgeClass = (b: string) => {
    const def = badgeDefs.get(b);
    return def?.badge_class || "bg-amber-500/15 text-amber-600 border-amber-500/30";
  };

  const getBadgeRibbonClass = (b: string) => {
    const def = badgeDefs.get(b);
    return def?.ribbon_class || "bg-gradient-to-r from-amber-500 to-yellow-400 text-white shadow-amber-500/30";
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAll = () => {
    if (selectedIds.size === users.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(users.map((u) => u.id)));
  };

  const invalidateRoleDerivedCaches = (userId: string) => {
    invalidateRoleCache(userId);
    void queryClient.invalidateQueries({ queryKey: queryKeys.isAdmin(userId) });
    void queryClient.invalidateQueries({ queryKey: ["user-roles", userId] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.profileMapPrefix() });
    void queryClient.invalidateQueries({ queryKey: ["dashboard-init"] });
  };

  const invalidateBadgeDerivedCaches = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.profileMapPrefix() });
    void queryClient.invalidateQueries({ queryKey: ["dashboard-init"] });
  };

  const refreshCurrentUsers = (options: { silent?: boolean } = { silent: true }) => {
    if (!activeQueryRef.current || !fetchUsersRef.current) return;
    const { query, by, badge, role } = activeQueryRef.current;
    void fetchUsersRef.current(query, by, badge, role, options);
  };

  const bulkAssignRole = async () => {
    if (!bulkRole || selectedIds.size === 0) return;
    setBulkLoading(true);
    let success = 0;
    for (const uid of selectedIds) {
      const u = users.find((x) => x.id === uid);
      if (u?.roles.includes(bulkRole)) continue;
      const { error } = await supabase.from("user_roles").insert({ user_id: uid, role: bulkRole as any });
      if (!error) {
        success++;
        invalidateRoleDerivedCaches(uid);
        setUsers((prev) => prev.map((x) => x.id === uid ? { ...x, roles: [...x.roles, bulkRole] } : x));
      }
    }
    refreshCurrentUsers();
    toast({ title: `${getRoleLabel(bulkRole)} assigned to ${success} user(s)` });
    setSelectedIds(new Set());
    setBulkRole("");
    setBulkLoading(false);
  };

  const bulkRemoveRole = async () => {
    if (!bulkRole || bulkRole === "user" || selectedIds.size === 0) return;
    confirmAction({
      title: `Remove "${getRoleLabel(bulkRole)}" from ${selectedIds.size} user(s)?`,
      onConfirm: async () => {
        setBulkLoading(true);
        let success = 0;
        for (const uid of selectedIds) {
          const u = users.find((x) => x.id === uid);
          if (!u?.roles.includes(bulkRole)) continue;
          const { error } = await supabase.from("user_roles").delete().eq("user_id", uid).eq("role", bulkRole as any);
          if (!error) {
            success++;
            invalidateRoleDerivedCaches(uid);
            setUsers((prev) => prev.map((x) => x.id === uid ? { ...x, roles: x.roles.filter((r) => r !== bulkRole) } : x));
          }
        }
        refreshCurrentUsers();
        toast({ title: `${getRoleLabel(bulkRole)} removed from ${success} user(s)` });
        setSelectedIds(new Set());
        setBulkRole("");
        setBulkLoading(false);
      },
    });
  };

  const fetchUsers = async (
    query = "",
    by = searchBy,
    badge = badgeFilter,
    role = roleFilter,
    options: { silent?: boolean } = {},
  ) => {
    const normalizedQuery = query.trim();
    const { silent = false } = options;
    activeQueryRef.current = { query: normalizedQuery, by, badge, role };
    setLoading(true);

    let badgeUserIds: string[] | null = null;
    if (badge) {
      const { data: badgeData } = await supabase
        .from("user_badges")
        .select("user_id")
        .eq("badge_type", badge);
      badgeUserIds = (badgeData as any[])?.map((b: any) => b.user_id) || [];
      if (badgeUserIds.length === 0) {
        setUsers([]);
        if (!silent) toast({ title: `No users found with ${getBadgeLabel(badge)} badge` });
        setLoading(false);
        return;
      }
    }

    let roleUserIds: string[] | null = null;
    if (role) {
      const { data: roleData } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", role as any);
      roleUserIds = (roleData as any[])?.map((r: any) => r.user_id) || [];
      if (roleUserIds.length === 0) {
        setUsers([]);
        if (!silent) toast({ title: `No users found with ${getRoleLabel(role)} role` });
        setLoading(false);
        return;
      }
    }

    const { data, error } = await supabase.rpc("admin_search_users", {
      search_query: normalizedQuery,
      search_by: by,
    });

    if (error) {
      if (!silent) toast({ title: "Search failed", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    if (data && data.length > 0) {
      let filtered = data as any[];
      if (badgeUserIds) {
        const idSet = new Set(badgeUserIds);
        filtered = filtered.filter((u: any) => idSet.has(u.id));
      }
      if (roleUserIds) {
        const idSet = new Set(roleUserIds);
        filtered = filtered.filter((u: any) => idSet.has(u.id));
      }

      if (filtered.length === 0) {
        setUsers([]);
        const filters = [
          badge ? `${getBadgeLabel(badge)} badge` : "",
          role ? `${getRoleLabel(role)} role` : "",
        ].filter(Boolean).join(" & ");
        if (!silent) toast({ title: `No users found${filters ? ` with ${filters}` : ""}` });
        setLoading(false);
        return;
      }

      const userIds = filtered.map((u: any) => u.id);
      const [rolesRes, badgesRes] = await Promise.all([
        supabase.from("user_roles").select("user_id, role").in("user_id", userIds),
        supabase.from("user_badges").select("user_id, badge_type").in("user_id", userIds),
      ]);
      const roleMap = new Map<string, string[]>();
      rolesRes.data?.forEach((r) => {
        const existing = roleMap.get(r.user_id) || [];
        existing.push(r.role);
        roleMap.set(r.user_id, existing);
      });
      const badgeMap = new Map<string, string[]>();
      (badgesRes.data as any[])?.forEach((b: any) => {
        const existing = badgeMap.get(b.user_id) || [];
        existing.push(b.badge_type);
        badgeMap.set(b.user_id, existing);
      });
      setUsers(filtered.map((u: any) => ({ ...u, roles: roleMap.get(u.id) || [], badges: badgeMap.get(u.id) || [] })));
    } else {
      setUsers([]);
      if (normalizedQuery && !silent) toast({ title: "No users found" });
    }
    setLoading(false);
  };

  fetchUsersRef.current = fetchUsers;

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRefresh = () => {
      if (!activeQueryRef.current) return;
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshCurrentUsers({ silent: true });
      }, 150);
    };

    const channel = supabase
      .channel("admin-users-live-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "user_roles" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_badges" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, scheduleRefresh)
      .subscribe();

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, []);

  const suspendUser = async () => {
    if (!suspendTarget) return;
    setActionLoading(suspendTarget.id);
    const update: any = {
      is_suspended: true,
      suspension_reason: suspendReason.trim() || "Suspended by admin",
      suspended_until: suspendType === "permanent" ? null : new Date(Date.now() + parseInt(suspendDays) * 86400000).toISOString(),
    };
    const { error } = await supabase.from("profiles").update(update).eq("id", suspendTarget.id);
    if (error) toast({ title: "Suspend failed", description: error.message, variant: "destructive" });
    else {
      toast({ title: `${suspendTarget.full_name || "User"} suspended` });
      setUsers((prev) => prev.map((u) => (u.id === suspendTarget.id ? { ...u, ...update } : u)));
    }
    setSuspendTarget(null);
    setSuspendReason("");
    setActionLoading(null);
  };

  const revokeSuspension = async (userId: string) => {
    setActionLoading(userId);
    const { error } = await supabase.from("profiles").update({
      is_suspended: false, suspended_until: null, suspension_reason: null,
    }).eq("id", userId);
    if (error) toast({ title: "Revoke failed", variant: "destructive" });
    else {
      toast({ title: "Suspension revoked" });
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, is_suspended: false, suspended_until: null, suspension_reason: null } : u)));
    }
    setActionLoading(null);
  };

  const deleteUser = async (u: UserRow) => {
    confirmAction({
      title: `Permanently delete ${u.full_name || u.email || "this user"}?`,
      description: "This will remove ALL their data and free their email for reuse.",
      onConfirm: async () => {
        setActionLoading(u.id);
        const { data, error } = await supabase.functions.invoke("delete-user", { body: { user_id: u.id } });
        if (error || data?.error) {
          toast({ title: "Delete failed", description: data?.error || error?.message || "Unknown error", variant: "destructive" });
        } else {
          toast({ title: "User permanently deleted", description: "All data removed. Email is now available for new signups." });
          setUsers((prev) => prev.filter((x) => x.id !== u.id));
        }
        setActionLoading(null);
      },
    });
  };

  const saveEdit = async () => {
    if (!editTarget) return;
    setActionLoading(editTarget.id);
    const { error } = await supabase.from("profiles").update({
      full_name: editName.trim() || null,
      bio: editBio.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq("id", editTarget.id);
    if (error) toast({ title: "Update failed", variant: "destructive" });
    else {
      toast({ title: "Profile updated" });
      setUsers((prev) => prev.map((u) => (u.id === editTarget.id ? { ...u, full_name: editName.trim() || null, bio: editBio.trim() || null } : u)));
    }
    setEditTarget(null);
    setActionLoading(null);
  };

  const assignRole = async (userId: string, role: string) => {
    setActionLoading(userId);
    const { error } = await supabase.from("user_roles").insert({ user_id: userId, role: role as any });
    if (error) {
      if (error.code === "23505") toast({ title: "Role already assigned" });
      else toast({ title: "Assign failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `${getRoleLabel(role)} role assigned` });
      invalidateRoleDerivedCaches(userId);
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, roles: [...u.roles, role] } : u));
      refreshCurrentUsers();
    }
    setActionLoading(null);
  };

  const removeRole = async (userId: string, role: string) => {
    if (role === "user") { toast({ title: "Cannot remove base user role" }); return; }
    confirmAction({
      title: `Remove "${getRoleLabel(role)}" role?`,
      onConfirm: async () => {
        setActionLoading(userId);
        const { error } = await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", role as any);
        if (error) toast({ title: "Remove failed", description: error.message, variant: "destructive" });
        else {
          toast({ title: `${getRoleLabel(role)} role removed` });
          invalidateRoleDerivedCaches(userId);
          setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, roles: u.roles.filter((r) => r !== role) } : u));
          refreshCurrentUsers();
        }
        setActionLoading(null);
      },
    });
  };

  const assignBadge = async (userId: string, badgeType: string) => {
    setActionLoading(userId);
    const { error } = await supabase.from("user_badges").insert({ user_id: userId, badge_type: badgeType, assigned_by: user?.id } as any);
    if (error) {
      if (error.code === "23505") toast({ title: "Badge already assigned" });
      else toast({ title: "Assign failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `${getBadgeLabel(badgeType)} badge assigned` });
      invalidateBadgeDerivedCaches();
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, badges: [...u.badges, badgeType] } : u));
      refreshCurrentUsers();
      if (badgeTarget?.id === userId) setBadgeTarget({ ...badgeTarget, badges: [...badgeTarget.badges, badgeType] });
    }
    setActionLoading(null);
  };

  const removeBadge = async (userId: string, badgeType: string) => {
    confirmAction({
      title: `Remove "${getBadgeLabel(badgeType)}" badge?`,
      onConfirm: async () => {
        setActionLoading(userId);
        const { error } = await supabase.from("user_badges").delete().eq("user_id", userId).eq("badge_type", badgeType);
        if (error) toast({ title: "Remove failed", description: error.message, variant: "destructive" });
        else {
          toast({ title: `${getBadgeLabel(badgeType)} badge removed` });
          invalidateBadgeDerivedCaches();
          setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, badges: u.badges.filter((b) => b !== badgeType) } : u));
          refreshCurrentUsers();
          if (badgeTarget?.id === userId) setBadgeTarget({ ...badgeTarget, badges: badgeTarget.badges.filter((b) => b !== badgeType) });
        }
        setActionLoading(null);
      },
    });
  };

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <div className="flex items-center border border-border rounded-sm overflow-hidden shrink-0">
          <button
            onClick={() => setSearchBy("email")}
            className={`px-3 py-2 text-[10px] tracking-wider uppercase transition-colors ${searchBy === "email" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            style={{ fontFamily: "var(--font-heading)" }}
          >
            <Mail className="h-3 w-3" />
          </button>
          <button
            onClick={() => setSearchBy("name")}
            className={`px-3 py-2 text-[10px] tracking-wider uppercase transition-colors ${searchBy === "name" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            style={{ fontFamily: "var(--font-heading)" }}
          >
            <User className="h-3 w-3" />
          </button>
        </div>
        <div className="flex-1 flex items-center gap-2 border border-border rounded-sm px-3">
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fetchUsers(searchQuery.trim())}
            placeholder={searchBy === "email" ? "Search by email..." : "Search by name..."}
            className="flex-1 bg-transparent outline-none py-2 text-sm min-w-0"
            style={{ fontFamily: "var(--font-body)" }}
          />
        </div>
        <div className="flex gap-2">
          <button onClick={() => fetchUsers(searchQuery.trim())} disabled={loading}
            className="flex-1 sm:flex-none px-4 py-2 text-[10px] tracking-[0.15em] uppercase bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 rounded-sm"
            style={{ fontFamily: "var(--font-heading)" }}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Search"}
          </button>
          <button onClick={() => fetchUsers("", searchBy)} disabled={loading}
            className="flex-1 sm:flex-none px-4 py-2 text-[10px] tracking-[0.15em] uppercase border border-border hover:border-primary transition-colors rounded-sm"
            style={{ fontFamily: "var(--font-heading)" }}>
            All
          </button>
        </div>
      </div>

      {/* Role Filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground shrink-0" style={{ fontFamily: "var(--font-heading)" }}>
          <Shield className="h-3 w-3 inline mr-1" />Filter by role:
        </span>
        <button
          onClick={() => { setRoleFilter(""); fetchUsers(searchQuery.trim(), searchBy, badgeFilter, ""); }}
          className={`px-2.5 py-1 text-[9px] tracking-wider uppercase border rounded-sm transition-all ${
            !roleFilter ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary hover:text-primary"
          }`}
          style={{ fontFamily: "var(--font-heading)" }}
        >
          All
        </button>
        {ALL_ROLES.map((r) => (
          <button
            key={r}
            onClick={() => {
              const newFilter = roleFilter === r ? "" : r;
              setRoleFilter(newFilter);
              fetchUsers(searchQuery.trim(), searchBy, badgeFilter, newFilter);
            }}
            className={`px-2.5 py-1 text-[9px] tracking-wider uppercase border rounded-sm transition-all ${
              roleFilter === r ? `${getRolePillClass(r)} font-medium` : "border-border text-muted-foreground hover:border-primary hover:text-primary"
            }`}
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {getRoleIcon(r)} {getRoleLabel(r)}
          </button>
        ))}
      </div>

      {/* Badge Filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground shrink-0" style={{ fontFamily: "var(--font-heading)" }}>
          <Award className="h-3 w-3 inline mr-1" />Filter by badge:
        </span>
        <button
          onClick={() => { setBadgeFilter(""); fetchUsers(searchQuery.trim(), searchBy, "", roleFilter); }}
          className={`px-2.5 py-1 text-[9px] tracking-wider uppercase border rounded-sm transition-all ${
            !badgeFilter ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary hover:text-primary"
          }`}
          style={{ fontFamily: "var(--font-heading)" }}
        >
          All
        </button>
        {badgeTypes.map((b) => (
          <button
            key={b}
            onClick={() => {
              const newFilter = badgeFilter === b ? "" : b;
              setBadgeFilter(newFilter);
              fetchUsers(searchQuery.trim(), searchBy, newFilter, roleFilter);
            }}
            className={`px-2.5 py-1 text-[9px] tracking-wider uppercase border rounded-sm transition-all ${
              badgeFilter === b ? `${getBadgeClass(b)} font-medium` : "border-border text-muted-foreground hover:border-primary hover:text-primary"
            }`}
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {getBadgeIcon(b)} {getBadgeLabel(b)}
          </button>
        ))}
      </div>

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 border border-primary/30 bg-primary/5 p-3 rounded-sm">
          <span className="text-[10px] tracking-[0.15em] uppercase text-primary font-medium shrink-0" style={{ fontFamily: "var(--font-heading)" }}>
            <CheckSquare className="h-3.5 w-3.5 inline mr-1" />
            {selectedIds.size} selected
          </span>
          <select
            value={bulkRole}
            onChange={(e) => setBulkRole(e.target.value)}
            className="bg-transparent border border-border rounded-sm px-2 py-1.5 text-xs outline-none focus:border-primary"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            <option value="">Select role...</option>
            {ALL_ROLES.filter((r) => r !== "user").map((r) => (
              <option key={r} value={r}>{getRoleLabel(r)}</option>
            ))}
          </select>
          <button onClick={bulkAssignRole} disabled={!bulkRole || bulkLoading}
            className="px-3 py-1.5 text-[10px] tracking-wider uppercase bg-primary text-primary-foreground hover:opacity-90 rounded-sm disabled:opacity-50 flex items-center gap-1"
            style={{ fontFamily: "var(--font-heading)" }}>
            {bulkLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Assign
          </button>
          <button onClick={bulkRemoveRole} disabled={!bulkRole || bulkRole === "user" || bulkLoading}
            className="px-3 py-1.5 text-[10px] tracking-wider uppercase border border-destructive/40 text-destructive hover:bg-destructive/10 rounded-sm disabled:opacity-50 flex items-center gap-1"
            style={{ fontFamily: "var(--font-heading)" }}>
            {bulkLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
            Remove
          </button>
          <button onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            style={{ fontFamily: "var(--font-heading)" }}>
            Clear
          </button>
        </div>
      )}

      {/* Suspend Modal */}
      {suspendTarget && (
        <div className="border border-destructive/40 bg-destructive/5 p-4 rounded-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] tracking-[0.2em] uppercase text-destructive font-medium" style={{ fontFamily: "var(--font-heading)" }}>
              Suspend: {suspendTarget.full_name || suspendTarget.email}
            </span>
            <button onClick={() => setSuspendTarget(null)} className="text-muted-foreground hover:text-foreground"><XCircle className="h-4 w-4" /></button>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input type="radio" checked={suspendType === "temporary"} onChange={() => setSuspendType("temporary")} className="accent-primary" /> Temporary
            </label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input type="radio" checked={suspendType === "permanent"} onChange={() => setSuspendType("permanent")} className="accent-destructive" /> Permanent
            </label>
            {suspendType === "temporary" && (
              <input type="number" value={suspendDays} onChange={(e) => setSuspendDays(e.target.value)} min="1"
                className="w-20 bg-transparent border border-border rounded-sm px-2 py-1 text-xs outline-none focus:border-primary" placeholder="Days" />
            )}
          </div>
          <div className="flex items-center gap-2">
            <input value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} placeholder="Reason..."
              className="flex-1 bg-transparent border border-border rounded-sm px-3 py-1.5 text-xs outline-none focus:border-primary" />
            <button onClick={suspendUser}
              className="px-4 py-1.5 text-[10px] tracking-wider uppercase bg-destructive text-destructive-foreground hover:opacity-90 rounded-sm"
              style={{ fontFamily: "var(--font-heading)" }}>
              Confirm
            </button>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editTarget && (
        <div className="border border-border p-4 rounded-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] tracking-[0.2em] uppercase text-primary font-medium" style={{ fontFamily: "var(--font-heading)" }}>
              Edit: {editTarget.full_name || editTarget.email}
            </span>
            <button onClick={() => setEditTarget(null)} className="text-muted-foreground hover:text-foreground"><XCircle className="h-4 w-4" /></button>
          </div>
          <div className="flex items-center gap-3">
            <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Full name"
              className="flex-1 bg-transparent border border-border rounded-sm px-3 py-1.5 text-xs outline-none focus:border-primary" />
            <input value={editBio} onChange={(e) => setEditBio(e.target.value)} placeholder="Bio"
              className="flex-1 bg-transparent border border-border rounded-sm px-3 py-1.5 text-xs outline-none focus:border-primary" />
            <button onClick={saveEdit}
              className="px-4 py-1.5 text-[10px] tracking-wider uppercase bg-primary text-primary-foreground hover:opacity-90 rounded-sm"
              style={{ fontFamily: "var(--font-heading)" }}>
              Save
            </button>
          </div>
        </div>
      )}

      {/* Role Management Panel */}
      {roleTarget && (
        <div className="border border-primary/30 bg-primary/5 p-4 rounded-sm space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] tracking-[0.2em] uppercase text-primary font-medium" style={{ fontFamily: "var(--font-heading)" }}>
              <Shield className="h-3.5 w-3.5 inline mr-1.5" />
              Manage Roles: {roleTarget.full_name || roleTarget.email}
            </span>
            <button onClick={() => setRoleTarget(null)} className="text-muted-foreground hover:text-foreground"><XCircle className="h-4 w-4" /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {ALL_ROLES.map((role) => {
              const has = roleTarget.roles.includes(role);
              const pillClass = getRolePillClass(role);
              return (
                <div
                  key={role}
                  className={`flex items-center gap-3 p-3 border rounded-sm transition-all ${
                    has ? pillClass : "border-dashed border-muted-foreground/20 hover:border-primary/40"
                  }`}
                >
                  <div className="flex flex-col items-center gap-1 shrink-0">
                    <span className="text-lg leading-none">{getRoleIcon(role) || "👤"}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate" style={{ fontFamily: "var(--font-heading)" }}>
                      {getRoleLabel(role)}
                    </p>
                    <p className="text-[9px] text-muted-foreground">
                      {has ? "✓ Assigned" : "Not assigned"}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      if (has) {
                        removeRole(roleTarget.id, role);
                        setRoleTarget({ ...roleTarget, roles: roleTarget.roles.filter((r) => r !== role) });
                      } else {
                        assignRole(roleTarget.id, role);
                        setRoleTarget({ ...roleTarget, roles: [...roleTarget.roles, role] });
                      }
                    }}
                    disabled={actionLoading === roleTarget.id || (role === "user" && has)}
                    className={`shrink-0 p-1.5 rounded-sm transition-all ${
                      has ? "bg-destructive/10 text-destructive hover:bg-destructive/20" : "bg-primary/10 text-primary hover:bg-primary/20"
                    } disabled:opacity-30`}
                    title={has ? `Remove ${getRoleLabel(role)}` : `Add ${getRoleLabel(role)}`}
                  >
                    {has ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                  </button>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Palette className="h-3 w-3" /> Roles display globally next to usernames. Manage definitions in Badge & Role Types tab.
          </p>
        </div>
      )}

      {/* Badge Management Panel */}
      {badgeTarget && (
        <div className="border border-amber-500/30 bg-amber-500/5 p-4 rounded-sm space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] tracking-[0.2em] uppercase text-amber-600 font-medium" style={{ fontFamily: "var(--font-heading)" }}>
              <Award className="h-3.5 w-3.5 inline mr-1.5" />
              Manage Badges: {badgeTarget.full_name || badgeTarget.email}
            </span>
            <button onClick={() => setBadgeTarget(null)} className="text-muted-foreground hover:text-foreground"><XCircle className="h-4 w-4" /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {badgeTypes.map((badge) => {
              const has = badgeTarget.badges.includes(badge);
              return (
                <div
                  key={badge}
                  className={`flex items-center gap-3 p-3 border rounded-sm transition-all ${
                    has ? getBadgeClass(badge) : "border-dashed border-muted-foreground/20 hover:border-amber-500/40"
                  }`}
                >
                  <div className="flex flex-col items-center gap-1 shrink-0">
                    <span className="text-lg leading-none">{getBadgeIcon(badge)}</span>
                    <div className={`w-6 h-1.5 rounded-full ${getBadgeRibbonClass(badge)}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate" style={{ fontFamily: "var(--font-heading)" }}>
                      {getBadgeLabel(badge)}
                    </p>
                    <p className="text-[9px] text-muted-foreground">
                      {has ? "✓ Assigned" : "Not assigned"}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      if (has) removeBadge(badgeTarget.id, badge);
                      else assignBadge(badgeTarget.id, badge);
                    }}
                    disabled={actionLoading === badgeTarget.id}
                    className={`shrink-0 p-1.5 rounded-sm transition-all ${
                      has ? "bg-destructive/10 text-destructive hover:bg-destructive/20" : "bg-amber-500/10 text-amber-600 hover:bg-amber-500/20"
                    } disabled:opacity-30`}
                    title={has ? `Remove ${getBadgeLabel(badge)}` : `Add ${getBadgeLabel(badge)}`}
                  >
                    {has ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                  </button>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Smile className="h-3 w-3" /> Badges display globally on user profiles. Manage definitions in Badge & Role Types tab.
          </p>
        </div>
      )}

      {/* User List */}
      {users.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[9px] tracking-[0.3em] uppercase text-muted-foreground mb-2" style={{ fontFamily: "var(--font-heading)" }}>
            <button onClick={selectAll} className="hover:text-primary transition-colors" title="Select all">
              {selectedIds.size === users.length && users.length > 0 ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
            </button>
            {users.length} user{users.length !== 1 ? "s" : ""} {badgeFilter ? `with ${getBadgeLabel(badgeFilter)} badge` : "found"}
          </div>
          <div className="border border-border rounded-sm overflow-hidden divide-y divide-border">
            {users.map((u) => (
              <div key={u.id} className={`px-3 py-2.5 hover:bg-muted/30 transition-colors group ${u.is_suspended ? "opacity-60 bg-destructive/5" : ""} ${selectedIds.has(u.id) ? "bg-primary/5" : ""}`}>
                <div className="flex items-start gap-2.5">
                  {/* Checkbox */}
                  <button onClick={() => toggleSelect(u.id)} className="shrink-0 hover:text-primary transition-colors mt-1">
                    {selectedIds.has(u.id) ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4 text-muted-foreground" />}
                  </button>
                  {/* Avatar */}
                  {u.avatar_url ? (
                    <img referrerPolicy="no-referrer" loading="lazy" decoding="async" src={u.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover border border-border shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-[10px] text-muted-foreground shrink-0 border border-border">
                      {(u.full_name || u.email || "?")[0]?.toUpperCase()}
                    </div>
                  )}

                  {/* Name + Email */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate" style={{ fontFamily: "var(--font-body)" }}>
                        {u.full_name || "No Name"}
                      </span>
                      {u.is_suspended && (
                        <span className="text-[8px] px-1.5 py-0.5 bg-destructive/10 text-destructive border border-destructive/30 rounded-sm uppercase tracking-wider shrink-0"
                          style={{ fontFamily: "var(--font-heading)" }}>
                          {u.suspended_until ? `Until ${new Date(u.suspended_until).toLocaleDateString()}` : "Permanent"}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      <span className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
                        <Mail className="h-2.5 w-2.5 shrink-0" /> {u.email || "—"}
                      </span>
                      <span className="text-[10px] text-muted-foreground/60 flex items-center gap-1 shrink-0">
                        <Calendar className="h-2.5 w-2.5" /> {new Date(u.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}
                      </span>
                    </div>

                    {/* Roles + Badges */}
                    <div className="flex gap-1 flex-wrap mt-1.5">
                      {u.badges.map((b) => (
                        <span key={b} className={`text-[8px] px-1.5 py-0.5 border rounded-sm uppercase tracking-wider ${getBadgeClass(b)}`}>
                          {getBadgeIcon(b)} {getBadgeLabel(b)}
                        </span>
                      ))}
                      {u.roles.map((r) => (
                        <span key={r} className={`text-[8px] px-1.5 py-0.5 border rounded-sm uppercase tracking-wider ${getRolePillClass(r)}`}>
                          {getRoleIcon(r)} {getRoleLabel(r)}
                        </span>
                      ))}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-0.5 mt-2 md:mt-0 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                      <button onClick={() => setRoleTarget(u)} className="p-1.5 hover:text-primary transition-colors rounded-sm hover:bg-primary/10" title="Manage Roles" disabled={actionLoading === u.id}>
                        <Shield className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => setBadgeTarget(u)} className="p-1.5 hover:text-amber-600 transition-colors rounded-sm hover:bg-amber-500/10" title="Manage Badges" disabled={actionLoading === u.id}>
                        <Award className="h-3.5 w-3.5" />
                      </button>
                      <a href={`/profile/${u.id}`} target="_blank" rel="noopener noreferrer" className="p-1.5 hover:text-blue-600 transition-colors rounded-sm hover:bg-blue-500/10" title="View Profile">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                      <button onClick={() => { setEditTarget(u); setEditName(u.full_name || ""); setEditBio(u.bio || ""); }} className="p-1.5 hover:text-primary transition-colors rounded-sm hover:bg-primary/10" title="Edit" disabled={actionLoading === u.id}>
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      {u.is_suspended ? (
                        <button onClick={() => revokeSuspension(u.id)} className="flex items-center gap-1 px-2 py-1 text-[9px] tracking-wider uppercase bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-colors rounded-sm" title="Revoke Suspension" disabled={actionLoading === u.id}>
                          <ShieldCheck className="h-3.5 w-3.5" /> Revoke
                        </button>
                      ) : (
                        <button onClick={() => setSuspendTarget(u)} className="flex items-center gap-1 px-2 py-1 text-[9px] tracking-wider uppercase hover:bg-destructive/10 hover:text-destructive transition-colors rounded-sm" title="Suspend" disabled={actionLoading === u.id}>
                          <Ban className="h-3.5 w-3.5" /> Suspend
                        </button>
                      )}
                      <button onClick={() => deleteUser(u)} className="p-1.5 hover:text-destructive transition-colors rounded-sm hover:bg-destructive/10" title="Delete" disabled={actionLoading === u.id}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {users.length === 0 && !loading && (
        <div className="text-center py-12 border border-dashed border-border rounded-sm">
          <Search className="h-5 w-5 text-muted-foreground mx-auto mb-2" />
          <p className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>Search by email or name, or click "All" to browse.</p>
        </div>
      )}
      <ConfirmDialog {...dialogProps} />
    </div>
  );
};

export default AdminUsers;
