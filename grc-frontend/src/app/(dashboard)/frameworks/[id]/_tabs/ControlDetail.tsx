'use client';

/**
 * What an open control shows in the hierarchical Requirements view: its statement, its sub-controls (a tick for each one that is a
 * criterion, the points printed under it, the evidence and artifacts it needs), what the control as a whole needs, and the standard's
 * implementation guidance. It is mounted only while the control is open, and then asks once for the control's artifacts
 * (/artifacts/by-control with the control's code and all its sub-controls' codes); each artifact is shown under the sub-controls its
 * `sub_controls` names, and under the control when it names none. Creating and opening an artifact are the page's own modals.
 * Each sub-control also has its own owners (the control modal's picker, per sub-control code), the files attached to it (the control's
 * own upload with the sub-control's code added, rated and reviewed like any file of the control) and a status that follows from them.
 */
import { useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Paperclip, Pencil, Upload, UserPlus } from 'lucide-react';
import apiClient, { certificationsApi } from '@/lib/api';
import { apiErrorText } from '@/lib/apiError';
import { parseUtc } from '@/lib/serverTime';
import { usePermissions } from '@/hooks/usePermissions';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import { EvidenceMaturity } from '@/app/(dashboard)/evidence/_review';
import { CreateArtifactModal, EditArtifactModal, type CatalogItem, type TenantArtifact } from '@/components/compliance/ArtifactsTab';
import type { CertificationControl, ControlEvidence, PointNode, SubControlNode } from '@/types';
import { ApplicabilityChip, ArtifactChipView, EvidenceChipView, FOCUS, MINI, MINI_PRIMARY, OwnerChip, PriorityChip, ReviewChip, RowStatusChip } from './RequirementChips';
import {
  attachmentsOf, controlEvidenceOf, evidenceCountLabel, evidenceCountOf, evidenceOf, isMet, isTickable, leadInGroups, ownerIdsOf, ownersOf, placeCatalog, rowStatus,
  statusOf, subControlsOf, userName, type EvidenceChip, type Owner,
} from './requirementTree';

type CatalogRow = CatalogItem & { sub_controls?: string[] | null };

interface ByControl {
  framework_key: string | null;
  framework_name?: string | null;
  control_ref: string;
  catalog: CatalogRow[];
  artifacts: TenantArtifact[];
}

/** The tenant users as the page holds them. */
export interface PageUser { id: number; display_name?: string | null; username?: string | null; email?: string | null }

const LABEL = 'text-[11px] font-semibold uppercase tracking-wide text-slate-500';

/** A tenant artifact's `control_ref` can bundle references ("M1.1.1.2 / M1.1.1.3"). */
const refTokens = (ref: string | null | undefined): string[] => (ref || '').split(/[/,]/).map((s) => s.trim()).filter(Boolean);

function useControlArtifacts(codes: string[], frameworkLabel: string) {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState<CatalogRow | null>(null);
  const [editing, setEditing] = useState<TenantArtifact | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['requirement-artifacts-tree', frameworkLabel, codes.join(',')],
    queryFn: async () => {
      const res = await apiClient.get('/artifacts/by-control', { params: { assessment_type: frameworkLabel, control_ref: codes.join(',') } });
      return res.data as ByControl;
    },
    enabled: !!frameworkLabel && codes.length > 0,
    staleTime: 30_000,
  });

  // Same calls as the page's per-requirement artifacts section and the Artifacts tab, so a created artifact shows in all three.
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['requirement-artifacts-tree'] });
    queryClient.invalidateQueries({ queryKey: ['requirement-artifacts'] });
    queryClient.invalidateQueries({ queryKey: ['tenant-artifacts'] });
  };
  const create = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => (await apiClient.post('/artifacts', payload)).data,
    onSuccess: () => { refresh(); setCreating(null); },
  });
  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: Partial<TenantArtifact> }) => (await apiClient.put(`/artifacts/${id}`, patch)).data,
    onSuccess: () => { refresh(); setEditing(null); },
  });

  const tenant = data?.artifacts ?? [];
  const madeFrom = new Map<number, TenantArtifact>();
  for (const a of tenant) if (a.catalog_item_id) madeFrom.set(a.catalog_item_id, a);
  return {
    data, isLoading, creating, setCreating, editing, setEditing, create, update,
    catalog: data?.catalog ?? [],
    orphans: tenant.filter((a) => !a.catalog_item_id),
    madeFor: (item: CatalogRow) => madeFrom.get(item.id),
  };
}

