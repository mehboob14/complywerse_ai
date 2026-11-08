'use client';

/**
 * The details of one requirement over the Requirements list (the Facet explorer's drawer): the kit's SidePanel, which replaces the 90vh popup and its accordion. The head names the
 * requirement and its section; the body is five tabs: Overview (the facts, the specification, the owners, the status where a person sets it), Evidence (the files and what is asked
 * for), Checklist (the criteria or the standard's sub-controls), Scope (the requests to change it) and Artifacts. Every save says so when the server has answered; a failure stays
 * on screen with its words. Previous and next walk the list as it is shown. `?req=<id>` opens it, as the journey's links always did.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Pencil, UserPlus } from 'lucide-react';
import EvidenceViewer from '@/components/evidence/EvidenceViewer';
import { CreateArtifactModal, EditArtifactModal } from '@/components/compliance/ArtifactsTab';
import {
  Button, ClampedText, Disclosure, Fact, FactList, FormField, IconButton, MultiSelect, Notice, Select, SidePanel, StatusPill, TabPanel, Tabs, type ListOption, type TabItem,
} from '@/components/ui/ds';
import { formatCount } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { requirementState } from '@/lib/statuses/frameworkJourney';
import { requirementScope } from '@/lib/statuses/frameworkRequirements';
import type { CertificationControl } from '@/types';
import { decisionsOf, evidenceLine, statusFollowsTicks, type ReqRow } from './reqModel';
import { DrawerArtifacts } from './DrawerArtifacts';
import { ChecklistNote, DrawerChecklist, type PersonOption } from './DrawerChecklist';
import { DrawerEvidence, type PreviewFile } from './DrawerEvidence';
import { DrawerScope } from './DrawerScope';
import type { ScopeRecord } from '../_workspace/ScopeTab';
import type { Ticks } from './useCriteriaTicks';
import type { useRequirementActions } from './useRequirementActions';
import { useRequirementArtifacts } from './useRequirementArtifacts';

export type DrawerTab = 'overview' | 'evidence' | 'checklist' | 'scope' | 'artifacts';

export interface RequirementDrawerProps {
  row: ReqRow | null;
  onClose: () => void;
  onStep: (dir: -1 | 1) => void;
  hasPrev: boolean;
  hasNext: boolean;
  frameworkLabel: string;
  users: readonly PersonOption[];
  rights: { canCreate: boolean; canEdit: boolean; canDelete: boolean };
  scope: { appFwId: number | null; records: readonly ScopeRecord[]; loading: boolean; error: unknown; onRetry: () => void };
  ticks: Ticks;
  onTick: (control: CertificationControl, index: number) => void;
  actions: ReturnType<typeof useRequirementActions>;
  onAskScope: (row: ReqRow, applicable: boolean) => void;
  onGoScope: () => void;
}

/** The row the details were opened from, found again when focus has to go back to it. */
const rowOf = (id: number | null) => (): HTMLElement | null => {
  if (id == null || typeof document === 'undefined') return null;
  const rows = Array.from(document.querySelectorAll<HTMLElement>(`[data-record-row="${id}"]`));
  const found = rows.find((r) => r.getClientRects().length > 0) ?? null;
  return found?.querySelector<HTMLElement>('a[href], button') ?? found;
};

export function RequirementDrawer(props: RequirementDrawerProps) {
  const { row, onClose, onStep, hasPrev, hasNext } = props;
  const [tab, setTab] = useState<DrawerTab>('overview');
  const open = !!row;
  useEffect(() => { if (!open) setTab('overview'); }, [open]);
  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={<span dir="auto" className="line-clamp-3 break-words" title={row?.name}>{row ? `${row.code} · ${row.name}` : ''}</span>}
      subtitle={row?.section}
      dockFrom={Infinity}
      width="lg"
      padded={false}
      restoreFocus={rowOf(row?.id ?? null)}
      initialFocus='[role="tab"][aria-selected="true"]'
      closeLabel="Close the details"
      actions={row && (
        <>
          <IconButton label="Previous requirement" aria-disabled={!hasPrev || undefined} onClick={() => { if (hasPrev) onStep(-1); }}><ChevronUp aria-hidden /></IconButton>
          <IconButton label="Next requirement" aria-disabled={!hasNext || undefined} onClick={() => { if (hasNext) onStep(1); }}><ChevronDown aria-hidden /></IconButton>
        </>
      )}
    >
      {row && <Body key={row.id} {...props} row={row} tab={tab} setTab={setTab} />}
    </SidePanel>
  );
}

