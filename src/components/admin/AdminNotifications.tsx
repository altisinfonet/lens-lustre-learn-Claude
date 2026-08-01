import { useEffect, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Bell, Check, Trash2, Eye, AlertTriangle, Briefcase, MessageSquare, HelpCircle, UserPlus, Filter, Wallet } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/core/use-toast";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };

interface AdminNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  reference_id: string | null;
  is_read: boolean;
  created_at: string;
}

const TYPE_ICON: Record<string, typeof Bell> = {
  role_application: Briefcase,
  post_report: AlertTriangle,
  comment_report: MessageSquare,
  support_ticket: HelpCircle,
  deposit_request: Wallet,
  new_signup: UserPlus,
};

const TYPE_LABEL: Record<string, string> = {
  role_application: "Role Application",
  post_report: "Post Report",
  comment_report: "Comment Report",
  support_ticket: "Support Ticket",
  deposit_request: "Deposit Request",
  new_signup: "New Signup",
};

const TYPE_COLOR: Record<string, string> = {
  role_application: "bg-primary/10 text-primary border-primary/30",
  post_report: "bg-destructive/10 text-destructive border-destructive/30",
  comment_report: "bg-muted text-muted-foreground border-border",
  support_ticket: "bg-muted text-muted-foreground border-border",
  deposit_request: "bg-muted text-muted-foreground border-border",
  new_signup: "bg-primary/10 text-primary border-primary/30",
};

