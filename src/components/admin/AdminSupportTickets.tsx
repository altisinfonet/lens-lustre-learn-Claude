import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cachedFetchProfilesByIds } from "@/lib/profileBatch";
import { generateImagePath, uploadImage } from "@/lib/imageUpload";
import { toast } from "@/hooks/core/use-toast";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { useConfirmAction } from "@/hooks/admin/useConfirmAction";
import { Send, Clock, CheckCircle, MessageSquare, XCircle, ChevronDown, ChevronUp, Paperclip, FileText, Image, X, Trash2, ArrowUpDown } from "lucide-react";
import { scanFileWithToast } from "@/lib/fileSecurityScanner";
import { Checkbox } from "@/components/ui/checkbox";

interface Ticket {
  id: string;
  user_id: string;
  subject: string;
  status: string;
  created_at: string;
  updated_at: string;
  user_name?: string;
  user_email?: string;
}

interface Reply {
  id: string;
  ticket_id: string;
  user_id: string;
  message: string;
  is_admin: boolean;
  created_at: string;
  attachment_url?: string | null;
  attachment_name?: string | null;
}

interface Props {
  user: any;
}

const AdminSupportTickets = ({ user }: Props) => {
  const qc = useQueryClient();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTicket, setExpandedTicket] = useState<string | null>(null);
  const [replies, setReplies] = useState<Record<string, Reply[]>>({});
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [sendingReply, setSendingReply] = useState<string | null>(null);
  const [replyFiles, setReplyFiles] = useState<Record<string, File | null>>({});
  const [filter, setFilter] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const { confirm: confirmAction, dialogProps } = useConfirmAction();

  useEffect(() => {
    fetchTickets();
  }, []);

  const fetchTickets = async () => {
    const { data } = await supabase
      .from("support_tickets")
      .select("id, user_id, subject, status, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(50);

    if (data && data.length > 0) {
      const userIds = [...new Set((data as any[]).map((t: any) => t.user_id))];
      const profileMap = await cachedFetchProfilesByIds(userIds);

      setTickets(
        (data as any[]).map((t: any) => ({
          ...t,
          user_name: profileMap.get(t.user_id) || "Unknown User",
        }))
      );
    } else {
      setTickets([]);
    }
    setLoading(false);
  };

  const fetchReplies = async (ticketId: string) => {
    const { data } = await supabase
      .from("ticket_replies")
      .select("*")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true });
    setReplies((prev) => ({ ...prev, [ticketId]: (data as any[]) || [] }));
  };

  const handleToggle = (ticketId: string) => {
    if (expandedTicket === ticketId) {
      setExpandedTicket(null);
    } else {
      setExpandedTicket(ticketId);
      fetchReplies(ticketId);
    }
  };

  const uploadAttachment = async (file: File): Promise<{ url: string; name: string } | null> => {
    const safe = await scanFileWithToast(file, toast, { allowedTypes: "image+pdf", maxSize: 50 * 1024 * 1024 });
    if (!safe) return null;
    const ext = file.name.split(".").pop() || "bin";
    const path = generateImagePath({ userId: user.id, type: "support", ext });
    try {
      const result = await uploadImage({ bucket: "support-attachments", file, path, type: "support", fileName: file.name });
      return { url: result.url, name: file.name };
    } catch (error: any) {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
      return null;
    }
  };

  const handleSendReply = async (ticketId: string) => {
    const text = replyText[ticketId]?.trim();
    const file = replyFiles[ticketId];
    if ((!text && !file) || !user) return;
    setSendingReply(ticketId);

    let attachment: { url: string; name: string } | null = null;
    if (file) {
      attachment = await uploadAttachment(file);
      if (!attachment) { setSendingReply(null); return; }
    }

    await supabase.from("ticket_replies").insert({
      ticket_id: ticketId,
      user_id: user.id,
      message: text || (attachment ? `Attached: ${attachment.name}` : ""),
      is_admin: true,
      ...(attachment ? { attachment_url: attachment.url, attachment_name: attachment.name } : {}),
    } as any);

    await supabase.from("support_tickets").update({ status: "replied", updated_at: new Date().toISOString() } as any).eq("id", ticketId);

    setReplyText((prev) => ({ ...prev, [ticketId]: "" }));
    setReplyFiles((prev) => ({ ...prev, [ticketId]: null }));
    setSendingReply(null);
    fetchReplies(ticketId);
    setTickets((prev) => prev.map((t) => t.id === ticketId ? { ...t, status: "replied", updated_at: new Date().toISOString() } : t));
  };

  const AttachmentDisplay = ({ url, name }: { url: string; name: string }) => {
    const isPdf = name?.toLowerCase().endsWith(".pdf");
    const [signedUrl, setSignedUrl] = useState<string | null>(null);

    useEffect(() => {
      if (url && !url.startsWith("http")) {
        import("@/lib/storageUpload").then(({ storageGetSignedUrl }) => {
          storageGetSignedUrl("support-attachments", url).then(setSignedUrl).catch(() => setSignedUrl(null));
        });
      } else {
        setSignedUrl(url);
      }
    }, [url]);

    const href = signedUrl || url;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 bg-muted/50 border border-border rounded text-xs hover:border-primary transition-colors">
        {isPdf ? <FileText className="h-3 w-3 text-red-500" /> : <Image className="h-3 w-3 text-blue-500" />}
        <span className="truncate max-w-[180px]">{name || "attachment"}</span>
      </a>
    );
  };

  const updateTicketStatus = async (ticketId: string, newStatus: string) => {
    await supabase.from("support_tickets").update({ status: newStatus, updated_at: new Date().toISOString() } as any).eq("id", ticketId);
    setTickets((prev) => prev.map((t) => t.id === ticketId ? { ...t, status: newStatus } : t));
    toast({ title: `Ticket marked as ${newStatus}` });
  };

  const handleSelectToggle = (ticketId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(ticketId)) next.delete(ticketId);
      else next.add(ticketId);
      return next;
    });
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(filtered.map((t) => t.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    confirmAction({
      title: `Delete ${selectedIds.size} ticket(s)?`,
      description: "This will also delete all replies. This cannot be undone.",
      onConfirm: async () => {
        setDeleting(true);
        const ids = Array.from(selectedIds);
        // Soft-delete: mark as 'deleted' instead of hard delete
        await supabase.from("support_tickets").update({ status: "deleted", updated_at: new Date().toISOString() } as any).in("id", ids);
        setTickets((prev) => prev.filter((t) => !selectedIds.has(t.id)));
        setSelectedIds(new Set());
        setExpandedTicket(null);
        setDeleting(false);
        qc.invalidateQueries({ queryKey: ["support-tickets"] });
        toast({ title: `${ids.length} ticket(s) removed` });
      },
    });
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "open": return <Clock className="h-3.5 w-3.5 text-yellow-500" />;
      case "replied": return <MessageSquare className="h-3.5 w-3.5 text-primary" />;
      case "resolved": return <CheckCircle className="h-3.5 w-3.5 text-green-500" />;
      case "closed": return <XCircle className="h-3.5 w-3.5 text-muted-foreground" />;
      default: return <Clock className="h-3.5 w-3.5" />;
    }
  };

  const filtered = (filter === "all" ? tickets : tickets.filter((t) => t.status === filter))
    .sort((a, b) => {
      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();
      return sortOrder === "newest" ? dateB - dateA : dateA - dateB;
    });

  if (loading) {
    return (
      <div className="text-xs tracking-[0.3em] uppercase text-muted-foreground animate-pulse py-12 text-center" style={{ fontFamily: "var(--font-heading)" }}>
        Loading tickets...
      </div>
    );
  }

  return (
    <div>
      {/* Top bar: count, sort, filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
            {filtered.length} ticket{filtered.length !== 1 ? "s" : ""}
          </span>
          {/* Sort toggle */}
          <button
            onClick={() => setSortOrder((o) => o === "newest" ? "oldest" : "newest")}
            className="inline-flex items-center gap-1 text-[10px] tracking-[0.15em] uppercase px-3 py-1.5 border border-border text-muted-foreground hover:border-foreground hover:text-foreground transition-all"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            <ArrowUpDown className="h-3 w-3" />
            {sortOrder === "newest" ? "Newest first" : "Oldest first"}
          </button>
        </div>

        <div className="flex gap-2 flex-wrap">
          {["all", "open", "replied", "resolved", "closed"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[10px] tracking-[0.15em] uppercase px-3 py-1.5 border transition-all ${filter === f ? "border-primary text-primary" : "border-border text-muted-foreground hover:border-foreground"}`}
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk actions bar — only visible when items selected */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-4 mb-4 px-4 py-3 border border-destructive/30 bg-destructive/5">
          <span className="text-[10px] tracking-[0.15em] uppercase text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
            {selectedIds.size} selected
          </span>
          <button
            onClick={handleBulkDelete}
            disabled={deleting}
            className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase px-4 py-1.5 bg-destructive text-destructive-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            <Trash2 className="h-3 w-3" />
            {deleting ? "Deleting..." : "Delete Selected"}
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground hover:text-foreground transition-colors"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Clear
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="border border-border p-10 text-center">
          <MessageSquare className="h-8 w-8 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-sm text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
            No tickets found.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Select all */}
          <div className="flex items-center gap-2 px-6 py-2">
            <Checkbox
              checked={filtered.length > 0 && filtered.every((t) => selectedIds.has(t.id))}
              onCheckedChange={(checked) => handleSelectAll(!!checked)}
            />
            <span className="text-[9px] tracking-[0.15em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
              Select all
            </span>
          </div>

          {filtered.map((ticket) => (
            <div key={ticket.id} className={`border ${selectedIds.has(ticket.id) ? "border-primary/50 bg-primary/5" : "border-border"}`}>
              {/* Header */}
              <div className="flex items-center gap-2 px-6 py-4">
                <Checkbox
                  checked={selectedIds.has(ticket.id)}
                  onCheckedChange={() => handleSelectToggle(ticket.id)}
                  onClick={(e) => e.stopPropagation()}
                />
                <button
                  onClick={() => handleToggle(ticket.id)}
                  className="flex-1 flex items-center gap-4 text-left hover:bg-muted/30 transition-colors -my-4 py-4 -mr-6 pr-6"
                >
                  {statusIcon(ticket.status)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ fontFamily: "var(--font-body)" }}>
                      {ticket.subject}
                    </p>
                    <p className="text-[10px] tracking-[0.1em] uppercase text-muted-foreground mt-1" style={{ fontFamily: "var(--font-heading)" }}>
                      <span className="text-foreground/70">{ticket.user_name}</span>
                      {" · "}
                      {new Date(ticket.created_at).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      {" · "}
                      <span className={ticket.status === "open" ? "text-yellow-500" : ticket.status === "replied" ? "text-primary" : ticket.status === "resolved" ? "text-green-500" : "text-muted-foreground"}>
                        {ticket.status.toUpperCase()}
                      </span>
                    </p>
                  </div>
                  {expandedTicket === ticket.id ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </button>
              </div>

              {/* Thread */}
              {expandedTicket === ticket.id && (
                <div className="border-t border-border px-6 py-4 space-y-4">
                  {/* Status actions */}
                  <div className="flex gap-2 mb-3">
                    {ticket.status !== "resolved" && (
                      <button
                        onClick={() => updateTicketStatus(ticket.id, "resolved")}
                        className="text-[9px] tracking-[0.15em] uppercase px-3 py-1.5 border border-green-500/30 text-green-500 hover:bg-green-500/10 transition-all"
                        style={{ fontFamily: "var(--font-heading)" }}
                      >
                        Mark Resolved
                      </button>
                    )}
                    {ticket.status !== "closed" && (
                      <button
                        onClick={() => updateTicketStatus(ticket.id, "closed")}
                        className="text-[9px] tracking-[0.15em] uppercase px-3 py-1.5 border border-border text-muted-foreground hover:text-foreground transition-all"
                        style={{ fontFamily: "var(--font-heading)" }}
                      >
                        Close Ticket
                      </button>
                    )}
                    {(ticket.status === "resolved" || ticket.status === "closed") && (
                      <button
                        onClick={() => updateTicketStatus(ticket.id, "open")}
                        className="text-[9px] tracking-[0.15em] uppercase px-3 py-1.5 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 transition-all"
                        style={{ fontFamily: "var(--font-heading)" }}
                      >
                        Reopen
                      </button>
                    )}
                  </div>

                  {/* Messages */}
                  {(replies[ticket.id] || []).map((reply) => (
                    <div
                      key={reply.id}
                      className={`flex ${reply.is_admin ? "justify-end" : "justify-start"}`}
                    >
                      <div className={`max-w-[80%] px-4 py-3 rounded-lg ${reply.is_admin ? "bg-primary/10 border border-primary/20" : "bg-muted/50 border border-border"}`}>
                        <p className="text-[9px] tracking-[0.15em] uppercase mb-1.5 font-semibold" style={{ fontFamily: "var(--font-heading)" }}>
                          {reply.is_admin ? (
                            <span className="text-primary">50mm Retina World (You)</span>
                          ) : (
                            <span className="text-muted-foreground">{ticket.user_name}</span>
                          )}
                          <span className="text-muted-foreground/50 ml-2 font-normal">
                            {new Date(reply.created_at).toLocaleDateString("en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </p>
                        <p className="text-sm text-foreground whitespace-pre-wrap" style={{ fontFamily: "var(--font-body)" }}>
                          {reply.message}
                        </p>
                        {reply.attachment_url && reply.attachment_name && (
                          <AttachmentDisplay url={reply.attachment_url} name={reply.attachment_name} />
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Admin Reply */}
                  <div className="space-y-2 pt-2">
                    {replyFiles[ticket.id] && (
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-muted/50 border border-border text-xs">
                        <Paperclip className="h-3 w-3" />
                        <span className="truncate max-w-[180px]">{replyFiles[ticket.id]!.name}</span>
                        <button onClick={() => setReplyFiles((prev) => ({ ...prev, [ticket.id]: null }))} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
                      </div>
                    )}
                    <div className="flex gap-3">
                      <textarea
                        value={replyText[ticket.id] || ""}
                        onChange={(e) => setReplyText((prev) => ({ ...prev, [ticket.id]: e.target.value }))}
                        placeholder="Type your reply to the user..."
                        maxLength={2000}
                        rows={2}
                        className="flex-1 bg-transparent border border-border focus:border-primary outline-none p-3 text-sm resize-none"
                        style={{ fontFamily: "var(--font-body)" }}
                      />
                      <div className="flex flex-col gap-2 self-end">
                        <label className="cursor-pointer p-2 text-muted-foreground hover:text-foreground transition-colors border border-border hover:border-primary">
                          <Paperclip className="h-4 w-4" />
                          <input type="file" accept="image/jpeg,image/jpg,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && setReplyFiles((prev) => ({ ...prev, [ticket.id]: e.target.files![0] }))} />
                        </label>
                        <button
                          onClick={() => handleSendReply(ticket.id)}
                          disabled={sendingReply === ticket.id || (!replyText[ticket.id]?.trim() && !replyFiles[ticket.id])}
                          className="inline-flex items-center gap-1.5 text-xs tracking-[0.1em] uppercase px-4 py-2.5 bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
                          style={{ fontFamily: "var(--font-heading)" }}
                        >
                          <Send className="h-3 w-3" /> Reply
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog {...dialogProps} />
    </div>
  );
};

export default AdminSupportTickets;
