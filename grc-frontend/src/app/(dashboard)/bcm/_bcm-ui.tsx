'use client';

// The few pieces the Business Continuity pages share, on the design-system kit (components/ui/ds): the status pill of a registry word, the pickers over the
// /bcm/*-options routes (a Combobox that says when its list failed or was cut by the server, and a MultiSelect for assets), the hours field, the title that is a
// link, the line a form shows when the server refused it, long text with "Show more", a short list of chips with "+N", and a label/value fact. The label maps,
// badges, toast hook and date helpers this file used to hold are gone: the words are lib/statuses/bcm.ts, the dates lib/format.ts, the requests report themselves
// through useReportedMutation. Only the --ds tokens and arbitrary values are used (the platform CSS repaints named utilities inside the shell: ds/kitRules.ts).
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { bcmApi } from '@/lib/api';
import { NOT_SET, truncate } from '@/lib/format';
import { statusPill, type Statuses } from '@/lib/status';
import { Button, Combobox, FormField, MultiSelect, StatusPill, TextInput } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { OPTION_NOUN, cutHint, optionsCut, pickOptions, retryRead, type OptionKind, type OptionRow } from './bcmModel';

/** A registry word as a pill that always says its word (the tone and the label are the registry's). */
export function Pill({ registry, word, size = 'sm' }: { registry: Statuses; word?: string | null; size?: 'sm' | 'md' }) {
  return <StatusPill size={size} {...statusPill(registry, word)} />;
}

// the padding and the matching negative margin make a link 24px high (44px on a phone) without moving anything: a line of text is 20px
export const LINK = 'rounded-ds-control py-[2px] -my-[2px] max-md:py-[12px] max-md:-my-[12px] font-medium text-ds-fg underline-offset-[2px] hover:text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring';
/** A link in a muted line (the plan under a drill's title): the muted colour until it is hovered. */
export const MUTED_LINK = 'rounded-ds-control py-[2px] -my-[2px] max-md:py-[12px] max-md:-my-[12px] text-ds-fg-muted underline-offset-[2px] hover:text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring';
/** A link inside a sentence or a card line (not a title): the brand's text colour. */
export const TEXT_LINK = 'rounded-ds-control py-[2px] -my-[2px] max-md:py-[12px] max-md:-my-[12px] font-medium text-ds-primary-text underline-offset-[2px] hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring';

