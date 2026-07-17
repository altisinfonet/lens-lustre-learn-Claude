import { useState, useEffect, useRef } from "react";
import DOMPurify from "dompurify";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { Loader2, Save, Eye, Code, Type, Plus, Pencil, Trash2, XCircle, CheckCircle, Copy, ChevronDown, ToggleLeft, ToggleRight } from "lucide-react";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { useConfirmAction } from "@/hooks/admin/useConfirmAction";
import { ScrollArea } from "@/components/ui/scroll-area";
import EmailRichTextToolbar from "./EmailRichTextToolbar";
import type { User } from "@supabase/supabase-js";

interface Props {
  user: User | null;
}

interface EmailTemplate {
  id: string;
  template_key: string;
  name: string;
  category: string;
  subject: string;
  body_html: string;
  body_text: string;
  variables: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const CATEGORIES = [
  { value: "welcome", label: "Welcome / Signup" },
  { value: "competition", label: "Competition Updates" },
  { value: "wallet", label: "Wallet & Payments" },
  { value: "course", label: "Course Notifications" },
  { value: "general", label: "General Notification" },
];

const categoryColor: Record<string, string> = {
  welcome: "bg-green-500/10 text-green-600",
  competition: "bg-amber-500/10 text-amber-600",
  wallet: "bg-blue-500/10 text-blue-600",
  course: "bg-purple-500/10 text-purple-600",
  general: "bg-muted text-muted-foreground",
};

export default function AdminEmailTemplates({ user }: Props) {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EmailTemplate | null>(null);
  const [editorMode, setEditorMode] = useState<"visual" | "html">("visual");
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filterCategory, setFilterCategory] = useState("all");
  const editorRef = useRef<HTMLDivElement>(null);
  const { confirm: confirmAction, dialogProps } = useConfirmAction();

  const fetchTemplates = async () => {
    const { data, error } = await supabase
      .from("email_templates")
      .select("id, template_key, name, category, subject, body_html, body_text, variables, is_active, created_at, updated_at")
      .order("category")
      .order("name")
      .limit(50);
    if (error) {
      toast({ title: "Failed to load templates", description: error.message, variant: "destructive" });
    } else {
      setTemplates((data || []) as unknown as EmailTemplate[]);
    }
    setLoading(false);
  };

  useEffect(() => { fetchTemplates(); }, []);

  const startEdit = (template: EmailTemplate) => {
    setEditing({ ...template });
    setEditorMode("visual");
    setShowPreview(false);
  };

  const startNew = () => {
    setEditing({
      id: "",
      template_key: "",
      name: "",
      category: "general",
      subject: "",
      body_html: '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px"><h1 style="color:#333">{{title}}</h1><p style="color:#666;line-height:1.6">{{message}}</p></div>',
      body_text: "",
      variables: [],
      is_active: true,
      created_at: "",
      updated_at: "",
    });
    setEditorMode("html");
    setShowPreview(false);
  };

  const saveTemplate = async () => {
    if (!editing || !user) return;
    if (!editing.name.trim() || !editing.template_key.trim()) {
      toast({ title: "Name and Template Key are required", variant: "destructive" });
      return;
    }
    setSaving(true);

    // Extract variables from HTML
    const varMatches = editing.body_html.match(/\{\{(\w+)\}\}/g) || [];
    const subjectVars = editing.subject.match(/\{\{(\w+)\}\}/g) || [];
    const allVars = [...new Set([...varMatches, ...subjectVars].map(v => v.replace(/\{\{|\}\}/g, "")))];

    // Sanitize HTML before saving to prevent stored XSS
    const sanitizedHtml = DOMPurify.sanitize(editing.body_html);
    const sanitizedText = editing.body_text.replace(/<[^>]*>/g, "");

    const payload = {
      template_key: editing.template_key.trim(),
      name: editing.name.trim(),
      category: editing.category,
      subject: editing.subject,
      body_html: sanitizedHtml,
      body_text: sanitizedText,
      variables: allVars,
      is_active: editing.is_active,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };

    let error;
    if (editing.id) {
      ({ error } = await supabase.from("email_templates").update(payload).eq("id", editing.id));
    } else {
      ({ error } = await supabase.from("email_templates").insert({ ...payload, created_by: user.id } as any));
    }

    setSaving(false);
    if (error) {
      toast({ title: "Failed to save template", description: error.message, variant: "destructive" });
    } else {
      toast({ title: editing.id ? "Template updated" : "Template created" });
      setEditing(null);
      fetchTemplates();
    }
  };

