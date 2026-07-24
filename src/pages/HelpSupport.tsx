import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/core/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { generateImagePath, uploadImage } from "@/lib/imageUpload";
import { toast } from "@/hooks/core/use-toast";
import { motion } from "framer-motion";
import { Plus, Send, MessageSquare, Clock, CheckCircle, XCircle, ChevronDown, ChevronUp, Paperclip, FileText, Image, Loader2, X, FileSpreadsheet } from "lucide-react";
import { scanFileWithToast } from "@/lib/fileSecurityScanner";
import FileUploadDropZone, { type UploadedFile } from "@/components/FileUploadDropZone";
import { useT } from "@/i18n/I18nContext";

interface Ticket {
  id: string;
  subject: string;
  status: string;
  created_at: string;
  updated_at: string;
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

const HelpSupport = () => {
  const t = useT();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [subject, setSubject] = useState("");
  const [issue, setIssue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [expandedTicket, setExpandedTicket] = useState<string | null>(null);
  const [replies, setReplies] = useState<Record<string, Reply[]>>({});
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [sendingReply, setSendingReply] = useState<string | null>(null);
  const [issueFile, setIssueFile] = useState<File | null>(null);
  const [issuePreUpload, setIssuePreUpload] = useState<{ url: string; name: string } | null>(null);
  const [replyFiles, setReplyFiles] = useState<Record<string, File | null>>({});
  const [uploadingFile, setUploadingFile] = useState(false);

  // Page is intentionally PUBLIC: it is the account/data-deletion resource URL
  // declared in the Google Play Data safety form, and Google requires that
  // deletion info be reachable without signing in (users may have lost access).
  // Only the ticket features below require a session.
  useEffect(() => {
    if (!authLoading && !user) setLoading(false);
  }, [user, authLoading]);

  useEffect(() => {
    if (!user) return;
    fetchTickets();
  }, [user]);

  const fetchTickets = async () => {
    const { data } = await supabase
      .from("support_tickets")
      .select("*")
      .eq("user_id", user!.id)
      .order("created_at", { ascending: false });
    setTickets((data as any[]) || []);
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

  const handleToggleTicket = (ticketId: string) => {
    if (expandedTicket === ticketId) {
      setExpandedTicket(null);
    } else {
      setExpandedTicket(ticketId);
      if (!replies[ticketId]) fetchReplies(ticketId);
    }
  };

  const uploadAttachment = async (file: File): Promise<{ url: string; name: string } | null> => {
    const safe = await scanFileWithToast(file, toast, { allowedTypes: "image+pdf+document", maxSize: 50 * 1024 * 1024 });
    if (!safe) return null;
    const ext = file.name.split(".").pop() || "bin";
    const path = generateImagePath({ userId: user!.id, type: "support", ext });
    try {
      const result = await uploadImage({ bucket: "support-attachments", file, path, type: "support", fileName: file.name });
      return { url: result.url, name: file.name };
    } catch (error: any) {
      toast({ title: t("mp.uploadFailed"), description: error.message, variant: "destructive" });
      return null;
    }
  };

  const handleSubmit = async () => {
    if (!user || !subject.trim() || !issue.trim()) {
      toast({ title: t("hs.fillBoth"), variant: "destructive" });
      return;
    }
    setSubmitting(true);

    let attachment: { url: string; name: string } | null = issuePreUpload || null;
    if (!attachment && issueFile) {
      setUploadingFile(true);
      attachment = await uploadAttachment(issueFile);
      setUploadingFile(false);
      if (!attachment) { setSubmitting(false); return; }
    }

    const { data: ticket, error: ticketErr } = await supabase
      .from("support_tickets")
      .insert({ user_id: user.id, subject: subject.trim() } as any)
      .select("id")
      .single();

    if (ticketErr || !ticket) {
      toast({ title: t("hs.ticketFailed"), description: ticketErr?.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }

    await supabase.from("ticket_replies").insert({
      ticket_id: (ticket as any).id,
      user_id: user.id,
      message: issue.trim(),
      is_admin: false,
      ...(attachment ? { attachment_url: attachment.url, attachment_name: attachment.name } : {}),
    } as any);

    setSubmitting(false);
    setSubject("");
    setIssue("");
    setIssueFile(null);
    setIssuePreUpload(null);
    setShowForm(false);
    toast({ title: t("hs.ticketSubmitted") });
    fetchTickets();
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
      is_admin: false,
      ...(attachment ? { attachment_url: attachment.url, attachment_name: attachment.name } : {}),
    } as any);

    setReplyText((prev) => ({ ...prev, [ticketId]: "" }));
    setReplyFiles((prev) => ({ ...prev, [ticketId]: null }));
    setSendingReply(null);
    fetchReplies(ticketId);
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

  const AttachmentDisplay = ({ url, name }: { url: string; name: string }) => {
    const lower = name?.toLowerCase() || "";
    const isPdf = lower.endsWith(".pdf");
    const isDoc = /\.(docx?|xlsx?)$/.test(lower);
    const [signedUrl, setSignedUrl] = useState<string | null>(null);

    // If URL is not a full URL (private file path), get signed URL
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
        {isPdf ? <FileText className="h-3 w-3 text-red-500" /> : isDoc ? <FileSpreadsheet className="h-3 w-3 text-green-500" /> : <Image className="h-3 w-3 text-blue-500" />}
        <span className="truncate max-w-[180px]">{name || "attachment"}</span>
      </a>
    );
  };

  if (authLoading || loading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-xs tracking-[0.3em] uppercase text-muted-foreground animate-pulse" style={{ fontFamily: "var(--font-heading)" }}>
          {t("common.loading")}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto py-3 md:py-16 max-w-4xl">

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }}>
          <div className="flex items-center gap-3 mb-1 md:mb-2">
            <div className="w-8 md:w-12 h-px bg-primary hidden md:block" />
            <span className="text-[9px] md:text-[10px] tracking-[0.3em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>
              {t("hs.helpSupport")}
            </span>
          </div>
          <div className="flex items-center justify-between mb-4 md:mb-10">
            <h1 className="text-xl md:text-3xl font-light tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
              {t("hs.supportTickets")}
            </h1>
            {user && (
              <button
                onClick={() => setShowForm(!showForm)}
                className="inline-flex items-center gap-1.5 text-[10px] md:text-xs tracking-[0.15em] uppercase px-3 md:px-5 py-2 md:py-2.5 bg-primary text-primary-foreground hover:opacity-90 transition-opacity duration-500 rounded-lg md:rounded-none"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                <Plus className="h-3 w-3 md:h-3.5 md:w-3.5" /> {t("hs.newTicket")}
              </button>
            )}
          </div>

          {/* New Ticket Form */}
          {showForm && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="border border-border rounded-xl md:rounded-none p-4 md:p-8 mb-4 md:mb-10 space-y-4 md:space-y-5">
              <span className="text-xs tracking-[0.2em] uppercase text-primary block" style={{ fontFamily: "var(--font-heading)" }}>
                {t("hs.submitNewTicket")}
              </span>
              <div>
                <label htmlFor="support-subject" className="block text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2" style={{ fontFamily: "var(--font-heading)" }}>
                  {t("hs.subject")}
                </label>
                <input
                  id="support-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder={t("hs.phSubject")}
                  maxLength={200}
                  className="w-full bg-transparent border-b border-border focus:border-primary outline-none py-3 text-sm transition-colors duration-500"
                  style={{ fontFamily: "var(--font-body)" }}
                />
              </div>
              <div>
                <label htmlFor="support-issue" className="block text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2" style={{ fontFamily: "var(--font-heading)" }}>
                  {t("hs.issueDetails")}
                </label>
                <textarea
                  id="support-issue"
                  value={issue}
                  onChange={(e) => setIssue(e.target.value)}
                  placeholder={t("hs.phIssue")}
                  rows={4}
                  maxLength={2000}
                  className="w-full bg-transparent border border-border focus:border-primary outline-none p-4 text-sm transition-colors duration-500 resize-none"
                  style={{ fontFamily: "var(--font-body)" }}
                />
              </div>
              {/* File attachment */}
              <div>
                <label className="block text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2" style={{ fontFamily: "var(--font-heading)" }}>
                  {t("hs.attachment")} <span className="normal-case">{t("hs.attachmentNote")}</span>
                </label>
                {issueFile ? (
                  <div className="inline-flex items-center gap-2 px-3 py-2 bg-muted/50 border border-border text-sm">
                    {issueFile.name.toLowerCase().endsWith(".pdf") ? <FileText className="h-3.5 w-3.5 text-red-500" /> : /\.(docx?|xlsx?)$/i.test(issueFile.name) ? <FileSpreadsheet className="h-3.5 w-3.5 text-green-500" /> : <Image className="h-3.5 w-3.5 text-blue-500" />}
                    <span className="truncate max-w-[200px]">{issueFile.name}</span>
                    <button onClick={() => setIssueFile(null)} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
                  </div>
                ) : (
                  <FileUploadDropZone
                    bucket="support-attachments"
                    folder={user?.id || "uploads"}
                    allowedTypes="image+pdf+document"
                    maxSize={50 * 1024 * 1024}
                    compressImages={false}
                    showGallery={false}
                    compact
                    label="Drop file here or browse"
                    onFileUploaded={(uploaded) => {
                      setIssueFile(new File([], uploaded.name, { type: uploaded.type }));
                      setIssuePreUpload({ url: uploaded.url, name: uploaded.name });
                    }}
                  />
                )}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleSubmit}
                  disabled={submitting || uploadingFile}
                  className="inline-flex items-center gap-2 text-xs tracking-[0.15em] uppercase px-6 py-2.5 bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {uploadingFile ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                  {submitting ? t("hs.submitting") : t("hs.submitTicket")}
                </button>
                <button
                  onClick={() => { setShowForm(false); setSubject(""); setIssue(""); setIssueFile(null); setIssuePreUpload(null); }}
                  className="text-xs tracking-[0.15em] uppercase px-5 py-2.5 border border-border hover:border-primary transition-all"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {t("common.cancel")}
                </button>
              </div>
            </motion.div>
          )}

