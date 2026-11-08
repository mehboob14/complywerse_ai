'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { ChevronDown, ChevronRight, Eye, FileText, Loader2, Package, Plus } from 'lucide-react';
import { CertificationControl } from '@/types';
import {
  CreateArtifactModal,
  EditArtifactModal,
  type CatalogItem as ArtifactCatalogItemT,
  type TenantArtifact as TenantArtifactT,
  type TenantUser as ArtifactTenantUserT,
} from '@/components/compliance/ArtifactsTab';

// ---------------------------------------------------------------------------
// RequirementArtifactsSection
//
// Inline per-requirement view of compliance artifacts: catalog items the
// framework recommends for this specific clause, plus any tenant artifacts
// already created against it. Lets the user create a tenant artifact from a
// catalog template without leaving the requirement row.
//
// Hidden when:
//   - The framework has no artifact catalog (e.g. NCA, custom uploads)
//   - The catalog has no entries matching this clause's control_ref
//
// Backend filters with token-equal matching on control_ref strings — see
// `_ref_matches_any()` in artifacts_router.py.
// ---------------------------------------------------------------------------

export default function RequirementArtifactsSection({
  control,
  frameworkLabel,
  tenantUsers,
}: {
  control: CertificationControl;
  frameworkLabel: string;
  tenantUsers: ArtifactTenantUserT[];
}) {
  const queryClient = useQueryClient();
  // Collapsed by default — only fetch + render when the user explicitly opens
  // the section. Avoids fan-out queries when many requirement rows are
  // expanded for evidence/applicability work.
  const [isOpen, setIsOpen] = useState(false);

  // Modal state: a catalog item triggers Create modal; an existing tenant
  // artifact triggers the Edit modal. Same modals as the dedicated
  // Artifacts tab so behaviour, download, upload, edit are all identical.
  const [creatingFromCatalog, setCreatingFromCatalog] = useState<ArtifactCatalogItemT | null>(null);
  const [editingArtifact, setEditingArtifact] = useState<TenantArtifactT | null>(null);

  // Build the comma-separated reference string for the backend filter. The
  // requirement may carry multiple identifiers (original/system codes) —
  // try them all so a catalog ref like "Cl. 5.1 / A.5.1" still matches.
  const refTokens = useMemo(() => {
    const tokens: string[] = [];
    const candidates = [
      (control as any).original_control_code,
      (control as any).system_control_code,
      (control as any).control_code,
      (control as any).original_reference,
    ];
    for (const c of candidates) {
      if (c && typeof c === 'string' && !tokens.includes(c)) tokens.push(c);
    }
    return tokens;
  }, [control]);

  const enabled = isOpen && !!frameworkLabel && refTokens.length > 0;
  const queryKey = ['requirement-artifacts', frameworkLabel, refTokens.join(',')];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await apiClient.get('/artifacts/by-control', {
        params: {
          assessment_type: frameworkLabel,
          control_ref: refTokens.join(','),
        },
      });
      return res.data as {
        framework_key: string | null;
        framework_name?: string | null;
        control_ref: string;
        catalog: ArtifactCatalogItemT[];
        artifacts: TenantArtifactT[];
      };
    },
    enabled,
    staleTime: 30_000,
  });

  // Same wire payload as the existing Artifacts tab → same backend → same
  // result, so nothing about creation behaviour drifts between the two
  // surfaces.
  const createMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await apiClient.post('/artifacts', payload);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      // Also refresh the dedicated Artifacts tab (its own query key is
      // ['tenant-artifacts', ...] — invalidate the prefix to cover all
      // assessment ids).
      queryClient.invalidateQueries({ queryKey: ['tenant-artifacts'] });
      setCreatingFromCatalog(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data: patch }: { id: number; data: Partial<TenantArtifactT> }) => {
      const res = await apiClient.put(`/artifacts/${id}`, patch);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['tenant-artifacts'] });
      setEditingArtifact(null);
    },
  });

  const realCatalog = data?.catalog || [];
  const artifacts = data?.artifacts || [];

  // Virtual catalog items derived from the requirement's own
  // evidence_requirements field. Ensures every requirement shows at least
  // N artifact slots, where N = number of expected evidence items — even
  // when the seeded artifact catalog has no entry for this clause. Virtual
  // items use negative ids so they never collide with real catalog ids,
  // and carry the same shape as ArtifactCatalogItemT so the existing
  // render loop and Create modal accept them unchanged.
  // Framework JSON shape is { name, description, filetype } per evidence
  // requirement (see seed_data/frameworks/*.json). Older drafts used
  // title/type/format — accept both so we don't silently regress on any
  // framework whose seed data hasn't been migrated yet.
  const evidenceReqs = ((control as any).evidence_requirements || []) as Array<{
    name?: string;
    title?: string;
    type?: string;
    description?: string;
    is_required?: boolean;
    format?: string;
    filetype?: string;
  }>;
  const realNames = new Set(
    realCatalog.map((c) => (c.name || '').toLowerCase().trim()).filter(Boolean),
  );
  // Evidence items a curated artifact already provides need no suggestion of their own.
  const providedNames = new Set(
    realCatalog.flatMap((c) => c.provides || []).map((n) => n.toLowerCase().trim()),
  );
  const refForVirtual = refTokens[0] || null;
  // Infer the artifact's logical type (Policy / Procedure / Register / ...)
  // from whatever signal we have — explicit `type`, the document name, or
  // the required filetype as a last resort. Without this, every evidence
  // item collapsed to "Evidence" because the seed JSON has no `type` key.
  const inferArtifactType = (typeHint?: string, nameHint?: string, fileHint?: string): string => {
    const combined = `${typeHint || ''} ${nameHint || ''}`.toLowerCase();
    if (combined.includes('policy')) return 'Policy';
    if (combined.includes('procedure')) return 'Procedure';
    if (combined.includes('register') || combined.includes('inventory')) return 'Register';
    if (combined.includes('matrix')) return 'Matrix';
    if (combined.includes('plan')) return 'Plan';
    if (combined.includes('contract') || combined.includes('agreement') || combined.includes('nda')) return 'Contract';
    if (combined.includes('attest') || combined.includes('acknowledg')) return 'Attestation';
    if (combined.includes('config')) return 'Configuration';
    if (combined.includes('screenshot')) return 'Screenshot';
    if (combined.includes('training') || combined.includes('awareness')) return 'Training Record';
    if (combined.includes('audit') || combined.includes('assessment')) return 'Assessment';
    if (combined.includes('report')) return 'Report';
    if (combined.includes('log')) return 'Log';
    if (combined.includes('minute') || combined.includes('email') || (fileHint || '').toUpperCase() === 'EML') return 'Record/Log';
    if (combined.includes('certificate')) return 'Evidence';
    // Sensible defaults by filetype if name didn't help.
    const ft = (fileHint || '').toUpperCase();
    if (ft === 'XLSX') return 'Register';
    if (ft === 'EML') return 'Record/Log';
    return 'Evidence';
  };
  const virtualCatalog: ArtifactCatalogItemT[] = evidenceReqs
    .filter((ev) => {
      const name = ((ev.name ?? ev.title) || '').toLowerCase().trim();
      return name && !realNames.has(name) && !providedNames.has(name);
    })
    .map((ev, idx) => {
      const fileType = (ev.filetype || ev.format || 'DOCX').toUpperCase();
      const docName = (ev.name ?? ev.title ?? `Evidence ${idx + 1}`).trim();
      return {
        id: -(idx + 1),
        artifact_id: `virtual_${idx + 1}`,
        stage: 'Auto-suggested',
        stage_number: null,
        name: docName,
        artifact_type: inferArtifactType(ev.type, docName, fileType),
        control_ref: refForVirtual,
        mandatory: !!ev.is_required,
        description: ev.description || '',
        format: fileType,
        owner: '',
        is_platform_native: false,
        platform_data_type: null,
      };
    });

  // Final catalog the section renders: real seeded items first (best
  // curated), then virtual items filling any evidence-requirement gaps.
  const catalog: ArtifactCatalogItemT[] = [...realCatalog, ...virtualCatalog];

  // Map catalog id → already-created tenant artifact (if any), so each
  // catalog row can show "Create" or "View" inline. Real items match by
  // catalog_item_id; virtual items match by normalized name + control_ref
  // because they have no FK link.
  const createdByCatalogId = new Map<number, TenantArtifactT>();
  for (const a of artifacts) {
    if (a.catalog_item_id) createdByCatalogId.set(a.catalog_item_id, a);
  }
  const orphanArtifacts = artifacts.filter((a) => !a.catalog_item_id);
  const createdByVirtualKey = new Map<string, TenantArtifactT>();
  for (const a of orphanArtifacts) {
    const key = `${(a.name || '').toLowerCase().trim()}|${(a.control_ref || '').toLowerCase()}`;
    if (key.trim()) createdByVirtualKey.set(key, a);
  }
  const isCreated = (item: ArtifactCatalogItemT): TenantArtifactT | undefined => {
    if (item.id > 0) return createdByCatalogId.get(item.id);
    const key = `${(item.name || '').toLowerCase().trim()}|${(item.control_ref || '').toLowerCase()}`;
    return createdByVirtualKey.get(key);
  };

  const summary = isOpen
    ? `${catalog.length} expected${artifacts.length > 0 ? `, ${artifacts.length} created` : ''}`
    : 'Click to view';

  return (
    <div className="mb-6 rounded-lg border border-primary-200 bg-primary-50/40">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-primary-100/60 rounded-lg"
        aria-expanded={isOpen}
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-primary-800">
          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <Package className="h-4 w-4 text-primary-700" />
          Compliance Artifacts
          <span className="text-xs font-normal text-primary-700">({summary})</span>
        </span>
        {isOpen && isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary-700" />}
      </button>

      {isOpen && (
        <div className="border-t border-primary-200 p-3 space-y-3">
          {!isLoading && catalog.length === 0 && artifacts.length === 0 && (
            <p className="text-xs text-slate-600 italic">
              No artifact catalog entries match this requirement{frameworkLabel ? ` for ${frameworkLabel}` : ''}.
            </p>
          )}

          {catalog.length > 0 && (
            <ul className="space-y-1">
              {catalog.map((item) => {
                const created = isCreated(item);
                // Tighter layout: text column is shrink-allowed and the
                // button sits directly next to it instead of being
                // shoved to the far right with a stretch-fill. Removes
                // the dead whitespace called out in the screenshot.
                return (
                  <li
                    key={item.id}
                    className={`group flex items-center gap-3 rounded-md border px-3 py-1.5 transition-colors ${
                      created
                        ? 'border-emerald-200 bg-emerald-50/40 hover:bg-emerald-50/70'
                        : 'border-primary-200 bg-white hover:bg-primary-50/40'
                    }`}
                  >
                    <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md ${created ? 'bg-emerald-100 text-emerald-700' : 'bg-primary-100 text-primary-700'}`}>
                      <FileText className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-shrink">
                      <div className="flex items-center gap-1.5 flex-wrap leading-tight">
                        <span className="text-sm font-medium text-slate-900 truncate">{item.name}</span>
                        {item.mandatory && (
                          <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700">
                            Mandatory
                          </span>
                        )}
                        {item.is_platform_native && (
                          <span className="rounded bg-primary-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-700">
                            Platform
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-500">
                        <span className="capitalize">{item.artifact_type}</span>
                        {item.control_ref && <span className="font-mono">· {item.control_ref}</span>}
                        {item.stage && <span>· {item.stage}</span>}
                        {item.format && <span>· {item.format}</span>}
                      </div>
                    </div>
                    {/* The mr-auto spacer was eating the whole row; now
                        the button is on a flex item with ml-auto so it
                        hugs the right edge but the text container can
                        grow naturally without the trailing gap. */}
                    <div className="ml-auto flex-shrink-0">
                      {created ? (
                        <button
                          type="button"
                          onClick={() => setEditingArtifact(created)}
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 shadow-sm"
                          title="View / edit / download / upload"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          View
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setCreatingFromCatalog(item)}
                          className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-2.5 py-1 text-xs font-medium text-[color:var(--color-on-base,#0a0a0a)] hover:bg-primary-700 shadow-sm"
                        >
                          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                          Create
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Tenant artifacts not linked to a catalog item (manually created) —
              surface them too so a user who added something custom for this
              requirement can still see it here. Click to open the same
              edit/download/upload modal. */}
          {orphanArtifacts.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-primary-700 mb-1.5">Other artifacts</p>
              <ul className="space-y-1">
                {orphanArtifacts.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => setEditingArtifact(a)}
                      className="w-full flex items-center gap-2 rounded-md border border-primary-200 bg-white px-3 py-1.5 text-xs text-left hover:bg-primary-50"
                    >
                      <FileText className="h-3.5 w-3.5 text-primary-600" />
                      <span className="text-slate-900 flex-1 truncate">{a.name}</span>
                      <span className="text-slate-500 capitalize">{a.artifact_type}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] ${
                        a.status === 'approved' ? 'bg-emerald-100 text-emerald-700'
                        : a.status === 'in_review' ? 'bg-amber-100 text-amber-700'
                        : 'bg-slate-100 text-slate-700'
                      }`}>{a.status}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {createMutation.isError && (
            <p className="text-xs text-rose-700">
              Could not create artifact: {(createMutation.error as any)?.response?.data?.detail || 'Please try again.'}
            </p>
          )}
          {updateMutation.isError && (
            <p className="text-xs text-rose-700">
              Could not save changes: {(updateMutation.error as any)?.response?.data?.detail || 'Please try again.'}
            </p>
          )}
        </div>
      )}

      {/* Reuse the exact same modals the Artifacts tab uses, so the create
          and edit/download/upload flows are identical across surfaces. */}
      {creatingFromCatalog && data?.framework_key && (
        <CreateArtifactModal
          item={creatingFromCatalog}
          frameworkKey={data.framework_key}
          frameworkName={data.framework_name || frameworkLabel}
          tenantUsers={tenantUsers}
          onConfirm={(payload) => createMutation.mutate(payload)}
          onClose={() => setCreatingFromCatalog(null)}
          isPending={createMutation.isPending}
        />
      )}
      {editingArtifact && (
        <EditArtifactModal
          artifact={editingArtifact}
          tenantUsers={tenantUsers}
          onSave={(patch) => updateMutation.mutate({ id: editingArtifact.id, data: patch })}
          onClose={() => setEditingArtifact(null)}
          isPending={updateMutation.isPending}
        />
      )}
    </div>
  );
}
