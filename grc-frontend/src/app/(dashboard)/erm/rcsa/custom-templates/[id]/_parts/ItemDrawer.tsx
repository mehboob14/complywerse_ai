'use client';

// One register item in a kit side panel over the list, with four tabs: its fields (every column of the workbook), the AI explanation, its evidence, and its owner. Save keeps the panel open and
// says "Saved" (the old drawer closed on Save and lost edits on Close); closing, Escape or the scrim ask before typed changes are thrown away. Delete and "Add to the Risk Register" go through a
// confirmation that says what they do. The fields tab is read only for a person who may not change the register.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Check, Trash2 } from 'lucide-react';
import { Button, FormError, SidePanel, StatusPill, TabPanel, Tabs, useConfirm, useReportedMutation } from '@/components/ui/ds';
import { rcsaApi } from '@/lib/api';
import { statusPill } from '@/lib/status';
import { registerLevel } from '@/lib/statuses/rcsa';
import { fieldGroups, flatColumns, hasEdits, keyColumns, levelWord, mergedData, referenceOf, scoreText, shownValue, titleOf, valueOf, type ColumnSchema, type RegisterRow } from '@/lib/rcsa/registerModel';
import { truncate } from '@/lib/format';
import { rowOf } from '../../../templates/_parts/libraryShared';
import { EvidenceTab } from './EvidenceTab';
import { ExplainTab } from './ExplainTab';
import { ItemFields } from './ItemFields';
import { OwnerTab } from './OwnerTab';
import { itemsChanged } from './registerData';

type Tab = 'fields' | 'explain' | 'evidence' | 'owner';

function Level({ label, score, name }: { label?: string | null; score?: number | null; name: string }) {
  if (!label) return <span className="text-ds-label text-ds-fg-muted">{`${name}: not rated`}</span>;
  const pill = statusPill(registerLevel, levelWord(label));
  return <span className="inline-flex flex-wrap items-center gap-[6px] text-ds-label text-ds-fg-muted">{name}<StatusPill size="sm" tone={pill.tone} label={pill.label} />{scoreText(score)}</span>;
}

export function ItemDrawer({ templateId, schema, row, canEdit, onClose }: { templateId: number; schema: ColumnSchema; row: RegisterRow | null; canEdit: boolean; onClose: () => void }) {
  // a different item starts on its own state: the panel is keyed by the item
  return <Drawer key={row?.id ?? 'none'} templateId={templateId} schema={schema} row={row} canEdit={canEdit} onClose={onClose} />;
}

