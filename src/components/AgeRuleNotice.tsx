import { AGE_RULE_LINE, AGE_RULE_SHORT } from "@/lib/ageRule";

/** The one 18+ line beside every date of birth. */
export const AgeRuleNotice = () => (
  <p className="text-sm font-semibold text-foreground" data-testid="age-18-notice">{AGE_RULE_LINE}</p>
);

/** The short form, on the same line as the Date of Birth label. */
export const AgeRuleBadge = () => (
  <span className="text-sm font-semibold text-foreground" data-testid="age-18-badge">{AGE_RULE_SHORT}</span>
);

/** The one refusal under a date of birth. */
export const AgeRuleError = ({ message }: { message: string }) =>
  message ? (
    <p className="text-sm font-semibold text-destructive" role="alert" data-testid="age-18-error">{message}</p>
  ) : null;
