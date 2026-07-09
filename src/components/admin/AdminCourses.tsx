import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { formatUSDFixed } from "@/lib/currencyFormat";
import { supabase } from "@/integrations/supabase/client";
import { cachedFetchProfilesByIds } from "@/lib/profileBatch";
import { toast } from "@/hooks/core/use-toast";
import { Plus, Pencil, Trash2, Eye, BookOpen, Star, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";

const LABEL_OPTIONS = ["Filling Up 1st", "Few Seats Left", "Early Bird Offer", "Most Demand"] as const;

interface CourseRow {
  id: string;
  title: string;
  slug: string;
  category: string;
  difficulty: string;
  status: string;
  is_free: boolean;
  price: number | null;
  created_at: string;
  author_name: string | null;
  is_featured: boolean;
  labels: string[];
  admin_students: number;
  admin_rating: number;
  admin_rating_count: number;
  reviews_enabled: boolean;
}

const AdminCourses = () => {
  const qc = useQueryClient();
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const fetchCourses = async () => {
    const { data } = await supabase
      .from("courses")
      .select("id, title, slug, category, difficulty, status, is_free, price, created_at, author_id, is_featured, labels, admin_students, admin_rating, admin_rating_count, reviews_enabled")
      .order("created_at", { ascending: false })
      .limit(50);

    if (data && data.length > 0) {
      const authorIds = [...new Set(data.map((c) => c.author_id))];
      const map = await cachedFetchProfilesByIds(authorIds);
      setCourses(data.map((c) => ({ ...c, author_name: map.get(c.author_id) || null })));
    } else {
      setCourses([]);
    }
    setLoading(false);
  };

  useEffect(() => { fetchCourses(); }, []);

  const [archivingCourse, setArchivingCourse] = useState(false);

  const archiveCourse = async (id: string) => {
    setArchivingCourse(true);
    // Check if users are enrolled before archiving
    const { count } = await supabase
      .from("course_enrollments")
      .select("id", { count: "exact", head: true })
      .eq("course_id", id);

    if (count && count > 0) {
      toast({
        title: "Cannot archive",
        description: `${count} users are enrolled in this course. Remove enrollments first.`,
        variant: "destructive",
      });
      setArchivingCourse(false);
      return;
    }

    const { error } = await supabase
      .from("courses")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", id);
    setArchivingCourse(false);
    if (error) {
      toast({ title: "Archive failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Course archived" });
      qc.invalidateQueries({ queryKey: ["courses"] });
      fetchCourses();
    }
  };

  const updateStatus = async (id: string, status: string) => {
    const update: any = { status, updated_at: new Date().toISOString() };
    if (status === "published") update.published_at = new Date().toISOString();
    const { error } = await supabase.from("courses").update(update).eq("id", id);
    if (error) toast({ title: "Update failed", variant: "destructive" });
    else {
      setCourses((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)));
      qc.invalidateQueries({ queryKey: ["courses"] });
      toast({ title: `Course ${status}` });
    }
  };

  const toggleFeatured = async (id: string, current: boolean) => {
    const { error } = await supabase.from("courses").update({ is_featured: !current, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) toast({ title: "Update failed", variant: "destructive" });
    else {
      setCourses((prev) => prev.map((c) => (c.id === id ? { ...c, is_featured: !current } : c)));
      toast({ title: !current ? "Course featured" : "Removed from featured" });
    }
  };

  const toggleLabel = async (id: string, label: string, currentLabels: string[]) => {
    const newLabels = currentLabels.includes(label)
      ? currentLabels.filter((l) => l !== label)
      : [...currentLabels, label];
    const { error } = await supabase.from("courses").update({ labels: newLabels, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) toast({ title: "Update failed", variant: "destructive" });
    else {
      setCourses((prev) => prev.map((c) => (c.id === id ? { ...c, labels: newLabels } : c)));
    }
  };

  const statusStyle = (s: string) => {
    if (s === "published") return "bg-primary/10 text-primary border-primary/30";
    if (s === "archived") return "bg-muted text-muted-foreground border-border";
    return "bg-yellow-500/10 text-yellow-600 border-yellow-500/30";
  };

  const labelColor = (l: string) => {
    switch (l) {
      case "Filling Up 1st": return "bg-orange-500/15 text-orange-500 border-orange-500/30";
      case "Few Seats Left": return "bg-red-500/15 text-red-500 border-red-500/30";
      case "Early Bird Offer": return "bg-green-500/15 text-green-500 border-green-500/30";
      case "Most Demand": return "bg-blue-500/15 text-blue-500 border-blue-500/30";
      default: return "bg-muted text-muted-foreground border-border";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
          {courses.length} course{courses.length !== 1 ? "s" : ""}
        </span>
        <button onClick={() => navigate("/courses/new")}
          className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase px-4 py-2 bg-primary text-primary-foreground hover:opacity-90 transition-opacity rounded-sm"
          style={{ fontFamily: "var(--font-heading)" }}>
          <Plus className="h-3 w-3" /> New Course
        </button>
      </div>

      {courses.length > 0 ? (
        <div className="border border-border rounded-sm overflow-hidden divide-y divide-border">
          {courses.map((c) => (
            <div key={c.id} className="px-3 py-3 hover:bg-muted/30 transition-colors group">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => toggleFeatured(c.id, c.is_featured)}
                  className={`p-1 rounded-sm transition-colors shrink-0 ${c.is_featured ? "text-yellow-500" : "text-muted-foreground/30 hover:text-yellow-500/60"}`}
                  title={c.is_featured ? "Remove from featured" : "Mark as featured"}
                >
                  <Star className="h-4 w-4" fill={c.is_featured ? "currentColor" : "none"} />
                </button>
                <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate" style={{ fontFamily: "var(--font-body)" }}>{c.title}</span>
                    <span className={`text-[8px] px-1.5 py-0.5 border rounded-sm uppercase tracking-wider shrink-0 ${statusStyle(c.status)}`}>
                      {c.status}
                    </span>
                    {c.is_featured && (
                      <span className="text-[8px] px-1.5 py-0.5 border rounded-sm uppercase tracking-wider shrink-0 bg-yellow-500/15 text-yellow-500 border-yellow-500/30">Featured</span>
                    )}
                    {c.labels.map((label) => (
                      <span key={label} className={`text-[8px] px-1.5 py-0.5 border rounded-sm uppercase tracking-wider shrink-0 ${labelColor(label)}`}>{label}</span>
                    ))}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground">
                    <span>{c.author_name || "Unknown"}</span>
                    <span>·</span>
                    <span>{c.category}</span>
                    <span>·</span>
                    <span>{c.difficulty}</span>
                    <span>·</span>
                    <span>{c.is_free ? "Free" : formatUSDFixed(Number(c.price))}</span>
                    <span>·</span>
                    <span><Users className="h-3 w-3 inline mr-0.5" />{(c.admin_students ?? 0).toLocaleString()} students</span>
                    <span>·</span>
                    <span><Star className="h-3 w-3 inline mr-0.5 text-yellow-500" />{Number(c.admin_rating ?? 0).toFixed(1)} ({(c.admin_rating_count ?? 0).toLocaleString()})</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <select value={c.status} onChange={(e) => updateStatus(c.id, e.target.value)}
                    className="text-[9px] tracking-wider uppercase px-2 py-1 border border-border bg-transparent outline-none cursor-pointer rounded-sm"
                    style={{ fontFamily: "var(--font-heading)" }}>
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
                <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => navigate(`/courses/${c.slug}`)} className="p-1.5 hover:text-primary transition-colors rounded-sm hover:bg-primary/10" title="View"><Eye className="h-3.5 w-3.5" /></button>
                  <button onClick={() => navigate(`/courses/edit/${c.id}`)} className="p-1.5 hover:text-primary transition-colors rounded-sm hover:bg-primary/10" title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button className="p-1.5 hover:text-destructive transition-colors rounded-sm hover:bg-destructive/10" title="Archive"><Trash2 className="h-3.5 w-3.5" /></button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Archive Course</AlertDialogTitle>
                        <AlertDialogDescription>This will archive "{c.title}". If students are enrolled, archiving will be blocked.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => archiveCourse(c.id)} disabled={archivingCourse}>Archive</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
              {/* Labels toggles */}
              <div className="flex items-center gap-2 mt-2 ml-10">
                {LABEL_OPTIONS.map((label) => (
                  <button
                    key={label}
                    onClick={() => toggleLabel(c.id, label, c.labels)}
                    className={`text-[8px] tracking-[0.1em] uppercase px-2 py-1 border rounded-sm transition-all ${
                      c.labels.includes(label) ? labelColor(label) : "border-border/50 text-muted-foreground/40 hover:text-muted-foreground hover:border-border"
                    }`}
                    style={{ fontFamily: "var(--font-heading)" }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 border border-dashed border-border rounded-sm">
          <BookOpen className="h-5 w-5 text-muted-foreground mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">No courses yet</p>
        </div>
      )}
    </div>
  );
};

export default AdminCourses;
