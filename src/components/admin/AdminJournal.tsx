import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { cachedFetchProfilesByIds } from "@/lib/profileBatch";
import { toast } from "@/hooks/core/use-toast";
import { Plus, Pencil, Trash2, Eye, Newspaper, Star } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/table";

interface ArticleRow {
  id: string;
  title: string;
  slug: string;
  status: string;
  tags: string[];
  published_at: string | null;
  created_at: string;
  author_name: string | null;
  is_featured: boolean;
}

const statusStyle = (s: string) => {
  if (s === "published") return "bg-primary/10 text-primary border-primary/30";
  if (s === "archived") return "bg-muted text-muted-foreground border-border";
  return "bg-yellow-500/10 text-yellow-600 border-yellow-500/30";
};

const AdminJournal = () => {
  const qc = useQueryClient();
  const [articles, setArticles] = useState<ArticleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const navigate = useNavigate();

  const fetchArticles = async () => {
    setFetchError(null);
    const { data, error } = await supabase
      .from("journal_articles")
      .select("id, title, slug, status, tags, published_at, created_at, author_id, is_featured")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      setFetchError(error.message);
      setLoading(false);
      return;
    }

    if (data && data.length > 0) {
      const authorIds = [...new Set(data.map((a) => a.author_id))];
      const map = await cachedFetchProfilesByIds(authorIds);
      setArticles(data.map((a) => ({ ...a, author_name: map.get(a.author_id) || null })));
    } else {
      setArticles([]);
    }
    setLoading(false);
  };

  useEffect(() => { fetchArticles(); }, []);

  const archiveArticle = async (id: string) => {
    setArchiving(true);
    const { error } = await supabase
      .from("journal_articles")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", id);
    setArchiving(false);
    if (error) {
      toast({ title: "Archive failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Article archived" });
      qc.invalidateQueries({ queryKey: ["journal"] });
      fetchArticles();
    }
  };

  const updateStatus = async (id: string, status: string) => {
    const update: any = { status, updated_at: new Date().toISOString() };
    if (status === "published") update.published_at = new Date().toISOString();
    const { error } = await supabase.from("journal_articles").update(update).eq("id", id);
    if (error) toast({ title: "Update failed", variant: "destructive" });
    else {
      setArticles((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
      qc.invalidateQueries({ queryKey: ["journal"] });
      toast({ title: `Article ${status}` });
    }
  };

  const toggleFeatured = async (id: string, current: boolean) => {
    if (!current) {
      const { error: clearError } = await supabase.from("journal_articles").update({ is_featured: false }).eq("is_featured", true);
      if (clearError) {
        toast({ title: "Failed to clear featured", description: clearError.message, variant: "destructive" });
        return;
      }
    }
    const { error } = await supabase.from("journal_articles").update({ is_featured: !current }).eq("id", id);
    if (error) {
      toast({ title: "Update failed", variant: "destructive" });
    } else {
      setArticles((prev) => prev.map((a) => ({ ...a, is_featured: a.id === id ? !current : (current ? a.is_featured : false) })));
      toast({ title: !current ? "Article featured on homepage" : "Removed from homepage" });
    }
  };

  if (fetchError) {
    return (
      <div className="text-center py-12 border border-dashed border-destructive/30 rounded-sm">
        <Newspaper className="h-5 w-5 text-destructive mx-auto mb-2" />
        <p className="text-xs text-destructive">Failed to load articles: {fetchError}</p>
        <button onClick={fetchArticles} className="mt-2 text-[10px] text-primary underline">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
          {articles.length} article{articles.length !== 1 ? "s" : ""}
        </span>
        <button onClick={() => navigate("/journal/new")}
          className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase px-4 py-2 bg-primary text-primary-foreground hover:opacity-90 transition-opacity rounded-sm"
          style={{ fontFamily: "var(--font-heading)" }}>
          <Plus className="h-3 w-3" /> New Article
        </button>
      </div>

      {articles.length > 0 ? (
        <div className="border border-border rounded-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[280px] min-w-[200px] text-[9px] tracking-[0.2em] uppercase" style={{ fontFamily: "var(--font-heading)" }}>Title</TableHead>
                <TableHead className="w-[140px] min-w-[100px] text-[9px] tracking-[0.2em] uppercase" style={{ fontFamily: "var(--font-heading)" }}>Author</TableHead>
                <TableHead className="w-[100px] min-w-[80px] text-[9px] tracking-[0.2em] uppercase" style={{ fontFamily: "var(--font-heading)" }}>Date</TableHead>
                <TableHead className="w-[110px] min-w-[90px] text-[9px] tracking-[0.2em] uppercase" style={{ fontFamily: "var(--font-heading)" }}>Status</TableHead>
                <TableHead className="w-[180px] min-w-[120px] text-[9px] tracking-[0.2em] uppercase" style={{ fontFamily: "var(--font-heading)" }}>Tags</TableHead>
                <TableHead className="w-[120px] min-w-[100px] text-right text-[9px] tracking-[0.2em] uppercase" style={{ fontFamily: "var(--font-heading)" }}>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {articles.map((a) => (
                <TableRow key={a.id} className="group">
                  {/* Title */}
                  <TableCell className="py-2.5 px-4">
                    <div className="flex items-center gap-2 min-w-0">
                      <Newspaper className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm font-medium truncate" style={{ fontFamily: "var(--font-body)" }}>{a.title}</span>
                      {a.is_featured && (
                        <span className="text-[8px] px-1.5 py-0.5 border rounded-sm uppercase tracking-wider shrink-0 bg-yellow-500/10 text-yellow-600 border-yellow-500/30 flex items-center gap-0.5">
                          <Star className="h-2.5 w-2.5 fill-current" /> Featured
                        </span>
                      )}
                    </div>
                  </TableCell>

                  {/* Author */}
                  <TableCell className="py-2.5 px-4">
                    <span className="text-xs text-muted-foreground truncate block">{a.author_name || "Unknown"}</span>
                  </TableCell>

                  {/* Date */}
                  <TableCell className="py-2.5 px-4">
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {(a.published_at ? new Date(a.published_at) : new Date(a.created_at)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}
                    </span>
                  </TableCell>

                  {/* Status */}
                  <TableCell className="py-2.5 px-4">
                    <select value={a.status} onChange={(e) => updateStatus(a.id, e.target.value)}
                      className={`text-[9px] tracking-wider uppercase px-2 py-1 border bg-transparent outline-none cursor-pointer rounded-sm ${statusStyle(a.status)}`}
                      style={{ fontFamily: "var(--font-heading)" }}>
                      <option value="draft">Draft</option>
                      <option value="published">Published</option>
                      <option value="archived">Archived</option>
                    </select>
                  </TableCell>

                  {/* Tags */}
                  <TableCell className="py-2.5 px-4">
                    {a.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {a.tags.slice(0, 3).map((t) => (
                          <span key={t} className="text-[8px] px-1.5 py-0.5 bg-muted text-muted-foreground rounded-sm whitespace-nowrap">{t}</span>
                        ))}
                        {a.tags.length > 3 && <span className="text-[8px] text-muted-foreground">+{a.tags.length - 3}</span>}
                      </div>
                    ) : (
                      <span className="text-[9px] text-muted-foreground/50">—</span>
                    )}
                  </TableCell>

                  {/* Actions */}
                  <TableCell className="py-2.5 px-4">
                    <div className="flex items-center gap-0.5 justify-end">
                      <button onClick={() => toggleFeatured(a.id, a.is_featured)} className={`p-1.5 transition-colors rounded-sm ${a.is_featured ? "text-yellow-500 bg-yellow-500/10" : "hover:text-yellow-500 hover:bg-yellow-500/10"}`} title={a.is_featured ? "Remove from homepage" : "Feature on homepage"}><Star className={`h-3.5 w-3.5 ${a.is_featured ? "fill-current" : ""}`} /></button>
                      <button onClick={() => navigate(`/journal/${a.slug}`)} className="p-1.5 hover:text-primary transition-colors rounded-sm hover:bg-primary/10" title="View"><Eye className="h-3.5 w-3.5" /></button>
                      <button onClick={() => navigate(`/journal/edit/${a.id}`)} className="p-1.5 hover:text-primary transition-colors rounded-sm hover:bg-primary/10" title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button className="p-1.5 hover:text-destructive transition-colors rounded-sm hover:bg-destructive/10" title="Archive"><Trash2 className="h-3.5 w-3.5" /></button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Archive Article</AlertDialogTitle>
                            <AlertDialogDescription>This will archive "{a.title}". The article can be restored by changing its status back to draft.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => archiveArticle(a.id)} disabled={archiving}>Archive</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="text-center py-12 border border-dashed border-border rounded-sm">
          <Newspaper className="h-5 w-5 text-muted-foreground mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">No articles yet</p>
        </div>
      )}
    </div>
  );
};

export default AdminJournal;
