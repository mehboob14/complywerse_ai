'use client';

/**
 * Choose an asset from the asset library: a search box and the matches as rows that say what each asset is (type, criticality, environment, owner),
 * because "Payments" alone does not tell two assets apart. The search is the server's (`GET /assets?search=`): a library can hold thousands.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Checkbox, ErrorState, SkeletonLines, StatusPill, TextInput } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { scopingApi, type AssetRow } from './scopingApi';

const ROW = 'flex w-full items-start gap-[10px] rounded-ds-card border border-ds-border bg-ds-surface p-[10px] text-left hover:border-ds-primary hover:bg-ds-primary-soft focus-visible:outline-none focus-visible:shadow-ds-ring';
const CRITICALITY = { critical: 'danger', high: 'warning', medium: 'progress', low: 'neutral' } as const;
const word = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : '');

export function AssetPicker({ onPick, exclude = [], applicationsFirst = false, autoFocus = false, label = 'Search the asset library' }: {
  onPick: (asset: AssetRow) => void;
  /** assets already chosen */
  exclude?: readonly number[];
  /** offer "Applications only" (on): the subject of an application assessment is an application */
  applicationsFirst?: boolean;
  autoFocus?: boolean;
  label?: string;
}) {
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [onlyApps, setOnlyApps] = useState(applicationsFirst);
  useEffect(() => {
    const t = setTimeout(() => setTerm(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);
  const found = useQuery({ queryKey: ['scoping-assets', term, onlyApps], queryFn: () => scopingApi.assets(term, 25, onlyApps ? 'application' : undefined), placeholderData: keepPreviousData, staleTime: 30_000 });
  const rows = (found.data ?? []).filter((a) => !exclude.includes(a.id));

  return (
    <div className="space-y-[8px]">
      <div className="flex flex-wrap items-center gap-[12px]">
        <TextInput type="search" aria-label={label} autoFocus={autoFocus} value={text} onChange={(e) => setText(e.target.value)} placeholder={label} leftAdornment={<Search aria-hidden />} className="min-w-[14rem] flex-1" />
        {applicationsFirst && <Checkbox label="Applications only" checked={onlyApps} onChange={(e) => setOnlyApps(e.target.checked)} />}
      </div>
      {found.isLoading ? <SkeletonLines lines={3} label="Searching the asset library" />
        : found.isError && !found.data ? <ErrorState compact title="Couldn't search the asset library" message={errorMessage(found.error)} onRetry={canRetry(found.error) ? () => { void found.refetch(); } : undefined} />
        : rows.length === 0 ? (
          <p className="text-ds-body text-ds-fg-muted">
            {term ? 'No asset matches.' : 'No asset to choose.'} {onlyApps && 'Untick "Applications only" to see every type, or '}<Link href="/assets" className="font-[600] text-ds-primary-text underline underline-offset-2">add it in the asset library</Link>.
          </p>
        ) : (
          <ul className="max-h-[18rem] space-y-[6px] overflow-y-auto pr-[2px]" aria-label="Assets">
            {rows.map((a) => (
              <li key={a.id}>
                <button type="button" className={ROW} onClick={() => onPick(a)}>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-[6px]">
                      <span className="text-ds-body font-[600] text-ds-fg">{a.name}</span>
                      {a.asset_type && <StatusPill tone="neutral" size="sm" label={word(a.asset_type)} />}
                      {a.criticality && <StatusPill tone={CRITICALITY[a.criticality as keyof typeof CRITICALITY] ?? 'neutral'} size="sm" label={`${word(a.criticality)} criticality`} />}
                      {a.internet_facing && <StatusPill tone="warning" size="sm" label="Internet-facing" />}
                    </span>
                    <span className="mt-[2px] block text-ds-label text-ds-fg-muted">{[a.environment && word(a.environment), a.owner_name && `Owner ${a.owner_name}`, a.host_name].filter(Boolean).join(' · ') || 'No environment or owner recorded'}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