function Statement({ text }: { text: string }) {
  const [more, setMore] = useState(false);
  const long = text.length > 260;
  return (
    <div data-testid="req-statement">
      <p className={`whitespace-pre-line break-words text-sm text-slate-700 ${long && !more ? 'line-clamp-3' : ''}`}>{text}</p>
      {long && (
        <button type="button" aria-expanded={more} onClick={() => setMore((v) => !v)} className={`mt-0.5 rounded text-xs font-medium text-[#0f766e] hover:underline ${FOCUS}`}>
          {more ? 'less' : 'more'}
        </button>
      )}
    </div>
  );
}

/** The points printed under a sub-control, as deep as the standard prints them. */
function PointList({ points }: { points: PointNode[] }) {
  return (
    <ul className="mt-1 space-y-0.5">
      {points.map((point, i) => (
        <li key={i}>
          <div className="flex items-start gap-1.5">
            <span className="min-w-[1.25rem] shrink-0 text-right text-sm text-slate-500">{point.label}</span>
            <span className="min-w-0 break-words text-sm text-slate-700">{point.text}</span>
          </div>
          {point.points && point.points.length > 0 && <div className="ml-6 max-sm:ml-3"><PointList points={point.points} /></div>}
        </li>
      ))}
    </ul>
  );
}

/** The picker that changes a sub-control's owners: the control modal's (search, several people) and Save; nobody chosen reads Withdraw. */
function OwnerEditor({ id, users, initial, saving, error, onSave, onCancel }: {
  id: string;
  users: PageUser[];
  initial: number[];
  saving: boolean;
  error: string | null;
  onSave: (ids: number[]) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<number[]>(initial);
  const items = useMemo(() => users.map((u) => ({ value: String(u.id), label: userName(u), subLabel: u.email || undefined })), [users]);
  const selected = useMemo(() => draft.map(String), [draft]);
  const dirty = draft.length !== initial.length || draft.some((uid) => !initial.includes(uid));
  return (
    <div id={id} data-testid="subcontrol-owner-editor" onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }} className="basis-full space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="min-w-0 max-w-xs flex-1 basis-[11rem]">
          <MultiSelectDropdown
            title="Owners"
            items={items}
            selectedValues={selected}
            onApply={(values) => setDraft(values.map(Number))}
            multiSelect
            autoApply
            forceSearch
            triggerVariant="input"
            triggerClassName="w-full"
            placeholder={draft.length === 0 ? 'Select users' : `${draft.length} selected`}
            searchPlaceholder="Search users"
            size="sm"
          />
        </div>
        <button type="button" onClick={() => onSave(draft)} disabled={!dirty || saving} className={MINI_PRIMARY}>
          {saving && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
          <span className="text-[11px] font-medium leading-4">{draft.length === 0 ? 'Withdraw' : 'Save'}</span>
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className={`${MINI} h-8 px-3`}>
          <span className="text-[11px] font-medium leading-4">Cancel</span>
        </button>
      </div>
      {error && <p role="alert" className="text-[11px] leading-4 text-rose-700">{error}</p>}
    </div>
  );
}

