import { useState } from "react";
import PageSEO from "@/components/PageSEO";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { BookOpen, GraduationCap, Star, Users } from "lucide-react";

import { useAuth } from "@/hooks/core/useAuth";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import UserIdentityBlock from "@/components/UserIdentityBlock";
import { useCourses, CourseListItem } from "@/hooks/content/useCourses";
import { useT } from "@/i18n/I18nContext";


const difficultyColor = (d: string) => {
  switch (d) {
    case "Beginner": return "text-primary border-primary";
    case "Intermediate": return "text-accent-foreground border-accent bg-accent/10";
    case "Advanced": return "text-destructive border-destructive bg-destructive/10";
    default: return "text-muted-foreground border-border";
  }
};

const Courses = () => {
  const { user } = useAuth();
  const t = useT();
  const navigate = useNavigate();
  const { isAdmin } = useIsAdmin();
  const { data: courses = [], isLoading: loading } = useCourses();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const canEdit = isAdmin;

  const categories = [...new Set(courses.map((c) => c.category))];
  const filtered = selectedCategory ? courses.filter((c) => c.category === selectedCategory) : courses;

  return (
    <main className="min-h-full bg-background text-foreground">
      <PageSEO title="Courses" description="Photography courses and learning resources." />

      <div className="py-6 md:py-24 w-[90%] mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1 }}>
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-px bg-primary" />
            <span className="text-[10px] tracking-[0.3em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>{t("courses.eyebrow")}</span>
          </div>
          <h1 className="text-2xl md:text-7xl font-light tracking-tight mb-3 md:mb-6" style={{ fontFamily: "var(--font-display)" }}>
            Photography <em className="italic">Courses</em>
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground max-w-lg leading-relaxed mb-6 md:mb-12" style={{ fontFamily: "var(--font-body)" }}>
            {t("courses.subtitle")}
          </p>
        </motion.div>

        {categories.length > 0 && (
          <div className="flex gap-2 mb-6 md:mb-12 overflow-x-auto scrollbar-hide">
            <button onClick={() => setSelectedCategory(null)} className={`text-[10px] tracking-[0.15em] uppercase px-3 md:px-4 py-1.5 md:py-2 border rounded-full md:rounded-none transition-all duration-300 whitespace-nowrap ${!selectedCategory ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"}`} style={{ fontFamily: "var(--font-heading)" }}>{t("comp.filterAll")}</button>
            {categories.map((cat) => (
              <button key={cat} onClick={() => setSelectedCategory(cat)} className={`text-[10px] tracking-[0.15em] uppercase px-3 md:px-4 py-1.5 md:py-2 border rounded-full md:rounded-none transition-all duration-300 whitespace-nowrap ${selectedCategory === cat ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"}`} style={{ fontFamily: "var(--font-heading)" }}>{cat}</button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse">
                <div className="h-48 bg-muted mb-4" />
                <div className="h-4 bg-muted w-3/4 mb-2" />
                <div className="h-3 bg-muted w-1/2" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-24">
            <GraduationCap className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground text-sm" style={{ fontFamily: "var(--font-body)" }}>{t("courses.empty")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6 pb-6 md:pb-10">
            {filtered.map((course, i) => (
              <motion.article key={course.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1, duration: 0.8 }}>
                <Link to={`/courses/${course.slug}`} className="group block rounded-xl border border-border overflow-hidden transition-all duration-300 hover:shadow-md hover:border-primary/20">
                  {/* 1:1 Square image */}
                  <div className="relative aspect-square overflow-hidden">
                    {course.cover_image_url ? (
                      <img src={course.cover_image_url} alt={course.title} className="w-full h-full object-cover transition-transform duration-[1.5s] group-hover:scale-[1.03]" loading="lazy" />
                    ) : (
                      <div className="w-full h-full bg-muted flex items-center justify-center">
                        <BookOpen className="h-10 w-10 text-muted-foreground/30" />
                      </div>
                    )}
                    <div className="absolute top-3 right-3 flex flex-col items-end gap-1">
                      {course.is_featured && (
                        <span className="text-[8px] tracking-[0.15em] uppercase px-2.5 py-1 bg-yellow-500 text-yellow-950 font-semibold" style={{ fontFamily: "var(--font-heading)" }}>★ {t("common.featured")}</span>
                      )}
                      {course.labels?.map((label) => (
                        <span key={label} className={`text-[8px] tracking-[0.1em] uppercase px-2.5 py-1 font-semibold ${
                          label === "Few Seats Left" ? "bg-destructive text-destructive-foreground" :
                          label === "Filling Up 1st" ? "bg-accent text-accent-foreground" :
                          label === "Early Bird Offer" ? "bg-primary text-primary-foreground" :
                          label === "Most Demand" ? "bg-secondary text-secondary-foreground" :
                          "bg-primary text-primary-foreground"
                        }`} style={{ fontFamily: "var(--font-heading)" }}>{label}</span>
                      ))}
                    </div>
                  </div>

                  {/* Card body */}
                  <div className="p-4 space-y-2.5">
                    <div className="flex items-center gap-3">
                      <span className={`text-[9px] tracking-[0.2em] uppercase px-2 py-0.5 border ${difficultyColor(course.difficulty)}`} style={{ fontFamily: "var(--font-heading)" }}>{course.difficulty}</span>
                      <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>{course.category}</span>
                    </div>

                    <h2 className="text-lg md:text-xl font-semibold leading-snug group-hover:text-primary transition-colors duration-500" style={{ fontFamily: "var(--font-display)" }}>{course.title}</h2>

                    {course.description && (
                      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2" style={{ fontFamily: "var(--font-body)" }}>{course.description}</p>
                    )}

                    {/* Rating row */}
                    <div className="flex items-center gap-3">
                      {(course.admin_rating ?? 0) > 0 && (
                        <div className="flex items-center gap-1">
                          <span className="text-sm font-medium text-yellow-500">{Number(course.admin_rating).toFixed(1)}</span>
                          <div className="flex">
                            {[1, 2, 3, 4, 5].map((s) => (
                              <Star key={s} className={`h-3 w-3 ${s <= Math.floor(course.admin_rating) ? "text-yellow-500 fill-yellow-500" : "text-yellow-500/40 fill-yellow-500/20"}`} />
                            ))}
                          </div>
                          {(course.admin_rating_count ?? 0) > 0 && (
                            <span className="text-[10px] text-muted-foreground ml-0.5">({course.admin_rating_count.toLocaleString()})</span>
                          )}
                        </div>
                      )}
                      {(course.admin_students ?? 0) > 0 && (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                          <Users className="h-3 w-3" /> {course.admin_students.toLocaleString()}
                        </span>
                      )}
                    </div>

                    {/* Meta row */}
                    <div className="flex items-center gap-4 text-[10px] text-muted-foreground pt-1 border-t border-border" style={{ fontFamily: "var(--font-heading)" }}>
                      <div className="min-w-0">
                        <UserIdentityBlock
                          userId={course.author_id || ""}
                          name={course.author_name || "Unknown"}
                          linkTo={`/profile/${course.author_id || ""}`}
                          nameClassName="text-[10px] hover:text-primary hover:underline transition-colors [font-family:var(--font-heading)]"
                        />
                      </div>
                      <span className="flex items-center gap-1">
                        <BookOpen className="h-3 w-3" />
                        {course.lesson_count} {course.lesson_count !== 1 ? "lessons" : "lesson"}
                      </span>
                      {course.is_free && <span className="text-primary font-medium">Free</span>}
                    </div>
                  </div>
                </Link>
              </motion.article>
            ))}
          </div>
        )}
      </div>
    </main>
  );
};

export default Courses;