function Body({ row, frameworkLabel, users, rights, scope, ticks, onTick, actions, onAskScope, onGoScope, tab, setTab }: RequirementDrawerProps & { row: ReqRow; tab: DrawerTab; setTab: (t: DrawerTab) => void }) {
  const control = row.control;
  const [preview, setPreview] = useState<PreviewFile | null>(null);
  const structured = (control.sub_control_tree?.length ?? 0) > 0;
  const hasChecklist = row.checklist !== null || structured || (control.assessment_criteria?.length ?? 0) > 0;
  const hasArtifacts = (control.evidence_requirements?.length ?? 0) > 0 || structured;
  const art = useRequirementArtifacts(control, frameworkLabel, tab === 'artifacts' || (tab === 'checklist' && structured));
  const waiting = useMemo(() => decisionsOf(row, scope.records).filter((d) => d.status === 'pending').length, [row, scope.records]);
  const tenantUsers = useMemo(() => users.map((u) => ({ id: u.id, label: u.name, email: u.email ?? null })), [users]);

  const tabs: TabItem[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'evidence', label: 'Evidence', count: row.evidence.files },
    { key: 'checklist', label: 'Checklist', hidden: !hasChecklist, count: row.checklist?.total },
    { key: 'scope', label: 'Scope', hidden: !scope.appFwId, count: waiting || undefined },
    { key: 'artifacts', label: 'Artifacts', hidden: !hasArtifacts },
  ];
  const value = tabs.some((t) => t.key === tab && !t.hidden) ? tab : 'overview';

  return (
    <div className="p-[16px]">
      <Tabs tabs={tabs} value={value} onChange={(k) => setTab(k as DrawerTab)} ariaLabel="Requirement details" countFormat="exact">
        <TabPanel tabKey="overview" className="pt-[16px]">
          <Overview row={row} users={users} canEdit={rights.canEdit} actions={actions} />
        </TabPanel>
        <TabPanel tabKey="evidence" lazy className="pt-[16px]">
          <DrawerEvidence row={row} actions={actions} canCreate={rights.canCreate} canEdit={rights.canEdit} canDelete={rights.canDelete} onPreview={setPreview} />
        </TabPanel>
        <TabPanel tabKey="checklist" lazy className="pt-[16px]">
          <div className="flex flex-col gap-[12px]">
            <ChecklistNote failed={structured && art.query.isError} />
            <DrawerChecklist row={row} ticks={ticks} onTick={(i) => onTick(control, i)} users={users} actions={actions} art={art} canCreate={rights.canCreate} canEdit={rights.canEdit} />
          </div>
        </TabPanel>
        <TabPanel tabKey="scope" lazy className="pt-[16px]">
          <DrawerScope row={row} appFwId={scope.appFwId} records={scope.records} loading={scope.loading} error={scope.error} onRetry={scope.onRetry} canEdit={rights.canEdit} busy={actions.askScope.isPending} onAsk={(applicable) => onAskScope(row, applicable)} onGoScope={onGoScope} />
        </TabPanel>
        <TabPanel tabKey="artifacts" lazy className="pt-[16px]">
          <DrawerArtifacts art={art} frameworkLabel={frameworkLabel} />
        </TabPanel>
      </Tabs>
      <EvidenceViewer evidence={preview} onClose={() => setPreview(null)} />
      {art.creating && art.query.data?.framework_key && (
        <CreateArtifactModal
          item={art.creating}
          frameworkKey={art.query.data.framework_key}
          frameworkName={art.query.data.framework_name || frameworkLabel}
          tenantUsers={tenantUsers}
          onConfirm={(payload) => art.create.mutate(payload)}
          onClose={() => art.setCreating(null)}
          isPending={art.create.isPending}
        />
      )}
      {art.editing && (
        <EditArtifactModal
          artifact={art.editing}
          tenantUsers={tenantUsers}
          onSave={(patch) => art.editing && art.update.mutate({ id: art.editing.id, patch })}
          onClose={() => art.setEditing(null)}
          isPending={art.update.isPending}
        />
      )}
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const STATUS_CHOICES = ['not_started', 'in_progress', 'implemented', 'verified'] as const;

function Overview({ row, users, canEdit, actions }: { row: ReqRow; users: readonly PersonOption[]; canEdit: boolean; actions: ReturnType<typeof useRequirementActions> }) {
  const c = row.control;
  const statement = (c.control_statement_full || c.control_statement || '').trim();
  const version = c.version_history && c.version_history[0] ? c.version_history[0] : null;
  const followsTicks = statusFollowsTicks(c);
  return (
    <div className="flex flex-col gap-[20px]">
      <FactList min={150}>
        <Fact label="Status"><StatusPill {...statusPill(requirementState, row.status)} /></Fact>
        <Fact label="Evidence">{evidenceLine(row.evidence)}{row.evidence.pending > 0 ? ` · ${formatCount(row.evidence.pending)} waiting for review` : ''}</Fact>
        <Fact label="Owners">{row.owners.length > 0 ? row.owners.join(', ') : null}</Fact>
        <Fact label="Scope"><StatusPill {...statusPill(requirementScope, row.inScope ? 'in_scope' : 'out_of_scope')} /></Fact>
        {row.tier && <Fact label="Priority">{`${row.tier}${c.priority_level && /^P[1-3]$/.test(c.priority_level) ? ` · Year ${c.priority_level.slice(1)}` : ''}`}</Fact>}
        {row.critical && <Fact label="Critical clause"><StatusPill tone="danger" label="Critical" /></Fact>}
        {c.applicability && <Fact label="Applies">{c.applicability}</Fact>}
        {c.objective_name && c.objective_name.trim() !== row.section && <Fact label="Objective">{c.objective_name}</Fact>}
        {version && <Fact label="Version">{`${version.version || '—'}${version.date ? ` · ${version.date}` : ''}`}</Fact>}
        {c.dependencies && c.dependencies.length > 0 && <Fact label="Depends on">{c.dependencies.join(', ')}</Fact>}
      </FactList>

      {row.critical && c.criticality_reason && <Notice tone="warning" title="Flagged as critical by AI">{c.criticality_reason}</Notice>}

      {statement && (
        <section aria-label="Specification">
          <h3 className="m-0 mb-[6px] !text-ds-body !font-[600] !text-ds-fg">Specification</h3>
          <ClampedText text={statement} lines={5} className="text-ds-body text-ds-fg-body" />
        </section>
      )}
      {c.control_description && c.control_description.trim() !== statement && (
        <section aria-label="Description">
          <h3 className="m-0 mb-[6px] !text-ds-body !font-[600] !text-ds-fg">Description</h3>
          <ClampedText text={c.control_description} lines={4} className="text-ds-body text-ds-fg-body" />
        </section>
      )}

      <OwnersEditor row={row} users={users} canEdit={canEdit} actions={actions} />
      <StatusEditor row={row} canEdit={canEdit} followsTicks={followsTicks} actions={actions} />

      {c.implementation_guidance && (
        <Disclosure label="Implementation guidance (for information only)" level={3} region={false}>
          <p className="m-0 whitespace-pre-line break-words text-ds-body text-ds-fg-body">{c.implementation_guidance}</p>
        </Disclosure>
      )}
    </div>
  );
}

function OwnersEditor({ row, users, canEdit, actions }: { row: ReqRow; users: readonly PersonOption[]; canEdit: boolean; actions: ReturnType<typeof useRequirementActions> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>(row.ownerIds.map(String));
  const options: ListOption[] = useMemo(() => users.map((u) => ({ value: String(u.id), label: u.name, description: u.email ?? undefined })), [users]);
  if (!canEdit) return null;
  const same = draft.length === row.ownerIds.length && draft.every((d) => row.ownerIds.includes(Number(d)));
  const busy = actions.assign.isPending && actions.assign.variables?.controlId === row.id;
  const close = () => setEditing(false);
  if (!editing) {
    return (
      <div>
        <Button leftIcon={row.ownerIds.length ? <Pencil aria-hidden /> : <UserPlus aria-hidden />} onClick={() => { setDraft(row.ownerIds.map(String)); setEditing(true); }}>{row.ownerIds.length ? 'Change owners' : 'Assign owners'}</Button>
      </div>
    );
  }
  return (
    <section aria-label="Owners" className="flex flex-col gap-[8px]">
      <FormField label="Owners" hint="Everyone you choose owns this requirement. Choose nobody to withdraw every owner.">
        <MultiSelect label="Owners" options={options} value={draft} onChange={setDraft} placeholder="Choose people" searchPlaceholder="Search people" />
      </FormField>
      <div className="flex flex-wrap gap-[8px]">
        <Button variant="primary" loading={busy} disabled={same} onClick={() => actions.assign.mutate({ controlId: row.id, userIds: draft.map(Number) }, { onSuccess: close })}>{draft.length === 0 ? 'Withdraw owners' : 'Save owners'}</Button>
        <Button onClick={close} disabled={busy}>Cancel</Button>
      </div>
    </section>
  );
}

function StatusEditor({ row, canEdit, followsTicks, actions }: { row: ReqRow; canEdit: boolean; followsTicks: boolean; actions: ReturnType<typeof useRequirementActions> }) {
  const [value, setValue] = useState<string>(row.status);
  useEffect(() => { setValue(row.status); }, [row.status]);
  if (followsTicks) {
    return <p className="m-0 text-ds-label text-ds-fg-muted">This requirement's status follows its checklist: tick the criteria on the Checklist tab.</p>;
  }
  if (!canEdit) return null;
  if (!STATUS_CHOICES.some((s) => s === row.status)) return null;                 // not applicable and the like are decided through scope
  const busy = actions.setStatus.isPending && actions.setStatus.variables?.controlId === row.id;
  return (
    <section aria-label="Status" className="flex flex-col gap-[8px]">
      <FormField label="Change the status" hint="Marking it verified records you as the person who verified it.">
        <Select value={value} onChange={(e) => setValue(e.target.value)}>
          {STATUS_CHOICES.map((s) => <option key={s} value={s}>{requirementState.label(s)}</option>)}
        </Select>
      </FormField>
      <div><Button loading={busy} disabled={value === row.status} onClick={() => actions.setStatus.mutate({ controlId: row.id, status: value })}>Update status</Button></div>
    </section>
  );
}