  const deleteTemplate = async (id: string) => {
    confirmAction({
      title: "Delete this template?",
      description: "This cannot be undone.",
      onConfirm: async () => {
        const { error } = await supabase.from("email_templates").delete().eq("id", id);
        if (error) {
          toast({ title: "Failed to delete", description: error.message, variant: "destructive" });
        } else {
          toast({ title: "Template deleted" });
          fetchTemplates();
        }
      },
    });
  };

  const toggleActive = async (template: EmailTemplate) => {
    const { error } = await supabase
      .from("email_templates")
      .update({ is_active: !template.is_active, updated_at: new Date().toISOString() })
      .eq("id", template.id);
    if (error) {
      toast({ title: "Failed to update", variant: "destructive" });
    } else {
      fetchTemplates();
    }
  };

  const insertVariable = (varName: string) => {
    if (!editing) return;
    const tag = `{{${varName}}}`;
    if (editorMode === "html") {
      setEditing({ ...editing, body_html: editing.body_html + tag });
    } else if (editorRef.current) {
      document.execCommand("insertText", false, tag);
    }
  };

  const handleVisualInput = () => {
    if (editorRef.current && editing) {
      setEditing({ ...editing, body_html: editorRef.current.innerHTML });
    }
  };

  const renderPreview = (html: string) => {
    // Replace variables with sample values
    return html
      .replace(/\{\{user_name\}\}/g, "John Doe")
      .replace(/\{\{user_email\}\}/g, "john@example.com")
      .replace(/\{\{site_name\}\}/g, "50mm Retina World")
      .replace(/\{\{site_url\}\}/g, "https://50mmretina.com")
      .replace(/\{\{amount\}\}/g, "₹500")
      .replace(/\{\{competition_title\}\}/g, "Street Photography 2026")
      .replace(/\{\{entry_title\}\}/g, "Urban Shadows")
      .replace(/\{\{course_title\}\}/g, "Mastering Portrait Light")
      .replace(/\{\{placement\}\}/g, "1st Place")
      .replace(/\{\{status\}\}/g, "Approved")
      .replace(/\{\{reason\}\}/g, "Outstanding contribution")
      .replace(/\{\{title\}\}/g, "Notification Title")
      .replace(/\{\{message\}\}/g, "This is a sample notification message.")
      .replace(/\{\{subject\}\}/g, "Sample Subject")
      .replace(/\{\{new_balance\}\}/g, "₹1,500")
      .replace(/\{\{(\w+)\}\}/g, "[$1]");
  };

  const filtered = filterCategory === "all" ? templates : templates.filter(t => t.category === filterCategory);

  const inputClass = "w-full bg-background border border-border px-3 py-2.5 text-sm rounded-sm focus:outline-none focus:border-primary transition-colors";
  const labelClass = "text-[10px] tracking-[0.2em] uppercase text-muted-foreground block mb-1.5";

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-20 justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-xs tracking-[0.2em] uppercase" style={{ fontFamily: "var(--font-heading)" }}>Loading templates...</span>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-px bg-primary" />
          <span className="text-[10px] tracking-[0.3em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>Communication</span>
        </div>
        <h2 className="text-2xl md:text-3xl font-light tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
          Email <em className="italic text-primary">Templates</em>
        </h2>
        <p className="text-xs text-muted-foreground mt-2 max-w-md" style={{ fontFamily: "var(--font-body)" }}>
          Manage email templates for notifications, welcome messages, and transactional emails.
        </p>
        {/* BUG-093: these DB rows are NOT read by any send path — outbound email is
            rendered from the built-in React Email template registry. Make that
            explicit so admins don't expect edits here to change live emails. */}
        <div className="mt-3 max-w-2xl border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 rounded" style={{ fontFamily: "var(--font-body)" }}>
          <p className="text-[11px] text-yellow-600 leading-relaxed">
            <strong>Reference only —</strong> live outbound emails are rendered from the built-in
            template registry, not from these rows. Edits here do not change the emails your users
            receive. Contact engineering to change a live template.
          </p>
        </div>
      </div>

