import { AGE_RULE_LINE } from "@/lib/ageRule";

/** The one 18+ line beside every date of birth. */
export const AgeRuleNotice = () => (
  <p className="text-sm font-semibold text-foreground" data-testid="age-18-notice">{AGE_RULE_LINE}</p>
);

/** The one refusal under a date of birth. */
export const AgeRuleError = ({ message }: { message: string }) =>
  message ? (
    <p className="text-sm font-semibold text-destructive" role="alert" data-testid="age-18-error">{message}</p>
  ) : null;
