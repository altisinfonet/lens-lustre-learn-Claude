import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle, XCircle, MessageSquare, ArrowUpDown, ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import ProfileLink from "@/components/ProfileLink";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/core/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { invalidateRoleCache } from "@/components/AutoRole";
import { useT } from "@/i18n/I18nContext";

interface RoleApp {
  id: string;
  user_id: string;
  requested_role: string;
  status: string;
  reason: string | null;
  portfolio_url: string | null;
  experience: string | null;
  admin_message: string | null;
  created_at: string;
  profiles: { full_name: string | null } | null;
}

interface Props {
  roleApps: RoleApp[];
  onRefresh: () => void;
  userId: string;
}

type SortKey = "sl" | "name" | "requested_role" | "status" | "created_at";
type SortDir = "asc" | "desc";

const ROLE_LABELS: Record<string, string> = {
  content_editor: "Content Editor",
  judge: "Judge",
  registered_photographer: "Photographer",
  student: "Student",
};

const headStyle: React.CSSProperties = { fontFamily: "var(--font-heading)" };
const bodyStyle: React.CSSProperties = { fontFamily: "var(--font-body)" };

const statusBadge = (status: string) => {
  const cls = status === "approved" ? "text-primary border-primary" : status === "rejected" ? "text-destructive border-destructive" : "text-yellow-500 border-yellow-500";
  return <span className={`text-[9px] tracking-[0.15em] uppercase px-2 py-0.5 border rounded-full md:rounded-none ${cls}`} style={headStyle}>{status}</span>;
};