/** Who owns a sub-control, and the button that opens the picker (people who may not edit see the owners only). */
function OwnerTools({ control, node, journeyId, users, owners, canAssign }: {
  control: CertificationControl;
  node: SubControlNode;
  journeyId: number;
  users: PageUser[];
  owners: Owner[];
  canAssign: boolean;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const assign = useMutation({
    mutationFn: async (ids: number[]) => (await certificationsApi.assignSubControl(journeyId, control.id, node.code, ids)).data,
    // handed back, so the picker says it is saving until the list carries the new owners
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['certification-controls', journeyId] }),
  });
  if (owners.length === 0 && !canAssign) return null;
  const editorId = `sc-owners-${control.id}-${node.number}`;
  const has = owners.length > 0;
  const close = () => { setEditing(false); opener.current?.focus(); };
  return (
    <>
      <span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-1">
        <span className="text-[11px] leading-4 text-[#586472]">{owners.length > 1 ? 'Owners' : 'Owner'}</span>
        {owners.map((o) => <OwnerChip key={o.id} name={o.name} />)}
        {canAssign && (
          <button
            ref={opener}
            type="button"
            data-testid="subcontrol-assign"
            aria-expanded={editing}
            aria-controls={editorId}
            aria-label={`${has ? 'Edit' : 'Assign'} owners of ${node.code}`}
            onClick={() => { assign.reset(); setEditing((v) => !v); }}
            className={`${MINI} h-6 px-2`}
          >
            {has ? <Pencil className="h-3 w-3" aria-hidden /> : <UserPlus className="h-3 w-3" aria-hidden />}
            <span className="text-[11px] font-medium leading-4">{has ? 'Edit' : 'Assign'}</span>
          </button>
        )}
      </span>
      {editing && (
        <OwnerEditor
          id={editorId}
          users={users}
          initial={ownerIdsOf(node)}
          saving={assign.isPending}
          error={assign.isError ? apiErrorText(assign.error, 'Could not save the owners') : null}
          onSave={(ids) => assign.mutate(ids, { onSuccess: close })}
          onCancel={close}
        />
      )}
    </>
  );
}

/** A file attached to a sub-control: its name (opening it in Evidence Management when the library holds it), review status, AI rating, day. */
function Attachment({ file }: { file: ControlEvidence }) {
  const name = file.file_name || 'Evidence file';
  const at = parseUtc(file.uploaded_at);
  return (
    <li data-testid="subcontrol-attachment" data-evidence-id={file.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Paperclip className="h-3 w-3 shrink-0 text-[#586472]" aria-hidden />
      {file.linked_evidence_id ? (
        <Link href={`/evidence/${file.linked_evidence_id}`} title="Open evidence detail" className={`min-w-0 break-all rounded text-[11px] font-medium leading-4 text-[#0f5f55] hover:underline max-sm:[word-break:normal] max-sm:break-words ${FOCUS}`}>
          {name}
        </Link>
      ) : (
        <span className="min-w-0 break-all text-[11px] leading-4 text-[#26323d] max-sm:[word-break:normal] max-sm:break-words">{name}</span>
      )}
      <ReviewChip status={file.review_status} />
      {file.linked_evidence_id ? <EvidenceMaturity evidenceId={file.linked_evidence_id} refresh={['certification-controls']} /> : null}
      {at && <time dateTime={at.toISOString()} title={at.toLocaleString()} className="text-[10px] leading-4 text-[#586472]">{at.toLocaleDateString()}</time>}
    </li>
  );
}

/** "1 of 2 evidence", the Upload button (the control's own upload with this sub-control's code) and the files attached to the sub-control. */
function EvidenceTools({ control, node, journeyId, files, canUpload }: {
  control: CertificationControl;
  node: SubControlNode;
  journeyId: number;
  files: ControlEvidence[];
  canUpload: boolean;
}) {
  const queryClient = useQueryClient();
  const picker = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      form.append('sub_control_code', node.code);
      return (await certificationsApi.uploadEvidence(journeyId, control.id, form)).data;
    },
    // handed back, so the button says it is working until the list carries the new file
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ['certification-controls', journeyId] }),
      queryClient.invalidateQueries({ queryKey: ['certification-progress', journeyId] }),
    ]),
  });
  const count = evidenceCountLabel(evidenceCountOf(control, node));
  const choose = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) upload.mutate(file);
    e.target.value = '';
  };
  return (
    <>
      {(count || canUpload) && (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {count && <span data-testid="subcontrol-evidence-count" className="text-[11px] leading-4 text-[#586472]">{count}</span>}
          {canUpload && (
            <>
              <input ref={picker} type="file" className="hidden" tabIndex={-1} aria-hidden onChange={choose} />
              <button
                type="button"
                data-testid="subcontrol-upload"
                aria-label={`Upload evidence for ${node.code}`}
                disabled={upload.isPending}
                onClick={() => picker.current?.click()}
                className={`${MINI} h-6 px-2`}
              >
                {upload.isPending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Upload className="h-3 w-3" aria-hidden />}
                <span className="text-[11px] font-medium leading-4">{upload.isPending ? 'Uploading' : 'Upload'}</span>
              </button>
            </>
          )}
        </span>
      )}
      {upload.isError && <p role="alert" className="basis-full text-[11px] leading-4 text-rose-700">{apiErrorText(upload.error, 'Could not upload the file')}</p>}
      {files.length > 0 && (
        <ul aria-label={`Evidence attached to ${node.code}`} className="basis-full space-y-1">
          {files.map((file) => <Attachment key={file.id} file={file} />)}
        </ul>
      )}
    </>
  );
}