function Drawer({ templateId, schema, row, canEdit, onClose }: { templateId: number; schema: ColumnSchema; row: RegisterRow | null; canEdit: boolean; onClose: () => void }) {
  const { confirm, confirmDialog } = useConfirm();
  const [tab, setTab] = useState<Tab>('fields');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<unknown>(null);
  const [savedNote, setSavedNote] = useState(false);
  const keys = useMemo(() => keyColumns(schema), [schema]);
  const groups = useMemo(() => fieldGroups(schema), [schema]);
  const columns = useMemo(() => flatColumns(schema), [schema]);
  const dirty = !!row && hasEdits(row.data, edits);

  const save = useReportedMutation({
    mutationFn: () => rcsaApi.customTemplates.updateRow(templateId, (row as RegisterRow).id, { data: mergedData((row as RegisterRow).data, edits, columns) }),
    failure: "The item wasn't saved",
    toast: 'none',
    retryable: false,
    invalidate: itemsChanged(templateId),
    onSuccess: () => { setEdits({}); setProblem(null); setSavedNote(true); window.setTimeout(() => setSavedNote(false), 4000); },
    onError: (e) => setProblem(e),
  });
  const remove = useReportedMutation({
    mutationFn: () => rcsaApi.customTemplates.deleteRow(templateId, (row as RegisterRow).id),
    success: 'Item deleted',
    failure: "The item wasn't deleted",
    toast: 'always',
    retryable: false,
    invalidate: itemsChanged(templateId),
    onSuccess: () => { setEdits({}); onClose(); },
  });
  const promote = useReportedMutation({
    mutationFn: () => rcsaApi.customTemplates.promoteRowToRisk(templateId, (row as RegisterRow).id),
    success: 'Added to the Risk Register',
    failure: "The item wasn't added to the Risk Register",
    toast: 'always',
    retryable: false,
    invalidate: itemsChanged(templateId),
  });

  const title = row ? titleOf(row, keys) : '';
  const reference = row ? referenceOf(row, keys) : '';
  const process = row ? valueOf(row, keys.process) : '';

  const askDelete = async () => {
    if (!row) return;
    const ok = await confirm({ title: 'Delete this item?', message: `"${truncate(title, 100).text}" is removed from the register with its evidence. This cannot be undone.`, confirmLabel: 'Delete item', tone: 'danger' });
    if (ok) remove.mutate();
  };
  const askPromote = async () => {
    if (!row) return;
    const ok = await confirm({
      title: 'Add this item to the Risk Register?',
      message: 'This creates a risk in the Risk Register from the item, with its description and scores, so it can be treated, monitored and reported on there. The item stays here and links to it.',
      confirmLabel: 'Add to the Risk Register',
    });
    if (ok) promote.mutate();
  };

  const tabs = [{ key: 'fields', label: 'Fields' }, { key: 'explain', label: 'AI explanation' }, { key: 'evidence', label: 'Evidence', count: row?.evidence_count || undefined }, { key: 'owner', label: 'Owner' }];
  return (
    <>
      <SidePanel
        open={!!row}
        onClose={() => { setEdits({}); onClose(); }}
        title={<span dir="auto" className="line-clamp-3 break-words" title={title}>{title}</span>}
        subtitle={[reference && reference !== title ? reference : '', process && process !== title ? process : ''].filter(Boolean).join(' · ') || undefined}
        dockFrom={Infinity}
        width="lg"
        padded={false}
        dirty={dirty && !save.isPending}
        restoreFocus={rowOf(row?.id ?? null)}
        footer={row && (
          <div className="flex flex-wrap items-center gap-[8px]">
            {canEdit && <Button variant="dangerOutline" leftIcon={<Trash2 aria-hidden />} onClick={() => { void askDelete(); }}>Delete</Button>}
            {row.linked_risk_id ? (
              <Link href={`/erm/risks/${row.linked_risk_id}`} className="inline-flex min-h-ds-control items-center gap-[4px] rounded-ds-control px-[6px] text-ds-body font-[500] text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">In the Risk Register <ArrowUpRight aria-hidden className="h-[16px] w-[16px]" strokeWidth={1.75} /></Link>
            ) : canEdit ? <Button loading={promote.isPending} onClick={() => { void askPromote(); }}>Add to Risk Register</Button> : null}
            <span className="ml-auto flex flex-wrap items-center gap-[8px]">
              {savedNote && !dirty && <span role="status" className="inline-flex items-center gap-[4px] text-ds-body text-ds-success"><Check aria-hidden className="h-[16px] w-[16px]" strokeWidth={1.75} />Saved</span>}
              <Button onClick={() => { setEdits({}); onClose(); }}>Close</Button>
              {canEdit && tab === 'fields' && <Button variant="primary" loading={save.isPending} disabled={!dirty} onClick={() => { setProblem(null); setSavedNote(false); save.mutate(); }}>Save</Button>}
            </span>
          </div>
        )}
      >
        {row && (
          <div className="flex min-w-0 flex-col">
            <div className="flex flex-wrap items-center gap-x-[16px] gap-y-[4px] px-[16px] pb-[8px] pt-[12px]">
              <Level name="Inherent" label={row.inherent_overall_label} score={row.inherent_overall_score} />
              <Level name="Residual" label={row.residual_overall_label} score={row.residual_overall_score} />
            </div>
            <Tabs tabs={tabs} value={tab} onChange={(k) => setTab(k as Tab)} ariaLabel="Item sections" countFormat="exact" className="min-w-0">
              <div className="px-[16px] py-[12px]">
                <TabPanel tabKey="fields">
                  <div className="flex flex-col gap-[12px]">
                    {!canEdit && <p className="text-ds-label text-ds-fg-muted">You can read this item. The risk team changes it.</p>}
                    <FormError title="The item wasn't saved" error={problem} onRetry={() => { setProblem(null); save.mutate(); }} />
                    <ItemFields groups={groups} value={(key) => edits[key] ?? shownValue(row.data[key])} onChange={(key, next) => { setSavedNote(false); setEdits((e) => ({ ...e, [key]: next })); }} disabled={!canEdit} />
                  </div>
                </TabPanel>
                <TabPanel tabKey="explain" lazy><ExplainTab templateId={templateId} rowId={row.id} cached={!!row.has_ai_explanation} /></TabPanel>
                <TabPanel tabKey="evidence" lazy><EvidenceTab templateId={templateId} rowId={row.id} canEdit={canEdit} /></TabPanel>
                <TabPanel tabKey="owner" lazy><OwnerTab templateId={templateId} rowId={row.id} ownerId={row.assigned_user_id ?? null} ownerName={row.assigned_user_name ?? null} canEdit={canEdit} /></TabPanel>
              </div>
            </Tabs>
          </div>
        )}
      </SidePanel>
      {confirmDialog}
    </>
  );
}
