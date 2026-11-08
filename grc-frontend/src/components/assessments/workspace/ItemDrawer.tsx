'use client';

/**
 * One control, in a drawer over the list: its answer and its gap in Details, its files in Evidence. A change is one Save at the foot (only the fields that changed are sent, as a JSON
 * body); the drawer asks before it throws unsaved input away, and Previous / Next walk the list that is shown. Who it is assigned to saves at once. A person who may not edit sees
 * the same facts and no controls. Nothing here shows an id, a hash or an endpoint.
 */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { Button, Disclosure, FactList, Fact, FormField, IconButton, Notice, ReadOnlyNote, Select, SidePanel, StatusPill, Tabs, TabPanel, Textarea, TextInput, useConfirm, useReportedMutation } from '@/components/ui/ds';
import { formatDate, formatDateTime } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { priority as priorityWords } from '@/lib/status';
import { CONTROL_STATUS_ORDER, controlStatus, remediationState } from '@/lib/statuses/assessments';
import { AssigneesField } from './AssigneesField';
import { EvidenceSection } from './EvidenceSection';
import { draftOf, draftProblem, dueMs, hasChanges, isOpenGap, patchBetween, PRIORITIES, PRIORITY_LABEL, REMEDIATIONS, UNCATEGORIZED, type Assignee, type ItemDraft, type SlaDays, type WorkItem } from './itemModel';
import { KEYS, workspaceApi } from './workspaceApi';
import type { AssessmentDetail } from './types';

type Section = 'details' | 'evidence';