          {/* Guests: tickets need an account */}
          {!user && (
            <div className="border border-border rounded-xl md:rounded-none p-6 md:p-10 text-center mb-4 md:mb-10">
              <MessageSquare className="h-6 w-6 md:h-8 md:w-8 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground mb-4" style={{ fontFamily: "var(--font-body)" }}>
                {t("hs.signInToTrack")}
              </p>
              <button
                onClick={() => navigate("/login")}
                className="inline-flex items-center gap-1.5 text-[10px] md:text-xs tracking-[0.15em] uppercase px-4 py-2.5 bg-primary text-primary-foreground hover:opacity-90 transition-opacity duration-500"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                {t("auth.signIn")}
              </button>
            </div>
          )}

          {/* Tickets List */}
          {!user ? null : tickets.length === 0 ? (
            <div className="border border-border rounded-xl md:rounded-none p-6 md:p-10 text-center">
              <MessageSquare className="h-6 w-6 md:h-8 md:w-8 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                {t("hs.noTickets")}
              </p>
            </div>
          ) : (
            <div className="space-y-2 md:space-y-3">
              {tickets.map((ticket) => (
                <div key={ticket.id} className="border border-border rounded-xl md:rounded-none">
                  {/* Ticket Header */}
                  <button
                    onClick={() => handleToggleTicket(ticket.id)}
                    className="w-full flex items-center gap-4 px-6 py-4 text-left hover:bg-muted/30 transition-colors"
                  >
                    {statusIcon(ticket.status)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ fontFamily: "var(--font-body)" }}>
                        {ticket.subject}
                      </p>
                      <p className="text-[10px] tracking-[0.1em] uppercase text-muted-foreground mt-1" style={{ fontFamily: "var(--font-heading)" }}>
                        {new Date(ticket.created_at).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                        {" · "}
                        <span className={ticket.status === "open" ? "text-yellow-500" : ticket.status === "replied" ? "text-primary" : ticket.status === "resolved" ? "text-green-500" : "text-muted-foreground"}>
                          {ticket.status.toUpperCase()}
                        </span>
                      </p>
                    </div>
                    {expandedTicket === ticket.id ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </button>

                  {/* Thread */}
                  {expandedTicket === ticket.id && (
                    <div className="border-t border-border px-6 py-4 space-y-4">
                      {(replies[ticket.id] || []).map((reply) => (
                        <div
                          key={reply.id}
                          className={`flex ${reply.is_admin ? "justify-start" : "justify-end"}`}
                        >
                          <div className={`max-w-[80%] px-4 py-3 rounded-lg ${reply.is_admin ? "bg-primary/10 border border-primary/20" : "bg-muted/50 border border-border"}`}>
                            <p className="text-[9px] tracking-[0.15em] uppercase mb-1.5 font-semibold" style={{ fontFamily: "var(--font-heading)" }}>
                              {reply.is_admin ? (
                                <span className="text-primary">50mm Retina World Support</span>
                              ) : (
                                <span className="text-muted-foreground">{t("hs.you")}</span>
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

                      {/* Reply input (only for open/replied tickets) */}
                      {(ticket.status === "open" || ticket.status === "replied") && (
                        <div className="space-y-2 pt-2">
                          {replyFiles[ticket.id] && (
                            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-muted/50 border border-border text-xs">
                              <Paperclip className="h-3 w-3" />
                              <span className="truncate max-w-[180px]">{replyFiles[ticket.id]!.name}</span>
                              <button onClick={() => setReplyFiles((prev) => ({ ...prev, [ticket.id]: null }))} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
                            </div>
                          )}
                          <div className="flex gap-2">
                            <input
                              value={replyText[ticket.id] || ""}
                              onChange={(e) => setReplyText((prev) => ({ ...prev, [ticket.id]: e.target.value }))}
                              placeholder={t("hs.phReply")}
                              maxLength={2000}
                              className="flex-1 bg-transparent border-b border-border focus:border-primary outline-none py-2 text-sm"
                              style={{ fontFamily: "var(--font-body)" }}
                              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendReply(ticket.id); } }}
                            />
                            <label className="cursor-pointer self-end p-2 text-muted-foreground hover:text-foreground transition-colors">
                              <Paperclip className="h-4 w-4" />
                              <input type="file" accept="image/jpeg,image/jpg,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => e.target.files?.[0] && setReplyFiles((prev) => ({ ...prev, [ticket.id]: e.target.files![0] }))} />
                            </label>
                            <button
                              onClick={() => handleSendReply(ticket.id)}
                              disabled={sendingReply === ticket.id || (!replyText[ticket.id]?.trim() && !replyFiles[ticket.id])}
                              className="self-end inline-flex items-center gap-1.5 text-xs tracking-[0.1em] uppercase px-4 py-2 bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
                              style={{ fontFamily: "var(--font-heading)" }}
                            >
                              <Send className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Account & Data Deletion — PUBLIC section. This page is the deletion
              resource URL declared in the Google Play Data safety form, so this
              information must be visible without signing in. */}
          <section id="delete-account" className="mt-8 md:mt-14 border border-border rounded-xl md:rounded-none p-4 md:p-8">
            <span className="text-[9px] md:text-[10px] tracking-[0.3em] uppercase text-primary block mb-3" style={{ fontFamily: "var(--font-heading)" }}>
              {t("hs.accountDeletion")}
            </span>
            <h2 className="text-lg md:text-2xl font-light tracking-tight mb-4" style={{ fontFamily: "var(--font-display)" }}>
              {t("hs.deleteYourAccount")}
            </h2>
            <div className="space-y-3 text-sm text-muted-foreground leading-relaxed" style={{ fontFamily: "var(--font-body)" }}>
              <p>
                You can permanently delete your account and all associated data yourself, at any
                time, from the app or the website:
              </p>
              <ol className="list-decimal pl-5 space-y-1.5">
                <li>Sign in and open <span className="text-foreground">Dashboard → Settings</span>.</li>
                <li>Scroll to the <span className="text-foreground">Danger Zone</span> section.</li>
                <li>Tap <span className="text-foreground">Delete My Account</span> and type DELETE to confirm.</li>
              </ol>
              <p>
                Deletion is immediate and permanent. It removes your profile, photos, posts,
                stories, comments, likes, competition entries, certificates, wallet, and sign-in
                credentials, and frees your email address. Records that we are legally required to
                keep (for example financial payout ledgers) are retained only as required by law.
              </p>
              <p>
                Lost access to your account? Email{" "}
                <a href="mailto:altisappdev@gmail.com" className="text-primary underline underline-offset-2">
                  altisappdev@gmail.com
                </a>{" "}
                from your registered email address and we will process the deletion for you.
              </p>
            </div>
          </section>
        </motion.div>
      </div>
    </main>
  );
};

export default HelpSupport;