function SubControlRow({ control, node, text, met, evidence, artifacts, journeyId, users, canAssign, canUpload, onTick }: {
  control: CertificationControl;
  node: SubControlNode;
  text: string;
  met: boolean;
  evidence: EvidenceChip[];
  artifacts: ReactNode[];
  journeyId: number;
  users: PageUser[];
  canAssign: boolean;
  canUpload: boolean;
  onTick: () => void;
}) {
  const tickable = isTickable(node);
  const inputId = `sc-${control.id}-${node.number}`;
  const owners = ownersOf(node, users);
  const files = attachmentsOf(control, node);
  const body = (
    <>
      <span className="mr-1.5 break-all font-mono text-xs text-slate-500">{node.code}</span>
      <span className="break-words text-sm text-slate-800">{text}</span>
    </>
  );
  return (
    <li data-testid="req-subcontrol" data-code={node.code} data-met={tickable ? String(met) : undefined} className="flex items-start gap-2.5">
      {tickable ? (
        <input id={inputId} type="checkbox" checked={met} onChange={onTick} className={`mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded accent-emerald-600 ${FOCUS}`} />
      ) : (
        <span aria-hidden className="mt-0.5 w-4 shrink-0 text-center text-sm leading-5 text-slate-500">•</span>
      )}
      <div className="min-w-0 flex-1">
        {tickable ? <label htmlFor={inputId} className="block cursor-pointer">{body}</label> : <div>{body}</div>}
        {node.points.length > 0 && <PointList points={node.points} />}
        {/* Below `sm` the chips and tools start under the tick (1rem + the 0.625rem gap of the row) and use the whole row. */}
        <div className="mt-1 flex flex-wrap items-center gap-1.5 max-sm:-ml-[1.625rem]">
          <RowStatusChip status={rowStatus(met, owners.length, files.length)} />
          <PriorityChip tier={control.priority_tier} muted />
          <ApplicabilityChip text={control.applicability} muted />
          {evidence.map((chip) => <EvidenceChipView key={chip.name} chip={chip} />)}
          {artifacts}
        </div>
        <div data-testid="subcontrol-tools" className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 max-sm:-ml-[1.625rem] empty:hidden">
          <OwnerTools control={control} node={node} journeyId={journeyId} users={users} owners={owners} canAssign={canAssign} />
          <EvidenceTools control={control} node={node} journeyId={journeyId} files={files} canUpload={canUpload} />
        </div>
      </div>
    </li>
  );
}

