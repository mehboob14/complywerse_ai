'use client';

// The Details tab of a unit's popup: what the unit is (level, code, how many documents, people and units) as facts, then its fields to change in place (name, where it sits,
// owner, description: UnitForm) and whether it is switched on. A person who may not manage the unit reads the same facts as text. The unit's full record (its description, its
// roles) is read when the tab opens; every unit has loading, failed and saved states, and a refusal keeps what was typed and says why in the server's words.
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { departmentsApi } from '@/lib/api';
import { DEACTIVATE_NOTE } from '@/lib/departments';
import { departmentStatus, statusPill } from '@/lib/status';
import { Button, ErrorState, Fact, FactList, SkeletonLines, StatusPill } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { InfoTip } from '@/components/ui/InfoTip';
import { UnitForm } from './UnitForm';
import { useToggleActive } from './useToggleActive';
import { libraryHref } from './directoryModel';
import type { DirectoryTabProps } from './directoryTabs';

/** Puts the cursor in the first field of the form drawn beside it (the unit's name), once, when "Edit details" opened the popup. */
function FocusFirstField() {
  const mark = useRef<HTMLSpanElement>(null);
  useEffect(() => { mark.current?.parentElement?.querySelector<HTMLElement>('input:not([type="hidden"]), textarea')?.focus({ preventScroll: true }); }, []);
  return <span ref={mark} hidden />;
}

export function DetailsTab({ node, tree, levels, canManage, canTop, setDirty, focusName }: DirectoryTabProps) {
  const detail = useQuery({ queryKey: ['admin-department', node.id], queryFn: () => departmentsApi.get(node.id).then((r) => r.data) });
  const toggle = useToggleActive();
  // switching a unit off re-reads it, which would throw typed input away: it waits until the fields are saved or discarded
  const [typing, setTyping] = useState(false);
  const onDirty = useCallback((d: boolean) => { setTyping(d); setDirty(d); }, [setDirty]);
  const total = tree.documentsTotal(node.id);
  const below = tree.subtree(node.id).size - 1;

  return (
    <div className="flex flex-col gap-[16px]">
      <FactList variant="boxed" min={120}>
        <Fact label="Level">{node.level_label}</Fact>
        <Fact label="Code">{node.code ? <span className="font-mono">{node.code}</span> : null}</Fact>
        <Fact label="Documents">
          <Link href={libraryHref(node.id)} className="text-ds-primary-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">
            {node.counts.documents}{total > node.counts.documents ? <span className="text-ds-fg-muted"> · {total} with units below</span> : null}
          </Link>
        </Fact>
        <Fact label="People">{node.counts.members}</Fact>
        <Fact label="Units below">{below}</Fact>
      </FactList>

      {detail.isLoading ? (
        <SkeletonLines lines={5} label="Loading the details" />
      ) : detail.isError || !detail.data ? (
        <ErrorState title="Couldn't load the details" message={errorMessage(detail.error)} onRetry={canRetry(detail.error) ? () => { void detail.refetch(); } : undefined} />
      ) : (
        <>
          <UnitForm key={`${detail.data.id}:${detail.data.updated_at}`} mode="edit" department={detail.data} tree={tree} levels={levels} canTop={canTop} readOnly={!canManage} onSaved={() => undefined} onDirty={onDirty} />
          {focusName && canManage && <FocusFirstField />}
        </>
      )}

      <section aria-label="Status" className="flex flex-wrap items-center gap-[8px] border-t border-ds-border pt-[16px]">
        <h3 className="!text-ds-section !text-ds-fg">Status</h3>
        <StatusPill {...statusPill(departmentStatus, node.is_active ? 'active' : 'inactive')} />
        <InfoTip text={DEACTIVATE_NOTE} label="About switching a unit off" />
        {canManage && (
          <Button className="ml-auto" variant={node.is_active ? 'dangerOutline' : 'secondary'} loading={toggle.busy} disabled={typing} title={typing ? 'Save or discard your changes first' : undefined} onClick={() => { void toggle.toggle(node); }}>
            {node.is_active ? 'Deactivate' : 'Activate'}
          </Button>
        )}
      </section>
      {toggle.dialog}
    </div>
  );
}
