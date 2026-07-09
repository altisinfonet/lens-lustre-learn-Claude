import { BookOpen, Star, Users } from "lucide-react";
import UserIdentityBlock from "@/components/UserIdentityBlock";

const headingFont = { fontFamily: "var(--font-heading)" };
const displayFont = { fontFamily: "var(--font-display)" };
const bodyFont = { fontFamily: "var(--font-body)" };

interface CourseHeroProps {
  courseId: string;
  title: string;
  description: string | null;
  category: string;
  difficulty: string;
  lessonCount: number;
  isFree: boolean;
  price: number | null;
  authorId: string;
  authorName: string | null;
  coverImageUrl: string | null;
  adminStudents: number;
  adminRating: number;
  adminRatingCount: number;
}

const CourseHero = ({
  courseId,
  title,
  description,
  category,
  difficulty,
  lessonCount,
  isFree,
  price,
  authorId,
  authorName,
  coverImageUrl,
  adminStudents,
  adminRating,
  adminRatingCount,
}: CourseHeroProps) => {
  const ratingWhole = Math.floor(adminRating);
  const ratingDisplay = adminRating > 0 ? adminRating.toFixed(1) : "0.0";
  return (
    <div
      className="relative w-full h-[340px] bg-cover bg-center"
      style={{
        backgroundImage: coverImageUrl ? `url(${coverImageUrl})` : undefined,
        backgroundColor: coverImageUrl ? undefined : "hsl(var(--muted))",
      }}
    >
      {/* Dark gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/60 to-transparent" />

      {/* Bottom-aligned content */}
      <div className="absolute bottom-0 left-0 w-full">
        <div className="max-w-7xl mx-auto px-6 pb-8">
          {/* Category + Difficulty */}
          <div className="flex items-center gap-2 mb-3">
            <span
              className="text-[10px] tracking-[0.2em] uppercase text-primary"
              style={headingFont}
            >
              {category}
            </span>
            <span className="text-white/30">·</span>
            <span
              className={`text-[10px] tracking-[0.2em] uppercase ${
                difficulty === "Beginner"
                  ? "text-primary"
                  : difficulty === "Intermediate"
                  ? "text-yellow-500"
                  : "text-accent"
              }`}
              style={headingFont}
            >
              {difficulty}
            </span>
          </div>

          {/* Title */}
          <h1
            className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight leading-[1.1] mb-3 text-white"
            style={displayFont}
          >
            {title}
          </h1>

          {/* Short description */}
          {description && (
            <p
              className="text-sm md:text-base text-white/70 leading-relaxed max-w-2xl mb-4 line-clamp-2"
              style={bodyFont}
            >
              {description.split("\n\n")[0]}
            </p>
          )}

          {/* Rating + students */}
          <div className="flex items-center gap-4 mb-4 flex-wrap">
            <div className="flex items-center gap-1">
              <span className="text-sm font-medium text-yellow-500">{ratingDisplay}</span>
              <div className="flex">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Star
                    key={i}
                    className={`h-3.5 w-3.5 ${
                      i <= ratingWhole
                        ? "text-yellow-500 fill-yellow-500"
                        : "text-yellow-500/40 fill-yellow-500/20"
                    }`}
                  />
                ))}
              </div>
              {adminRatingCount > 0 && (
                <span className="text-xs text-white/50 ml-1">({adminRatingCount.toLocaleString()})</span>
              )}
            </div>
            <span
              className="flex items-center gap-1 text-xs text-white/50"
              style={headingFont}
            >
              <Users className="h-3 w-3" /> {adminStudents.toLocaleString()} students enrolled
            </span>
          </div>

          {/* Author + meta row */}
          <div
            className="flex items-center gap-4 text-xs text-white/60 flex-wrap"
            style={headingFont}
          >
            <UserIdentityBlock
              userId={authorId}
              name={authorName || "Unknown"}
              linkTo={`/profile/${authorId}`}
              nameClassName="tracking-[0.1em] uppercase text-white/80 hover:text-primary hover:underline transition-colors"
            />
            <span className="flex items-center gap-1">
              <BookOpen className="h-3 w-3" />
              {lessonCount} lessons
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CourseHero;
