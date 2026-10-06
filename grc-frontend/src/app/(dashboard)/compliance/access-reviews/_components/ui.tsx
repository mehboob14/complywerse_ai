'use client';
// Small, accessible building blocks for the Access Reviews module: buttons that look and
// focus the same everywhere, status pills that say their meaning in words (never colour
// alone), tabs and a switch that follow the ARIA patterns, and form fields that tie their
// label, hint and error together. Colours come from the platform tokens; secondary text is
// slate-600 or darker so it meets 4.5:1 on white.

import Link from 'next/link';
import { clsx } from 'clsx';
import {
  AlertCircle, AlertTriangle, Check, CheckCircle2, Info, Loader2, MinusCircle, XCircle, type LucideIcon,
} from 'lucide-react';
import {
  forwardRef, useCallback, useId, useRef,
  type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode,
} from 'react';
import type { Outcome } from '../types';

/** A focus ring that shows for the keyboard and stays out of the mouse's way. */
export const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2';

// ---------------------------------------------------------------- buttons
type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-[var(--color-base)] text-[var(--color-on-base)] hover:bg-[var(--color-base-strong)] border border-transparent font-semibold',
  secondary: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 font-medium',
  danger: 'bg-rose-700 text-white hover:bg-rose-800 border border-transparent font-semibold',
  ghost: 'bg-transparent text-slate-700 hover:bg-slate-100 border border-transparent font-medium',
};
const buttonClass = (variant: Variant, size: 'sm' | 'md', extra?: string) => clsx(
  'inline-flex items-center justify-center gap-2 rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-60',
  size === 'md' ? 'min-h-[40px] px-4 py-2 text-sm' : 'min-h-[32px] px-3 py-1.5 text-xs',
  VARIANT[variant], FOCUS, extra,
);

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: LucideIcon;
}>(function Button({ variant = 'secondary', size = 'md', loading, icon: Icon, children, className, disabled, type = 'button', ...rest }, ref) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} aria-busy={loading || undefined}
      className={buttonClass(variant, size, className)} {...rest}>
      {loading ? <Loader2 size={size === 'md' ? 16 : 14} className="animate-spin motion-reduce:animate-none" aria-hidden /> : Icon ? <Icon size={size === 'md' ? 16 : 14} aria-hidden /> : null}
      {children}
    </button>
  );
});

export function ButtonLink({ href, variant = 'secondary', size = 'md', icon: Icon, children, className }: {
  href: string; variant?: Variant; size?: 'sm' | 'md'; icon?: LucideIcon; children: ReactNode; className?: string;
}) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {Icon && <Icon size={size === 'md' ? 16 : 14} aria-hidden />}
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------- feedback
const ALERT: Record<string, { cls: string; Icon: LucideIcon }> = {
  error: { cls: 'border-rose-200 bg-rose-50 text-rose-900', Icon: AlertCircle },
  warning: { cls: 'border-amber-200 bg-amber-50 text-amber-900', Icon: AlertTriangle },
  info: { cls: 'border-sky-200 bg-sky-50 text-sky-900', Icon: Info },
  success: { cls: 'border-emerald-200 bg-emerald-50 text-emerald-900', Icon: CheckCircle2 },
};

/** Errors interrupt (role=alert); everything else is announced politely (role=status). */
export function Alert({ tone = 'info', title, children, className, action }: {
  tone?: 'error' | 'warning' | 'info' | 'success'; title?: string; children?: ReactNode; className?: string; action?: ReactNode;
}) {
  const { cls, Icon } = ALERT[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={clsx('flex items-start gap-3 rounded-lg border px-4 py-3 text-sm', cls, className)}>
      <Icon size={18} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? 'mt-0.5' : undefined}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-slate-600">
      <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden /> {label}…
    </span>
  );
}

