import { Link } from "react-router-dom";
import { Camera, UserPlus } from "lucide-react";
import { motion } from "framer-motion";

const headingFont = { fontFamily: "var(--font-heading)" };
const displayFont = { fontFamily: "var(--font-display)" };
const bodyFont = { fontFamily: "var(--font-body)" };

/**
 * Shown to unauthenticated visitors on public profiles.
 * Renders a blur gradient overlay + sticky bottom join bar.
 */
const PublicProfileJoinWall = () => {
  return (
    <>
      {/* ── Blur overlay wall (sits on top of content) ── */}
      <div className="relative z-10 -mt-4">
        {/* Gradient fade from transparent to solid */}
        <div className="h-32 bg-gradient-to-b from-transparent via-background/70 to-background pointer-events-none" />

        {/* Main CTA card */}
        <div className="bg-background pb-32">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            className="max-w-md mx-auto text-center px-6"
          >
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-5">
              <Camera className="h-7 w-7 text-primary" />
            </div>
            <h3
              className="text-xl md:text-2xl font-light tracking-tight mb-3"
              style={displayFont}
            >
              Join to see <em className="italic text-primary">more</em>
            </h3>
            <p
              className="text-sm text-muted-foreground leading-relaxed mb-6"
              style={bodyFont}
            >
              Sign up to explore full profiles, view competition entries,
              connect with photographers, and share your own work.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                to="/signup"
                className="inline-flex items-center gap-2 text-xs tracking-[0.15em] uppercase px-8 py-3 bg-primary text-primary-foreground hover:opacity-90 transition-opacity duration-300"
                style={headingFont}
              >
                <UserPlus className="h-3.5 w-3.5" />
                Sign Up Free
              </Link>
              <Link
                to="/login"
                className="inline-flex items-center gap-2 text-xs tracking-[0.15em] uppercase px-8 py-3 border border-border text-foreground hover:border-foreground/40 transition-colors duration-300"
                style={headingFont}
              >
                Log In
              </Link>
            </div>
          </motion.div>
        </div>
      </div>

      {/* ── Sticky bottom bar ── */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-md border-t border-border py-3 px-4">
        <div className="max-w-lg mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <Camera className="h-4 w-4 text-primary shrink-0" />
            <span
              className="text-[10px] sm:text-xs tracking-[0.1em] uppercase text-foreground truncate"
              style={headingFont}
            >
              Join 50mm Retina World
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              to="/login"
              className="text-[10px] tracking-[0.12em] uppercase px-4 py-2 border border-border text-foreground hover:border-foreground/40 transition-colors duration-300"
              style={headingFont}
            >
              Log In
            </Link>
            <Link
              to="/signup"
              className="text-[10px] tracking-[0.12em] uppercase px-4 py-2 bg-primary text-primary-foreground hover:opacity-90 transition-opacity duration-300"
              style={headingFont}
            >
              Sign Up
            </Link>
          </div>
        </div>
      </div>
    </>
  );
};

export default PublicProfileJoinWall;
