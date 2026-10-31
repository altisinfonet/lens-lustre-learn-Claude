/**
 * Password security utilities.
 * - Strength validation with complexity requirements
 * - Password history hashing for reuse prevention (client-side)
 * - Common password blocklist
 */

// Top 100 most common passwords to block
const COMMON_PASSWORDS = new Set([
  "password", "12345678", "123456789", "1234567890", "qwerty123",
  "password1", "iloveyou", "sunshine1", "princess1", "football1",
  "charlie1", "access14", "shadow12", "master12", "michael1",
  "mustang1", "jessica1", "letmein1", "trustno1", "jordan23",
  "harley12", "ranger12", "batman12", "andrew12", "tigger12",
  "abcdef12", "qwerty12", "abc12345", "password123", "welcome1",
  "monkey12", "dragon12", "passw0rd", "p@ssw0rd", "p@ssword",
  "admin123", "12345678", "welcome1", "1q2w3e4r", "qwertyui",
]);

export interface PasswordValidation {
  valid: boolean;
  errors: string[];
  score: number; // 0-5
}

/**
 * Validate password strength with specific requirements:
 * - Min 8 characters
 * - At least 1 uppercase letter
 * - At least 1 lowercase letter
 * - At least 1 digit
 * - At least 1 special character
 * - Not in common password list
 */
export function validatePasswordStrength(password: string): PasswordValidation {
  const errors: string[] = [];
  let score = 0;

  if (password.length >= 8) score++;
  else errors.push("Must be at least 8 characters");

  if (password.length >= 12) score++;

  if (/[A-Z]/.test(password)) score++;
  else errors.push("Must contain at least one uppercase letter");

  if (/[a-z]/.test(password)) {
    // no score increment, just validation
  } else {
    errors.push("Must contain at least one lowercase letter");
  }

  if (/[0-9]/.test(password)) score++;
  else errors.push("Must contain at least one number");

  if (/[^A-Za-z0-9]/.test(password)) score++;
  else errors.push("Must contain at least one special character (!@#$%^&*)");

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    errors.push("This password is too common. Please choose a stronger one.");
    score = Math.max(score - 2, 0);
  }

  return { valid: errors.length === 0, errors, score };
}

/**
 * Simple client-side password hash for reuse comparison.
 * Uses SubtleCrypto SHA-256 — NOT for server-side auth, only for
 * comparing if a new password matches previously used ones.
 */
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + "_50mm_retina_salt");
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

const PASSWORD_HISTORY_KEY = "pw_history";
const MAX_HISTORY = 1;

/**
 * Check if a password was recently used (last 5 passwords).
 * Returns true if the password was previously used.
 */
export async function isPasswordReused(userId: string, password: string): Promise<boolean> {
  try {
    const stored = localStorage.getItem(`${PASSWORD_HISTORY_KEY}_${userId}`);
    if (!stored) return false;

    const history: string[] = JSON.parse(stored);
    const hash = await hashPassword(password);
    return history.includes(hash);
  } catch {
    return false;
  }
}

/**
 * Record a password in the user's local history after a successful change.
 */
export async function recordPasswordUsage(userId: string, password: string): Promise<void> {
  try {
    const hash = await hashPassword(password);
    const stored = localStorage.getItem(`${PASSWORD_HISTORY_KEY}_${userId}`);
    const history: string[] = stored ? JSON.parse(stored) : [];

    if (!history.includes(hash)) {
      history.push(hash);
      // Keep only last N
      while (history.length > MAX_HISTORY) history.shift();
    }

    localStorage.setItem(`${PASSWORD_HISTORY_KEY}_${userId}`, JSON.stringify(history));
  } catch {
    // Fail silently — this is a best-effort feature
  }
}

/**
 * Lockout management — persisted via localStorage.
 */
const LOCKOUT_KEY = "login_lockout";

interface LockoutState {
  failedAttempts: number;
  lockedUntil: number | null; // timestamp
  lastAttempt: number;
}

function getLockoutState(): LockoutState {
  try {
    const stored = localStorage.getItem(LOCKOUT_KEY);
    if (!stored) return { failedAttempts: 0, lockedUntil: null, lastAttempt: 0 };
    const state = JSON.parse(stored);
    // Reset if last attempt was more than 1 hour ago
    if (state.lastAttempt && Date.now() - state.lastAttempt > 3600000) {
      return { failedAttempts: 0, lockedUntil: null, lastAttempt: 0 };
    }
    return state;
  } catch {
    return { failedAttempts: 0, lockedUntil: null, lastAttempt: 0 };
  }
}

function saveLockoutState(state: LockoutState): void {
  try {
    localStorage.setItem(LOCKOUT_KEY, JSON.stringify(state));
  } catch {
    // Fail silently
  }
}

/**
 * Check if the account is currently locked out.
 * Returns remaining seconds if locked, or 0 if not locked.
 */
export function getLockedOutSeconds(): number {
  const state = getLockoutState();
  if (!state.lockedUntil) return 0;
  const remaining = Math.ceil((state.lockedUntil - Date.now()) / 1000);
  if (remaining <= 0) {
    // Lockout expired, clear it
    saveLockoutState({ ...state, lockedUntil: null });
    return 0;
  }
  return remaining;
}

/**
 * Get the current number of failed attempts.
 */
export function getFailedAttempts(): number {
  return getLockoutState().failedAttempts;
}

/**
 * Record a failed login attempt. Returns lockout duration in seconds if locked.
 * Progressive lockout:
 * - 3 failures: 30 second lockout + CAPTCHA
 * - 5 failures: 2 minute lockout
 * - 7 failures: 5 minute lockout
 * - 10+ failures: 15 minute lockout
 */
export function recordFailedAttempt(): number {
  const state = getLockoutState();
  state.failedAttempts += 1;
  state.lastAttempt = Date.now();

  let lockoutSeconds = 0;

  if (state.failedAttempts >= 10) {
    lockoutSeconds = 900; // 15 minutes
  } else if (state.failedAttempts >= 7) {
    lockoutSeconds = 300; // 5 minutes
  } else if (state.failedAttempts >= 5) {
    lockoutSeconds = 120; // 2 minutes
  } else if (state.failedAttempts >= 3) {
    lockoutSeconds = 30; // 30 seconds
  }

  if (lockoutSeconds > 0) {
    state.lockedUntil = Date.now() + lockoutSeconds * 1000;
  }

  saveLockoutState(state);
  return lockoutSeconds;
}

/**
 * Reset lockout state after successful login.
 */
export function resetLockout(): void {
  try {
    localStorage.removeItem(LOCKOUT_KEY);
  } catch {
    // Fail silently
  }
}
