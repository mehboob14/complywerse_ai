'use client';

// A control's workbench, as a Sheet from the right (a bottom sheet on a phone): who it is assigned to, and five tabs to work it (Details, Sampling, Test procedures, Design and effectiveness, Risks).
// It opens from any row of the Catalog and asks for the control's detail under the same key as ever (['wb-detail', source, id]). Closing it with unsaved details asks first. Every write says what it
// did (a toast) and a failure stays with a Retry; the lists behind the drawer refresh when a write lands.
import { useEffect, useMemo, useState } from 'react';
import { Star } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button, ErrorState, MultiSelect, Sheet, SkeletonRows, StatusPill, TabPanel, Tabs, useReportedMutation, PersonStack } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import apiClient from '@/lib/api';
import { statusPill } from '@/lib/status';
import { controlSource } from '@/lib/statuses/catalog';
import { controlLifecycle, workProgress } from '@/lib/statuses/controls';
import { REFRESH_KEYS, WB, useTenantPeople } from './catalogData';
import { subtitleOf, type CatalogRow, type ControlDetail } from './catalogModel';
import { DetailsTab } from './DetailsTab';
import { EffectivenessTab } from './EffectivenessTab';
import { ProceduresTab } from './ProceduresTab';
import { RisksTab } from './RisksTab';
import { SamplingTab } from './SamplingTab';

const TABS = [
  { key: 'details', label: 'Details' },
  { key: 'sampling', label: 'Sampling' },
  { key: 'procedures', label: 'Test procedures' },
  { key: 'effectiveness', label: 'Design and effectiveness' },
  { key: 'risks', label: 'Risks' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export function ControlDrawer({ row, onClose }: { row: CatalogRow; onClose: () => void }) {
  const [tab, setTab] = useState<TabKey>('details');
  const [dirty, setDirty] = useState(false);
  const detailKey = useMemo(() => ['wb-detail', row.source_type, row.source_id] as const, [row.source_type, row.source_id]);
  const keys = useMemo(() => [detailKey, ...REFRESH_KEYS], [detailKey]);
  const q = useQuery({ queryKey: detailKey, queryFn: async () => (await apiClient.get(`${WB}/controls/${row.source_type}/${row.source_id}`)).data as ControlDetail });
  const people = useTenantPeople();
  const d = q.data;

  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => { if (d) setPicked((d.assigned_user_ids ?? []).map(String)); }, [d]);
  const assign = useReportedMutation({
    mutationFn: (ids: number[]) => apiClient.patch(`${WB}/items/${d?.work_item_id}/assign`, { assigned_user_ids: ids }),
    success: { title: 'Assignment saved', message: 'The people on this control are up to date.' },
    failure: "Couldn't change who this control is assigned to",
    invalidate: keys,
  });
  const options = useMemo(() => (people.data ?? []).map((u) => ({ value: String(u.id), label: u.display_name, description: u.email })).sort((a, b) => a.label.localeCompare(b.label)), [people.data]);
  const assigned = (d?.assigned_user_ids ?? []).map(String);
  const assignDirty = picked.length !== assigned.length || picked.some((p) => !assigned.includes(p));
  const source = statusPill(controlSource, row.source_type).label;
  const subtitle = [subtitleOf({ code: row.code, framework_name: undefined }), source, d?.framework_name || row.framework_name].filter(Boolean).join(' · ');

  return (
    <Sheet
      open
      onClose={onClose}
      width="lg"
      dirty={dirty}
      title={<span className="inline-flex items-center gap-[8px]">{row.is_key_control && <><Star aria-hidden className="h-[16px] w-[16px] shrink-0 fill-current text-ds-warning" strokeWidth={1.75} /><span className="sr-only">Key control.</span></>}{d?.name || row.name}</span>}
      subtitle={subtitle}
    >
      {q.isError && !d ? (
        <ErrorState title="Couldn’t open this control" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />
      ) : q.isPending || !d ? (
        <SkeletonRows rows={6} columns={2} label="Opening the control" />
      ) : (
        <div className="flex flex-col gap-[16px]">
          <div className="flex flex-col gap-[12px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
            <div className="flex flex-wrap items-center gap-[8px]">
              <StatusPill {...statusPill(controlLifecycle, d.status || 'draft')} />
              <StatusPill {...statusPill(workProgress, d.implementation_status || 'not_started')} />
              <span className="ml-auto"><PersonStack people={(d.assignees ?? []).map((a) => a.display_name)} max={4} label="Assigned to" emptyLabel="Unassigned" /></span>
            </div>
            <div className="flex flex-wrap items-end gap-[8px]">
              <div className="min-w-[200px] flex-1">
                <MultiSelect label="Assigned to" showLabel options={options} value={picked} onChange={setPicked} placeholder="Choose people" disabled={people.isError || options.length === 0} />
              </div>
              <Button variant="primary" loading={assign.isPending} disabled={!assignDirty} onClick={() => assign.mutate(picked.map(Number))}>Save assignment</Button>
            </div>
            {people.isError && <p role="alert" className="m-0 text-ds-label text-ds-danger">The list of people could not be loaded, so nobody can be assigned. <button type="button" className="underline" onClick={() => { void people.refetch(); }}>Retry</button></p>}
          </div>

          <Tabs tabs={TABS.map((t) => ({ key: t.key, label: t.label }))} value={tab} onChange={setTab} ariaLabel="Control sections">
            <TabPanel tabKey="details" className="pt-[16px]"><DetailsTab d={d} keys={keys} onDirty={setDirty} /></TabPanel>
            <TabPanel tabKey="sampling" lazy className="pt-[16px]"><SamplingTab d={d} keys={keys} /></TabPanel>
            <TabPanel tabKey="procedures" lazy className="pt-[16px]"><ProceduresTab d={d} keys={keys} /></TabPanel>
            <TabPanel tabKey="effectiveness" lazy className="pt-[16px]"><EffectivenessTab d={d} keys={keys} /></TabPanel>
            <TabPanel tabKey="risks" lazy className="pt-[16px]"><RisksTab d={d} keys={keys} /></TabPanel>
          </Tabs>
        </div>
      )}
    </Sheet>
  );
}