      {/* Editor */}
      {editing ? (
        <div className="border border-border rounded-sm overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card/50">
            <span className="text-sm font-medium tracking-wide uppercase" style={{ fontFamily: "var(--font-heading)" }}>
              {editing.id ? "Edit Template" : "New Template"}
            </span>
            <button onClick={() => setEditing(null)} className="text-muted-foreground hover:text-foreground"><XCircle className="h-4 w-4" /></button>
          </div>
          <div className="p-6 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Template Name *</label>
                <input className={inputClass} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="Welcome Email" />
              </div>
              <div>
                <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Template Key *</label>
                <input className={inputClass} value={editing.template_key} onChange={e => setEditing({ ...editing, template_key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} placeholder="welcome_email" disabled={!!editing.id} />
              </div>
              <div>
                <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Category</label>
                <select className={inputClass} value={editing.category} onChange={e => setEditing({ ...editing, category: e.target.value })}>
                  {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Subject Line</label>
              <input className={inputClass} value={editing.subject} onChange={e => setEditing({ ...editing, subject: e.target.value })} placeholder="Welcome to {{site_name}}!" />
            </div>

            {/* Variable Pills */}
            <div>
              <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Insert Variable</label>
              <div className="flex flex-wrap gap-1.5">
                {["user_name", "user_email", "site_name", "site_url", "amount", "competition_title", "entry_title", "course_title", "title", "message", "action_url", "action_text", "status", "reason", "placement", "new_balance", "admin_note", "expires_at", "certificate_url", "course_url", "result_url", "subject"].map(v => (
                  <button key={v} onClick={() => insertVariable(v)}
                    className="text-[9px] tracking-wider uppercase px-2 py-1 border border-border rounded-sm hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-colors"
                    style={{ fontFamily: "var(--font-heading)" }}
                  >
                    {`{{${v}}}`}
                  </button>
                ))}
              </div>
            </div>

            {/* Editor Mode Toggle */}
            <div className="flex items-center gap-2 border-b border-border pb-2">
              <button onClick={() => setEditorMode("visual")} className={`inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase px-3 py-1.5 rounded-sm transition-colors ${editorMode === "visual" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`} style={{ fontFamily: "var(--font-heading)" }}>
                <Type className="h-3 w-3" /> Visual
              </button>
              <button onClick={() => { if (editorRef.current && editing) setEditing({ ...editing, body_html: editorRef.current.innerHTML }); setEditorMode("html"); }} className={`inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase px-3 py-1.5 rounded-sm transition-colors ${editorMode === "html" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`} style={{ fontFamily: "var(--font-heading)" }}>
                <Code className="h-3 w-3" /> HTML
              </button>
              <button onClick={() => setShowPreview(!showPreview)} className={`inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase px-3 py-1.5 rounded-sm transition-colors ml-auto ${showPreview ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`} style={{ fontFamily: "var(--font-heading)" }}>
                <Eye className="h-3 w-3" /> Preview
              </button>
            </div>

            <div className={`grid ${showPreview ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"} gap-4`}>
              {/* Editor */}
              <div>
                {editorMode === "visual" ? (
                  <div>
                    <EmailRichTextToolbar editorRef={editorRef} onInput={handleVisualInput} />
                     <div
                      ref={editorRef}
                      contentEditable
                      suppressContentEditableWarning
                      onInput={handleVisualInput}
                      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(editing.body_html) }}
                      className="min-h-[300px] border border-border border-t-0 p-4 bg-background focus:outline-none focus:border-primary transition-colors prose prose-sm max-w-none [&_img]:cursor-pointer [&_img]:transition-all [&_img:hover]:opacity-90"
                      style={{ fontFamily: "var(--font-body)" }}
                    />
                  </div>
                ) : (
                  <textarea
                    value={editing.body_html}
                    onChange={e => setEditing({ ...editing, body_html: e.target.value })}
                    className="w-full min-h-[300px] bg-background border border-border rounded-sm p-4 font-mono text-xs focus:outline-none focus:border-primary transition-colors resize-y"
                    spellCheck={false}
                  />
                )}
              </div>

              {/* Preview */}
              {showPreview && (
                <div className="border border-border rounded-sm overflow-hidden">
                  <div className="px-4 py-2 bg-muted/30 border-b border-border flex items-center justify-between">
                    <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>Live Preview</span>
                    <span className="text-[9px] text-muted-foreground/60 font-mono">Variables replaced with samples</span>
                  </div>
                  <div className="bg-white p-4 min-h-[300px]">
                    <div className="text-xs text-muted-foreground mb-2 px-1 border-b border-border/30 pb-2">
                      <strong>Subject:</strong> {renderPreview(editing.subject)}
                    </div>
                    <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderPreview(editing.body_html)) }} />
                  </div>
                </div>
              )}
            </div>