export function EmptyState({ icon: Icon, title, children, action }: {
  icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      {Icon && <Icon size={28} className="mx-auto mb-3 text-slate-500" aria-hidden />}
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-slate-600">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- pills
const OUTCOME: Record<Outcome, { label: string; cls: string; Icon: LucideIcon }> = {
  pass: { label: 'Passed', cls: 'border-emerald-200 bg-emerald-50 text-emerald-800', Icon: CheckCircle2 },
  fail: { label: 'Failed', cls: 'border-rose-200 bg-rose-50 text-rose-800', Icon: XCircle },
  not_run: { label: 'Not run', cls: 'border-amber-300 bg-amber-50 text-amber-900', Icon: AlertTriangle },
  not_applicable: { label: 'Not applicable', cls: 'border-slate-300 bg-[#eef1f4] text-slate-700', Icon: MinusCircle },
  error: { label: 'Error', cls: 'border-rose-200 bg-rose-50 text-rose-800', Icon: AlertCircle },
};
export const outcomeLabel = (o: Outcome) => OUTCOME[o]?.label ?? o;

/** What a rule found, in words and an icon: colour never carries it alone. */
export function OutcomePill({ outcome, className }: { outcome: Outcome; className?: string }) {
  const { label, cls, Icon } = OUTCOME[outcome] ?? OUTCOME.error;
  return (
    <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold', cls, className)}>
      <Icon size={13} aria-hidden /> {label}
    </span>
  );
}

const TONE: Record<string, string> = {
  slate: 'border-slate-300 bg-[#eef1f4] text-slate-800', teal: 'border-teal-200 bg-teal-50 text-teal-900',
  sky: 'border-sky-200 bg-sky-50 text-sky-900', amber: 'border-amber-300 bg-amber-50 text-amber-900',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800', rose: 'border-rose-200 bg-rose-50 text-rose-800',
};
export function Badge({ tone = 'slate', children, className, icon: Icon }: {
  tone?: keyof typeof TONE; children: ReactNode; className?: string; icon?: LucideIcon;
}) {
  return (
    <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', TONE[tone], className)}>
      {Icon && <Icon size={12} aria-hidden />}{children}
    </span>
  );
}

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}

/** A toggle in a row of filters. Pressed is a tick and a teal outline as well as aria-pressed, never colour alone.
 *  (A dark fill with white text is not an option here: the platform stylesheet repaints slate fills white.) */
export function FilterChip({ pressed, onClick, children, count }: { pressed: boolean; onClick: () => void; children: ReactNode; count?: number }) {
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick}
      className={clsx('inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-sm font-medium',
        pressed ? 'border-teal-700 bg-teal-50 text-teal-900 ring-1 ring-teal-700' : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50', FOCUS)}>
      {pressed && <Check size={14} aria-hidden />}
      {children}
      {count != null && <span className="rounded-full border border-slate-300 bg-white px-1.5 text-xs font-semibold tabular-nums text-slate-800">{count}</span>}
    </button>
  );
}

const SEV: Record<string, { label: string; cls: string }> = {
  critical: { label: 'Critical', cls: 'border-rose-300 bg-rose-50 text-rose-900' },
  high: { label: 'High', cls: 'border-orange-300 bg-orange-50 text-orange-900' },
  medium: { label: 'Medium', cls: 'border-amber-300 bg-amber-50 text-amber-900' },
  low: { label: 'Low', cls: 'border-slate-300 bg-[#eef1f4] text-slate-800' },
  info: { label: 'Info', cls: 'border-slate-300 bg-[#eef1f4] text-slate-800' },
};
/** A severity in words. Not a live region: a table of these must not announce itself. */
export function SeverityTag({ severity, className }: { severity: string; className?: string }) {
  const s = SEV[severity] ?? SEV.info;
  return (
    <span className={clsx('inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 text-xs font-semibold', s.cls, className)}>
      <VisuallyHidden>Severity: </VisuallyHidden>{s.label}
    </span>
  );
}

// ---------------------------------------------------------------- layout
export function Card({ title, description, actions, children, className, as: Heading = 'h2', padded = true }: {
  title?: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string;
  as?: 'h2' | 'h3'; padded?: boolean;
}) {
  return (
    <section className={clsx('rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            {title && <Heading className="text-base font-semibold text-slate-900">{title}</Heading>}
            {description && <p className="mt-0.5 text-sm text-slate-600">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'p-5' : undefined}>{children}</div>
    </section>
  );
}

/** A figure with its name: a definition list, so a screen reader hears "Failed rules, 2". */
export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'rose' | 'amber' | 'emerald' }) {
  const color = tone === 'rose' ? 'text-rose-800' : tone === 'amber' ? 'text-amber-900' : tone === 'emerald' ? 'text-emerald-800' : 'text-slate-900';
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <dt className="text-sm font-medium text-slate-600">{label}</dt>
      <dd className={clsx('mt-1 text-2xl font-semibold tabular-nums', color)}>{value}</dd>
      {hint && <dd className="mt-0.5 text-xs text-slate-600">{hint}</dd>}
    </div>
  );
}


