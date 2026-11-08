// Administration > Password & sessions: what the form holds, checks and sends, as decisions apart from React so `node --test` can pin them. Relative imports only.
//
// WHAT THE PAGE OFFERS (G12 P-6): the settings the platform enforces and nothing it does not. Password length and character classes are checked when an administrator
// creates an account (admin_router.create_user, services/password_policy.validate_password); the idle timeout signs a person out (the client's IdleLogout and
// /auth/me); the failed-sign-in count and the lock time lock an account only when the server has account locking switched on (AUTH_ACCOUNT_LOCKOUT_ENABLED,
// services/password_policy._lockout_enabled), which this page cannot see. "Disallow reuse of the last N passwords" and "Maximum password age" are stored but nothing
// reads them, so they are not offered and never sent: the server keeps whatever they hold. The ranges are the server's (admin_router.update_password_policy).

export interface PolicyRecord {
  min_length: number;
  require_uppercase: boolean;
  require_lowercase: boolean;
  require_digit: boolean;
  require_special: boolean;
  lockout_threshold: number;
  lockout_minutes: number;
  session_idle_timeout_minutes: number;
  updated_at?: string | null;
}

/** A number box holds a number, or NaN while it is empty or not a number. */
export interface PolicyForm {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigit: boolean;
  requireSpecial: boolean;
  lockoutThreshold: number;
  lockoutMinutes: number;
  idleMinutes: number;
}

export type NumberField = 'minLength' | 'lockoutThreshold' | 'lockoutMinutes' | 'idleMinutes';
export type FlagField = 'requireUppercase' | 'requireLowercase' | 'requireDigit' | 'requireSpecial';

/** The server's ranges (inclusive). */
export const RANGES: Record<NumberField, { min: number; max: number }> = {
  minLength: { min: 8, max: 128 },
  lockoutThreshold: { min: 3, max: 50 },
  lockoutMinutes: { min: 1, max: 1440 },
  idleMinutes: { min: 5, max: 1440 },
};

const SERVER_FIELD: Record<NumberField | FlagField, string> = {
  minLength: 'min_length', requireUppercase: 'require_uppercase', requireLowercase: 'require_lowercase', requireDigit: 'require_digit', requireSpecial: 'require_special',
  lockoutThreshold: 'lockout_threshold', lockoutMinutes: 'lockout_minutes', idleMinutes: 'session_idle_timeout_minutes',
};
const FIELDS = Object.keys(SERVER_FIELD) as Array<NumberField | FlagField>;

export function formOf(record: PolicyRecord): PolicyForm {
  return {
    minLength: record.min_length,
    requireUppercase: !!record.require_uppercase, requireLowercase: !!record.require_lowercase, requireDigit: !!record.require_digit, requireSpecial: !!record.require_special,
    lockoutThreshold: record.lockout_threshold, lockoutMinutes: record.lockout_minutes, idleMinutes: record.session_idle_timeout_minutes,
  };
}

/** What a number box typed makes: empty is NaN (not 0, which would pass for a value), text with a decimal point is NaN too. */
export function numberOf(typed: string): number {
  const text = typed.trim();
  return /^\d+$/.test(text) ? Number(text) : Number.NaN;
}

const same = (a: number | boolean, b: number | boolean): boolean => (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) || a === b;

export const isDirty = (saved: PolicyForm, form: PolicyForm): boolean => FIELDS.some((k) => !same(saved[k], form[k]));

/** Only what changed, under the server's names. History and maximum age are not here and are never sent. */
export function bodyOf(saved: PolicyForm, form: PolicyForm): Record<string, number | boolean> {
  const body: Record<string, number | boolean> = {};
  FIELDS.forEach((k) => { if (!same(saved[k], form[k])) body[SERVER_FIELD[k]] = form[k]; });
  return body;
}

export const LABELS: Record<NumberField, string> = {
  minLength: 'Minimum length', lockoutThreshold: 'Failed sign-ins before lock', lockoutMinutes: 'Lock time', idleMinutes: 'Sign out after inactivity',
};

/** What is wrong with a number box, in words ("Use a whole number from 8 to 128."); nothing for a field that is fine. */
export function errorsOf(form: PolicyForm): Partial<Record<NumberField, string>> {
  const errors: Partial<Record<NumberField, string>> = {};
  (Object.keys(RANGES) as NumberField[]).forEach((k) => {
    const { min, max } = RANGES[k];
    const v = form[k];
    if (!Number.isInteger(v) || v < min || v > max) errors[k] = `Use a whole number from ${min} to ${max}.`;
  });
  return errors;
}

export const hasErrors = (form: PolicyForm): boolean => Object.keys(errorsOf(form)).length > 0;

/** The words beside each setting: what it does and when it takes effect. */
export const INFO = {
  minLength: 'Checked when an administrator creates an account. 12 or more is recommended; 8 is the lowest allowed.',
  classes: 'Every account created by an administrator needs a password with each kind ticked here.',
  lockoutThreshold: 'Locks an account after this many wrong passwords in a row. Locking is switched on for the whole platform by whoever runs it: until then wrong passwords are counted and nothing is locked.',
  lockoutMinutes: 'How long a locked account stays locked.',
  idleMinutes: 'Signs a person out after this long without any activity in the platform.',
} as const;

export const CLASSES: ReadonlyArray<{ key: FlagField; label: string }> = [
  { key: 'requireUppercase', label: 'An uppercase letter (A to Z)' },
  { key: 'requireLowercase', label: 'A lowercase letter (a to z)' },
  { key: 'requireDigit', label: 'A digit (0 to 9)' },
  { key: 'requireSpecial', label: 'A special character (! @ # $ …)' },
];

export const SAVED = { title: 'Password and session settings saved', message: 'They apply from the next sign-in, and to accounts created from now on.' } as const;
export const SAVE_FAILED = "The settings weren't saved";
