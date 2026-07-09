import { Link } from "react-router-dom";
import { LogIn, TrendingUp, Trophy, BookOpen, Camera } from "lucide-react";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };

interface Props {
  type: "left" | "right";
}

const AnonymousSidebarFallback = ({ type }: Props) => {
  if (type === "left") {
    return (
      <div className="space-y-5">
        {/* Join CTA */}
        <div className="border border-border bg-card/50 rounded-sm">
          <div className="px-4 py-3 border-b border-border">
            <span
              className="text-[9px] tracking-[0.3em] uppercase text-primary flex items-center gap-1.5"
              style={headingFont}
            >
              <Camera className="h-3 w-3" />
              Welcome
            </span>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-xs text-muted-foreground leading-relaxed" style={bodyFont}>
              Join our community of photographers. Share your work, compete, and grow.
            </p>
            <Link
              to="/signup"
              className="inline-flex items-center gap-1.5 text-[9px] tracking-[0.15em] uppercase px-3 py-2 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors rounded-sm w-full justify-center"
              style={headingFont}
            >
              <LogIn className="h-3 w-3" />
              Sign Up Free
            </Link>
            <p className="text-[9px] text-muted-foreground text-center" style={bodyFont}>
              Already a member?{" "}
              <Link to="/login" className="text-primary hover:underline">
                Log in
              </Link>
            </p>
          </div>
        </div>

        {/* Trending Tags */}
        <div className="border border-border bg-card/50 rounded-sm">
          <div className="px-4 py-3 border-b border-border">
            <span
              className="text-[9px] tracking-[0.3em] uppercase text-primary flex items-center gap-1.5"
              style={headingFont}
            >
              <TrendingUp className="h-3 w-3" />
              Popular Categories
            </span>
          </div>
          <div className="p-4">
            <div className="flex flex-wrap gap-1.5">
              {["Street", "Portrait", "Landscape", "Wildlife", "Macro", "Architecture"].map((tag) => (
                <span
                  key={tag}
                  className="text-[9px] tracking-[0.1em] px-2 py-1 border border-border rounded-sm text-muted-foreground"
                  style={bodyFont}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // type === "right"
  return (
    <div className="space-y-5">
      {/* Competitions Teaser */}
      <div className="border border-border bg-card/50 rounded-sm">
        <div className="px-4 py-3 border-b border-border">
          <span
            className="text-[9px] tracking-[0.3em] uppercase text-primary flex items-center gap-1.5"
            style={headingFont}
          >
            <Trophy className="h-3 w-3" />
            Competitions
          </span>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed" style={bodyFont}>
            Enter photography competitions and win recognition for your craft.
          </p>
          <Link
            to="/competitions"
            className="inline-flex items-center gap-1.5 text-[9px] tracking-[0.15em] uppercase px-3 py-2 border border-primary/40 text-primary hover:bg-primary/10 transition-colors rounded-sm w-full justify-center"
            style={headingFont}
          >
            <Trophy className="h-3 w-3" />
            Explore Competitions
          </Link>
        </div>
      </div>

      {/* Courses Teaser */}
      <div className="border border-border bg-card/50 rounded-sm">
        <div className="px-4 py-3 border-b border-border">
          <span
            className="text-[9px] tracking-[0.3em] uppercase text-primary flex items-center gap-1.5"
            style={headingFont}
          >
            <BookOpen className="h-3 w-3" />
            Learn Photography
          </span>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed" style={bodyFont}>
            Explore courses from beginner to advanced, taught by professionals.
          </p>
          <Link
            to="/courses"
            className="inline-flex items-center gap-1.5 text-[9px] tracking-[0.15em] uppercase px-3 py-2 border border-primary/40 text-primary hover:bg-primary/10 transition-colors rounded-sm w-full justify-center"
            style={headingFont}
          >
            <BookOpen className="h-3 w-3" />
            Browse Courses
          </Link>
        </div>
      </div>

      {/* Login CTA */}
      <div className="border border-dashed border-border rounded-sm p-4 text-center">
        <p className="text-[10px] text-muted-foreground mb-2" style={bodyFont}>
          Sign in to see personalized recommendations
        </p>
        <Link
          to="/login"
          className="text-[9px] tracking-[0.15em] uppercase text-primary hover:underline"
          style={headingFont}
        >
          Log In →
        </Link>
      </div>
    </div>
  );
};

export default AnonymousSidebarFallback;
