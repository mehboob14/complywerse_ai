'use client';

// Link a control to anything: risks, assets, evidence, documents, policy
// statements, vulnerabilities, issues, vendors, projects, tasks and internal
// controls. Search runs on the server — a register with tens of thousands of
// rows is never shipped to the browser to be filtered here.

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, Bug, Building2, FileText, FolderKanban, ListTodo, Loader2, Search,
  Server, ShieldCheck, ScrollText, Quote, X,
} from 'lucide-react';
import { automationApi, type ControlRecordLink } from '@/lib/api';

export type LinkedRecord = ControlRecordLink;

const ICONS: Record<string, typeof AlertTriangle> = {
  risk: AlertTriangle,
  asset: Server,
  evidence: FileText,
  document: ScrollText,
  policy_statement: Quote,
  vulnerability: Bug,
  issue: ListTodo,
  vendor: Building2,
  project: FolderKanban,
  task: ListTodo,
  internal_control: ShieldCheck,
};

export function RecordTypeIcon({ type, className }: { type: string; className?: string }) {
  const Icon = ICONS[type] || FileText;
  return <Icon className={className || 'h-3.5 w-3.5 text-slate-400'} />;
}

const key = (r: LinkedRecord) => `${r.type}:${r.id}`;

/** Group by type in the registry's order, for a stable list. */
export function groupByType(items: LinkedRecord[], order: string[]): [string, LinkedRecord[]][] {
  const by = new Map<string, LinkedRecord[]>();
  for (const item of items) {
    const bucket = by.get(item.type);
    if (bucket) bucket.push(item);
    else by.set(item.type, [item]);
  }
  const ordered = order.filter((t) => by.has(t));
  const rest = Array.from(by.keys()).filter((t) => !order.includes(t));
  return [...ordered, ...rest].map((t) => [t, by.get(t) as LinkedRecord[]]);
}

export function RecordLinker({
  selected,
  onChange,
  disabled,
  busyKey,
  label = 'Linked records',
  hint = 'Search any module and attach what this control relies on, protects or evidences.',
}: {
  selected: LinkedRecord[];
  onChange: (next: LinkedRecord[]) => void;
  disabled?: boolean;
  /** `type:id` currently being written, to show a spinner on that row. */
  busyKey?: string | null;
  label?: string;
  hint?: string;
}) {
  const typesQ = useQuery({
    queryKey: ['control-link-types'],
    queryFn: async () => (await automationApi.listLinkTypes()).data.types,
    staleTime: 60 * 60_000,
  });
  const types = typesQ.data ?? [];
  const [type, setType] = useState('risk');
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(id);
  }, [term]);

  const resultsQ = useQuery({
    queryKey: ['link-targets', type, debounced],
    queryFn: async () => (await automationApi.searchLinkTargets(type, debounced)).data.items,
    enabled: open && !disabled,
    staleTime: 30_000,
  });

  const chosen = useMemo(() => new Set(selected.map(key)), [selected]);
  const order = types.map((t) => t.key);
  const groups = groupByType(selected, order);
  const typeLabel = (t: string) => types.find((x) => x.key === t)?.plural || t.replace(/_/g, ' ');

  const add = (row: LinkedRecord) => {
    if (chosen.has(key(row))) return;
    onChange([...selected, row]);
  };
  const remove = (row: LinkedRecord) => onChange(selected.filter((r) => key(r) !== key(row)));

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
        {selected.length > 0 && (
          <span className="text-[11px] tabular-nums text-slate-400">{selected.length} linked</span>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-2">
          <select
            value={type}
            onChange={(e) => { setType(e.target.value); setOpen(true); }}
            disabled={disabled}
            aria-label="Record type"
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[12.5px] text-slate-700 focus:border-primary-500 focus:outline-none"
          >
            {types.map((t) => <option key={t.key} value={t.key}>{t.plural}</option>)}
          </select>
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={term}
              onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              disabled={disabled}
              placeholder={`Search ${typeLabel(type).toLowerCase()}…`}
              className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-[12.5px] text-slate-700 focus:border-primary-500 focus:outline-none"
            />
          </div>
          {open && (
            <button type="button" onClick={() => { setOpen(false); setTerm(''); }}
              className="rounded-lg px-2 py-1.5 text-[12px] font-medium text-slate-500 hover:text-slate-800">
              Done
            </button>
          )}
        </div>

        {open && (
          <div className="max-h-56 overflow-y-auto">
            {resultsQ.isLoading ? (
              <div className="flex items-center gap-2 px-3 py-3 text-[12.5px] text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
              </div>
            ) : (resultsQ.data?.length ?? 0) === 0 ? (
              <p className="px-3 py-3 text-[12.5px] text-slate-400">
                {debounced ? `No ${typeLabel(type).toLowerCase()} match “${debounced}”.` : `No ${typeLabel(type).toLowerCase()} in this tenant yet.`}
              </p>
            ) : (
              <ul className="divide-y divide-slate-50">
                {resultsQ.data?.map((row) => {
                  const already = chosen.has(key(row));
                  return (
                    <li key={key(row)}>
                      <button
                        type="button"
                        disabled={already || disabled}
                        onClick={() => add(row)}
                        className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-slate-50 disabled:cursor-default disabled:opacity-50"
                      >
                        <RecordTypeIcon type={row.type} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] font-medium text-slate-800">
                            {row.code ? <span className="mr-1.5 font-mono text-[11px] text-slate-500">{row.code}</span> : null}
                            {row.label}
                          </span>
                          {row.subtitle && (
                            <span className="block truncate text-[11px] capitalize text-slate-400">{row.subtitle}</span>
                          )}
                        </span>
                        {busyKey === key(row) ? (
                          <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin text-slate-400" />
                        ) : (
                          <span className="mt-0.5 text-[11px] font-semibold text-primary-600">{already ? 'Linked' : 'Link'}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        <div className="p-2">
          {selected.length === 0 ? (
            <p className="px-1 py-1 text-[11.5px] leading-relaxed text-slate-400">{hint}</p>
          ) : (
            <div className="space-y-2">
              {groups.map(([t, rows]) => (
                <div key={t}>
                  <p className="mb-1 px-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
                    {typeLabel(t)} · {rows.length}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {rows.map((row) => (
                      <span key={key(row)}
                        className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-slate-100 py-1 pl-2 pr-1 text-[11.5px] text-slate-700">
                        <RecordTypeIcon type={row.type} className="h-3 w-3 shrink-0 text-slate-400" />
                        <span className="truncate">{row.code ? `${row.code} · ` : ''}{row.label}</span>
                        <button type="button" onClick={() => remove(row)} disabled={disabled}
                          aria-label={`Unlink ${row.label}`}
                          className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-50">
                          {busyKey === key(row) ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default RecordLinker;