export function ProgressBar({ value, max, label, tone = 'teal' }: { value: number; max: number; label: string; tone?: 'teal' | 'emerald' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}
      aria-valuetext={`${value} of ${max}`} className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
      <div className={clsx('h-full rounded-full', tone === 'emerald' ? 'bg-emerald-600' : 'bg-teal-600')} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------- forms
export const inputClass = clsx('block w-full rounded-md border border-[#7b8794] bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500',
  'min-h-[40px] disabled:cursor-not-allowed disabled:bg-[#eef1f4]', FOCUS);

/** A label, its hint and its error, wired to the control with ids — one place so every form reads the same. */
export function Field({ label, hint, error, required, children }: {
  label: string; hint?: ReactNode; error?: string | null; required?: boolean;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean; 'aria-required'?: boolean }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`; const errId = `${id}-err`;
  const described = [hint ? hintId : null, error ? errId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-800">
        {label}{required && <span className="ml-0.5 text-rose-700" aria-hidden> *</span>}
        {required && <VisuallyHidden> (required)</VisuallyHidden>}
      </label>
      {children({ id, 'aria-describedby': described, 'aria-invalid': error ? true : undefined, 'aria-required': required || undefined })}
      {hint && <p id={hintId} className="mt-1 text-xs text-slate-600">{hint}</p>}
      {error && <p id={errId} className="mt-1 text-xs font-medium text-rose-800">{error}</p>}
    </div>
  );
}

/** A radio group drawn as cards: a real fieldset, a real radio input per choice (keyboard and screen-reader native). */
export function RadioCards<T extends string>({ legend, name, value, onChange, options, columns = 3, hint }: {
  legend: string; name: string; value: T; onChange: (v: T) => void; hint?: string;
  options: { value: T; label: string; description?: ReactNode; disabled?: boolean }[]; columns?: 1 | 2 | 3;
}) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium text-slate-800">{legend}</legend>
      {hint && <p className="mb-2 text-xs text-slate-600">{hint}</p>}
      <div className={clsx('grid gap-2', columns === 3 ? 'sm:grid-cols-3' : columns === 2 ? 'sm:grid-cols-2' : 'grid-cols-1')}>
        {options.map((o) => (
          <label key={o.value} className={clsx(
            'relative flex cursor-pointer gap-3 rounded-lg border p-3 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-teal-700 has-[:focus-visible]:ring-offset-2',
            value === o.value ? 'border-teal-700 bg-teal-50' : 'border-slate-300 bg-white hover:bg-slate-50',
            o.disabled && 'cursor-not-allowed opacity-60')}>
            <input type="radio" name={name} value={o.value} checked={value === o.value} disabled={o.disabled}
              onChange={() => onChange(o.value)} className="mt-0.5 h-4 w-4 shrink-0 accent-teal-700" />
            <span className="min-w-0">
              <span className="block font-medium text-slate-900">{o.label}</span>
              {o.description && <span className="mt-0.5 block text-xs text-slate-600">{o.description}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** An on/off switch: a button with role=switch, labelled by what it controls. */
export function Switch({ checked, onChange, label, disabled, title }: {
  checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean; title?: string;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} title={title} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'border-teal-700 bg-teal-700' : 'border-[#7b8794] bg-[#7b8794]', FOCUS)}>
      <span className={clsx('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform motion-reduce:transition-none', checked ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  );
}

// ---------------------------------------------------------------- tabs
export type TabDef = { id: string; label: string; badge?: ReactNode };

/** Tabs per the ARIA pattern: arrow keys move between them, Home/End jump, and only the
 *  selected tab is in the tab order. The panel is the caller's, labelled by `tabId(id)`. */
export const tabId = (base: string, id: string) => `${base}-tab-${id}`;
export const panelId = (base: string, id: string) => `${base}-panel-${id}`;

export function Tabs({ label, base, tabs, value, onChange }: {
  label: string; base: string; tabs: TabDef[]; value: string; onChange: (id: string) => void;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const move = useCallback((e: KeyboardEvent, index: number) => {
    const last = tabs.length - 1;
    const next = e.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : e.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
        : e.key === 'Home' ? 0 : e.key === 'End' ? last : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].id);
    refs.current[tabs[next].id]?.focus();
  }, [tabs, onChange]);
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((t, i) => {
        const on = t.id === value;
        return (
          <button key={t.id} ref={(el) => { refs.current[t.id] = el; }} type="button" role="tab" id={tabId(base, t.id)}
            aria-selected={on} aria-controls={panelId(base, t.id)} tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.id)} onKeyDown={(e) => move(e, i)}
            className={clsx('-mb-px inline-flex min-h-[44px] items-center gap-2 whitespace-nowrap border-b-2 px-4 text-sm font-semibold',
              on ? 'border-teal-700 text-slate-900' : 'border-transparent text-slate-600 hover:text-slate-900', FOCUS)}>
            {t.label}
            {t.badge != null && t.badge !== '' && (
              <span className="rounded-full bg-[var(--color-border)] px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-800">{t.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
