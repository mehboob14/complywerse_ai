'use client';

/**
 * Configure frameworks: choose which frameworks are in the Control Catalog. Choosing frameworks pulls their controls into the Catalog; the choice is for the whole organisation, only an administrator
 * can change it, and every change is logged (shown below in words). It reads and writes the Workbench scope: GET returns the frameworks with their control counts and the change log, PUT saves the
 * selection, and "every framework ticked" saves as the canonical "all" (an empty list). The kit's save bar holds the unsaved choice; a failed save says why and can be tried again.
 */
import { useEffect, useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { History, Layers } from 'lucide-react';
import { Button, Checkbox, EmptyState, ErrorState, Notice, ReadOnlyNote, SaveBar, SectionCard, SkeletonRows, StatTile, TextInput, useReportedMutation } from '@/components/ui/ds';
import { PageHeader } from '@/components/ui';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import apiClient from '@/lib/api';
import { formatCount, formatDateTime } from '@/lib/format';
import { routeFor } from '@/lib/navRegistry';
import { WB, useScope } from '../_catalog/catalogData';
import { pct } from '../_catalog/catalogModel';

export default function ConfigureFrameworks() {
  const q = useScope();
  const scope = q.data;
  const uid = useId();
  const [search, setSearch] = useState('');
  const [sel, setSel] = useState<number[] | null>(null);                        // null: not read from the saved scope yet
  const [justSaved, setJustSaved] = useState(false);

  const all = useMemo(() => (scope?.available ?? []).map((f) => f.id), [scope]);
  const saved = useMemo(() => (scope ? (scope.framework_ids.length ? scope.framework_ids : all) : []), [scope, all]);   // an empty scope means every framework
  useEffect(() => { if (scope && sel === null) setSel(saved); }, [scope, sel, saved]);
  useEffect(() => { if (!justSaved) return; const t = window.setTimeout(() => setJustSaved(false), 3000); return () => window.clearTimeout(t); }, [justSaved]);

  const chosen = sel ?? saved;
  const dirty = scope != null && sel !== null && (chosen.length !== saved.length || chosen.some((id) => !saved.includes(id)));
  const save = useReportedMutation({
    mutationFn: () => apiClient.put(`${WB}/scope`, { framework_ids: chosen.length === all.length ? [] : chosen }),
    success: { title: 'Frameworks saved', message: 'The Catalog now draws its controls from them.' },
    failure: "Couldn't save the frameworks",
    toast: 'success',
    invalidate: [['wb-scope'], ['wb-overview'], ['wb-list'], ['wb-domains'], ['wb-groups']],
    onSuccess: () => { setSel(null); setJustSaved(true); },
  });

  const canEdit = !!scope?.can_edit;
  const available = scope?.available ?? [];
  const needle = search.trim().toLowerCase();
  const shown = needle ? available.filter((f) => f.name.toLowerCase().includes(needle)) : available;
  const totalControls = available.reduce((a, f) => a + f.controls, 0);
  const selControls = available.filter((f) => chosen.includes(f.id)).reduce((a, f) => a + f.controls, 0);
  const toggle = (id: number) => { if (canEdit) setSel(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]); };
  const label = routeFor('/controls/configure-frameworks')?.label ?? 'Configure Frameworks';

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-[16px]">
      <PageHeader variant="page" title={label} back={{ href: '/controls', label: 'Back to the Control Catalog' }} info="Choose which frameworks appear in your Control Catalog. Their controls flow into it automatically. The choice is for the whole organisation and every change is logged." />
      <Notice tone="info" title="Controls Automation has its own scope">
        The frameworks that drive Controls Automation are chosen under <Link href="/automation/soc2-controls?configure=scope" className="font-[600] text-ds-primary-text underline">Controls, Configure scope</Link>. This page is for the Control Catalog only.
      </Notice>

      {q.isError && !scope ? (
        <ErrorState title="Couldn’t load the frameworks" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />
      ) : q.isPending || !scope ? (
        <SkeletonRows rows={8} columns={2} label="Loading the frameworks" />
      ) : (
        <>
          {!canEdit && <ReadOnlyNote>Only an administrator can change which frameworks are in the Catalog. You can see the choice here.</ReadOnlyNote>}
          <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-3">
            <StatTile label="Frameworks selected" value={`${formatCount(chosen.length)} of ${formatCount(available.length)}`} />
            <StatTile label="Controls in the Catalog" value={formatCount(selControls)} note={`of ${formatCount(totalControls)} available`} />
            <StatTile label="Coverage" value={`${pct(selControls, totalControls)}%`} />
          </div>

          <SectionCard
            id="frameworks"
            title="Frameworks"
            meta={`${formatCount(available.length)} available`}
            actions={canEdit ? (
              <>
                <Button size="sm" onClick={() => setSel(available.map((f) => f.id))}>Select all</Button>
                <Button size="sm" onClick={() => setSel([])}>Clear</Button>
              </>
            ) : undefined}
          >
            <div className="flex flex-col gap-[8px]">
              <TextInput aria-label="Search frameworks" placeholder="Search frameworks" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full sm:w-[320px]" />
              {available.length === 0 ? (
                <EmptyState kind="firstUse" bare icon={Layers} title="No frameworks yet" description="Frameworks you add appear here, with their controls." />
              ) : shown.length === 0 ? (
                <EmptyState kind="noMatches" bare title="No framework matches" description={`No framework name contains “${search.trim()}”.`} onClearFilters={() => setSearch('')} />
              ) : (
                <ul aria-label="Frameworks" className="m-0 max-h-[460px] list-none divide-y divide-ds-border overflow-y-auto rounded-ds-card border border-ds-border bg-ds-surface p-0">
                  {shown.map((f) => (
                    <li key={f.id} className="flex items-center gap-[8px] px-[12px]">
                      <Checkbox
                        id={`${uid}-${f.id}`}
                        className="flex-1"
                        label={<span className="text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{f.name}</span>}
                        checked={chosen.includes(f.id)}
                        disabled={!canEdit}
                        onChange={() => toggle(f.id)}
                      />
                      <span className="shrink-0 text-ds-label tabular-nums text-ds-fg-muted">{`${formatCount(f.controls)} ${f.controls === 1 ? 'control' : 'controls'}`}</span>
                    </li>
                  ))}
                </ul>
              )}
              {canEdit && chosen.length === 0 && <p className="m-0 text-ds-label text-ds-danger">Select at least one framework to save.</p>}
            </div>
          </SectionCard>

          <SaveBar
            label="Save the framework selection"
            saveLabel="Save selection"
            canEdit={canEdit}
            dirty={dirty}
            invalid={chosen.length === 0}
            saving={save.isPending}
            justSaved={justSaved}
            error={save.isError ? errorMessage(save.error) : null}
            onSave={() => save.mutate()}
            onDiscard={() => { setSel(null); save.reset(); }}
          />

          <SectionCard id="change-log" title="Change log" meta={<span className="inline-flex items-center gap-[4px]"><History aria-hidden className="h-[14px] w-[14px]" />{`${formatCount(scope.history?.length ?? 0)} changes`}</span>}>
            {(scope.history ?? []).length === 0 ? (
              <p className="m-0 text-ds-body text-ds-fg-muted">No changes recorded yet.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-[12px] p-0">
                {(scope.history ?? []).map((h, i) => (
                  <li key={i} className="text-ds-body text-ds-fg-body">
                    <span className="font-[600] text-ds-fg">{h.by}</span> updated the selection <span className="text-ds-fg-muted">on {formatDateTime(h.at)}</span>
                    <span className="mt-[4px] flex flex-wrap gap-[6px]">
                      {h.added.map((n) => <span key={`a${n}`} className="rounded-ds-control bg-ds-success-soft px-[6px] text-ds-label text-ds-success">{`Added ${n}`}</span>)}
                      {h.removed.map((n) => <span key={`r${n}`} className="rounded-ds-control bg-ds-danger-soft px-[6px] text-ds-label text-ds-danger">{`Removed ${n}`}</span>)}
                      <span className="rounded-ds-control bg-ds-surface-hover px-[6px] text-ds-label text-ds-fg-body">{h.total === 0 ? 'Now every framework' : `Now ${formatCount(h.total)} selected`}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}
