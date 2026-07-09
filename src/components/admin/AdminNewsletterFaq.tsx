import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { Loader2, Plus, Trash2, Save, Mail, HelpCircle, Search, Download, Sparkles, TrendingUp, Check, Pencil, UserX } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { useConfirmAction } from "@/hooks/admin/useConfirmAction";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };

/* ── Types ── */
interface Subscriber {
  id: string;
  email: string;
  source: string;
  user_id: string | null;
  subscribed_at: string;
  is_active: boolean;
  user_name?: string | null;
}

interface FaqEntry {
  id: string;
  question: string;
  answer: string;
  keywords: string[];
  sort_order: number;
  is_active: boolean;
}

const AdminNewsletterFaq = () => {
  const [subTab, setSubTab] = useState<"newsletter" | "faq" | "trending">("newsletter");

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-px bg-primary" />
          <span className="text-[10px] tracking-[0.3em] uppercase text-primary" style={headingFont}>Management</span>
        </div>
        <h2 className="text-2xl md:text-3xl font-light tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
          Newsletter & <em className="italic text-primary">FAQ</em>
        </h2>
      </div>

      <div className="flex gap-1 border-b border-border">
        {(["newsletter", "faq", "trending"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={`px-4 py-2 text-[10px] tracking-[0.2em] uppercase border-b-2 transition-colors ${
              subTab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            style={headingFont}
          >
            {t === "newsletter" ? "Newsletter Subscribers" : t === "faq" ? "FAQ Entries" : "Trending Questions"}
          </button>
        ))}
      </div>

      {subTab === "newsletter" ? <NewsletterSection /> : subTab === "faq" ? <FaqSection /> : <TrendingQuestionsSection />}
    </div>
  );
};

/* ══════════════════════════════════════════
   Newsletter Subscribers Section
   ══════════════════════════════════════════ */
const NewsletterSection = () => {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const { confirm, dialogProps } = useConfirmAction();

  const fetchSubscribers = async () => {
    setLoading(true);
    const { data, error } = await (supabase
      .from("newsletter_subscribers" as any)
      .select("*")
      .order("subscribed_at", { ascending: false })
      .limit(1000) as any);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); setLoading(false); return; }
    const subs = (data || []) as Subscriber[];
    const userIds = subs.map(s => s.user_id).filter(Boolean) as string[];
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", userIds.slice(0, 500));
      const nameMap = new Map((profiles || []).map((p: any) => [p.id, p.full_name]));
      subs.forEach(s => { if (s.user_id) s.user_name = nameMap.get(s.user_id) || null; });
    }
    setSubscribers(subs);
    setLoading(false);
  };

  useEffect(() => { fetchSubscribers(); }, []);

  const filtered = subscribers.filter((s) =>
    s.email.toLowerCase().includes(search.toLowerCase()) ||
    (s.user_name || "").toLowerCase().includes(search.toLowerCase())
  );

  const unsubscribeSubscriber = async (sub: Subscriber) => {
    confirm({
      title: "Unsubscribe this subscriber?",
      description: `This will mark "${sub.email}" as unsubscribed. They will no longer receive newsletters. This action can be reversed by re-activating them.`,
      confirmLabel: "Unsubscribe",
      variant: "destructive",
      onConfirm: async () => {
        const { error } = await (supabase
          .from("newsletter_subscribers" as any)
          .update({ is_active: false })
          .eq("id", sub.id) as any);
        if (error) {
          toast({ title: "Error", description: error.message, variant: "destructive" });
        } else {
          setSubscribers((prev) =>
            prev.map((s) => s.id === sub.id ? { ...s, is_active: false } : s)
          );
          toast({ title: "Successfully unsubscribed", description: `${sub.email} has been unsubscribed from the newsletter.` });
        }
      },
    });
  };

  const reactivateSubscriber = async (sub: Subscriber) => {
    const { error } = await (supabase
      .from("newsletter_subscribers" as any)
      .update({ is_active: true })
      .eq("id", sub.id) as any);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setSubscribers((prev) =>
        prev.map((s) => s.id === sub.id ? { ...s, is_active: true } : s)
      );
      toast({ title: "Reactivated", description: `${sub.email} has been re-subscribed.` });
    }
  };

  const exportCsv = () => {
    const csv = ["Email,Name,Source,Date,Active"]
      .concat(filtered.map((s) => `${s.email},${(s.user_name || "").replace(/,/g, " ")},${s.source},${new Date(s.subscribed_at).toLocaleDateString()},${s.is_active}`))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "newsletter_subscribers.csv";
    a.click();
  };

  const activeCount = filtered.filter(s => s.is_active).length;
  const inactiveCount = filtered.length - activeCount;

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <ConfirmDialog {...dialogProps} />

      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search emails..."
            className="w-full h-9 pl-9 pr-3 text-sm border border-border rounded-sm bg-background"
            style={bodyFont}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground" style={headingFont}>
            {activeCount} active · {inactiveCount} unsubscribed
          </span>
          <button onClick={exportCsv} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[9px] tracking-[0.15em] uppercase border border-border hover:bg-muted transition-colors" style={headingFont}>
            <Download className="h-3 w-3" /> Export CSV
          </button>
        </div>
      </div>

      <div className="border border-border rounded-sm overflow-hidden">
        <table className="w-full text-sm" style={bodyFont}>
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-4 py-2 text-left text-[9px] tracking-[0.2em] uppercase text-muted-foreground" style={headingFont}>Email</th>
              <th className="px-4 py-2 text-left text-[9px] tracking-[0.2em] uppercase text-muted-foreground hidden md:table-cell" style={headingFont}>Name</th>
              <th className="px-4 py-2 text-left text-[9px] tracking-[0.2em] uppercase text-muted-foreground hidden md:table-cell" style={headingFont}>Source</th>
              <th className="px-4 py-2 text-left text-[9px] tracking-[0.2em] uppercase text-muted-foreground hidden md:table-cell" style={headingFont}>Date</th>
              <th className="px-4 py-2 text-left text-[9px] tracking-[0.2em] uppercase text-muted-foreground" style={headingFont}>Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id} className={`border-b border-border/50 hover:bg-muted/20 ${!s.is_active ? "opacity-60" : ""}`}>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate">{s.email}</span>
                  </div>
                </td>
                <td className="px-4 py-2.5 hidden md:table-cell">
                  <span className="text-xs text-muted-foreground truncate" style={bodyFont}>{s.user_name || "—"}</span>
                </td>
                <td className="px-4 py-2.5 hidden md:table-cell">
                  <span className="text-[9px] tracking-[0.15em] uppercase px-2 py-0.5 border border-border text-muted-foreground" style={headingFont}>{s.source}</span>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs hidden md:table-cell">
                  {new Date(s.subscribed_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-2.5">
                  {s.is_active ? (
                    <span className="inline-flex items-center gap-1 text-[8px] tracking-[0.2em] uppercase px-1.5 py-0.5 bg-primary/10 text-primary" style={headingFont}>
                      <Check className="h-2.5 w-2.5" /> Active
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[8px] tracking-[0.2em] uppercase px-1.5 py-0.5 bg-destructive/10 text-destructive" style={headingFont}>
                      <UserX className="h-2.5 w-2.5" /> Unsubscribed
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {s.is_active ? (
                    <button
                      onClick={() => unsubscribeSubscriber(s)}
                      className="p-1 text-destructive/60 hover:text-destructive transition-colors"
                      title="Unsubscribe"
                    >
                      <UserX className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={() => reactivateSubscriber(s)}
                      className="p-1 text-primary/60 hover:text-primary transition-colors"
                      title="Re-activate subscription"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">No subscribers yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════
   FAQ Entries Section
   ══════════════════════════════════════════ */
const FaqSection = () => {
  const [faqs, setFaqs] = useState<FaqEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ question: "", answer: "", keywords: "", sort_order: 0, is_active: true });
  const { confirm, dialogProps } = useConfirmAction();

  const fetchFaqs = async () => {
    setLoading(true);
    const { data, error } = await (supabase
      .from("faq_entries" as any)
      .select("*")
      .order("sort_order") as any);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else setFaqs((data || []) as FaqEntry[]);
    setLoading(false);
  };

  useEffect(() => { fetchFaqs(); }, []);

  const resetForm = () => {
    setEditingId(null);
    setForm({ question: "", answer: "", keywords: "", sort_order: 0, is_active: true });
  };

  const startEdit = (faq: FaqEntry) => {
    setEditingId(faq.id);
    setForm({
      question: faq.question,
      answer: faq.answer,
      keywords: faq.keywords.join(", "),
      sort_order: faq.sort_order,
      is_active: faq.is_active,
    });
  };

  const saveFaq = async () => {
    if (!form.question.trim() || !form.answer.trim()) {
      toast({ title: "Error", description: "Question and answer are required", variant: "destructive" });
      return;
    }
    const payload = {
      question: form.question.trim(),
      answer: form.answer.trim(),
      keywords: form.keywords.split(",").map((k) => k.trim()).filter(Boolean),
      sort_order: form.sort_order,
      is_active: form.is_active,
      updated_at: new Date().toISOString(),
    };

    if (editingId) {
      const { error } = await (supabase.from("faq_entries" as any).update(payload).eq("id", editingId) as any);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    } else {
      const { error } = await (supabase.from("faq_entries" as any).insert(payload) as any);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    }

    toast({ title: editingId ? "Updated" : "Created" });
    resetForm();
    fetchFaqs();
  };

  const deleteFaq = (faq: FaqEntry) => {
    confirm({
      title: "Delete this FAQ entry?",
      description: `"${faq.question}" will be permanently removed. This action cannot be undone.`,
      confirmLabel: "Delete",
      variant: "destructive",
      onConfirm: async () => {
        const { error } = await (supabase.from("faq_entries" as any).delete().eq("id", faq.id) as any);
        if (error) {
          toast({ title: "Error", description: error.message, variant: "destructive" });
        } else {
          setFaqs((prev) => prev.filter((f) => f.id !== faq.id));
          toast({ title: "Deleted", description: "FAQ entry has been removed." });
        }
      },
    });
  };

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6">
      <ConfirmDialog {...dialogProps} />

      {/* Add/Edit Form */}
      <div className="border border-border rounded-sm p-4 space-y-3 bg-muted/10">
        <p className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground" style={headingFont}>
          {editingId ? "Edit FAQ" : "Add New FAQ"}
        </p>
        <input
          value={form.question}
          onChange={(e) => setForm((p) => ({ ...p, question: e.target.value }))}
          placeholder="Question (e.g., How do I submit a photo?)"
          className="w-full h-9 px-3 text-sm border border-border rounded-sm bg-background"
          style={bodyFont}
        />
        <textarea
          value={form.answer}
          onChange={(e) => setForm((p) => ({ ...p, answer: e.target.value }))}
          placeholder="Answer (supports markdown)"
          className="w-full min-h-[80px] px-3 py-2 text-sm border border-border rounded-sm bg-background resize-y"
          style={bodyFont}
        />
        <input
          value={form.keywords}
          onChange={(e) => setForm((p) => ({ ...p, keywords: e.target.value }))}
          placeholder="Keywords (comma separated: submit, upload, photo)"
          className="w-full h-9 px-3 text-sm border border-border rounded-sm bg-background"
          style={bodyFont}
        />
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground" style={headingFont}>Order</label>
              <input
                type="number"
                value={form.sort_order}
                onChange={(e) => setForm((p) => ({ ...p, sort_order: Number(e.target.value) }))}
                className="w-16 h-8 px-2 text-sm border border-border rounded-sm bg-background"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground" style={headingFont}>Active</label>
              <Switch checked={form.is_active} onCheckedChange={(c) => setForm((p) => ({ ...p, is_active: c }))} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {editingId && (
              <button onClick={resetForm} className="px-3 py-1.5 text-[9px] tracking-[0.15em] uppercase border border-border hover:bg-muted transition-colors" style={headingFont}>
                Cancel
              </button>
            )}
            <button onClick={saveFaq} className="inline-flex items-center gap-1.5 px-4 py-1.5 text-[9px] tracking-[0.15em] uppercase bg-primary text-primary-foreground hover:bg-primary/90 transition-colors" style={headingFont}>
              <Save className="h-3 w-3" /> {editingId ? "Update" : "Add"}
            </button>
          </div>
        </div>
      </div>

      {/* FAQ List */}
      <div className="space-y-2">
        {faqs.map((faq) => (
          <div key={faq.id} className="border border-border rounded-sm p-3 hover:bg-muted/10 transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <HelpCircle className="h-3.5 w-3.5 text-primary shrink-0" />
                  <p className="text-sm font-medium truncate" style={bodyFont}>{faq.question}</p>
                  {!faq.is_active && faq.sort_order === 999 && (
                    <span className="inline-flex items-center gap-1 text-[8px] tracking-[0.2em] uppercase px-1.5 py-0.5 border border-amber-500/30 text-amber-600" style={headingFont}>
                      <Sparkles className="h-2.5 w-2.5" /> Auto-Generated
                    </span>
                  )}
                  {!faq.is_active && faq.sort_order !== 999 && (
                    <span className="text-[8px] tracking-[0.2em] uppercase px-1.5 py-0.5 border border-destructive/30 text-destructive" style={headingFont}>Inactive</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2 ml-5.5" style={bodyFont}>{faq.answer}</p>
                {faq.keywords.length > 0 && (
                  <div className="flex gap-1 mt-1.5 ml-5.5 flex-wrap">
                    {faq.keywords.map((kw, i) => (
                      <span key={i} className="text-[8px] px-1.5 py-0.5 bg-muted text-muted-foreground rounded">{kw}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => startEdit(faq)} className="p-1.5 text-muted-foreground hover:text-foreground transition-colors" title="Edit">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => deleteFaq(faq)} className="p-1.5 text-destructive/60 hover:text-destructive transition-colors" title="Delete">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
        {faqs.length === 0 && (
          <div className="border border-dashed border-border rounded-sm py-10 text-center">
            <HelpCircle className="h-8 w-8 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground" style={bodyFont}>No FAQ entries yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1" style={bodyFont}>Add common questions to reduce AI token usage</p>
          </div>
        )}
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════
   Trending Questions Section
   ══════════════════════════════════════════ */
interface ChatQuestion {
  id: string;
  question_text: string;
  question_fingerprint: string;
  ai_answer: string | null;
  ask_count: number;
  last_asked_at: string;
  promoted_to_faq: boolean;
}

const TrendingQuestionsSection = () => {
  const [questions, setQuestions] = useState<ChatQuestion[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchQuestions = async () => {
    setLoading(true);
    const { data, error } = await (supabase
      .from("chat_questions" as any)
      .select("*")
      .order("ask_count", { ascending: false })
      .limit(100) as any);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else setQuestions((data || []) as ChatQuestion[]);
    setLoading(false);
  };

  useEffect(() => { fetchQuestions(); }, []);

  const promoteToFaq = async (q: ChatQuestion) => {
    const { error } = await (supabase.from("faq_entries" as any).insert({
      question: q.question_text,
      answer: q.ai_answer || "Please update this answer.",
      keywords: [],
      is_active: false,
      sort_order: 999,
    }) as any);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    await (supabase.from("chat_questions" as any).update({ promoted_to_faq: true }).eq("id", q.id) as any);
    setQuestions((prev) => prev.map((p) => p.id === q.id ? { ...p, promoted_to_faq: true } : p));
    toast({ title: "Added to FAQ as draft" });
  };

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground" style={bodyFont}>
          Questions asked 2+ times are shown here. Questions asked 3+ times are auto-added to FAQ as drafts.
        </p>
        <span className="text-[10px] text-muted-foreground" style={headingFont}>
          {questions.length} tracked questions
        </span>
      </div>

      <div className="space-y-2">
        {questions.map((q) => (
          <div key={q.id} className="border border-border rounded-sm p-3 hover:bg-muted/10 transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="h-3.5 w-3.5 text-primary shrink-0" />
                  <p className="text-sm font-medium truncate" style={bodyFont}>{q.question_text}</p>
                  <span className="text-[9px] tracking-[0.15em] uppercase px-2 py-0.5 border border-border text-muted-foreground shrink-0" style={headingFont}>
                    {q.ask_count}× asked
                  </span>
                  {q.promoted_to_faq && (
                    <span className="inline-flex items-center gap-1 text-[8px] tracking-[0.2em] uppercase px-1.5 py-0.5 bg-primary/10 text-primary" style={headingFont}>
                      <Check className="h-2.5 w-2.5" /> In FAQ
                    </span>
                  )}
                </div>
                {q.ai_answer && (
                  <p className="text-xs text-muted-foreground line-clamp-2 ml-5.5" style={bodyFont}>{q.ai_answer}</p>
                )}
                <p className="text-[10px] text-muted-foreground/50 mt-1 ml-5.5" style={bodyFont}>
                  Last asked: {new Date(q.last_asked_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {!q.promoted_to_faq && (
                  <button
                    onClick={() => promoteToFaq(q)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[9px] tracking-[0.15em] uppercase border border-primary/30 text-primary hover:bg-primary/10 transition-colors"
                    style={headingFont}
                    title="Add to FAQ as draft"
                  >
                    <Plus className="h-3 w-3" /> FAQ
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        {questions.length === 0 && (
          <div className="border border-dashed border-border rounded-sm py-10 text-center">
            <TrendingUp className="h-8 w-8 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground" style={bodyFont}>No tracked questions yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1" style={bodyFont}>Questions will appear here as users ask them via AI chat</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminNewsletterFaq;
