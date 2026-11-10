'use client';

// Our own domains found in public code beside words like password or secret. Each file is linked, never copied; confirm it or rule it out with a reason. A failed read says so (it used to read
// as "connect GitHub"), a decision says what happened and a refusal stays on screen with a Retry. The right is the server's: monitoring:edit, or the risk-edit right that stands in for it.
import { useState } from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { Button, EmptyState, ErrorState, FormField, Notice, SectionCard, SkeletonLines, StatusPill, TextInput, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { linkClasses } from '@/components/ui/ds/linkModel';
import { usePermissions } from '@/hooks/usePermissions';
import { vendorLeaksApi } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { LEAKS_KEY, useOwnLeaks, type Leak } from './alertsApi';

const LINK = linkClasses({ tone: 'text', size: 'label' });
const SAYS: Record<Leak['status'], { tone: 'warning' | 'danger' | 'neutral'; label: string }> = {
  new: { tone: 'warning', label: 'To look at' }, confirmed: { tone: 'danger', label: 'A real leak' }, dismissed: { tone: 'neutral', label: 'Ruled out' },
};

export default function OwnLeaks() {
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:monitoring:edit') || hasPermission('erm:risks:edit');
  const q = useOwnLeaks();
  const [ruling, setRuling] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const decide = useReportedMutation({
    mutationFn: async (v: { id: number; status: Leak['status']; note?: string }) => (await vendorLeaksApi.decide(v.id, { status: v.status, note: v.note })).data,
    success: (_d, v) => (v.status === 'confirmed' ? 'Marked as a real leak' : v.status === 'dismissed' ? 'Ruled out' : 'Reopened'),
    failure: "Couldn't save the decision",
    invalidate: [[LEAKS_KEY]],
    onSuccess: () => { setRuling(null); setNote(''); },
  });

  if (q.isPending) return <SkeletonLines lines={2} label="Looking for our own domains in public code" />;
  if (q.isError) return <ErrorState compact title="Couldn't read the public-code finds" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />;
  const items = q.data.items;
  if (!q.data.switched_on && items.length === 0) {
    return (
      <Notice tone="info" title="Our own domains in public code">
        Connect GitHub code search under <Link href="/admin/connectors" className={LINK}>Admin, Connectors</Link> and list the domains under <Link href="/vendor-risk/settings#monitoring" className={LINK}>Settings, Monitoring</Link> to search for them too.
      </Notice>
    );
  }
  return (
    <SectionCard id="own-leaks" title="Our own domains in public code" info="Files on GitHub that name one of our domains beside a word like password. Searched once a day; each is linked, not copied." meta={`${items.length} ${items.length === 1 ? 'find' : 'finds'}`}>
      {items.length === 0 ? <EmptyState kind="firstUse" bare title="Nothing found" description="No public file names one of our domains beside a word like password." /> : (
        <ul className="m-0 flex list-none flex-col divide-y divide-ds-border p-0">
          {items.map((l) => (
            <li key={l.id} className="flex flex-col gap-[8px] py-[10px]">
              <div className="flex flex-wrap items-start justify-between gap-[8px]">
                <div className="min-w-0">
                  <a href={l.url} target="_blank" rel="noreferrer noopener" className={`${LINK} break-all`}>{l.repository}/{l.path}<ExternalLink aria-hidden size={12} className="ml-[3px] inline" /></a>
                  <p className="m-0 text-ds-label text-ds-fg-muted">{l.domain} · found {formatDate(l.first_seen)}{l.decided_by ? ` · ${SAYS[l.status].label.toLowerCase()} by ${l.decided_by}` : ''}{l.note ? `: ${l.note}` : ''}</p>
                </div>
                <div className="flex flex-wrap items-center gap-[8px]">
                  <StatusPill size="sm" {...SAYS[l.status]} />
                  {canEdit && l.status === 'new' && (
                    <>
                      <Button size="sm" loading={decide.isPending && decide.variables?.id === l.id && decide.variables.status === 'confirmed'} onClick={() => decide.mutate({ id: l.id, status: 'confirmed' })}>It is real</Button>
                      <Button size="sm" onClick={() => { setRuling(ruling === l.id ? null : l.id); setNote(''); }}>Rule it out</Button>
                    </>
                  )}
                  {canEdit && l.status !== 'new' && <Button size="sm" onClick={() => decide.mutate({ id: l.id, status: 'new' })}>Reopen</Button>}
                </div>
              </div>
              {ruling === l.id && (
                <form className="flex flex-wrap items-end gap-[8px]" onSubmit={(e) => { e.preventDefault(); if (note.trim().length >= 5) decide.mutate({ id: l.id, status: 'dismissed', note }); }}>
                  <FormField label="Why it is not a leak" className="min-w-[220px] flex-1" hint="A few words.">
                    <TextInput value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
                  </FormField>
                  <Button type="submit" variant="primary" loading={decide.isPending} disabled={note.trim().length < 5}>Rule out</Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
