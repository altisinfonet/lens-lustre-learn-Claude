/**
 * Super-admin-only toggle to reveal judge identities in admin audit views.
 * Toggling writes an audit log entry via setJudgeReveal().
 */
import { Eye, EyeOff, ShieldAlert } from "lucide-react";
import { useJudgeReveal, setJudgeReveal } from "@/lib/judgeAnonymizer";
import { useUserRoles } from "@/hooks/profile/useUserRoles";
import { useAuth } from "@/hooks/core/useAuth";

const JudgeRevealToggle = () => {
  const { user } = useAuth();
  const { hasRole } = useUserRoles();
  const reveal = useJudgeReveal();

  if (!hasRole("admin")) return null;

  return (
    <button
      type="button"
      onClick={() => setJudgeReveal(!reveal, user?.id)}
      className={`inline-flex items-center gap-1.5 px-2 py-1 border text-[9px] tracking-[0.15em] uppercase transition-colors ${
        reveal
          ? "border-destructive/40 bg-destructive/5 text-destructive hover:bg-destructive/10"
          : "border-border bg-transparent text-muted-foreground hover:border-primary/40 hover:text-primary"
      }`}
      style={{ fontFamily: "var(--font-heading)" }}
      title={reveal ? "Identities visible — click to anonymize" : "Identities anonymized — click to reveal (audited)"}
    >
      {reveal ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
      {reveal ? (
        <span className="flex items-center gap-1">
          <ShieldAlert className="h-2.5 w-2.5" /> Identities revealed
        </span>
      ) : (
        <span>Anonymized</span>
      )}
    </button>
  );
};

export default JudgeRevealToggle;
