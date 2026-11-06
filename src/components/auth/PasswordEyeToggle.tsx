/**
 * THE ONE show/hide-password button — sign in, sign up and reset password, web
 * and app alike (Owner, 6 Nov 2026: "eye button to password view must be larger
 * 2x from now, web and App"). The icon is 32 px (was 16 px on sign in, 14 px on
 * sign up) inside a 44 px tap area; the field it sits in keeps `PASSWORD_EYE_PAD`
 * on its right so typed text never runs under it.
 */
import { Eye, EyeOff } from "lucide-react";

/** The right padding a password field needs for this button (44 px button + 8 px gap). */
export const PASSWORD_EYE_PAD = "pr-14";

export default function PasswordEyeToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="absolute right-1 top-1/2 -translate-y-1/2 grid h-11 w-11 place-items-center text-foreground/70 hover:text-foreground transition-colors"
      aria-label={shown ? "Hide password" : "Show password"}
      data-testid="password-eye"
    >
      {shown ? <EyeOff className="h-8 w-8" /> : <Eye className="h-8 w-8" />}
    </button>
  );
}
