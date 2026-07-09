import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cachedFetchProfilesByIds } from "@/lib/profileBatch";
import { Loader2, Download, Trash2, Archive, Search, Calendar, Filter } from "lucide-react";
import { toast } from "@/hooks/core/use-toast";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { useConfirmAction } from "@/hooks/admin/useConfirmAction";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };

interface ActivityLog {
  id: string;
  user_id: string;
  action_type: string;
  action_category: string;
  description: string | null;
  metadata: any;
  page_path: string | null;
  user_agent: string | null;
  is_archived: boolean;
  created_at: string;
  user_name?: string;
}

const CATEGORIES = ["all", "auth", "navigation", "content", "social", "competition", "course", "admin"];
const RETENTION_PRESETS = [
  { label: "30 days", days: 30 },
  { label: "60 days", days: 60 },
  { label: "90 days", days: 90 },
  { label: "6 months", days: 180 },
  { label: "12 months", days: 365 },
];

const PAGE_SIZE = 50;

const AdminActivityLogs = () => {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [processing, setProcessing] = useState(false);
  const { confirm: confirmAction, dialogProps } = useConfirmAction();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const fetchLogs = useCallback(async (reset = false) => {
    setLoading(true);
    const currentPage = reset ? 0 : page;
    if (reset) setPage(0);

    let query = (supabase.from("activity_logs" as any).select("*") as any)
      .eq("is_archived", showArchived)
      .order("created_at", { ascending: false })
      .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

    if (category !== "all") query = query.eq("action_category", category);
    if (dateFrom) query = query.gte("created_at", new Date(dateFrom).toISOString());
    if (dateTo) query = query.lte("created_at", new Date(dateTo + "T23:59:59").toISOString());
    if (search) {
      // Escape special PostgREST filter characters to prevent injection
      const escaped = search.replace(/[%_\\]/g, (ch) => `\\${ch}`);
      query = query.or(`action_type.ilike.%${escaped}%,description.ilike.%${escaped}%`);
    }

    const { data, error } = await query;
    if (error) { toast({ title: "Error loading logs", variant: "destructive" }); setLoading(false); return; }

    const rows = (data || []) as ActivityLog[];

    // Fetch user names
    const userIds = [...new Set(rows.map((r) => r.user_id))];
    if (userIds.length > 0) {
      const nameMap = await cachedFetchProfilesByIds(userIds);
      rows.forEach((r) => { r.user_name = nameMap.get(r.user_id) || "Unknown"; });
    }

    setLogs(reset ? rows : [...logs, ...rows]);
    setHasMore(rows.length === PAGE_SIZE);
    setLoading(false);
  }, [page, category, showArchived, dateFrom, dateTo, search]);

  useEffect(() => { fetchLogs(true); }, [category, showArchived, dateFrom, dateTo]);

  const handleSearch = () => fetchLogs(true);

  const exportCSV = () => {
    const headers = ["Date", "User", "Category", "Action", "Description", "Page", "User Agent"];
    const csvRows = [headers.join(",")];
    logs.forEach((l) => {
      csvRows.push([
        new Date(l.created_at).toISOString(),
        `"${(l.user_name || "").replace(/"/g, '""')}"`,
        l.action_category,
        l.action_type,
        `"${(l.description || "").replace(/"/g, '""')}"`,
        l.page_path || "",
        `"${(l.user_agent || "").replace(/"/g, '""')}"`,
      ].join(","));
    });
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `activity-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "CSV exported" });
  };

  const archiveByPeriod = async (days: number) => {
    setProcessing(true);
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const { error } = await (supabase.from("activity_logs" as any).update({ is_archived: true } as any).lt("created_at", cutoff).eq("is_archived", false) as any);
    if (error) toast({ title: "Archive failed", variant: "destructive" });
    else { toast({ title: `Archived logs older than ${days} days` }); fetchLogs(true); }
    setProcessing(false);
  };

  const deleteByPeriod = async (days: number) => {
    confirmAction({
      title: `Permanently delete logs older than ${days} days?`,
      description: "This cannot be undone.",
      onConfirm: async () => {
        setProcessing(true);
        const cutoff = new Date(Date.now() - days * 86400000).toISOString();
        const { error } = await (supabase.from("activity_logs" as any).delete().lt("created_at", cutoff) as any);
        if (error) toast({ title: "Delete failed", variant: "destructive" });
        else { toast({ title: `Deleted logs older than ${days} days` }); fetchLogs(true); }
        setProcessing(false);
      },
    });
  };

  const deleteCustomRange = async () => {
    if (!dateFrom || !dateTo) { toast({ title: "Select both dates", variant: "destructive" }); return; }
    confirmAction({
      title: "Permanently delete logs in this date range?",
      description: "This cannot be undone.",
      onConfirm: async () => {
        setProcessing(true);
        const { error } = await (supabase.from("activity_logs" as any).delete()
          .gte("created_at", new Date(dateFrom).toISOString())
          .lte("created_at", new Date(dateTo + "T23:59:59").toISOString()) as any);
        if (error) toast({ title: "Delete failed", variant: "destructive" });
        else { toast({ title: "Deleted logs in range" }); fetchLogs(true); }
        setProcessing(false);
      },
    });
  };

  const deleteSelected = async () => {
    if (selectedIds.size === 0) return;
    confirmAction({
      title: `Delete ${selectedIds.size} selected logs?`,
      description: "This cannot be undone.",
      onConfirm: async () => {
        setProcessing(true);
        const { error } = await (supabase.from("activity_logs" as any).delete().in("id", Array.from(selectedIds)) as any);
        if (error) toast({ title: "Delete failed", variant: "destructive" });
        else { toast({ title: `Deleted ${selectedIds.size} logs` }); setSelectedIds(new Set()); fetchLogs(true); }
        setProcessing(false);
      },
    });
  };

  const toggleSelect = (id: string) => {
    const s = new Set(selectedIds);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelectedIds(s);
  };

  const selectAll = () => {
    if (selectedIds.size === logs.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(logs.map((l) => l.id)));
  };

  const categoryColor = (cat: string) => {
    const colors: Record<string, string> = {
      auth: "text-blue-500 border-blue-500",
      navigation: "text-muted-foreground border-border",
      content: "text-primary border-primary",
      social: "text-pink-500 border-pink-500",
      competition: "text-yellow-500 border-yellow-500",
      course: "text-green-500 border-green-500",
      admin: "text-destructive border-destructive",
    };
    return colors[cat] || "text-muted-foreground border-border";
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <span className="text-[9px] tracking-[0.3em] uppercase text-primary block mb-1" style={headingFont}>
            Activity Logs
          </span>
          <p className="text-xs text-muted-foreground" style={bodyFont}>
            Full user activity tracking — auth, navigation, and content actions
          </p>
        </div>
        <button onClick={exportCSV} className="inline-flex items-center gap-2 px-4 py-2 border border-border text-[10px] tracking-[0.15em] uppercase hover:border-primary/50 transition-all" style={headingFont}>
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="border border-border p-4 space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[9px] tracking-[0.2em] uppercase text-muted-foreground mb-1.5" style={headingFont}>Search</label>
            <div className="flex gap-2">
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search actions..."
                className="flex-1 bg-transparent border-b border-border focus:border-primary outline-none py-2 text-xs" style={bodyFont}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()} />
              <button onClick={handleSearch} className="p-2 text-muted-foreground hover:text-primary"><Search className="h-3.5 w-3.5" /></button>
            </div>
          </div>
          <div>
            <label className="block text-[9px] tracking-[0.2em] uppercase text-muted-foreground mb-1.5" style={headingFont}>Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="bg-transparent border-b border-border focus:border-primary outline-none py-2 text-xs" style={bodyFont}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c === "all" ? "All Categories" : c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[9px] tracking-[0.2em] uppercase text-muted-foreground mb-1.5" style={headingFont}>From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="bg-transparent border-b border-border focus:border-primary outline-none py-2 text-xs" style={bodyFont} />
          </div>
          <div>
            <label className="block text-[9px] tracking-[0.2em] uppercase text-muted-foreground mb-1.5" style={headingFont}>To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="bg-transparent border-b border-border focus:border-primary outline-none py-2 text-xs" style={bodyFont} />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer" style={bodyFont}>
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-primary" />
            Archived
          </label>
        </div>
      </div>

      {/* Retention / Archive / Delete Controls */}
      <div className="border border-border p-4 space-y-3">
        <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground block" style={headingFont}>
          <Filter className="h-3 w-3 inline mr-1.5" />Retention Management
        </span>
        <div className="flex flex-wrap gap-2">
          {RETENTION_PRESETS.map((p) => (
            <div key={p.label} className="flex gap-1">
              <button onClick={() => archiveByPeriod(p.days)} disabled={processing}
                className="inline-flex items-center gap-1 px-3 py-1.5 border border-border text-[9px] tracking-[0.1em] uppercase hover:border-primary/50 transition-all disabled:opacity-50" style={headingFont}>
                <Archive className="h-3 w-3" /> Archive older than {p.label}
              </button>
              <button onClick={() => deleteByPeriod(p.days)} disabled={processing}
                className="inline-flex items-center gap-1 px-3 py-1.5 border border-destructive/30 text-[9px] tracking-[0.1em] uppercase text-destructive hover:border-destructive transition-all disabled:opacity-50" style={headingFont}>
                <Trash2 className="h-3 w-3" /> Delete older than {p.label}
              </button>
            </div>
          ))}
        </div>
        {dateFrom && dateTo && (
          <button onClick={deleteCustomRange} disabled={processing}
            className="inline-flex items-center gap-1.5 px-4 py-2 border border-destructive/30 text-[10px] tracking-[0.1em] uppercase text-destructive hover:border-destructive transition-all disabled:opacity-50" style={headingFont}>
            <Calendar className="h-3.5 w-3.5" /> Delete Custom Range ({dateFrom} to {dateTo})
          </button>
        )}
      </div>

      {/* Bulk actions */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-3 border border-primary/30 bg-primary/5">
          <span className="text-xs text-primary" style={headingFont}>{selectedIds.size} selected</span>
          <button onClick={deleteSelected} disabled={processing}
            className="inline-flex items-center gap-1 text-[10px] tracking-[0.1em] uppercase text-destructive hover:opacity-70" style={headingFont}>
            <Trash2 className="h-3.5 w-3.5" /> Delete Selected
          </button>
        </div>
      )}

      {/* Logs Table */}
      {loading && page === 0 ? (
        <div className="text-center py-16">
          <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
        </div>
      ) : logs.length === 0 ? (
        <div className="border border-dashed border-border p-12 text-center">
          <p className="text-sm text-muted-foreground" style={bodyFont}>No activity logs found.</p>
        </div>
      ) : (
        <>
          <div className="border border-border divide-y divide-border text-xs">
            {/* Header row */}
            <div className="flex items-center gap-3 px-4 py-3 bg-muted/30 text-[9px] tracking-[0.2em] uppercase text-muted-foreground" style={headingFont}>
              <input type="checkbox" checked={selectedIds.size === logs.length && logs.length > 0} onChange={selectAll} className="accent-primary" />
              <span className="w-36">Date</span>
              <span className="w-32">User</span>
              <span className="w-24">Category</span>
              <span className="w-32">Action</span>
              <span className="flex-1">Description</span>
              <span className="w-24">Page</span>
            </div>
            {logs.map((log) => (
              <div key={log.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/20 transition-colors">
                <input type="checkbox" checked={selectedIds.has(log.id)} onChange={() => toggleSelect(log.id)} className="accent-primary" />
                <span className="w-36 text-muted-foreground shrink-0" style={bodyFont}>
                  {new Date(log.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="w-32 truncate" style={bodyFont}>{log.user_name || log.user_id.slice(0, 8)}</span>
                <span className="w-24 shrink-0">
                  <span className={`text-[8px] tracking-[0.15em] uppercase px-2 py-0.5 border ${categoryColor(log.action_category)}`} style={headingFont}>
                    {log.action_category}
                  </span>
                </span>
                <span className="w-32 truncate" style={bodyFont}>{log.action_type}</span>
                <span className="flex-1 truncate text-muted-foreground" style={bodyFont}>{log.description || "—"}</span>
                <span className="w-24 truncate text-muted-foreground" style={bodyFont}>{log.page_path || "—"}</span>
              </div>
            ))}
          </div>
          {hasMore && (
            <div className="text-center pt-4">
              <button onClick={() => { setPage((p) => p + 1); fetchLogs(false); }}
                className="px-6 py-2 border border-border text-[10px] tracking-[0.15em] uppercase hover:border-primary/50 transition-all" style={headingFont}>
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin inline" /> : "Load More"}
              </button>
            </div>
          )}
        </>
      )}
      <ConfirmDialog {...dialogProps} />
    </div>
  );
};

export default AdminActivityLogs;
