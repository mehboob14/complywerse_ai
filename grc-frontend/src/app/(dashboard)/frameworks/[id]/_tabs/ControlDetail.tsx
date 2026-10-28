'use client';

/**
 * What an open control shows in the hierarchical Requirements view: its statement, its sub-controls (a tick for each one that is a
 * criterion, the points printed under it, the evidence and artifacts it needs), what the control as a whole needs, and the standard's
 * implementation guidance. It is mounted only while the control is open, and then asks once for the control's artifacts
 * (/artifacts/by-control with the control's code and all its sub-controls' codes); each artifact is shown under the sub-controls its
 * `sub_controls` names, and under the control when it names none. Creating and opening an artifact are the page's own modals.
 */
import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import apiClient from '@/lib/api';
import { CreateArtifactModal, EditArtifactModal, type CatalogItem, type TenantArtifact } from '@/components/compliance/ArtifactsTab';
import type { CertificationControl, PointNode, SubControlNode } from '@/types';
import { ApplicabilityChip, ArtifactChipView, EvidenceChipView, FOCUS, PriorityChip } from './RequirementChips';
import { controlEvidenceOf, evidenceOf, isMet, isTickable, leadInGroups, placeCatalog, statusOf, subControlsOf, type EvidenceChip } from './requirementTree';

type CatalogRow = CatalogItem & { sub_controls?: string[] | null };

interface ByControl {
  framework_key: string | null;
  framework_name?: string | null;
  control_ref: string;
  catalog: CatalogRow[];
  artifacts: TenantArtifact[];
}

/** The tenant users as the page holds them. */
export interface PageUser { id: number; display_name?: string | null; email?: string | null }

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
          {point.points && point.points.length > 0 && <div className="ml-6"><PointList points={point.points} /></div>}
        </li>
      ))}
    </ul>
  );
}

function SubControlRow({ control, node, text, met, evidence, artifacts, onTick }: {
  control: CertificationControl;
  node: SubControlNode;
  text: string;
  met: boolean;
  evidence: EvidenceChip[];
  artifacts: ReactNode[];
  onTick: () => void;
}) {
  const tickable = isTickable(node);
  const inputId = `sc-${control.id}-${node.number}`;
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
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <PriorityChip tier={control.priority_tier} muted />
          <ApplicabilityChip text={control.applicability} muted />
          {evidence.map((chip) => <EvidenceChipView key={chip.name} chip={chip} />)}
          {artifacts}
        </div>
      </div>
    </li>
  );
}

export default function ControlDetail({ control, id, criteriaState, onToggleCriterion, frameworkLabel, users }: {
  control: CertificationControl;
  id: string;
  criteriaState: Record<number, Record<string, boolean>>;
  onToggleCriterion: (control: CertificationControl, index: number) => void;
  frameworkLabel: string;
  users: PageUser[];
}) {
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
    <div id={id} data-testid="req-control-detail" className="space-y-4 rounded-b-xl border-t border-slate-200 bg-[#fafbfb] px-3 py-3 sm:px-4">
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
                <ul className={group.leadIn ? 'space-y-2 border-l-2 border-emerald-100 pl-3' : 'space-y-2'}>
                  {group.rows.map(({ node, text }) => (
                    <SubControlRow
                      key={node.code}
                      control={control}
                      node={node}
                      text={text}
                      met={isMet(node, status)}
                      evidence={evidenceOf(control, node)}
                      artifacts={[...(fromCatalog.byCode[node.code] ?? []).map(catalogChip), ...(fromTenant.byCode[node.code] ?? []).map(tenantChip)]}
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