const AdminNotifications = () => {
  const qc = useQueryClient();
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterType, setFilterType] = useState<string>("all");
  const [filterRead, setFilterRead] = useState<string>("all");

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("admin_notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (filterRead === "unread") query = query.eq("is_read", false);
    if (filterRead === "read") query = query.eq("is_read", true);
    if (filterType !== "all") query = query.eq("type", filterType);

    const { data } = await query;
    setNotifications((data as AdminNotification[]) || []);
    setLoading(false);
  }, [filterType, filterRead]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel("admin-notifs-panel")
      .on("postgres_changes", { event: "*", schema: "public", table: "admin_notifications" }, () => {
        fetchNotifications();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchNotifications]);

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === notifications.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(notifications.map(n => n.id)));
    }
  };

  const markRead = async (ids: string[]) => {
    const { error } = await supabase
      .from("admin_notifications")
      .update({ is_read: true })
      .in("id", ids);

    if (error) {
      toast({ title: "Could not mark notifications as read", variant: "destructive" });
      return;
    }

    setSelected(new Set());
    fetchNotifications();
    qc.invalidateQueries({ queryKey: ["admin-notifications-unread"] });
    toast({ title: `Marked ${ids.length} as read` });
  };

  const deleteNotifs = async (ids: string[]) => {
    const { error } = await supabase
      .from("admin_notifications")
      .delete()
      .in("id", ids);

    if (error) {
      toast({ title: "Could not delete notifications", variant: "destructive" });
      return;
    }

    setSelected(new Set());
    fetchNotifications();
    qc.invalidateQueries({ queryKey: ["admin-notifications-unread"] });
    toast({ title: `Deleted ${ids.length} notification(s)` });
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  const filtered = notifications;
  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm tracking-[0.15em] uppercase text-foreground" style={headingFont}>
            Admin Notifications
          </h2>
          {unreadCount > 0 && (
            <Badge variant="secondary" className="bg-primary/10 text-primary text-[10px]">
              {unreadCount} unread
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="h-8 text-xs w-[140px]">
              <Filter className="h-3 w-3 mr-1" />
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="role_application">Role Applications</SelectItem>
              <SelectItem value="post_report">Post Reports</SelectItem>
              <SelectItem value="comment_report">Comment Reports</SelectItem>
              <SelectItem value="support_ticket">Support Tickets</SelectItem>
              <SelectItem value="deposit_request">Deposit Requests</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filterRead} onValueChange={setFilterRead}>
            <SelectTrigger className="h-8 text-xs w-[120px]">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="unread">Unread</SelectItem>
              <SelectItem value="read">Read</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Bulk Actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 p-2 bg-muted/30 border border-border rounded-md">
          <span className="text-xs text-muted-foreground" style={bodyFont}>{selected.size} selected</span>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => markRead(Array.from(selected))}>
            <Check className="h-3 w-3 mr-1" /> Mark Read
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => deleteNotifs(Array.from(selected))}>
            <Trash2 className="h-3 w-3 mr-1" /> Delete
          </Button>
        </div>
      )}

      {/* Mobile Card View */}
      <div className="flex flex-col gap-2 md:hidden">
        {loading ? (
          <div className="py-8 text-center text-xs text-muted-foreground animate-pulse" style={headingFont}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center">
            <Bell className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground" style={bodyFont}>No notifications</p>
          </div>
        ) : filtered.map((notif, idx) => {
          const Icon = TYPE_ICON[notif.type] || Bell;
          return (
            <div key={notif.id} className={`bg-card rounded-xl border border-border shadow-sm p-3 cursor-pointer ${!notif.is_read ? "border-l-2 border-l-primary" : ""}`} onClick={() => { if (!notif.is_read) markRead([notif.id]); }}>
              <div className="flex items-start gap-3">
                <Checkbox checked={selected.has(notif.id)} onCheckedChange={() => toggleSelect(notif.id)} className="mt-1" />
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${TYPE_COLOR[notif.type] || "bg-muted text-muted-foreground"}`}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${TYPE_COLOR[notif.type] || ""}`}>
                      {TYPE_LABEL[notif.type] || notif.type}
                    </Badge>
                    {!notif.is_read && <span className="w-2 h-2 rounded-full bg-primary shrink-0" />}
                  </div>
                  <p className="text-xs" style={bodyFont}>{notif.message}</p>
                  <span className="text-[9px] text-muted-foreground" style={headingFont}>{timeAgo(notif.created_at)}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 mt-2 ml-11">
                {!notif.is_read && (
                  <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => markRead([notif.id])}>
                    <Eye className="h-3 w-3 mr-1" /> Mark Read
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-destructive" onClick={() => deleteNotifs([notif.id])}>
                  <Trash2 className="h-3 w-3 mr-1" /> Delete
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop Table View */}
      <div className="hidden md:block border border-border rounded-md overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="w-10">
                <Checkbox checked={selected.size === filtered.length && filtered.length > 0} onCheckedChange={selectAll} />
              </TableHead>
              <TableHead className="text-[10px] tracking-[0.15em] uppercase" style={headingFont}>#</TableHead>
              <TableHead className="text-[10px] tracking-[0.15em] uppercase" style={headingFont}>Type</TableHead>
              <TableHead className="text-[10px] tracking-[0.15em] uppercase" style={headingFont}>Message</TableHead>
              <TableHead className="text-[10px] tracking-[0.15em] uppercase" style={headingFont}>Status</TableHead>
              <TableHead className="text-[10px] tracking-[0.15em] uppercase" style={headingFont}>Time</TableHead>
              <TableHead className="text-[10px] tracking-[0.15em] uppercase text-right" style={headingFont}>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-xs text-muted-foreground animate-pulse">Loading...</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-xs text-muted-foreground">No notifications</TableCell></TableRow>
            ) : filtered.map((notif, idx) => {
              const Icon = TYPE_ICON[notif.type] || Bell;
              return (
                <TableRow key={notif.id} className={`cursor-pointer ${!notif.is_read ? "bg-primary/[0.02]" : ""}`} onClick={() => { if (!notif.is_read) markRead([notif.id]); }}>
                  <TableCell><Checkbox checked={selected.has(notif.id)} onCheckedChange={() => toggleSelect(notif.id)} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center ${TYPE_COLOR[notif.type] || "bg-muted"}`}>
                        <Icon className="h-3 w-3" />
                      </div>
                      <span className="text-xs" style={bodyFont}>{TYPE_LABEL[notif.type] || notif.type}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs max-w-[400px]" style={bodyFont}>
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="block truncate cursor-default">{notif.message}</span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" align="start" className="max-w-[420px] text-xs leading-relaxed whitespace-pre-wrap break-words">
                          {notif.message}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableCell>
                  <TableCell>
                    {notif.is_read ? (
                      <Badge variant="outline" className="text-[9px] text-muted-foreground">Read</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[9px] bg-primary/10 text-primary border-primary/30">Unread</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-[10px] text-muted-foreground whitespace-nowrap" style={headingFont}>{timeAgo(notif.created_at)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {!notif.is_read && (
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => markRead([notif.id])} title="Mark read">
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => deleteNotifs([notif.id])} title="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default AdminNotifications;