const AdminRoleApplications = ({ roleApps, onRefresh, userId }: Props) => {
  const t = useT();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adminMsg, setAdminMsg] = useState<Record<string, string>>({});
  const [detailApp, setDetailApp] = useState<RoleApp | null>(null);

  const invalidateApprovedRoleCaches = (targetUserId: string) => {
    invalidateRoleCache(targetUserId);
    void queryClient.invalidateQueries({ queryKey: queryKeys.isAdmin(targetUserId) });
    void queryClient.invalidateQueries({ queryKey: ["user-roles", targetUserId] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.profileMapPrefix() });
    void queryClient.invalidateQueries({ queryKey: ["dashboard-init"] });
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const sorted = useMemo(() => {
    const items = [...roleApps];
    items.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name": cmp = (a.profiles?.full_name || "").localeCompare(b.profiles?.full_name || ""); break;
        case "requested_role": cmp = a.requested_role.localeCompare(b.requested_role); break;
        case "status": cmp = a.status.localeCompare(b.status); break;
        case "created_at": cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime(); break;
        default: cmp = 0;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return items;
  }, [roleApps, sortKey, sortDir]);

  const allSelected = sorted.length > 0 && selected.size === sorted.length;
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(sorted.map((a) => a.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const handleDecision = async (appId: string, decision: "approved" | "rejected") => {
    const app = roleApps.find((a) => a.id === appId);
    if (!app) return;
    if (decision === "approved") {
      const { error: roleError } = await supabase.from("user_roles").insert({ user_id: app.user_id, role: app.requested_role as any });
      if (roleError && roleError.code !== "23505") {
        toast({ title: t("ar.roleAssignFailed"), description: roleError.message, variant: "destructive" });
        return;
      }
    }
    const { error } = await supabase
      .from("role_applications")
      .update({ status: decision, admin_message: adminMsg[appId]?.trim() || null, reviewed_by: userId, updated_at: new Date().toISOString() })
      .eq("id", appId);
    if (error) { toast({ title: t("au.updateFailed"), description: error.message, variant: "destructive" }); return; }
    if (decision === "approved") {
      invalidateApprovedRoleCaches(app.user_id);
    }
    toast({ title: `${t("ar.application")}: ${t("dash.status." + decision, decision)}` });
    setDetailApp(null);
    onRefresh();
  };

  const handleBulk = async (decision: "approved" | "rejected") => {
    const pendingSelected = sorted.filter((a) => selected.has(a.id) && a.status === "pending");
    if (pendingSelected.length === 0) { toast({ title: t("ar.noPendingSelected"), variant: "destructive" }); return; }
    for (const app of pendingSelected) {
      if (decision === "approved") {
        const { error: roleError } = await supabase.from("user_roles").insert({ user_id: app.user_id, role: app.requested_role as any });
        if (roleError && roleError.code !== "23505") {
          toast({ title: `${t("ar.roleAssignFailed")} — ${app.profiles?.full_name || "user"}`, description: roleError.message, variant: "destructive" });
          continue;
        }
      }
      const { error } = await supabase.from("role_applications").update({ status: decision, reviewed_by: userId, updated_at: new Date().toISOString() }).eq("id", app.id);
      if (error) {
        toast({ title: `${t("au.updateFailed")} — ${app.profiles?.full_name || "user"}`, description: error.message, variant: "destructive" });
        continue;
      }
      if (decision === "approved") invalidateApprovedRoleCaches(app.user_id);
    }
    toast({ title: `${pendingSelected.length} ${t("ar.applications")} — ${t("dash.status." + decision, decision)}` });
    setSelected(new Set());
    onRefresh();
  };

  const handleBulkDelete = async () => {
    const ids = sorted.filter((a) => selected.has(a.id)).map((a) => a.id);
    if (ids.length === 0) return;
    const { error } = await supabase.from("role_applications").delete().in("id", ids);
    if (error) { toast({ title: t("au.deleteFailed"), description: error.message, variant: "destructive" }); return; }
    toast({ title: `${ids.length} application(s) deleted` });
    setSelected(new Set());
    onRefresh();
  };

  const handleSingleDelete = async (appId: string) => {
    const { error } = await supabase.from("role_applications").delete().eq("id", appId);
    if (error) { toast({ title: t("au.deleteFailed"), description: error.message, variant: "destructive" }); return; }
    toast({ title: "Application deleted" });
    setDetailApp(null);
    onRefresh();
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };

  return (
    <div>
      {/* Header row with count + mobile sort */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground" style={headStyle}>
          {roleApps.length} {t("ar.applications")}
        </span>
        <div className="flex md:hidden items-center gap-1">
          {(["name", "requested_role", "status", "created_at"] as SortKey[]).map((key) => (
            <button
              key={key}
              onClick={() => toggleSort(key)}
              className={`text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded-full transition-colors ${sortKey === key ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground"}`}
              style={headStyle}
            >
              {key === "name" ? t("ar.name") : key === "requested_role" ? t("dash.role") : key === "status" ? t("ref.status") : t("at.thDate")}
              {sortKey === key && (sortDir === "asc" ? "↑" : "↓")}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-xl md:rounded-none mb-3">
          <span className="text-[10px] font-semibold text-primary tabular-nums" style={headStyle}>{selected.size} {t("au.selected")}</span>
          <div className="w-px h-4 bg-border mx-1" />
          <button onClick={() => handleBulk("approved")} className="inline-flex items-center gap-1 px-2.5 py-1 text-[9px] uppercase tracking-wider border border-primary text-primary hover:bg-primary/10 rounded-lg md:rounded-none transition-colors" style={headStyle}>
            <CheckCircle className="h-3 w-3" /> {t("aw.approve")}
          </button>
          <button onClick={() => handleBulk("rejected")} className="inline-flex items-center gap-1 px-2.5 py-1 text-[9px] uppercase tracking-wider border border-destructive text-destructive hover:bg-destructive/10 rounded-lg md:rounded-none transition-colors" style={headStyle}>
            <XCircle className="h-3 w-3" /> {t("aw.reject")}
          </button>
          <button onClick={() => handleBulkDelete()} className="inline-flex items-center gap-1 px-2.5 py-1 text-[9px] uppercase tracking-wider border border-muted-foreground/40 text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive rounded-lg md:rounded-none transition-colors" style={headStyle}>
            <Trash2 className="h-3 w-3" /> {t("common.delete")}
          </button>
          <div className="flex-1" />
          <button onClick={() => setSelected(new Set())} className="text-[9px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors" style={headStyle}>{t("ast.clear")}</button>
        </div>
      )}

      {/* ── Mobile Card View ── */}
      <div className="flex flex-col gap-2.5 md:hidden">
        {sorted.length === 0 && (
          <div className="text-center py-10 text-xs text-muted-foreground bg-card rounded-xl border border-border" style={bodyStyle}>
            No role applications yet
          </div>
        )}
        {sorted.map((app, idx) => (
          <div
            key={app.id}
            className={`bg-card rounded-xl border border-border shadow-sm overflow-hidden transition-colors ${selected.has(app.id) ? "border-primary/40 bg-primary/5" : ""}`}
          >
            {/* Card header */}
            <div className="flex items-center gap-2.5 px-3.5 pt-3 pb-2">
              <Checkbox checked={selected.has(app.id)} onCheckedChange={() => toggleOne(app.id)} />
              <span className="text-[10px] tabular-nums text-muted-foreground w-5" style={bodyStyle}>#{idx + 1}</span>
              <div className="flex-1 min-w-0">
                <ProfileLink userId={app.user_id} className="text-[13px] font-semibold text-primary leading-tight" style={headStyle}>
                  {app.profiles?.full_name || "Unknown User"}
                </ProfileLink>
              </div>
              {statusBadge(app.status)}
            </div>

            {/* Card body */}
            <div className="px-3.5 pb-2.5 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground w-14 shrink-0" style={headStyle}>{t("dash.role")}</span>
                <span className="text-xs text-foreground font-medium" style={bodyStyle}>{ROLE_LABELS[app.requested_role] || app.requested_role}</span>
              </div>
              {app.reason && (
                <div className="flex gap-2">
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground w-14 shrink-0 pt-0.5" style={headStyle}>{t("ar.reason")}</span>
                  <span className="text-[11px] text-muted-foreground leading-snug line-clamp-2" style={bodyStyle}>{app.reason}</span>
                </div>
              )}
              {app.portfolio_url && (
                <div className="flex items-center gap-2">
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground w-14 shrink-0" style={headStyle}>{t("ar.link")}</span>
                  <a href={app.portfolio_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary hover:underline truncate" style={bodyStyle}>{app.portfolio_url}</a>
                </div>
              )}
              {app.experience && (
                <div className="flex gap-2">
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground w-14 shrink-0 pt-0.5" style={headStyle}>{t("ar.exp")}</span>
                  <span className="text-[11px] text-muted-foreground leading-snug line-clamp-2" style={bodyStyle}>{app.experience}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground w-14 shrink-0" style={headStyle}>{t("at.thDate")}</span>
                <span className="text-[11px] text-muted-foreground" style={bodyStyle}>
                  {new Date(app.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
              </div>
              {app.admin_message && (
                <div className="flex gap-2">
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground w-14 shrink-0 pt-0.5" style={headStyle}>Msg</span>
                  <span className="text-[11px] text-muted-foreground leading-snug line-clamp-2" style={bodyStyle}>{app.admin_message}</span>
                </div>
              )}
            </div>

            {/* Card footer actions */}
            <div className="flex items-center gap-1.5 px-3.5 py-2.5 border-t border-border/60 bg-muted/30">
              {app.status === "pending" ? (
                <>
                  <button onClick={() => handleDecision(app.id, "approved")} className="flex-1 inline-flex items-center justify-center gap-1 py-2 text-[9px] uppercase tracking-wider bg-primary/10 text-primary rounded-lg font-semibold active:scale-95 transition-all" style={headStyle}>
                    <CheckCircle className="h-3.5 w-3.5" /> {t("aw.approve")}
                  </button>
                  <button onClick={() => handleDecision(app.id, "rejected")} className="flex-1 inline-flex items-center justify-center gap-1 py-2 text-[9px] uppercase tracking-wider bg-destructive/10 text-destructive rounded-lg font-semibold active:scale-95 transition-all" style={headStyle}>
                    <XCircle className="h-3.5 w-3.5" /> {t("aw.reject")}
                  </button>
                  <button onClick={() => setDetailApp(app)} className="px-3 py-2 text-muted-foreground bg-accent rounded-lg active:scale-95 transition-all" style={headStyle}>
                    <MessageSquare className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => handleSingleDelete(app.id)} className="px-3 py-2 text-muted-foreground hover:text-destructive bg-accent rounded-lg active:scale-95 transition-all" style={headStyle}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : (
                <div className="flex items-center gap-1.5 flex-1">
                  <button onClick={() => setDetailApp(app)} className="flex-1 inline-flex items-center justify-center gap-1 py-2 text-[9px] uppercase tracking-wider text-muted-foreground bg-accent rounded-lg font-medium active:scale-95 transition-all" style={headStyle}>
                    View Details
                  </button>
                  <button onClick={() => handleSingleDelete(app.id)} className="px-3 py-2 text-muted-foreground hover:text-destructive bg-accent rounded-lg active:scale-95 transition-all" style={headStyle}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── Desktop Table View ── */}
      <div className="hidden md:block border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"><Checkbox checked={allSelected} onCheckedChange={toggleAll} /></TableHead>
              <TableHead className="w-12">
                <button onClick={() => toggleSort("sl")} className="inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.15em]" style={headStyle}>SL <SortIcon col="sl" /></button>
              </TableHead>
              <TableHead>
                <button onClick={() => toggleSort("name")} className="inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.15em]" style={headStyle}>{t("ar.applicant")} <SortIcon col="name" /></button>
              </TableHead>
              <TableHead>
                <button onClick={() => toggleSort("requested_role")} className="inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.15em]" style={headStyle}>{t("dash.role")} <SortIcon col="requested_role" /></button>
              </TableHead>
              <TableHead>{t("ar.reason")}</TableHead>
              <TableHead className="hidden lg:table-cell">{t("ar.portfolio")}</TableHead>
              <TableHead className="hidden lg:table-cell">{t("dash.experience")}</TableHead>
              <TableHead>
                <button onClick={() => toggleSort("status")} className="inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.15em]" style={headStyle}>{t("ref.status")} <SortIcon col="status" /></button>
              </TableHead>
              <TableHead>
                <button onClick={() => toggleSort("created_at")} className="inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.15em]" style={headStyle}>{t("ar.applied")} <SortIcon col="created_at" /></button>
              </TableHead>
              <TableHead>{t("ar.adminMsg")}</TableHead>
              <TableHead className="w-20">{t("ar.action")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-10 text-sm text-muted-foreground" style={bodyStyle}>{t("ar.noApps")}</TableCell>
              </TableRow>
            )}
            {sorted.map((app, idx) => (
              <TableRow key={app.id} className={selected.has(app.id) ? "bg-primary/5" : ""}>
                <TableCell><Checkbox checked={selected.has(app.id)} onCheckedChange={() => toggleOne(app.id)} /></TableCell>
                <TableCell className="text-xs tabular-nums text-muted-foreground" style={bodyStyle}>{idx + 1}</TableCell>
                <TableCell>
                  <ProfileLink userId={app.user_id} className="text-xs font-medium text-primary hover:underline transition-colors text-left" style={headStyle}>
                    {app.profiles?.full_name || "Unknown User"}
                  </ProfileLink>
                </TableCell>
                <TableCell className="text-xs" style={bodyStyle}>{ROLE_LABELS[app.requested_role] || app.requested_role}</TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate" style={bodyStyle}>{app.reason || "—"}</TableCell>
                <TableCell className="hidden lg:table-cell text-xs max-w-[120px] truncate">
                  {app.portfolio_url ? <a href={app.portfolio_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" style={bodyStyle}>{app.portfolio_url}</a> : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="hidden lg:table-cell text-xs text-muted-foreground max-w-[120px] truncate" style={bodyStyle}>{app.experience || "—"}</TableCell>
                <TableCell>{statusBadge(app.status)}</TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap" style={bodyStyle}>
                  {new Date(app.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate" style={bodyStyle}>{app.admin_message || "—"}</TableCell>
                <TableCell>
                  {app.status === "pending" ? (
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleDecision(app.id, "approved")} className="p-1 hover:text-primary transition-colors" title="Approve"><CheckCircle className="h-3.5 w-3.5" /></button>
                      <button onClick={() => handleDecision(app.id, "rejected")} className="p-1 hover:text-destructive transition-colors" title="Reject"><XCircle className="h-3.5 w-3.5" /></button>
                      <button onClick={() => setDetailApp(app)} className="p-1 hover:text-primary transition-colors" title="Detail"><MessageSquare className="h-3.5 w-3.5" /></button>
                      <button onClick={() => handleSingleDelete(app.id)} className="p-1 hover:text-destructive transition-colors" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <button onClick={() => setDetailApp(app)} className="text-[9px] uppercase tracking-wider text-muted-foreground hover:text-foreground" style={headStyle}>{t("ar.view")}</button>
                      <button onClick={() => handleSingleDelete(app.id)} className="p-1 hover:text-destructive transition-colors" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Detail dialog */}
      <Dialog open={!!detailApp} onOpenChange={(o) => !o && setDetailApp(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm" style={headStyle}>{detailApp?.profiles?.full_name || "Unknown User"}</DialogTitle>
          </DialogHeader>
          {detailApp && (
            <div className="space-y-3 text-xs" style={bodyStyle}>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">{t("gc.roleLabel")}</span>
                <span className="text-primary uppercase tracking-wider text-[10px]" style={headStyle}>{ROLE_LABELS[detailApp.requested_role] || detailApp.requested_role}</span>
                {statusBadge(detailApp.status)}
              </div>
              {detailApp.reason && <div><span className="text-muted-foreground block mb-0.5">{t("ar.reason")}:</span><p className="text-foreground/80 leading-relaxed">{detailApp.reason}</p></div>}
              {detailApp.portfolio_url && <div><span className="text-muted-foreground block mb-0.5">{t("ar.portfolio")}:</span><a href={detailApp.portfolio_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{detailApp.portfolio_url}</a></div>}
              {detailApp.experience && <div><span className="text-muted-foreground block mb-0.5">{t("dash.experience")}:</span><p className="text-foreground/80 leading-relaxed">{detailApp.experience}</p></div>}
              <p className="text-muted-foreground">Applied {new Date(detailApp.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>

              {detailApp.status === "pending" && (
                <div className="border-t border-border pt-3 space-y-2">
                  <input
                    type="text"
                    value={adminMsg[detailApp.id] || ""}
                    onChange={(e) => setAdminMsg((p) => ({ ...p, [detailApp.id]: e.target.value }))}
                    placeholder={t("ar.phFeedback")}
                    className="w-full bg-transparent border-b border-border focus:border-primary outline-none py-2 text-xs transition-colors"
                    style={bodyStyle}
                  />
                  <div className="flex gap-2">
                    <button onClick={() => handleDecision(detailApp.id, "approved")} className="inline-flex items-center gap-1.5 px-4 py-2 text-[10px] tracking-[0.15em] uppercase bg-primary text-primary-foreground hover:opacity-90 transition-opacity" style={headStyle}>
                      <CheckCircle className="h-3 w-3" /> {t("aw.approve")}
                    </button>
                    <button onClick={() => handleDecision(detailApp.id, "rejected")} className="inline-flex items-center gap-1.5 px-4 py-2 text-[10px] tracking-[0.15em] uppercase border border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground transition-all" style={headStyle}>
                      <XCircle className="h-3 w-3" /> {t("aw.reject")}
                    </button>
                  </div>
                </div>
              )}

              {detailApp.admin_message && detailApp.status !== "pending" && (
                <div className="border-t border-border pt-3">
                  <p className="text-muted-foreground flex items-start gap-1.5"><MessageSquare className="h-3 w-3 mt-0.5 shrink-0" />{detailApp.admin_message}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminRoleApplications;
