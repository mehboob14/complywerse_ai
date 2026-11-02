'use client';

// Small building blocks shared by the Reports tabs (Saved, Scheduled, Trends) so they
// look like the Report Builder card next to them. Lives beside page.tsx because a Next.js
// page file may not export extra components.
import React from 'react';
import type { LucideIcon } from 'lucide-react';

export const ACCENT = 'var(--color-base)';

export const labelize = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const inputCls =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-base)] focus:outline-none';

export const btnPrimary =
  'inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-[var(--color-on-base)] disabled:opacity-60';

export const btnGhost =
  'inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-subtle)] disabled:opacity-60';

/** Compact icon-or-text button used inside table rows. */
export const btnRow =
  'inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-subtle)] disabled:opacity-50';

export const fieldLabel = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]';

/** Date + time in the viewer's locale. API timestamps are UTC ISO strings. */
export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// Date helpers live in ./dates (pure, unit-checked). Re-exported so existing
// callers keep importing `fmtDate` from './shared'.
export { fmtDate, parseServerDate } from './dates';

/** Icon + title + description header with right-aligned actions, then the body. Matches the Report Builder card. */
export function PanelShell({
  icon: Icon,
  title,
  description,
  actions,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div
            className="flex h-11 w-11 flex-none items-center justify-center rounded-lg"
            style={{ background: 'var(--color-base-soft)', color: ACCENT }}
          >
            <Icon size={22} />
          </div>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-[var(--color-text)]">{title}</h2>
            {description && (
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-muted)]">{description}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex flex-none flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'muted';

const TONE_STYLE: Record<Tone, { background: string; color: string }> = {
  ok: { background: 'var(--color-success-soft)', color: 'var(--color-success)' },
  warn: { background: 'var(--color-warning-soft)', color: 'var(--color-warning)' },
  bad: { background: 'var(--color-danger-soft)', color: 'var(--color-danger)' },
  info: { background: 'var(--color-base-soft)', color: 'var(--color-base)' },
  muted: { background: 'var(--color-subtle)', color: 'var(--color-muted)' },
};

export function Chip({ tone = 'muted', children, title }: { tone?: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={TONE_STYLE[tone]}
    >
      {children}
    </span>
  );
}

export function EmptyBlock({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mt-5 flex flex-col items-center rounded-xl border border-dashed border-[var(--color-border)] px-6 py-10 text-center">
      <div
        className="mb-3 flex h-11 w-11 items-center justify-center rounded-full"
        style={{ background: 'var(--color-base-soft)', color: ACCENT }}
      >
        <Icon size={22} />
      </div>
      <p className="text-sm font-semibold text-[var(--color-text)]">{title}</p>
      {children && <div className="mt-1 max-w-md text-[13px] leading-relaxed text-[var(--color-muted)]">{children}</div>}
    </div>
  );
}

/** Two-step delete: first click arms it, second confirms. Avoids window.confirm. */
export function ConfirmButton({
  label,
  confirmLabel = 'Confirm',
  onConfirm,
  busy,
  icon,
}: {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void;
  busy?: boolean;
  icon?: React.ReactNode;
}) {
  const [armed, setArmed] = React.useState(false);
  React.useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  if (armed) {
    return (
      <span className="inline-flex items-center gap-1">
        <button
          onClick={() => {
            setArmed(false);
            onConfirm();
          }}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-white disabled:opacity-60"
          style={{ background: 'var(--color-danger)' }}
        >
          {confirmLabel}
        </button>
        <button onClick={() => setArmed(false)} className="rounded-md px-1.5 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]">
          Cancel
        </button>
      </span>
    );
  }
  return (
    <button onClick={() => setArmed(true)} disabled={busy} className={btnRow} title={label} aria-label={label}>
      {icon}
      {label}
    </button>
  );
}
