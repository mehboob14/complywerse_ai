'use client';

// The Checklist tab of the requirement drawer: what a requirement asks to be ticked. For a standard with its own structure (UAE IA) that is its sub-controls: the sentence the standard
// prints, a tick for each one that is a criterion, the points under it, the evidence it needs, the artifacts for it, its own owners and the files attached to it. For the others it is the
// requirement's assessment criteria, each worth an equal share. Ticking moves the requirement's status on the server (all met = implemented, some = in progress); the screen says so.
import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Package, Paperclip, Pencil, Upload, UserPlus } from 'lucide-react';
import { Button, Checkbox, MultiSelect, Notice, ProgressBar, StatusPill, type ListOption } from '@/components/ui/ds';
import { formatDate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { subControlState } from '@/lib/statuses/frameworkRequirements';
import type { CatalogItem, TenantArtifact } from '@/components/compliance/ArtifactsTab';
import type { PointNode, SubControlNode } from '@/types';
import {
  attachmentsOf, evidenceCountLabel, evidenceCountOf, evidenceOf, isMet, isTickable, leadInGroups, ownerIdsOf, ownersOf, placeCatalog, rowStatus, statusOf, subControlsOf,
  type EvidenceChip,
} from '../_tabs/requirementTree';
import { MaturityPill, ReviewPill } from './FileBits';
import type { ReqRow } from './reqModel';
import type { Ticks } from './useCriteriaTicks';
import type { useRequirementActions } from './useRequirementActions';
import type { useRequirementArtifacts } from './useRequirementArtifacts';

export interface PersonOption { id: number; name: string; email?: string | null }

interface Props {
  row: ReqRow;
  ticks: Ticks;
  onTick: (index: number) => void;
  users: readonly PersonOption[];
  actions: ReturnType<typeof useRequirementActions>;
  art: ReturnType<typeof useRequirementArtifacts>;
  canCreate: boolean;
  canEdit: boolean;
}

const FOCUS = 'focus-visible:outline-none focus-visible:shadow-ds-ring';
const ALSO = 'rounded-ds-control border border-ds-border bg-ds-surface px-[6px] py-[1px] text-ds-label text-ds-fg-body';

export function DrawerChecklist(p: Props) {
  const { row } = p;
  const control = row.control;
  const nodes = subControlsOf(control);
  if (nodes.length > 0) return <SubControls {...p} />;
  return <Criteria {...p} />;
}

// ── the assessment criteria of a requirement ─────────────────────────────────────────────────────────────────────────────
function Criteria({ row, ticks, onTick }: Props) {
  const crits = row.control.assessment_criteria ?? [];
  const state = statusOf(row.control, ticks) ?? {};
  const met = crits.filter((_, i) => state[String(i)]).length;
  const weight = Math.round(100 / Math.max(1, crits.length));
  const pct = Math.round((met / Math.max(1, crits.length)) * 100);
  const word = pct === 100 ? 'Compliant' : pct > 0 ? 'In progress' : 'Not started';
  const tone = pct === 100 ? 'success' : pct > 0 ? 'progress' : 'neutral';
  return (
    <section aria-label="Assessment criteria" className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[6px]">
        <h3 className="m-0 min-w-0 flex-1 !text-ds-body !font-[600] !text-ds-fg">Assessment criteria</h3>
        <StatusPill size="sm" tone={tone} label={word} />
        <span className="text-ds-body font-[600] tabular-nums text-ds-fg">{`${pct}%`}</span>
        <span className="text-ds-label tabular-nums text-ds-fg-muted">{`${met} of ${crits.length} met`}</span>
      </div>
      <ProgressBar value={pct} label="Criteria met" showValue={false} tone={pct === 100 ? 'success' : 'primary'} />
      <ul className="m-0 flex list-none flex-col gap-[2px] p-0">
        {crits.map((c, i) => (
          <li key={i} className="flex items-start gap-[8px]">
            <Checkbox
              className="min-w-0 flex-1"
              checked={!!state[String(i)]}
              onChange={() => onTick(i)}
              label={<span><span className="mr-[6px] font-mono text-ds-label text-ds-fg-muted">{`${i + 1}.`}</span>{c}</span>}
            />
            <span className="mt-[8px] shrink-0 rounded-ds-control bg-ds-surface-subtle px-[6px] text-ds-label tabular-nums text-ds-fg-muted" title="Each criterion carries an equal share">{`${weight}%`}</span>
          </li>
        ))}
      </ul>
      <p className="m-0 text-ds-label text-ds-fg-muted">{`Each criterion is worth ${weight}%. All of them must be met, with evidence, for the requirement to score 100%. Ticking one updates the requirement's status.`}</p>
    </section>
  );
}

// ── the sub-controls of a standard ───────────────────────────────────────────────────────────────────────────────────────
function PointList({ points }: { points: PointNode[] }) {
  return (
    <ul className="m-0 mt-[4px] flex list-none flex-col gap-[2px] p-0">
      {points.map((point, i) => (
        <li key={i}>
          <div className="flex items-start gap-[6px]">
            <span className="min-w-[20px] shrink-0 text-right text-ds-body text-ds-fg-muted">{point.label}</span>
            <span className="min-w-0 break-words text-ds-body text-ds-fg-body">{point.text}</span>
          </div>
          {point.points && point.points.length > 0 && <div className="ml-[24px]"><PointList points={point.points} /></div>}
        </li>
      ))}
    </ul>
  );
}

function SubControls(p: Props) {
  const { row, ticks, onTick, art } = p;
  const control = row.control;
  const nodes = subControlsOf(control);
  const status = statusOf(control, ticks);
  const subCodes = nodes.map((n) => n.code);
  const fromCatalog = useMemo(() => placeCatalog(art.catalog.filter((c) => c.id > 0), subCodes), [art.catalog, subCodes.join('|')]);   // eslint-disable-line react-hooks/exhaustive-deps -- the codes are the key
  const tickable = nodes.filter(isTickable);
  const met = tickable.filter((n) => isMet(n, status)).length;
  return (
    <section aria-label="Sub-controls" className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[4px]">
        <h3 className="m-0 min-w-0 flex-1 !text-ds-body !font-[600] !text-ds-fg">{`Sub-controls (${nodes.length})`}</h3>
        {tickable.length > 0 && <span className="text-ds-label tabular-nums text-ds-fg-muted">{`${met} of ${tickable.length} met`}</span>}
        {art.query.isLoading && <span role="status" className="text-ds-label text-ds-fg-muted">Loading artifacts</span>}
      </div>
      {tickable.length > 0 && <p className="m-0 text-ds-label text-ds-fg-muted">Ticking a sub-control updates the requirement's status.</p>}
      <div className="flex flex-col gap-[16px]">
        {leadInGroups(nodes).map((group, gi) => (
          <div key={gi}>
            {group.leadIn && <p data-testid="req-leadin" className="m-0 mb-[6px] text-ds-body font-[500] text-ds-fg">{group.leadIn}</p>}
            <ul className="m-0 flex list-none flex-col gap-[12px] p-0">
              {group.rows.map(({ node, text }) => (
                <SubControlRow
                  key={node.code}
                  {...p}
                  node={node}
                  text={text}
                  met={isMet(node, status)}
                  onTickNode={() => node.criterion_index != null && onTick(node.criterion_index)}
                  items={[...(fromCatalog.byCode[node.code] ?? [])]}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function SubControlRow({ row, node, text, met, onTickNode, items, users, actions, art, canCreate, canEdit }: Props & { node: SubControlNode; text: string; met: boolean; onTickNode: () => void; items: Array<CatalogItem & { sub_controls?: string[] | null }> }) {
  const control = row.control;
  const owners = ownersOf(node, users.map((u) => ({ id: u.id, display_name: u.name, email: u.email })));
  const files = attachmentsOf(control, node);
  const asks = evidenceOf(control, node);
  const state = rowStatus(met, owners.length, files.length);
  const label = (
    <span>
      <span className="mr-[6px] break-all font-mono text-ds-label text-ds-fg-muted">{node.code}</span>
      <span className="text-ds-body text-ds-fg">{text}</span>
    </span>
  );
  return (
    <li data-testid="req-subcontrol" data-code={node.code} className="min-w-0 rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">
      {isTickable(node) ? (
        <Checkbox checked={met} onChange={onTickNode} label={label} />
      ) : (
        <div className="flex items-start gap-[8px] py-[4px]"><span aria-hidden className="w-[16px] shrink-0 text-center text-ds-body text-ds-fg-muted">•</span>{label}</div>
      )}
      {node.points.length > 0 && <div className="ml-[24px]"><PointList points={node.points} /></div>}
      <div className="ml-[24px] mt-[8px] flex flex-col gap-[8px] max-sm:ml-0">
        <div className="flex flex-wrap items-center gap-[6px]">
          {state && <StatusPill size="sm" {...statusPill(subControlState, state)} />}
          {asks.map((c: EvidenceChip) => <span key={c.name} title={c.description || c.name} className={ALSO}><Paperclip aria-hidden className="mr-[4px] inline h-[12px] w-[12px] align-[-1px]" />{c.name}{c.filetype ? <span className="ml-[6px] text-ds-fg-muted">{c.filetype}</span> : null}</span>)}
          {items.map((item) => <ArtifactChip key={item.id} item={item} art={art} />)}
        </div>
        <div className="flex flex-wrap items-center gap-x-[16px] gap-y-[8px]">
          <OwnerLine control={row.control} node={node} owners={owners} users={users} actions={actions} canEdit={canEdit} />
          <EvidenceLine row={row} node={node} files={files} actions={actions} canCreate={canCreate} />
        </div>
        {files.length > 0 && (
          <ul aria-label={`Evidence attached to ${node.code}`} className="m-0 flex list-none flex-col gap-[6px] p-0">
            {files.map((file) => (
              <li key={file.id} className="flex min-w-0 flex-wrap items-center gap-x-[8px] gap-y-[4px]">
                <Paperclip aria-hidden className="h-[14px] w-[14px] shrink-0 text-ds-fg-muted" />
                {file.linked_evidence_id ? (
                  <Link href={`/evidence/${file.linked_evidence_id}`} title="Open the evidence" className={`min-w-0 break-words rounded-ds-control text-ds-label font-[500] text-ds-primary-text hover:underline ${FOCUS}`}>{file.file_name || 'Evidence file'}</Link>
                ) : (
                  <span className="min-w-0 break-words text-ds-label text-ds-fg">{file.file_name || 'Evidence file'}</span>
                )}
                <ReviewPill status={file.review_status} />
                {file.linked_evidence_id ? <MaturityPill evidenceId={file.linked_evidence_id} /> : null}
                <span className="text-ds-label text-ds-fg-muted">{formatDate(file.uploaded_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function ArtifactChip({ item, art }: { item: CatalogItem; art: Props['art'] }) {
  const made: TenantArtifact | undefined = art.madeFor(item);
  return (
    <button
      type="button"
      onClick={() => (made ? art.setEditing(made) : art.setCreating(item))}
      title={made ? `Open ${item.name}` : `Create ${item.name}`}
      className={`inline-flex min-h-ds-control-sm max-w-full items-center gap-[4px] rounded-ds-control border px-[8px] text-left text-ds-label ${FOCUS} ${made ? 'border-ds-success bg-ds-success-soft text-ds-fg' : 'border-ds-border bg-ds-surface text-ds-primary-text hover:bg-ds-primary-soft'}`}
    >
      <Package aria-hidden className="h-[12px] w-[12px] shrink-0" />
      <span className="min-w-0 break-words">{made ? item.name : `Create ${item.name}`}</span>
    </button>
  );
}

function OwnerLine({ control, node, owners, users, actions, canEdit }: { control: Props['row']['control']; node: SubControlNode; owners: Array<{ id: number; name: string }>; users: readonly PersonOption[]; actions: Props['actions']; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const current = ownerIdsOf(node);
  const [draft, setDraft] = useState<string[]>(current.map(String));
  const options: ListOption[] = useMemo(() => users.map((u) => ({ value: String(u.id), label: u.name, description: u.email ?? undefined })), [users]);
  const opener = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  if (owners.length === 0 && !canEdit) return null;
  const same = draft.length === current.length && draft.every((d) => current.includes(Number(d)));
  const close = () => { setEditing(false); opener.current?.focus(); };
  return (
    <div className="flex min-w-0 flex-col gap-[6px]">
      <div className="flex min-w-0 flex-wrap items-center gap-[6px]">
        <span className="text-ds-label text-ds-fg-muted">{owners.length > 1 ? 'Owners' : 'Owner'}</span>
        {owners.length === 0 ? <span className="text-ds-label text-ds-fg-muted">Unassigned</span> : owners.map((o) => <span key={o.id} className={ALSO}>{o.name}</span>)}
        {canEdit && !editing && (
          <Button ref={opener} size="sm" leftIcon={owners.length ? <Pencil aria-hidden /> : <UserPlus aria-hidden />} aria-label={`${owners.length ? 'Edit' : 'Assign'} owners of ${node.code}`} onClick={() => { setDraft(current.map(String)); setEditing(true); }}>{owners.length ? 'Edit' : 'Assign'}</Button>
        )}
      </div>
      {editing && (
        <div className="flex flex-wrap items-center gap-[8px]">
          <div className="min-w-[200px] max-w-[320px] flex-1"><MultiSelect label={`Owners of ${node.code}`} options={options} value={draft} onChange={setDraft} placeholder="Choose people" searchPlaceholder="Search people" /></div>
          <Button variant="primary" loading={actions.assignSub.isPending} disabled={same} onClick={() => actions.assignSub.mutate({ controlId: control.id, code: node.code, userIds: draft.map(Number) }, { onSuccess: close })}>{draft.length === 0 ? 'Withdraw' : 'Save'}</Button>
          <Button onClick={close} disabled={actions.assignSub.isPending}>Cancel</Button>
        </div>
      )}
    </div>
  );
}

function EvidenceLine({ row, node, files, actions, canCreate }: { row: ReqRow; node: SubControlNode; files: unknown[]; actions: Props['actions']; canCreate: boolean }) {
  const picker = useRef<HTMLInputElement>(null);
  const count = evidenceCountLabel(evidenceCountOf(row.control, node));
  if (!count && !canCreate) return null;
  const busy = actions.upload.isPending && actions.upload.variables?.controlId === row.id && actions.upload.variables?.subControlCode === node.code;
  return (
    <div className="flex flex-wrap items-center gap-[8px]">
      {count && <span data-testid="subcontrol-evidence-count" className="text-ds-label text-ds-fg-muted">{count}</span>}
      {canCreate && (
        <>
          <input ref={picker} type="file" className="hidden" tabIndex={-1} aria-hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) actions.upload.mutate({ controlId: row.id, file: f, subControlCode: node.code }); e.target.value = ''; }} />
          <Button size="sm" leftIcon={<Upload aria-hidden />} loading={busy} aria-label={`Upload evidence for ${node.code}`} onClick={() => picker.current?.click()}>{files.length ? 'Upload another' : 'Upload'}</Button>
        </>
      )}
    </div>
  );
}

/** Shown above the checklist when its artifacts could not be loaded (the ticks still work). */
export function ChecklistNote({ failed }: { failed: boolean }) {
  if (!failed) return null;
  return <Notice tone="warning" title="The artifacts for these sub-controls didn't load">You can still tick, assign and upload. Open the Artifacts tab to try again.</Notice>;
}