export default function ControlDetail({ control, id, journeyId, criteriaState, onToggleCriterion, frameworkLabel, users }: {
  control: CertificationControl;
  id: string;
  journeyId: number;
  criteriaState: Record<number, Record<string, boolean>>;
  onToggleCriterion: (control: CertificationControl, index: number) => void;
  frameworkLabel: string;
  users: PageUser[];
}) {
  // The control modal's rules for its Assign (edit) and Upload (create) buttons.
  const { hasPermission } = usePermissions();
  const canAssign = hasPermission('frameworks:framework_library:edit');
  const canUpload = hasPermission('frameworks:framework_library:create');
  const nodes = subControlsOf(control);
  const subCodes = nodes.map((n) => n.code);
  const status = statusOf(control, criteriaState);
  const art = useControlArtifacts(Array.from(new Set([control.control_code, control.original_control_code || '', ...subCodes])).filter(Boolean), frameworkLabel);

  const fromCatalog = placeCatalog(art.catalog, subCodes);
  const fromTenant = placeCatalog(art.orphans.map((a) => ({ ...a, sub_controls: refTokens(a.control_ref) })), subCodes);
  const catalogChip = (item: CatalogRow) => {
    const made = art.madeFor(item);
    return <ArtifactChipView key={`c${item.id}`} name={item.name} type={item.artifact_type} created={!!made} onClick={() => (made ? art.setEditing(made) : art.setCreating(item))} />;
  };
  const tenantChip = (a: TenantArtifact) => <ArtifactChipView key={`t${a.id}`} name={a.name} type={a.artifact_type} created onClick={() => art.setEditing(a)} />;
  const controlArtifacts = [...fromCatalog.controlLevel.map(catalogChip), ...fromTenant.controlLevel.map(tenantChip)];

  const controlEvidence = controlEvidenceOf(control);

  const statement = (control.control_statement || '').trim();
  const showStatement = !!statement && !nodes.some((n) => n.text.trim() === statement);   // not twice, when the sub-control is the statement
  const tenantUsers = users.map((u) => ({ id: u.id, label: u.display_name || u.email || String(u.id), email: u.email ?? null }));

  return (
    <div id={id} data-testid="req-control-detail" className="space-y-4 rounded-b-xl border-t border-slate-200 bg-[#fafbfb] px-3 py-3 sm:px-4 max-sm:px-2">
      {showStatement && <Statement text={statement} />}

      {nodes.length > 0 && (
        <section aria-label="Sub-controls">
          <div className="mb-1.5 flex items-center gap-2">
            <h4 className={LABEL}>Sub-controls</h4>
            <span className="text-[11px] text-slate-500">{nodes.length}</span>
            {art.isLoading && <Loader2 className="h-3 w-3 animate-spin text-slate-500" aria-label="Loading artifacts" />}
          </div>
          <div className="space-y-3">
            {leadInGroups(nodes).map((group, gi) => (
              <div key={gi}>
                {group.leadIn && <p data-testid="req-leadin" className="mb-1.5 text-sm font-medium text-slate-800">{group.leadIn}</p>}
                <ul className={group.leadIn ? 'space-y-2 border-l-2 border-emerald-100 pl-3 max-sm:border-l-0 max-sm:pl-0' : 'space-y-2'}>
                  {group.rows.map(({ node, text }) => (
                    <SubControlRow
                      key={node.code}
                      control={control}
                      node={node}
                      text={text}
                      met={isMet(node, status)}
                      evidence={evidenceOf(control, node)}
                      artifacts={[...(fromCatalog.byCode[node.code] ?? []).map(catalogChip), ...(fromTenant.byCode[node.code] ?? []).map(tenantChip)]}
                      journeyId={journeyId}
                      users={users}
                      canAssign={canAssign}
                      canUpload={canUpload}
                      onTick={() => node.criterion_index != null && onToggleCriterion(control, node.criterion_index)}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {controlEvidence.length > 0 && (
        <section aria-label="Control-level evidence" data-testid="req-control-evidence">
          <h4 className={`mb-1.5 ${LABEL}`}>{nodes.length > 0 ? 'Control-level evidence' : 'Evidence'}</h4>
          <div className="flex flex-wrap gap-1.5">{controlEvidence.map((chip) => <EvidenceChipView key={chip.name} chip={chip} />)}</div>
        </section>
      )}

      {controlArtifacts.length > 0 && (
        <section aria-label="Artifacts" data-testid="req-control-artifacts">
          <h4 className={`mb-1.5 ${LABEL}`}>Artifacts</h4>
          <div className="flex flex-wrap gap-1.5">{controlArtifacts}</div>
        </section>
      )}

      {control.implementation_guidance && (
        <details data-testid="req-guidance" className="rounded-lg border border-emerald-100 bg-[#f7fbfa]">
          <summary className={`cursor-pointer select-none rounded-lg px-3 py-2 text-xs font-medium text-slate-700 ${FOCUS}`}>
            Implementation guidance — for information only
          </summary>
          <div className="whitespace-pre-line break-words border-t border-emerald-100 px-3 py-2 text-sm text-slate-700">{control.implementation_guidance}</div>
        </details>
      )}

      {art.creating && art.data?.framework_key && (
        <CreateArtifactModal
          item={art.creating}
          frameworkKey={art.data.framework_key}
          frameworkName={art.data.framework_name || frameworkLabel}
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
      {(art.create.isError || art.update.isError) && (
        <p className="text-xs text-rose-700">Could not save the artifact. Please try again.</p>
      )}
    </div>
  );
}