export function ItemDrawer({ assessmentId, assessmentName, item, domains, days, readOnly, structuredRemarks, prev, next, onOpen, onClose, onChanged }: {
  assessmentId: number;
  assessmentName: string;
  item: WorkItem;
  /** the domains of this assessment, offered while typing a domain */
  domains: readonly string[];
  days: SlaDays;
  readOnly: boolean;
  /** the score of this format reads `remarks`: the field is not offered */
  structuredRemarks: boolean;
  prev: WorkItem | null;
  next: WorkItem | null;
  onOpen: (id: number) => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [section, setSection] = useState<Section>('details');
  const [base, setBase] = useState<ItemDraft>(() => draftOf(item));               // the control as the drawer opened it (or as it was last saved): "changed" is measured from here
  const [draft, setDraft] = useState<ItemDraft>(base);
  const patch = patchBetween(base, draft, { structuredRemarks });
  const dirty = hasChanges(patch);
  const problem = dirty ? draftProblem(draft) : '';

  // another control, or a fresh copy from the server while nothing is typed: the drawer starts again from it. Typed input is never replaced under the person's hands.
  const shown = useRef(item.id);
  useEffect(() => {
    if (dirty && shown.current === item.id) return;
    const fresh = draftOf(item);
    shown.current = item.id;
    setBase(fresh);
    setDraft(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);
  const set = <K extends keyof ItemDraft>(field: K, value: ItemDraft[K]) => setDraft((d) => ({ ...d, [field]: value }));

  const merge = (fields: Partial<AssessmentDetail['items'][number]>) => qc.setQueryData<AssessmentDetail>(KEYS.detail(assessmentId), (d) => (d ? { ...d, items: d.items.map((i) => (i.id === item.id ? { ...i, ...fields } : i)) } : d));

  const save = useReportedMutation({
    mutationFn: () => workspaceApi.updateItem(item.id, patch),
    success: 'Control saved',
    failure: "Couldn't save the control",
    onSuccess: (res) => {
      const { assessment: _totals, ...fields } = (res ?? {}) as Record<string, unknown>;
      void _totals;
      merge(fields as Partial<AssessmentDetail['items'][number]>);                     // the saved control, so the drawer is not "changed" while the list reads again
      setBase(draft);
      onChanged();
    },
  });
  const remove = useReportedMutation({
    mutationFn: () => workspaceApi.deleteItem(item.id),
    success: 'Control deleted',
    failure: "Couldn't delete the control",
    onSuccess: () => { onClose(); onChanged(); },
  });

  const ask = async () => {
    const yes = await confirm({ title: `Delete control ${item.number || ''}?`.replace('  ', ' '), message: 'Its answer, its gap and its links to evidence are removed. This cannot be undone.', confirmLabel: 'Delete control', tone: 'danger' });
    if (yes) remove.mutate();
  };
  const walk = (to: WorkItem | null) => { if (to && !dirty) onOpen(to.id); };

  const followed = isOpenGap(item) ? dueMs(item, days) : null;
  const status = statusPill(controlStatus, item.status);
  const title = item.number ? `${item.number}` : 'Control';
  const dis = readOnly || save.isPending;

  return (
    <>
      <SidePanel
        open onClose={onClose} width="lg" dockFrom={Infinity} dirty={dirty} title={title}
        subtitle={<span className="flex flex-wrap items-center gap-[8px]"><StatusPill {...status} size="sm" /><span className="text-ds-label text-ds-fg-muted">{item.domain}</span></span>}
        actions={(
          <>
            <IconButton label={dirty ? 'Previous control (save or discard first)' : 'Previous control'} disabled={!prev || dirty} onClick={() => walk(prev)}><ChevronUp aria-hidden /></IconButton>
            <IconButton label={dirty ? 'Next control (save or discard first)' : 'Next control'} disabled={!next || dirty} onClick={() => walk(next)}><ChevronDown aria-hidden /></IconButton>
          </>
        )}
        footer={section === 'details' && !readOnly ? (
          <div className="flex flex-wrap items-center justify-between gap-[8px]">
            <Button variant="danger" leftIcon={<Trash2 aria-hidden />} loading={remove.isPending} disabled={save.isPending} onClick={() => void ask()}>Delete control</Button>
            <div className="flex flex-wrap items-center gap-[8px]">
              {dirty && <Button disabled={save.isPending} onClick={() => setDraft(base)}>Discard changes</Button>}
              <Button variant="primary" loading={save.isPending} disabled={!dirty || !!problem} onClick={() => save.mutate()}>Save changes</Button>
            </div>
          </div>
        ) : undefined}
      >
        <Tabs tabs={[{ key: 'details', label: 'Details' }, { key: 'evidence', label: 'Evidence', count: item.evidenceCount }]} value={section} onChange={setSection} ariaLabel="Control sections" className="flex flex-col gap-[16px]">
          <TabPanel tabKey="details">
            <div className="flex flex-col gap-[16px] pt-[16px]">
              {readOnly && <ReadOnlyNote>You can look at this control but not change it.</ReadOnlyNote>}
              <FormField label="Control" required>
                <Textarea rows={3} value={draft.description} disabled={dis} onChange={(e) => set('description', e.target.value)} />
              </FormField>
              <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
                <FormField label="Answer">
                  <Select value={draft.status} disabled={dis} onChange={(e) => set('status', e.target.value as ItemDraft['status'])}>
                    {CONTROL_STATUS_ORDER.map((s) => <option key={s} value={s}>{controlStatus.label(s)}</option>)}
                  </Select>
                </FormField>
                <FormField label="Priority">
                  <Select value={draft.priority} disabled={dis} onChange={(e) => set('priority', e.target.value as ItemDraft['priority'])}>
                    <option value="">Not set</option>
                    {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
                  </Select>
                </FormField>
                <FormField label="Fix status" info="Where the work to close the gap stands. Closing it records the day, and complied answers close it too.">
                  <Select value={draft.remediation} disabled={dis} onChange={(e) => set('remediation', e.target.value as ItemDraft['remediation'])}>
                    <option value="">Not started</option>
                    {REMEDIATIONS.map((r) => <option key={r} value={r}>{remediationState.label(r)}</option>)}
                  </Select>
                </FormField>
                <FormField label="Due date" hint={!draft.targetDate && followed ? `Follows the priority: ${formatDate(followed, { calendar: true })}` : undefined} info="When the gap must be closed. Left empty, the date follows the priority (the organization's SLA days from the day the control was raised).">
                  <TextInput type="date" value={draft.targetDate} disabled={dis} onChange={(e) => set('targetDate', e.target.value)} />
                </FormField>
              </div>
              <FormField label="Assigned to">
                <AssigneesField itemId={item.id} value={item.assignees} disabled={readOnly} onSaved={(list: Assignee[]) => { merge({ assignees: list }); onChanged(); }} />
              </FormField>
              <FormField label="Domain">
                <>
                  <TextInput list={`domains-${item.id}`} value={draft.domain} placeholder={UNCATEGORIZED} disabled={dis} onChange={(e) => set('domain', e.target.value)} />
                  <datalist id={`domains-${item.id}`}>{domains.filter((d) => d !== UNCATEGORIZED).map((d) => <option key={d} value={d} />)}</datalist>
                </>
              </FormField>
              <FormField label="Gap" hint="What is missing or not working.">
                <Textarea rows={3} value={draft.gap} disabled={dis} onChange={(e) => set('gap', e.target.value)} />
              </FormField>
              <FormField label="Proposed fix">
                <Textarea rows={3} value={draft.fix} disabled={dis} onChange={(e) => set('fix', e.target.value)} />
              </FormField>
              <Disclosure label="Workbook fields">
                <div className="flex flex-col gap-[12px] pt-[8px]">
                  <FormField label="Responsible (as the workbook says)"><TextInput value={draft.responsible} disabled={dis} onChange={(e) => set('responsible', e.target.value)} /></FormField>
                  <FormField label="Timeline (as the workbook says)" hint="Free text such as Q3-2025. The due date above is what the clock uses."><TextInput value={draft.timeline} disabled={dis} onChange={(e) => set('timeline', e.target.value)} /></FormField>
                  <FormField label="Evidence reference"><TextInput value={draft.evidenceReference} disabled={dis} onChange={(e) => set('evidenceReference', e.target.value)} /></FormField>
                  <FormField label="Risk rating">
                    <Select value={draft.riskRating} disabled={dis} onChange={(e) => set('riskRating', e.target.value)}>
                      <option value="">Not set</option>
                      {['High', 'Medium', 'Low'].map((r) => <option key={r} value={r}>{r}</option>)}
                      {draft.riskRating && !['High', 'Medium', 'Low'].includes(draft.riskRating) && <option value={draft.riskRating}>{draft.riskRating}</option>}
                    </Select>
                  </FormField>
                  {item.maturity !== null && (
                    <FormField label="Maturity" hint="0 to 5. It sets the answer: 3 and above is complied.">
                      <Select value={draft.maturity} disabled={dis} onChange={(e) => set('maturity', e.target.value)}>
                        <option value="">Not scored</option>
                        {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={String(n)}>{n}</option>)}
                      </Select>
                    </FormField>
                  )}
                  {!structuredRemarks && <FormField label="Remarks"><Textarea rows={2} value={draft.remarks} disabled={dis} onChange={(e) => set('remarks', e.target.value)} /></FormField>}
                </div>
              </Disclosure>
              <FactList variant="boxed" min={160}>
                <Fact label="Raised">{formatDate(item.createdAt)}</Fact>
                <Fact label="Last changed" empty="Not changed">{item.updatedAt ? formatDateTime(item.updatedAt) : null}</Fact>
                <Fact label="Closed" empty="Still open">{item.closedAt ? formatDate(item.closedAt) : null}</Fact>
                {item.priority && <Fact label="Priority">{statusPill(priorityWords, item.priority).label}</Fact>}
              </FactList>
              {problem && <Notice tone="danger" title="Can't save yet">{problem}</Notice>}
            </div>
          </TabPanel>
          <TabPanel tabKey="evidence" lazy>
            <div className="pt-[16px]">
              <EvidenceSection assessmentId={assessmentId} assessmentName={assessmentName} item={item} readOnly={readOnly} onChanged={onChanged} />
            </div>
          </TabPanel>
        </Tabs>
      </SidePanel>
      {confirmDialog}
    </>
  );
}
