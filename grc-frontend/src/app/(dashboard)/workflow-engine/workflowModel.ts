// The Workflow Engine page's rules as pure functions apart from React, so `node --test` can pin them (workflowModel.test.ts): the tabs kept in the address, the list of saved
// workflows newest first with their trigger in words, the one-line count of runs, the e-mail server form (validation in plain words, the body the server takes) and the
// "try a workflow" sample data. The engine itself, the route names and the events the audit log describes are the server's and are not touched by the page.
import { parseUtc } from '../../../lib/serverTime.ts';

export const TAB_KEYS = ['builder', 'workflows', 'analytics', 'approvals', 'schedules'] as const;
export type TabKey = (typeof TAB_KEYS)[number];
export const TAB_LABELS: Record<TabKey, string> = {
  builder: 'Builder', workflows: 'Workflows', analytics: 'Analytics', approvals: 'Approvals', schedules: 'Schedules & webhooks',
};

/** "risk.created" -> "Risk created"; "manual.trigger" -> "Manual trigger"; nothing is a dash. Event keys are the engine's code names, said in words. */
export function triggerWords(event: string | null | undefined): string {
  const words = String(event ?? '').replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '—';
}

export interface DefinitionRow { id: number; name: string; trigger_event?: string | null; version?: number | null; is_active?: boolean | null; updated_at?: string | null }

/** Newest first by the time they were last changed (server times are naive UTC); a workflow with no time goes last; ties keep the server's order. */
export function newestFirst<T extends Pick<DefinitionRow, 'updated_at'>>(rows: readonly T[]): T[] {
  const stamp = (r: T) => parseUtc(r.updated_at ?? null)?.getTime() ?? 0;
  return rows.map((r, i) => ({ r, i })).sort((a, b) => stamp(b.r) - stamp(a.r) || a.i - b.i).map((x) => x.r);
}

export interface Overview { total_instances?: number; completed?: number; running?: number; failed?: number; waiting?: number }

/** "12 runs · 9 completed · 1 running · 1 failed · 1 waiting": the line under the title. Only the counts that are not zero follow the total. */
export function runsLine(o: Overview | null | undefined): string {
  const n = (v: number | undefined) => Math.max(0, Math.round(Number(v) || 0));
  const total = n(o?.total_instances);
  const parts = [`${total.toLocaleString('en-US')} ${total === 1 ? 'run' : 'runs'}`];
  (['completed', 'running', 'failed', 'waiting'] as const).forEach((k) => { if (n(o?.[k])) parts.push(`${n(o?.[k]).toLocaleString('en-US')} ${k}`); });
  return parts.join(' · ');
}

// ── the e-mail server ────────────────────────────────────────────────────────

export interface SmtpForm { config_name: string; smtp_host: string; smtp_port: string; smtp_username: string; smtp_password: string; from_email: string; from_name: string; use_tls: boolean }

/** What the form starts with: the values the page always started with. The password is never filled in and never read back. */
export const SMTP_DEFAULTS: SmtpForm = {
  config_name: 'default', smtp_host: 'smtp.gmail.com', smtp_port: '587', smtp_username: '', smtp_password: '', from_email: '', from_name: 'ComplyVerse', use_tls: true,
};

export const isEmail = (text: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(text).trim());

export interface SmtpErrors { smtp_host?: string; smtp_port?: string; smtp_username?: string; smtp_password?: string; from_email?: string }

/** The sentences for a form that cannot be saved (the page used to grey Save out without saying why). */
export function smtpErrors(f: SmtpForm): SmtpErrors {
  const errors: SmtpErrors = {};
  if (!f.smtp_host.trim()) errors.smtp_host = 'Enter the mail server address.';
  const port = Number(f.smtp_port);
  if (f.smtp_port.trim() !== '' && !(Number.isInteger(port) && port >= 1 && port <= 65535)) errors.smtp_port = 'Enter a port from 1 to 65535.';
  if (!f.smtp_username.trim()) errors.smtp_username = 'Enter the account that signs in to the mail server.';
  if (!f.smtp_password) errors.smtp_password = 'Enter the password or app password.';
  if (f.from_email.trim() && !isEmail(f.from_email)) errors.from_email = 'Enter an e-mail address, like noreply@yourcompany.com.';
  return errors;
}
export const hasSmtpErrors = (e: SmtpErrors): boolean => Object.keys(e).length > 0;

/** The body the server takes: the same fields and fall-backs as before (port 587, "from" the sign-in account, name ComplyVerse). */
export function smtpBody(f: SmtpForm): Record<string, unknown> {
  return {
    config_name: f.config_name.trim() || 'default',
    smtp_host: f.smtp_host.trim(),
    smtp_port: Number(f.smtp_port) || 587,
    smtp_username: f.smtp_username.trim(),
    smtp_password: f.smtp_password,
    from_email: f.from_email.trim() || f.smtp_username.trim(),
    from_name: f.from_name.trim() || 'ComplyVerse',
    use_tls: f.use_tls,
  };
}

// ── trying a workflow ────────────────────────────────────────────────────────

export const TRY_DEFAULT_EVENT = 'manual.trigger';

/** The sample data for a test run: empty means none; it must be an object (the engine reads named values from it). */
export function parseSample(text: string): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  const raw = String(text ?? '').trim();
  if (!raw) return { ok: true, value: {} };
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === 'object' && !Array.isArray(value)) return { ok: true, value: value as Record<string, unknown> };
    return { ok: false, message: 'The sample data must be an object, written like {"severity": "high"}.' };
  } catch {
    return { ok: false, message: 'The sample data is not valid. Check the brackets, quotes and commas.' };
  }
}

/** The body of a test run; an empty event is the default one. */
export function tryBody(workflowId: number, event: string, sample: Record<string, unknown>): Record<string, unknown> {
  return { workflow_definition_id: workflowId, trigger_event: event.trim() || TRY_DEFAULT_EVENT, payload: sample };
}