/** What the server said about a form that did not save, at the top of the form it is about: said once, where the person is looking, with what they typed kept. */
export function FormProblem({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return <p role="alert" className="break-words rounded-ds-control border border-ds-danger-border bg-ds-danger-soft px-[12px] py-[8px] text-ds-body text-ds-danger">{message}</p>;
}

// ── the pickers over the /bcm/*-options routes ──
/** The options of one picker: the same request and key as always (['bcm-options', kind]), asked again a minute later, and not retried for a refusal. */
export function useOptions(kind: OptionKind) {
  return useQuery({
    queryKey: ['bcm-options', kind],
    queryFn: async () => (await bcmApi.options[kind]()).data.items as OptionRow[],
    staleTime: 60_000,
    retry: retryRead,
  });
}

const NOTE = 'break-words text-ds-label font-normal';

/** What stands under a picker: that its list could not be read (in the server's words, with Retry where trying again can help) or that the server cut it. A refusal
 *  is real: a role that may schedule a drill and may not see plans gets no plan list, and the old form said nothing. */
function OptionsNote({ kind, query }: { kind: OptionKind; query: ReturnType<typeof useOptions> }) {
  if (query.isError && !query.data) {
    return (
      <p role="alert" className={clsx(NOTE, 'flex flex-wrap items-center gap-x-[8px] text-ds-danger')}>
        <span className="min-w-0">{`Couldn't load the list. ${errorMessage(query.error)}`}</span>
        {canRetry(query.error) && <Button size="sm" variant="link" onClick={() => { void query.refetch(); }}>Retry</Button>}
      </p>
    );
  }
  if (query.data && optionsCut(kind, query.data.length)) return <p className={clsx(NOTE, 'text-ds-fg-muted')}>{cutHint(kind)}</p>;
  return null;
}

/** Choose one record of another module (a person, a document, a risk, an incident): searchable, shows its name, stores its id. `extra` is the record already linked, so
 *  its name shows even when the server's list was cut before it. Emptied (when `clearable`) it is null. */
export function EntityCombobox({ kind, label, value, onChange, placeholder, extra, clearable = false, invalid, disabled }: {
  kind: OptionKind;
  /** names the control for a screen reader ("Owner") */
  label: string;
  value: number | null;
  onChange: (id: number | null) => void;
  placeholder?: string;
  extra?: OptionRow[];
  clearable?: boolean;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const query = useOptions(kind);
  const options = pickOptions(extra, query.data);
  const noun = OPTION_NOUN[kind];
  return (
    <>
      <Combobox
        label={label}
        options={options}
        value={value != null ? String(value) : null}
        onChange={(v) => onChange(v ? Number(v) : null)}
        placeholder={placeholder ?? 'Choose…'}
        searchable
        searchPlaceholder={`Search ${noun}`}
        emptyText={query.isLoading ? 'Loading…' : `No ${noun} found`}
        clearable={clearable}
        invalid={invalid}
        disabled={disabled}
      />
      <OptionsNote kind={kind} query={query} />
    </>
  );
}

/** Choose IT-inventory assets (several): the first two as chips and "+N". `extra` keeps the names of assets already linked that the server's list was cut before. */
export function AssetMultiSelect({ value, onChange, extra, label = 'Linked assets', disabled }: {
  value: number[];
  onChange: (ids: number[]) => void;
  extra?: OptionRow[];
  label?: string;
  disabled?: boolean;
}) {
  const query = useOptions('assets');
  return (
    <>
      <MultiSelect
        label={label}
        options={pickOptions(extra, query.data)}
        value={value.map(String)}
        onChange={(v) => onChange(v.map(Number))}
        placeholder="Link inventory assets…"
        searchable
        searchPlaceholder="Search assets"
        emptyText={query.isLoading ? 'Loading…' : 'No assets found'}
        display="chips"
        disabled={disabled}
      />
      <OptionsNote kind="assets" query={query} />
    </>
  );
}

/** A field in whole hours (RTO, RPO, MTPD, an actual recovery): a number with its unit "h" inside the box; what is wrong with it is said under it. */
export function HoursInput({ label, value, onChange, error, info, hint, className, disabled }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  info?: string;
  hint?: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <FormField label={label} optional info={info} hint={hint} error={error} className={className}>
      <TextInput type="number" inputMode="numeric" min={0} step={1} unit="h" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </FormField>
  );
}

// ── what a page draws ──
/** A title that is a link (a plan's, a drill's). A long title wraps and is cut at two lines; the whole of it is the tooltip. The cut is on an inner span: `line-clamp` on the
 *  link itself shows its third line through the link's own padding (the phone's 44px target). */
export function TitleLink({ href, title }: { href: string; title: string }) {
  return <Link href={href} title={title} className={clsx('block [overflow-wrap:anywhere]', LINK)}><span className="line-clamp-2">{title}</span></Link>;
}

const MORE = 'inline-flex min-h-ds-control-sm items-center rounded-ds-control px-[6px] text-ds-label text-ds-primary-text hover:bg-ds-primary-soft focus-visible:outline-none focus-visible:shadow-ds-ring';
const SHOW_MORE = `-ml-[6px] mt-[2px] ${MORE}`;

/** Long text as a concise preview with access to the whole of it ("Show more"). Short text is drawn as it is. Line breaks are kept. */
export function ClampedText({ text, max = 240, className }: { text: string; max?: number; className?: string }) {
  const [open, setOpen] = useState(false);
  const cut = truncate(text, max);
  return (
    <div className={className}>
      <p className="whitespace-pre-line break-words text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{open || !cut.truncated ? text : cut.text}</p>
      {cut.truncated && <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={SHOW_MORE}>{open ? 'Show less' : 'Show more'}</button>}
    </div>
  );
}

const CHIP = 'inline-flex max-w-full items-center rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[8px] py-[2px] text-ds-label text-ds-fg-body';

/** A short list of names as chips: the first `shown`, then "+N" that opens the rest (and "Show less"). */
export function ChipList({ items, shown = 8, label }: { items: string[]; shown?: number; label: string }) {
  const [all, setAll] = useState(false);
  const rest = Math.max(0, items.length - shown);
  const visible = all || rest === 0 ? items : items.slice(0, shown);
  return (
    <ul aria-label={label} className="flex flex-wrap items-center gap-[6px]">
      {visible.map((name, i) => <li key={i} className={CHIP}><span className="min-w-0 truncate" title={name}>{name}</span></li>)}
      {rest > 0 && (
        <li>
          <button type="button" aria-expanded={all} onClick={() => setAll((v) => !v)} className={MORE}>{all ? 'Show less' : `+${rest} more`}</button>
        </li>
      )}
    </ul>
  );
}

/** One label and its value, as a box of a fact band. */
export function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('min-w-0 rounded-ds-card border border-ds-border bg-ds-surface px-[12px] py-[10px]', className)}>
      <dt className="text-ds-label font-normal text-ds-fg-muted">{label}</dt>
      <dd className="mt-[2px] min-w-0 break-words text-ds-body text-ds-fg">{children}</dd>
    </div>
  );
}

/** An hours figure: "8h", or "Not set" in muted words where nobody has set it (the person can set it). */
export function HoursText({ h }: { h: number | null | undefined }) {
  return h == null ? <span className="whitespace-nowrap text-ds-fg-muted">{NOT_SET}</span> : <span className="whitespace-nowrap tabular-nums">{`${h}h`}</span>;
}

/** A value that may be long: two lines, the whole of it as the tooltip. */
export function Clamp({ text, className }: { text: string; className?: string }) {
  return <span title={text} className={clsx('line-clamp-2 break-words', className)}>{text}</span>;
}