            {/* Plain Text Version */}
            <div>
              <label className={labelClass} style={{ fontFamily: "var(--font-heading)" }}>Plain Text Version (optional)</label>
              <textarea
                value={editing.body_text}
                onChange={e => setEditing({ ...editing, body_text: e.target.value })}
                className={inputClass + " min-h-[80px] resize-y font-mono text-xs"}
                placeholder="Plain text fallback for email clients that don't support HTML..."
              />
            </div>

            {/* Active Toggle */}
            <div className="flex items-center gap-3">
              <button onClick={() => setEditing({ ...editing, is_active: !editing.is_active })} className="flex items-center gap-2 text-xs">
                {editing.is_active ? <ToggleRight className="h-5 w-5 text-primary" /> : <ToggleLeft className="h-5 w-5 text-muted-foreground" />}
                <span className={`text-[10px] tracking-[0.15em] uppercase ${editing.is_active ? "text-primary" : "text-muted-foreground"}`} style={{ fontFamily: "var(--font-heading)" }}>
                  {editing.is_active ? "Active" : "Inactive"}
                </span>
              </button>
            </div>

            {/* Save */}
            <div className="flex items-center gap-3 pt-2 border-t border-border">
              <button onClick={saveTemplate} disabled={saving} className="inline-flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase px-5 py-2.5 bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50" style={{ fontFamily: "var(--font-heading)" }}>
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                {editing.id ? "Update Template" : "Create Template"}
              </button>
              <button onClick={() => setEditing(null)} className="text-[10px] tracking-[0.2em] uppercase px-5 py-2.5 border border-border text-muted-foreground hover:text-foreground transition-colors" style={{ fontFamily: "var(--font-heading)" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Toolbar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <select className="bg-background border border-border px-3 py-2 text-xs rounded-sm" value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
                <option value="all">All Categories</option>
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                {filtered.length} template{filtered.length !== 1 ? "s" : ""}
              </span>
            </div>
            <button onClick={startNew} className="inline-flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase px-4 py-2.5 bg-primary text-primary-foreground hover:opacity-90 transition-opacity" style={{ fontFamily: "var(--font-heading)" }}>
              <Plus className="h-3 w-3" /> New Template
            </button>
          </div>

          {/* Template List */}
          <div className="space-y-2">
            {filtered.map(t => (
              <div key={t.id} className="border border-border rounded-sm overflow-hidden hover:border-primary/30 transition-colors">
                <div className="flex items-center gap-4 px-5 py-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium truncate" style={{ fontFamily: "var(--font-heading)" }}>{t.name}</span>
                      <span className={`text-[9px] tracking-wider uppercase px-2 py-0.5 rounded-sm ${categoryColor[t.category] || categoryColor.general}`} style={{ fontFamily: "var(--font-heading)" }}>
                        {t.category}
                      </span>
                      {!t.is_active && (
                        <span className="text-[9px] tracking-wider uppercase px-2 py-0.5 rounded-sm bg-destructive/10 text-destructive" style={{ fontFamily: "var(--font-heading)" }}>
                          Inactive
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                      <span className="font-mono text-[10px]">{t.template_key}</span>
                      <span>·</span>
                      <span className="truncate">{t.subject || "No subject"}</span>
                    </div>
                    {t.variables.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {t.variables.slice(0, 5).map(v => (
                          <span key={v} className="text-[8px] font-mono px-1.5 py-0.5 bg-muted/50 text-muted-foreground rounded-sm">{`{{${v}}}`}</span>
                        ))}
                        {t.variables.length > 5 && <span className="text-[8px] text-muted-foreground/60">+{t.variables.length - 5} more</span>}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => toggleActive(t)} className="p-2 text-muted-foreground hover:text-foreground transition-colors" title={t.is_active ? "Deactivate" : "Activate"}>
                      {t.is_active ? <ToggleRight className="h-4 w-4 text-primary" /> : <ToggleLeft className="h-4 w-4" />}
                    </button>
                    <button onClick={() => startEdit(t)} className="p-2 text-muted-foreground hover:text-primary transition-colors" title="Edit">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => deleteTemplate(t.id)} className="p-2 text-muted-foreground hover:text-destructive transition-colors" title="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <p className="text-xs tracking-[0.2em] uppercase" style={{ fontFamily: "var(--font-heading)" }}>No templates found</p>
              </div>
            )}
          </div>
        </>
      )}
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
