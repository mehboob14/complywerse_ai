'use client';

import { Fragment, useState, useEffect, useRef, useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { certificationsApi, governanceApi, assetsApi, evidenceApi } from '@/lib/api';
import apiClient from '@/lib/api';
import { FrameworkChartsOverview } from '../_components/FrameworkChartsOverview';
import { usePermissions } from '@/hooks/usePermissions';
import { CertificationJourney, ControlImplementation, ProgressSummary, CertificationControl, SubControlWithEvidence, ControlEvidence, ITAsset } from '@/types';
import ControlImplementationModal from '@/components/ControlImplementationModal';
import EvidenceViewer from '@/components/evidence/EvidenceViewer';
import { SearchInput, MultiSelectDropdown, PageLoader, InlineLinkPicker } from '@/components/ui';
import { InlineIssueBadge } from '@/components/issue-management/InlineIssueBadge';
import {
  Loader2,
  AlertCircle,
  Shield,
  ChevronRight,
  ChevronDown,
  Calendar,
  Target,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Play,
  Check,
  XCircle,
  ArrowLeft,
  Layers,
  FileText,
  Download,
  ExternalLink,
  MapPin,
  Building2,
  Users,
  Percent,
  Filter,
  ChevronUp,
  Circle,
  FileCheck,
  BookOpen,
  ClipboardCheck,
  GraduationCap,
  Eye,
  BarChart3,
  Settings,
  Upload,
  Plus,
  Minus,
  Award,
  TrendingUp,
  Radio,
  Paperclip,
  Sparkles,
  Trash2,
  CheckCircle,
  Unlink,
  Package,
  X,
} from 'lucide-react';
import ArtifactsTab, {
  CreateArtifactModal,
  EditArtifactModal,
  type CatalogItem as ArtifactCatalogItemT,
  type TenantArtifact as TenantArtifactT,
  type TenantUser as ArtifactTenantUserT,
} from '@/components/compliance/ArtifactsTab';
import FrameworkRegisterTab from './_tabs/FrameworkRegisterTab';
import FrameworkDocumentTab from './_tabs/FrameworkDocumentTab';

// Evidence-type markers are categorical labels, not statuses — so they render
// as neutral slate pills. Only the handful of types that carry genuine status
// meaning keep a semantic tone (risk → rose, certificate → emerald, recurring
// audit/access review → amber). Policy, the flagship artifact type, gets the
// single teal accent.
const EVIDENCE_TYPE_MAP: Record<string, { label: string; color: string }> = {
  policy: { label: 'Policy', color: 'bg-primary-50 text-primary-700' },
  procedure: { label: 'Procedure', color: 'bg-slate-100 text-slate-600' },
  screenshot: { label: 'Screenshot', color: 'bg-slate-100 text-slate-600' },
  audit: { label: 'Audit Log', color: 'bg-amber-50 text-amber-700' },
  log: { label: 'Log', color: 'bg-slate-100 text-slate-600' },
  training: { label: 'Training', color: 'bg-slate-100 text-slate-600' },
  risk: { label: 'Risk Assessment', color: 'bg-rose-50 text-rose-700' },
  access: { label: 'Access Review', color: 'bg-amber-50 text-amber-700' },
  config: { label: 'Configuration', color: 'bg-slate-100 text-slate-600' },
  report: { label: 'Report', color: 'bg-slate-100 text-slate-600' },
  certificate: { label: 'Certificate', color: 'bg-emerald-50 text-emerald-700' },
  contract: { label: 'Contract', color: 'bg-slate-100 text-slate-600' },
  register: { label: 'Register', color: 'bg-slate-100 text-slate-600' },
  inventory: { label: 'Inventory', color: 'bg-slate-100 text-slate-600' },
  plan: { label: 'Plan', color: 'bg-slate-100 text-slate-600' },
  matrix: { label: 'Matrix', color: 'bg-slate-100 text-slate-600' },
  list: { label: 'List', color: 'bg-slate-100 text-slate-600' },
};

const getEvidenceType = (recommendation: string): { label: string; color: string } => {
  const key = recommendation.toLowerCase();
  for (const [pattern, value] of Object.entries(EVIDENCE_TYPE_MAP)) {
    if (key.includes(pattern)) return value;
  }
  return { label: 'Document', color: 'bg-slate-100 text-slate-600' };
};

interface EvidenceRequirement {
  id: string;
  title: string;
  description: string;
  type: string;
  typeLabel: string;
  typeColor: string;
  frequency: string;
  isRequired: boolean;
}

const EVIDENCE_DETAILS: Record<string, { title: string; description: string; frequency: string; isRequired: boolean }> = {
  policy_document: { title: 'Policy Document', description: 'Approved and published policy document', frequency: 'annual', isRequired: true },
  procedure_document: { title: 'Procedure Document', description: 'Documented operational procedures', frequency: 'annual', isRequired: true },
  screenshot: { title: 'System Screenshot', description: 'Screenshot evidence of system configuration', frequency: 'quarterly', isRequired: false },
  audit_log: { title: 'Audit Log Records', description: 'System audit log exports showing activity', frequency: 'monthly', isRequired: true },
  configuration_export: { title: 'Configuration Export', description: 'System configuration settings export', frequency: 'quarterly', isRequired: true },
  training_record: { title: 'Training Records', description: 'Records of personnel training completion', frequency: 'annual', isRequired: true },
  risk_assessment: { title: 'Risk Assessment Report', description: 'Documented risk assessment results', frequency: 'annual', isRequired: true },
  penetration_test_report: { title: 'Penetration Test Report', description: 'External penetration testing results', frequency: 'annual', isRequired: true },
  vulnerability_scan: { title: 'Vulnerability Scan Results', description: 'Automated vulnerability scan output', frequency: 'quarterly', isRequired: true },
  access_review: { title: 'Access Review Records', description: 'Periodic access review documentation', frequency: 'quarterly', isRequired: true },
  change_request: { title: 'Change Request Records', description: 'Records of change requests', frequency: 'monthly', isRequired: true },
  incident_report: { title: 'Incident Reports', description: 'Security incident documentation', frequency: 'as_needed', isRequired: false },
  backup_log: { title: 'Backup Log Records', description: 'System backup verification logs', frequency: 'monthly', isRequired: true },
  encryption_certificate: { title: 'Encryption Certificate', description: 'Valid encryption/SSL certificate', frequency: 'annual', isRequired: true },
  contract: { title: 'Contract/Agreement', description: 'Signed contractual agreements', frequency: 'as_needed', isRequired: true },
  register: { title: 'Register/Inventory', description: 'Maintained register or inventory list', frequency: 'quarterly', isRequired: true },
  plan: { title: 'Management Plan', description: 'Documented management or response plan', frequency: 'annual', isRequired: true },
  matrix: { title: 'Responsibility Matrix', description: 'Roles and responsibilities matrix', frequency: 'annual', isRequired: true },
  meeting_minutes: { title: 'Meeting Minutes', description: 'Meeting records and minutes', frequency: 'monthly', isRequired: false },
  acknowledgment: { title: 'Acknowledgment Records', description: 'Signed acknowledgment forms', frequency: 'annual', isRequired: true },
  job_description: { title: 'Job Descriptions', description: 'Role-specific job descriptions', frequency: 'annual', isRequired: false },
  org_chart: { title: 'Organizational Chart', description: 'Current organizational structure', frequency: 'annual', isRequired: false },
};

const getEvidenceRequirements = (controlName: string, evidenceRecs: string[]): EvidenceRequirement[] => {
  return evidenceRecs.map((rec, idx) => {
    const key = rec.toLowerCase().replace(/-/g, '_');
    const details = EVIDENCE_DETAILS[key] || {
      title: rec.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      description: `Documentation for ${rec.replace(/_/g, ' ')}`,
      frequency: 'annual',
      isRequired: true
    };
    const evType = getEvidenceType(rec);
    return {
      id: `${rec}-${idx}`,
      title: details.title,
      description: details.description,
      type: rec,
      typeLabel: evType.label,
      typeColor: evType.color,
      frequency: details.frequency,
      isRequired: details.isRequired
    };
  });
};

const getCategoryFromDomain = (domainName: string): string => {
  const name = domainName?.toLowerCase() || '';
  if (name.includes('organizational')) return 'Organizational';
  if (name.includes('people')) return 'People';
  if (name.includes('physical')) return 'Physical';
  if (name.includes('technological')) return 'Technological';
  return 'Other';
};

type CategoryFilter = 'all' | 'organizational' | 'people' | 'physical' | 'technological';
type StatusFilter = 'all' | 'implemented' | 'not_implemented' | 'partial' | 'in_progress' | 'verified';
type SortOrder = 'asc' | 'desc' | 'default';


const ANNEX_A_DOMAINS = [
  { id: 'A.5', name: 'Organizational Controls', controlCount: 37 },
  { id: 'A.6', name: 'People Controls', controlCount: 8 },
  { id: 'A.7', name: 'Physical Controls', controlCount: 14 },
  { id: 'A.8', name: 'Technological Controls', controlCount: 34 },
];

const stripCertificationPostfix = (value?: string): string => {
  if (!value) return '';
  return value.replace(/\s+certification\s*$/i, '').trim();
};

type TabType = 'overview' | 'phases' | 'controls' | string;
type ScopingSubTab = 'definition' | 'locations' | 'exclusions' | 'departments';
type SoaSubTab = 'controls' | 'summary' | 'export';
type ControlsSubTab = 'library' | 'policies' | 'evidence';

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

function RequirementArtifactsSection({
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
      return name && !realNames.has(name);
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

export default function CertificationJourneyPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const journeyId = parseInt(params.id as string);
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('frameworks:framework_library:create');
  const canEdit = hasPermission('frameworks:framework_library:edit');
  const canDelete = hasPermission('frameworks:framework_library:delete');
  
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [expandedPhases, setExpandedPhases] = useState<number[]>([1]);
  const [expandedDomains, setExpandedDomains] = useState<string[]>(['A.5']);
  const [scopingSubTab, setScopingSubTab] = useState<ScopingSubTab>('definition');
  const [soaSubTab, setSoaSubTab] = useState<SoaSubTab>('controls');
  const [controlsSubTab, setControlsSubTab] = useState<ControlsSubTab>('library');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDomain, setSelectedDomain] = useState<number | null>(null);
  const [selectedControl, setSelectedControl] = useState<ControlImplementation | null>(null);
  const [showControlModal, setShowControlModal] = useState(false);
  const [expandedControls, setExpandedControls] = useState<number[]>([]);
  // Spine-view modal: opens when the user clicks a requirement row in
  // the progress-spine layout. The modal renders the existing
  // renderControlAccordion forcibly expanded — so the upload-per-
  // recommendation, assign picker, artifacts section, and every other
  // feature stay identical to the legacy inline accordion.
  const [selectedSpineControl, setSelectedSpineControl] = useState<CertificationControl | null>(null);

  /**
   * Open/close the requirement modal AND mirror that selection into
   * the URL as `?req=<id>`. Critical for back-from-evidence-detail:
   * the browser captures the URL at click time, so `router.back()`
   * inside /evidence/[id] returns to /frameworks/<fwId>?req=<reqId>
   * and the page auto-reopens the modal on the same requirement.
   * Tab is forced to `controls` so the spine is what greets the user.
   */
  const openSpineControl = (control: CertificationControl | null) => {
    setSelectedSpineControl(control);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (control) {
      url.searchParams.set('req', String(control.id));
      url.searchParams.set('tab', 'controls');
    } else {
      url.searchParams.delete('req');
    }
    // replaceState keeps SPA navigation intact (no full reload) while
    // still updating the address bar — so back/forward see the state.
    window.history.replaceState({}, '', url.toString());
  };

  // Guarded ref-id for the spine auto-open effect declared below.
  // Lives up here next to the related state so the wiring is visible
  // even though the effect itself needs to sit after `controls` is
  // declared (TDZ).
  const spineAutoOpenedFor = useRef<number | null>(null);

  useEffect(() => {
    if (!selectedSpineControl) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') openSpineControl(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedSpineControl]);
  const [expandedSubControlKeys, setExpandedSubControlKeys] = useState<string[]>([]);
  const [expandedRequirementTextIds, setExpandedRequirementTextIds] = useState<number[]>([]);
  // Local override of per-control assessment-criteria check state (control.id -> {idx: met}).
  // Seeded from the API's criteria_status; toggling persists via PATCH.
  const [criteriaState, setCriteriaState] = useState<Record<number, Record<string, boolean>>>({});
  // Which dashboard tier+category dropdown is open, e.g. "P1:inprog". null = none.
  const [openTierCat, setOpenTierCat] = useState<string | null>(null);
  const toggleCriterion = (control: CertificationControl, idx: number) => {
    const current = criteriaState[control.id] ?? control.criteria_status ?? {};
    const next = { ...current, [String(idx)]: !current[String(idx)] };
    setCriteriaState((prev) => ({ ...prev, [control.id]: next }));
    apiClient
      .patch(`/certifications/${journeyId}/controls/${control.id}/criteria`, { criteria_status: next })
      .then(() => {
        // Refresh BOTH the controls list (checklist + dashboard) and the
        // progress payload that drives the top "your assessment" header
        // (compliant / in review / to start counts). Ticking criteria now
        // moves the control's status server-side, so the header must refetch
        // too — otherwise its numbers only update on a hard reload.
        queryClient.invalidateQueries({ queryKey: ['certification-controls', journeyId] });
        queryClient.invalidateQueries({ queryKey: ['certification-progress', journeyId] });
      })
      .catch(() => {
        // revert on failure
        setCriteriaState((prev) => ({ ...prev, [control.id]: current }));
      });
  };
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('default');
  const [uploadingControlId, setUploadingControlId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cardsCollapsed, setCardsCollapsed] = useState(false);
  const contentScrollRef = useRef<HTMLDivElement>(null);

  const { data: journey, isLoading: journeyLoading, error: journeyError } = useQuery({
    queryKey: ['certification', journeyId],
    queryFn: async () => {
      const response = await certificationsApi.getById(journeyId);
      console.info('[JourneyTrace] certification payload', {
        journeyId,
        frameworkName: response?.data?.framework_name,
        classification: (response?.data as any)?.framework_classification,
      });
      return response.data as CertificationJourney;
    },
  });

  const { data: controls, isLoading: controlsLoading } = useQuery({
    queryKey: ['certification-controls', journeyId],
    queryFn: async () => {
      const response = await certificationsApi.getControls(journeyId);
      console.info('[JourneyTrace] controls payload', {
        journeyId,
        totalControls: response?.data?.length || 0,
        sample: (response?.data || []).slice(0, 5).map((c: any) => ({
          id: c.id,
          code: c.control_code,
          evidenceRequirements: c.evidence_requirements?.length || 0,
          evidenceRecommendations: c.evidence_recommendations?.length || 0,
          subControls: c.sub_controls?.length || 0,
        })),
      });
      return response.data as CertificationControl[];
    },
    enabled: !!journeyId,
  });

  // Compliance history (annual snapshots).
  const { data: snapshots } = useQuery({
    queryKey: ['compliance-snapshots', journeyId],
    queryFn: async () => {
      const r = await apiClient.get(`/certifications/${journeyId}/snapshots`);
      return r.data as Array<{
        id: number; year: number | null; label: string | null; captured_at: string | null;
        overall_pct: number; compliant_count: number; total_count: number;
        breakdown: { tiers?: Record<string, { total: number; compliant: number; avg: number }>; domains?: Array<{ domain: string; total: number; compliant: number; avg: number }> };
        notes: string | null;
      }>;
    },
    enabled: !!journeyId,
  });
  const [capturingSnapshot, setCapturingSnapshot] = useState(false);
  const [openSnapshotId, setOpenSnapshotId] = useState<number | null>(null);
  const captureSnapshot = async () => {
    setCapturingSnapshot(true);
    try {
      const year = new Date().getFullYear();
      await apiClient.post(`/certifications/${journeyId}/snapshots`, {
        year,
        label: `${year} Assessment`,
      });
      await queryClient.invalidateQueries({ queryKey: ['compliance-snapshots', journeyId] });
    } finally {
      setCapturingSnapshot(false);
    }
  };

  // Auto-open the spine modal when arriving with `?req=<id>` in the URL.
  // This is what makes the back-button from /evidence/[id] land the
  // user on the exact requirement they came from: we mirror the modal
  // selection into the URL on open, so the browser captures it; coming
  // back via `router.back()` returns to /frameworks/<id>?req=<reqId>
  // and this effect re-opens the modal once `controls` resolves.
  // Matches by certification-control id OR parsed_control id so either
  // URL shape works. Guarded with `spineAutoOpenedFor` so a parent
  // re-render doesn't keep re-opening the same modal after the user
  // closes it.
  useEffect(() => {
    if (typeof window === 'undefined' || !controls || controls.length === 0) return;
    const sp = new URL(window.location.href).searchParams;
    const reqRaw = sp.get('req');
    if (!reqRaw) return;
    const reqId = Number(reqRaw);
    if (!Number.isFinite(reqId)) return;
    if (spineAutoOpenedFor.current === reqId) return;
    const match = (controls as CertificationControl[]).find(
      (c) => c.id === reqId || c.parsed_control_id === reqId,
    );
    if (!match) return;
    spineAutoOpenedFor.current = reqId;
    setActiveTab('controls');
    setSelectedSpineControl(match);
  }, [controls]);

  // Critical-clause AI analysis. Loaded lazily — the GET is cheap (DB read of
  // already-flagged rows) and powers the "Critical Items" panel; the POST
  // mutation re-runs GPT-4o classification across the framework's parsed
  // controls and persists results.
  const { data: criticalData } = useQuery({
    queryKey: ['critical-controls', journeyId],
    queryFn: async () => {
      const res = await certificationsApi.getCriticalControls(journeyId);
      return res.data as {
        framework_id: number | null;
        analyzed_at: string | null;
        items: Array<{
          parsed_control_id: number;
          control_code: string;
          title: string;
          domain?: string | null;
          category?: string | null;
          reason?: string | null;
        }>;
      };
    },
    enabled: !!journeyId,
  });

  const analyzeCriticalMutation = useMutation({
    mutationFn: async () => certificationsApi.analyzeCriticalControls(journeyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['critical-controls', journeyId] });
      // Controls list also carries `is_critical` per row — refresh it so badges appear.
      queryClient.invalidateQueries({ queryKey: ['certification-controls', journeyId] });
    },
  });

  const uploadEvidenceMutation = useMutation({
    mutationFn: async ({ controlId, file }: { controlId: number; file: File }) => {
      const formData = new FormData();
      formData.append('file', file);
      return certificationsApi.uploadEvidence(journeyId, controlId, formData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certification-controls', journeyId] });
      setUploadingControlId(null);
    },
    onError: () => {
      setUploadingControlId(null);
    }
  });

  const [assessingEvidenceId, setAssessingEvidenceId] = useState<number | null>(null);

  const assessEvidenceMutation = useMutation({
    mutationFn: async (evidenceId: number) => {
      return apiClient.post(`/evidence-mgmt/ai/${evidenceId}/assess?force_refresh=true`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certification-controls', journeyId] });
      setAssessingEvidenceId(null);
    },
    onError: () => {
      setAssessingEvidenceId(null);
    }
  });

  const [deletingEvidenceId, setDeletingEvidenceId] = useState<number | null>(null);
  // Evidence file currently shown in the in-browser preview modal.
  // Holds the minimal fields the shared viewer needs (path / name / type).
  const [previewEvidenceFile, setPreviewEvidenceFile] = useState<{ file_path: string; file_name: string; mime_type?: string | null; file_size?: number | null } | null>(null);

  const deleteEvidenceMutation = useMutation({
    mutationFn: async (ev: { id: number; item_type?: string; linked_evidence_id?: number }) => {
      if (ev.item_type === 'ecm' && ev.linked_evidence_id) {
        // ECM-sourced item: unlink via the evidence-mgmt endpoint
        return apiClient.delete(`/evidence-mgmt/links/${ev.linked_evidence_id}/controls/${ev.id}`);
      }
      // ImplementationEvidence item: unlink via the certifications endpoint
      return apiClient.delete(`/certifications/evidence/${ev.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certification-controls', journeyId] });
      setDeletingEvidenceId(null);
    },
    onError: () => {
      setDeletingEvidenceId(null);
    }
  });

  const reviewEvidenceMutation = useMutation({
    mutationFn: async ({ evidenceId, action }: { evidenceId: number; action: 'approve' | 'reject' }) => {
      return apiClient.put(`/certifications/evidence/${evidenceId}/review`, { action });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certification-controls', journeyId] });
    }
  });

  const [enhanceSuccess, setEnhanceSuccess] = useState<string | null>(null);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const [editingTargetDate, setEditingTargetDate] = useState(false);
  const [targetDateValue, setTargetDateValue] = useState('');
  const [generatingPhaseTasks, setGeneratingPhaseTasks] = useState(false);

  // Per-requirement assignment: lazy-fetched tenant users + current-user id.
  // Fetching is deferred until a user actually opens the assign picker, so it
  // doesn't add latency to the initial framework load.
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { authedFetch } = await import('@/lib/auth-fetch');
        const res = await authedFetch('/api/auth/me');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data?.authenticated && data.user?.id) {
          setCurrentUserId(Number(data.user.id));
        }
      } catch {
        /* non-fatal */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const { data: assignmentTenantUsers } = useQuery({
    queryKey: ['certification-tenant-users', journeyId],
    queryFn: async () => {
      const res = await certificationsApi.getTenantUsers();
      return res.data;
    },
    enabled: !!journeyId,
  });

  // Multi-assignee picker: per-control draft list + open/closed toggle.
  // Draft mirrors the server state until the user clicks "Assign", then we
  // flush it via the mutation. Removing every selection acts as "withdraw".
  const [assignPickerOpenFor, setAssignPickerOpenFor] = useState<number | null>(null);
  const [assignDraftByControl, setAssignDraftByControl] = useState<Record<number, number[]>>({});

  const assignControlMutation = useMutation({
    mutationFn: async ({ controlId, userIds }: { controlId: number; userIds: number[] }) =>
      certificationsApi.assignControl(journeyId, controlId, userIds),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['certification-controls', journeyId] });
      setAssignPickerOpenFor(null);
      setAssignDraftByControl((prev) => {
        const next = { ...prev };
        delete next[vars.controlId];
        return next;
      });
    },
  });

  const [showApplicabilityModal, setShowApplicabilityModal] = useState(false);
  const [applicabilityModalControl, setApplicabilityModalControl] = useState<any>(null);
  const [applicabilityJustification, setApplicabilityJustification] = useState('');
  const [applicabilityIsApplicable, setApplicabilityIsApplicable] = useState(true);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewingRecord, setReviewingRecord] = useState<any>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [applicabilityStatusFilter, setApplicabilityStatusFilter] = useState<string>('all');
  const [criticalExpanded, setCriticalExpanded] = useState<boolean>(false);

  const generateReportMutation = useMutation({
    mutationFn: async () => {
      const response = await apiClient.get(`/certifications/${journeyId}/report`, {
        responseType: 'blob'
      });
      return response.data as Blob;
    },
    onSuccess: (blob) => {
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `framework-${journeyId}-report.txt`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    }
  });

  const enhanceMutation = useMutation({
    mutationFn: async (frameworkId: number) => {
      return await apiClient.post(`/framework-upload/parser/frameworks/${frameworkId}/enhance`);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['certification-controls', journeyId] });
      setEnhanceSuccess(`Enhancement started for ${data.data?.total_controls || 0} controls. Estimated time: ${data.data?.estimated_time_minutes || 1} minutes.`);
      setTimeout(() => setEnhanceSuccess(null), 8000);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.detail || error?.message || 'Enhancement failed';
      setEnhanceError(message);
      setTimeout(() => setEnhanceError(null), 5000);
    }
  });

  const updateTargetDateMutation = useMutation({
    mutationFn: async (targetDate: string) => {
      return certificationsApi.update(journeyId, { target_date: targetDate });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certification', journeyId] });
      setEditingTargetDate(false);
    }
  });

  const generatePhasesMutation = useMutation({
    mutationFn: async () => {
      setGeneratingPhaseTasks(true);
      return apiClient.post(`/certifications/${journeyId}/generate-phases`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journey-phases', journeyId] });
      queryClient.invalidateQueries({ queryKey: ['certification', journeyId] });
      setGeneratingPhaseTasks(false);
      setEnhanceSuccess('AI successfully generated certification journey phases.');
      setTimeout(() => setEnhanceSuccess(null), 5000);
    },
    onError: (error: any) => {
      setGeneratingPhaseTasks(false);
      const message = error?.response?.data?.detail || error?.message || 'Failed to generate phases';
      setEnhanceError(message);
      setTimeout(() => setEnhanceError(null), 5000);
    }
  });

  const { data: progress } = useQuery({
    queryKey: ['certification-progress', journeyId],
    queryFn: async () => {
      const response = await certificationsApi.getProgress(journeyId);
      return response.data as ProgressSummary;
    },
    enabled: !!journeyId,
  });

  const { data: gaps } = useQuery({
    queryKey: ['certification-gaps', journeyId],
    queryFn: async () => {
      const response = await certificationsApi.getGaps(journeyId);
      return response.data;
    },
    enabled: !!journeyId,
  });

  const { data: journeyPhasesData, isLoading: phasesLoading } = useQuery({
    queryKey: ['journey-phases', journeyId],
    queryFn: async () => {
      const response = await apiClient.get(`/certifications/${journeyId}/journey-phases`);
      return response.data;
    },
    enabled: !!journeyId,
  });

  const phasesGenerated = journeyPhasesData?.generated || false;
  const phaseGenerationTriggered = useRef(false);

  const frameworkClassification = ((journey as any)?.framework_classification || '').toLowerCase();
  const fallbackName = (((journey as any)?.framework_name || journey?.framework?.name || '') as string).toLowerCase();
  const isCertificationFramework = frameworkClassification
    ? frameworkClassification === 'certification'
    : (fallbackName.includes('iso') || fallbackName.includes('pci'));
  const entityLabel = isCertificationFramework ? 'Control' : 'Requirement';
  const entityLabelPlural = isCertificationFramework ? 'Controls' : 'Requirements';
  const frameworkOverview = (journey as any)?.framework_overview || {};

  useEffect(() => {
    if (
      journeyId &&
      journeyPhasesData &&
      isCertificationFramework &&
      !journeyPhasesData.generated &&
      !generatingPhaseTasks &&
      !generatePhasesMutation.isPending &&
      !phaseGenerationTriggered.current
    ) {
      phaseGenerationTriggered.current = true;
      generatePhasesMutation.mutate();
    }
  }, [journeyId, journeyPhasesData?.generated, isCertificationFramework]);

  const phases = (journeyPhasesData?.phases || []).map((phase: any) => ({
    id: phase.phase_number || phase.id,
    name: phase.name,
    description: phase.description,
    estimated_duration: phase.estimated_duration || '',
    tasks: phase.key_tasks || [],
    deliverables: phase.deliverables || [],
    status: phase.status || 'not_started',
  }));

  useEffect(() => {
    if (progress?.by_domain?.length && !selectedDomain) {
      setSelectedDomain(progress.by_domain[0].domain_id);
    }
  }, [progress, selectedDomain]);

  const { data: cdeData, isLoading: cdeLoading } = useQuery({
    queryKey: ['cde-systems'],
    queryFn: async () => {
      const response = await certificationsApi.getCDESystems();
      return response.data as {
        systems: Array<{
          id: number;
          name: string;
          asset_type: string;
          description: string;
          location: string;
          owner_name: string | null;
          owner_id: number | null;
          vendor: string | null;
          criticality: string;
          status: string;
          cde_environment: boolean;
          created_at: string;
        }>;
        summary: {
          total: number;
          type_breakdown: Record<string, number>;
          criticality_breakdown: Record<string, number>;
        };
      };
    },
    enabled: activeTab === 'cde-scope',
  });

  const { data: cdeAssetsFallback, isLoading: cdeAssetsFallbackLoading } = useQuery({
    queryKey: ['cde-assets-fallback'],
    queryFn: async () => {
      const response = await assetsApi.getAll();
      return response.data as ITAsset[];
    },
    enabled: activeTab === 'cde-scope',
  });

  // Applicability is keyed by the UPLOADED framework id. For flat/uploaded
  // frameworks (NDMO) journey.framework_id is null and uploaded_framework_id
  // carries the real id — fall back to it so applicability works there too.
  const appFwId = (journey as any)?.uploaded_framework_id ?? (journey as any)?.framework_id ?? null;

  const { data: applicabilityData, isLoading: applicabilityLoading } = useQuery({
    queryKey: ['applicability', appFwId, applicabilityStatusFilter],
    queryFn: async () => {
      if (!appFwId) return null;
      const params = applicabilityStatusFilter !== 'all' ? `?status_filter=${applicabilityStatusFilter}` : '';
      const response = await governanceApi.getFrameworkApplicability(appFwId);
      return response.data;
    },
    enabled: !!appFwId && activeTab === 'applicability',
  });

  const { data: applicabilityAuditLog } = useQuery({
    queryKey: ['applicability-audit-log', appFwId],
    queryFn: async () => {
      if (!appFwId) return [];
      const response = await governanceApi.getApplicabilityAuditLog(appFwId);
      return response.data;
    },
    enabled: !!appFwId && activeTab === 'applicability',
  });

  const setApplicabilityMutation = useMutation({
    mutationFn: async (data: { control_id: number; uploaded_framework_id: number; is_applicable: boolean; justification: string }) => {
      return governanceApi.setClauseApplicability(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applicability'] });
      queryClient.invalidateQueries({ queryKey: ['applicability-audit-log'] });
      // Backend now self-approves and syncs ControlImplementation.is_applicable
      // — refresh controls so the badge flips and the row hides/shows.
      queryClient.invalidateQueries({ queryKey: ['certification-controls', journeyId] });
      setShowApplicabilityModal(false);
      setApplicabilityJustification('');
      setApplicabilityModalControl(null);
    },
  });

  // Statement-of-Applicability template metadata (owner / implementation status /
  // linked evidence) — inline edits on existing applicability rows.
  const updateApplicabilityDetailsMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { owner_id?: number | null; implementation_status?: string | null; linked_evidence_id?: number | null } }) =>
      governanceApi.updateApplicabilityDetails(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['applicability'] }); },
  });
  const { data: soaEvidenceLib } = useQuery({
    queryKey: ['evidence-all'],
    queryFn: async () => (await evidenceApi.getAll()).data as unknown as Array<{ id: number; name?: string; title?: string; file_name?: string; evidence_type?: string }>,
    enabled: activeTab === 'applicability',
    staleTime: 60_000,
  });

  const reviewApplicabilityMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { status: string; review_comment?: string } }) => {
      return governanceApi.reviewApplicability(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applicability'] });
      queryClient.invalidateQueries({ queryKey: ['applicability-audit-log'] });
      // Approving an applicability decision flips ControlImplementation.is_applicable,
      // which the main Requirements view filters on — refresh it so the row hides/shows.
      queryClient.invalidateQueries({ queryKey: ['certification-controls', journeyId] });
      setShowReviewModal(false);
      setReviewingRecord(null);
      setReviewComment('');
    },
  });

  const isLoading = journeyLoading || controlsLoading;
  const totalControlsProgress = progress?.total_controls || 0;
  const implementedCount = (progress as any)?.implemented_count ?? (progress as any)?.implemented ?? 0;
  const verifiedCount = (progress as any)?.verified_count ?? (progress as any)?.verified ?? 0;
  const inProgressCount = (progress as any)?.in_progress_count ?? (progress as any)?.in_progress ?? 0;
  const notApplicableCount = (progress as any)?.not_applicable_count ?? (progress as any)?.not_applicable ?? 0;
  const completionPercentage = progress?.completion_percentage || 0;
  const evidenceCoveragePercentage = (progress as any)?.evidence_coverage_percentage ?? completionPercentage;
  const readinessPercentage = (progress as any)?.readiness_percentage ?? completionPercentage;
  const controlsWithEvidence = (progress as any)?.with_evidence_count ?? 0;
  const fullyEvidencedControls = (progress as any)?.fully_evidenced_count ?? 0;

  const togglePhase = (phaseId: number) => {
    setExpandedPhases(prev => 
      prev.includes(phaseId) 
        ? prev.filter(id => id !== phaseId)
        : [...prev, phaseId]
    );
  };

  const toggleDomain = (domainId: string) => {
    setExpandedDomains(prev => 
      prev.includes(domainId) 
        ? prev.filter(id => id !== domainId)
        : [...prev, domainId]
    );
  };

  const toggleControl = (controlId: number) => {
    console.info('[JourneyTrace] toggle control accordion', { controlId });
    setExpandedControls(prev => 
      prev.includes(controlId) 
        ? prev.filter(id => id !== controlId)
        : [...prev, controlId]
    );
  };

  const makeSubControlKey = (sub: SubControlWithEvidence, depth: number, index: number): string => {
    return `${sub.id || 'na'}::${sub.code || 'no-code'}::${depth}::${index}`;
  };

  const toggleSubControl = (key: string, meta: { code?: string; depth: number; hasChildren: boolean }) => {
    console.info('[JourneyTrace] toggle sub-control', { key, ...meta });
    setExpandedSubControlKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const focusControlByCode = (controlCode?: string) => {
    if (!controlCode) return;
    const trimmed = controlCode.trim();
    if (!trimmed) return;

    const match = (controls || []).find((ctrl: CertificationControl) => {
      const code = (ctrl.control_code || '').trim();
      return code === trimmed || code.startsWith(`${trimmed}.`) || trimmed.startsWith(`${code}.`);
    });

    console.info('[JourneyTrace] focusControlByCode', {
      requestedCode: trimmed,
      controlsCount: (controls || []).length,
      foundMatch: !!match,
      activeFilters: {
        categoryFilter,
        statusFilter,
        sortOrder,
        searchQuery,
      },
    });

    if (!match) return;

    setExpandedControls((prev) => (prev.includes(match.id) ? prev : [...prev, match.id]));
    setTimeout(() => {
      const el = document.getElementById(`control-${match.id}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 80);
  };

  const handleFileUpload = (controlId: number, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setUploadingControlId(controlId);
      uploadEvidenceMutation.mutate({ controlId, file });
    }
    if (event.target) {
      event.target.value = '';
    }
  };

  // Natural sort comparison for section/clause numbers (e.g., "1.2.10" should come after "1.2.9")
  const naturalSortCompare = (a: string, b: string): number => {
    const aParts = (a || '').split(/[.\-_\s]+/).map(p => {
      const num = parseInt(p, 10);
      return isNaN(num) ? p.toLowerCase() : num;
    });
    const bParts = (b || '').split(/[.\-_\s]+/).map(p => {
      const num = parseInt(p, 10);
      return isNaN(num) ? p.toLowerCase() : num;
    });
    
    const maxLen = Math.max(aParts.length, bParts.length);
    for (let i = 0; i < maxLen; i++) {
      const aPart = aParts[i] ?? '';
      const bPart = bParts[i] ?? '';
      
      if (typeof aPart === 'number' && typeof bPart === 'number') {
        if (aPart !== bPart) return aPart - bPart;
      } else if (typeof aPart === 'number') {
        return -1; // Numbers come before strings
      } else if (typeof bPart === 'number') {
        return 1;
      } else {
        const cmp = String(aPart).localeCompare(String(bPart));
        if (cmp !== 0) return cmp;
      }
    }
    return 0;
  };

  // Domain → document-order rank, derived from the API response order. The
  // backend returns controls in the framework's published/document sequence,
  // so each domain's first-appearance index gives its document position. Used
  // to order the requirement list by domain as in the source document
  // (e.g. NDMO: Data Governance first), not alphabetically by control code.
  const domainOrderRank = (() => {
    const m = new Map<string, number>();
    (controls || []).forEach((c: CertificationControl) => {
      const d = (c.domain_name || '').toLowerCase().trim();
      if (!m.has(d)) m.set(d, m.size);
    });
    return m;
  })();

  const filteredControls = controls?.filter((control: CertificationControl) => {
    // Hide controls that have been approved as Not Applicable.
    // They remain accessible (and reversible) from the Applicability tab.
    if (control.is_applicable === false) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesSearch =
        control.control_code?.toLowerCase().includes(query) ||
        control.control_name?.toLowerCase().includes(query) ||
        control.control_statement?.toLowerCase().includes(query);
      if (!matchesSearch) return false;
    }
    if (categoryFilter !== 'all') {
      const category = getCategoryFromDomain(control.domain_name).toLowerCase();
      if (category !== categoryFilter) return false;
    }
    if (statusFilter !== 'all') {
      if (statusFilter === 'not_implemented' && control.status !== 'not_started') return false;
      if (statusFilter === 'implemented' && !['implemented', 'verified'].includes(control.status)) return false;
      if (statusFilter === 'partial' && control.status !== 'in_progress') return false;
      if (statusFilter === 'in_progress' && control.status !== 'in_progress') return false;
      if (statusFilter === 'verified' && control.status !== 'verified') return false;
    }
    return true;
  }).sort((a: CertificationControl, b: CertificationControl) => {
    // Order by domain document-sequence first, then natural code within the
    // domain (DG.1.1 < DG.1.2 < DG.2.1). This keeps domains in the source
    // document order instead of sorting them alphabetically by code prefix.
    const da = domainOrderRank.get((a.domain_name || '').toLowerCase().trim()) ?? 9999;
    const db = domainOrderRank.get((b.domain_name || '').toLowerCase().trim()) ?? 9999;
    if (da !== db) return sortOrder === 'desc' ? db - da : da - db;
    const codeA = a.original_control_code || a.system_control_code || a.control_code || '';
    const codeB = b.original_control_code || b.system_control_code || b.control_code || '';
    const result = naturalSortCompare(codeA, codeB);
    return sortOrder === 'desc' ? -result : result;
  }) || [];

  useEffect(() => {
    console.info('[JourneyTrace] filtered controls recalculated', {
      totalControls: (controls || []).length,
      filteredControls: filteredControls.length,
      filters: {
        searchQuery,
        categoryFilter,
        statusFilter,
        sortOrder,
      },
    });
  }, [controls, filteredControls.length, searchQuery, categoryFilter, statusFilter, sortOrder]);

  const controlStats = {
    total: controls?.length || 0,
    applicable: controls?.filter((c: CertificationControl) => c.is_applicable).length || 0,
    notApplicable: controls?.filter((c: CertificationControl) => !c.is_applicable).length || 0,
    implemented: controls?.filter((c: CertificationControl) => ['implemented', 'verified'].includes(c.status)).length || 0,
    partial: controls?.filter((c: CertificationControl) => c.status === 'in_progress').length || 0,
    notImplemented: controls?.filter((c: CertificationControl) => c.status === 'not_started').length || 0,
    byCategory: {
      organizational: controls?.filter((c: CertificationControl) => getCategoryFromDomain(c.domain_name) === 'Organizational').length || 0,
      people: controls?.filter((c: CertificationControl) => getCategoryFromDomain(c.domain_name) === 'People').length || 0,
      physical: controls?.filter((c: CertificationControl) => getCategoryFromDomain(c.domain_name) === 'Physical').length || 0,
      technological: controls?.filter((c: CertificationControl) => getCategoryFromDomain(c.domain_name) === 'Technological').length || 0,
    }
  };

  // Group the (already filtered + sorted) controls into hierarchy
  // sections so the requirements view can render as a "Progress spine"
  // — a vertical journey through the framework with numbered section
  // anchors. Section key is the leading numeric prefix of the control
  // code (e.g. "1.2" -> section "1") with `domain_name` as fallback for
  // frameworks whose clause IDs aren't numeric. We deliberately work off
  // `filteredControls` so the spine respects the current search/category/
  // status filters and the user's sort order.
  type RequirementSection = {
    key: string;
    label: string;
    sectionNumber: number | null;  // null when grouping by non-numeric domain
    controls: CertificationControl[];
  };

  // Pure helper — extracted so the Assigned-to-me tab can reuse the
  // same grouping rules on its own filtered list without re-running
  // every page-level memo. The result is sorted by numeric section
  // then alphabetically by label so output is stable across re-renders.
  const buildRequirementSections = (list: CertificationControl[]): RequirementSection[] => {
    const map = new Map<string, RequirementSection>();
    for (const c of list) {
      const code = String((c as any).control_code || (c as any).original_control_code || '').trim();
      const numericPrefix = code.match(/^\s*(\d+)/)?.[1];
      const key = numericPrefix
        ? `num:${numericPrefix}`
        : `dom:${(c.domain_name || 'general').toLowerCase().trim()}`;
      const label = c.domain_name || (numericPrefix ? `Section ${numericPrefix}` : 'General');
      if (!map.has(key)) {
        map.set(key, {
          key,
          label,
          sectionNumber: numericPrefix ? Number(numericPrefix) : null,
          controls: [],
        });
      }
      map.get(key)!.controls.push(c);
    }
    const result = Array.from(map.values());
    result.sort((a, b) => {
      if (a.sectionNumber !== null && b.sectionNumber !== null) return a.sectionNumber - b.sectionNumber;
      if (a.sectionNumber !== null) return -1;
      if (b.sectionNumber !== null) return 1;
      // Letter-coded frameworks (e.g. NDMO: DG, MCM, DQ…) carry no numeric
      // section prefix — preserve the API order, which the backend already
      // returns in the framework's published/document sequence, instead of
      // sorting domains alphabetically by name.
      return 0;
    });
    return result;
  };

  const requirementSections: RequirementSection[] = (() => {
    const map = new Map<string, RequirementSection>();
    for (const c of filteredControls) {
      const code = String((c as any).control_code || (c as any).original_control_code || '').trim();
      const numericPrefix = code.match(/^\s*(\d+)/)?.[1];
      const key = numericPrefix
        ? `num:${numericPrefix}`
        : `dom:${(c.domain_name || 'general').toLowerCase().trim()}`;
      const label = c.domain_name || (numericPrefix ? `Section ${numericPrefix}` : 'General');
      if (!map.has(key)) {
        map.set(key, {
          key,
          label,
          sectionNumber: numericPrefix ? Number(numericPrefix) : null,
          controls: [],
        });
      }
      map.get(key)!.controls.push(c);
    }
    const list = Array.from(map.values());
    list.sort((a, b) => {
      if (a.sectionNumber !== null && b.sectionNumber !== null) return a.sectionNumber - b.sectionNumber;
      if (a.sectionNumber !== null) return -1;
      if (b.sectionNumber !== null) return 1;
      // Letter-coded frameworks (e.g. NDMO: DG, MCM, DQ…) carry no numeric
      // section prefix — preserve the API order, which the backend already
      // returns in the framework's published/document sequence, instead of
      // sorting domains alphabetically by name.
      return 0;
    });
    return list;
  })();

  const totalEvidence = (controls || []).reduce(
    (acc: number, c: CertificationControl) => acc + (c.evidence_count ?? (c.evidence ? c.evidence.length : 0)),
    0
  );

  const handleControlClick = (control: ControlImplementation) => {
    setSelectedControl(control);
    setShowControlModal(true);
  };

  const phaseTabs = phases.map((phase, index) => ({
    id: `phase-${phase.id}` as TabType,
    label: `${index + 1}. ${phase.name.split(' ')[0]}`
  }));

  const isPciDssFramework = (
    (journey as any)?.framework_name ||
    journey?.framework?.name ||
    ''
  ).toLowerCase().includes('pci');

  // ISO 27001 template tabs (Gap Analysis, Internal Audit, Risk Treatment,
  // Scope Statement, Audit Procedure) are gated to the ISO 27001 framework.
  // Normalise so "ISO/IEC 27001:2022", "ISO 27001", "ISO27001" all match.
  const _fwNameNorm = (((journey as any)?.framework_name || journey?.framework?.name || journey?.name || '') as string)
    .toLowerCase().replace(/[^a-z0-9]/g, '');
  const isIso27001Framework = _fwNameNorm.includes('27001') && _fwNameNorm.includes('iso');
  const templateTenantUsers = useMemo(
    () => (assignmentTenantUsers || []).map((u: any) => ({ id: u.id, name: u.display_name || u.email || String(u.id) })),
    [assignmentTenantUsers]
  );

  // "Phased" frameworks (NDMO) carry P1/P2/P3 priorities — show the 3-year
  // roadmap compliance dashboard in the header instead of the generic KPI cards.
  const isPhasedFramework = (controls || []).some(
    (c: CertificationControl) => ['P1', 'P2', 'P3'].includes(c.priority_level || ''),
  );

  const toggleRequirementText = (controlId: number) => {
    setExpandedRequirementTextIds((prev) =>
      prev.includes(controlId) ? prev.filter((id) => id !== controlId) : [...prev, controlId]
    );
  };
  
  const tabs: { id: TabType; label: string; icon?: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview' },
    ...(isCertificationFramework ? [{ id: 'phases' as TabType, label: 'Phases' }] : []),
    ...(isPciDssFramework ? [{ id: 'cde-scope' as TabType, label: 'CDE Scope' }] : []),
    { id: 'controls', label: 'Requirements' },
    { id: 'assigned-to-me' as TabType, label: 'Assigned to Me' },
    { id: 'applicability', label: 'Applicability' },
    ...(isIso27001Framework ? [
      { id: 'gap-analysis' as TabType, label: 'Gap Analysis' },
      { id: 'internal-audit' as TabType, label: 'Internal Audit' },
      { id: 'risk-treatment' as TabType, label: 'Risk Treatment' },
      { id: 'scope-statement' as TabType, label: 'Scope Statement' },
      { id: 'audit-procedure' as TabType, label: 'Audit Procedure' },
    ] : []),
    { id: 'artifacts' as TabType, label: 'Artifacts' },
    { id: 'history' as TabType, label: 'History' },
  ];

  useEffect(() => {
    const el = contentScrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      setCardsCollapsed(el.scrollTop > 80);
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    // Summary cards belong on the Overview tab only — every other tab is
    // operational (browsing/working on requirements) and benefits from the
    // extra vertical space.
    if (activeTab === 'overview') {
      setCardsCollapsed(false);
    } else {
      setCardsCollapsed(true);
    }
    // Dismiss any open applicability/review modals when navigating between
    // tabs — they belong to the originating tab's row click and should not
    // bleed into the next view.
    setShowApplicabilityModal(false);
    setApplicabilityModalControl(null);
    setApplicabilityJustification('');
    setShowReviewModal(false);
    setReviewingRecord(null);
    setReviewComment('');
  }, [activeTab]);

  if (isLoading) {
    return (
      <PageLoader className="h-64" />
    );
  }

  if (journeyError || !journey) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-red-400">
        <AlertCircle className="mb-2 h-8 w-8" />
        <p>Failed to load certification journey</p>
        <button 
          onClick={() => router.push('/frameworks')}
          className="btn-secondary mt-4"
        >
          Back to Frameworks
        </button>
      </div>
    );
  }

  const CircularProgress = ({ percentage }: { percentage: number }) => {
    const circumference = 2 * Math.PI * 45;
    const strokeDashoffset = circumference - (percentage / 100) * circumference;
    
    return (
      <div className="relative h-32 w-32">
        <svg className="h-32 w-32 -rotate-90 transform">
          <circle
            cx="64"
            cy="64"
            r="45"
            stroke="currentColor"
            strokeWidth="8"
            fill="transparent"
            className="text-slate-200"
          />
          <circle
            cx="64"
            cy="64"
            r="45"
            stroke="currentColor"
            strokeWidth="8"
            fill="transparent"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="text-primary-700 transition-all duration-500"
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold cw-text">{percentage}%</span>
          <span className="text-xs text-slate-600">Ready</span>
        </div>
      </div>
    );
  };

  /**
   * Critical-clause callout: AI-flagged red-flag requirements that must
   * go through reviewer approval before they can be marked Not
   * Applicable. Lives on the Overview tab so it surfaces immediately
   * when the user opens a framework — the previous placement at the
   * top of the Controls tab pushed the spine down and buried the
   * "where do I start" cue. Returns `null` when no analysis has run
   * AND no critical items exist (it's a no-op until either side has
   * data to show).
   */
  const renderCriticalItemsPanel = () => {
    const critical = criticalData?.items ?? [];
    const analyzed = !!criticalData?.analyzed_at;
    const isAnalyzing = analyzeCriticalMutation.isPending;
    if (!analyzed && critical.length === 0) {
      // First-time state — invite user to run analysis.
      return (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-900">Critical-Clause Analysis</p>
              <p className="text-xs text-amber-800 mt-0.5">
                Run an AI scan to flag red-flag clauses in this framework that may require special attention during review.
              </p>
            </div>
            {canEdit && (
              <button
                type="button"
                onClick={() => analyzeCriticalMutation.mutate()}
                disabled={isAnalyzing}
                className="flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {isAnalyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {isAnalyzing ? 'Analyzing…' : 'Run AI analysis'}
              </button>
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-rose-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-rose-900">
                Critical Items <span className="text-rose-700 font-normal">({critical.length})</span>
              </p>
              <p className="text-xs text-rose-800 mt-0.5">
                These clauses require reviewer approval before being marked Not Applicable.
                {criticalData?.analyzed_at ? ` Last analyzed ${new Date(criticalData.analyzed_at).toLocaleDateString()}.` : ''}
              </p>
            </div>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={() => analyzeCriticalMutation.mutate()}
              disabled={isAnalyzing}
              className="flex items-center gap-1.5 rounded-md border border-rose-300 bg-white px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              title="Re-run AI critical-clause analysis"
            >
              {isAnalyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {isAnalyzing ? 'Re-analyzing…' : 'Re-analyze'}
            </button>
          )}
        </div>
        {critical.length === 0 ? (
          <p className="text-xs text-rose-800 italic">No critical clauses identified for this framework.</p>
        ) : (
          <>
            <ul className="space-y-1.5">
              {(criticalExpanded ? critical : critical.slice(0, 8)).map((c) => (
                <li key={c.parsed_control_id} className="flex items-start gap-2 text-xs">
                  <span className="font-mono text-rose-700 flex-shrink-0">{c.control_code}</span>
                  <span className="text-rose-900">{c.title}</span>
                  {c.reason && <span className="text-rose-700/80 truncate">— {c.reason}</span>}
                </li>
              ))}
            </ul>
            {critical.length > 8 && (
              <button
                type="button"
                onClick={() => setCriticalExpanded((v) => !v)}
                className="mt-2 text-xs font-medium text-rose-700 hover:text-rose-900 hover:underline"
              >
                {criticalExpanded ? 'View less' : `View all ${critical.length} →`}
              </button>
            )}
          </>
        )}
      </div>
    );
  };

  // NDMO compliance dashboard — per-spec score from the assessment-criteria
  // calculator, rolled up by P1/P2/P3 (Year 1/2/3). Computed client-side from
  // the already-fetched controls + live criteria check state.
  const specScorePct = (c: CertificationControl): number => {
    const crits = c.assessment_criteria || [];
    const st = criteriaState[c.id] ?? c.criteria_status ?? {};
    if (crits.length > 0) {
      const met = crits.filter((_, i) => st[String(i)]).length;
      return Math.round((met / crits.length) * 100);
    }
    if (['implemented', 'verified'].includes(c.status)) return 100;
    if (c.status === 'in_progress') return 50;
    return 0;
  };

  const renderComplianceDashboard = () => {
    const all = (controls || []).filter(
      (c) => ['P1', 'P2', 'P3'].includes(c.priority_level || '') && c.is_applicable !== false,
    );
    if (all.length === 0) return null;
    const META: Record<string, { year: string; ring: string; bar: string }> = {
      P1: { year: 'Year 1', ring: 'text-rose-600', bar: 'bg-rose-500' },
      P2: { year: 'Year 2', ring: 'text-amber-600', bar: 'bg-amber-500' },
      P3: { year: 'Year 3', ring: 'text-emerald-600', bar: 'bg-emerald-500' },
    };
    const CATS = [
      { key: 'compliant', label: 'Compliant', dot: 'bg-emerald-500' },
      { key: 'inprog', label: 'In Progress', dot: 'bg-amber-500' },
      { key: 'notstarted', label: 'Not Started', dot: 'bg-slate-300' },
    ] as const;
    const tiers = (['P1', 'P2', 'P3'] as const).map((pl) => {
      const specs = all.filter((c) => c.priority_level === pl);
      const scored = specs.map((c) => ({ c, p: specScorePct(c) }));
      const byCat: Record<string, CertificationControl[]> = {
        compliant: scored.filter((s) => s.p === 100).map((s) => s.c),
        inprog: scored.filter((s) => s.p > 0 && s.p < 100).map((s) => s.c),
        notstarted: scored.filter((s) => s.p === 0).map((s) => s.c),
      };
      const total = specs.length;
      const avg = total ? Math.round(scored.reduce((a, s) => a + s.p, 0) / total) : 0;
      return { pl, total, avg, byCat, ...META[pl] };
    });
    const allPcts = all.map(specScorePct);
    const overall = allPcts.length ? Math.round(allPcts.reduce((a, b) => a + b, 0) / allPcts.length) : 0;
    const overallCompliant = allPcts.filter((p) => p === 100).length;

    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-semibold cw-text">
            <Target className="h-5 w-5 text-primary-700" />
            Compliance Dashboard · 3-Year Roadmap
          </h3>
          <div className="text-right">
            <div className="text-xl font-bold text-slate-900">{overall}%</div>
            <div className="text-[11px] text-slate-500">{overallCompliant}/{all.length} specs compliant</div>
          </div>
        </div>
        <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: `${overall}%` }} />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {tiers.map((t) => (
            <div key={t.pl} className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-800">{t.pl} · {t.year}</span>
                <span className={`text-lg font-bold ${t.ring}`}>{t.avg}%</span>
              </div>
              <div className="mt-2 mb-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div className={`h-full rounded-full ${t.bar}`} style={{ width: `${t.avg}%` }} />
              </div>
              <ul className="space-y-1">
                {CATS.map((cat) => {
                  const list = t.byCat[cat.key];
                  const key = `${t.pl}:${cat.key}`;
                  const open = openTierCat === key;
                  return (
                    <li key={cat.key}>
                      <button
                        type="button"
                        disabled={list.length === 0}
                        onClick={() => setOpenTierCat(open ? null : key)}
                        className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-xs transition-colors ${list.length ? 'hover:bg-slate-50' : 'cursor-default opacity-60'}`}
                      >
                        <span className="flex items-center gap-1.5 text-slate-600">
                          <span className={`h-2 w-2 rounded-full ${cat.dot}`} />{cat.label}
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="font-semibold text-slate-700">{list.length}</span>
                          {list.length > 0 && (
                            <ChevronDown className={`h-3 w-3 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                          )}
                        </span>
                      </button>
                      {open && (() => {
                        // Group this category's specs by their domain so the
                        // drill-down shows which domain each belongs to.
                        const groups: { domain: string; items: CertificationControl[] }[] = [];
                        const gi = new Map<string, number>();
                        list.forEach((c) => {
                          const d = c.domain_name || 'Other';
                          if (!gi.has(d)) { gi.set(d, groups.length); groups.push({ domain: d, items: [] }); }
                          groups[gi.get(d)!].items.push(c);
                        });
                        return (
                          <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-sm">
                            {groups.map((g, gi) => (
                              <div key={g.domain} className={gi > 0 ? 'border-t border-slate-100' : ''}>
                                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-slate-50/95 px-3 py-1.5 backdrop-blur">
                                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{g.domain}</span>
                                  <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600">{g.items.length}</span>
                                </div>
                                <ul className="divide-y divide-slate-50">
                                  {g.items.map((c) => {
                                    const p = specScorePct(c);
                                    const dot = p === 100 ? 'bg-emerald-500' : p > 0 ? 'bg-amber-500' : 'bg-slate-300';
                                    const ptxt = p === 100 ? 'text-emerald-600' : p > 0 ? 'text-amber-600' : 'text-slate-400';
                                    return (
                                      <li key={c.id}>
                                        <button
                                          type="button"
                                          onClick={() => openSpineControl(c)}
                                          className="group flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-primary-50/40"
                                        >
                                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
                                          <span className="w-16 shrink-0 font-mono text-[11px] font-semibold text-primary-700">{c.control_code}</span>
                                          <span className="flex-1 truncate text-xs text-slate-700">{c.control_name}</span>
                                          <span className={`shrink-0 text-[11px] font-bold ${ptxt}`}>{p}%</span>
                                          <ChevronRight className="h-3 w-3 shrink-0 text-slate-300 transition-colors group-hover:text-slate-500" />
                                        </button>
                                      </li>
                                    );
                                  })}
                                </ul>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </li>
                  );
                })}
              </ul>
              <div className="mt-2 border-t border-slate-100 pt-2 text-[11px] text-slate-400">{t.total} specifications</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderOverviewTab = () => (
    <div className="space-y-4">
      {/* Compliance dashboard charts — gauge, requirement status, automated
          controls assurance, maturity radar, trend + top stat cards. */}
      <FrameworkChartsOverview journeyId={journeyId} />
      {renderCriticalItemsPanel()}
      {!isCertificationFramework ? (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <div className="cw-card p-6">
            <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold cw-text">
              <Sparkles className="h-5 w-5 text-primary-700" />
              AI Framework Overview
            </h3>
            <div className="space-y-4 text-sm text-slate-700">
              {frameworkOverview.purpose && (
                <div>
                  <p className="font-semibold text-slate-900">Purpose</p>
                  <p>{frameworkOverview.purpose}</p>
                </div>
              )}
              {frameworkOverview.scope && (
                <div>
                  <p className="font-semibold text-slate-900">Scope</p>
                  <p>{frameworkOverview.scope}</p>
                </div>
              )}
              {frameworkOverview.classification_reasoning && (
                <div>
                  <p className="font-semibold text-slate-900">AI Assessment</p>
                  <p>{frameworkOverview.classification_reasoning}</p>
                </div>
              )}
              {Array.isArray(frameworkOverview.objectives) && frameworkOverview.objectives.length > 0 && (
                <div>
                  <p className="mb-2 font-semibold text-slate-900">Key Objectives</p>
                  <ul className="list-disc pl-5 space-y-1">
                    {frameworkOverview.objectives.slice(0, 8).map((item: string, idx: number) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {Array.isArray(frameworkOverview.adoption_approach) && frameworkOverview.adoption_approach.length > 0 && (
                <div>
                  <p className="mb-2 font-semibold text-slate-900">Adoption Approach</p>
                  <ul className="list-disc pl-5 space-y-1">
                    {frameworkOverview.adoption_approach.slice(0, 8).map((item: string, idx: number) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {!frameworkOverview.purpose && !frameworkOverview.scope && !frameworkOverview.classification_reasoning && (
                <p className="text-slate-500">AI overview data is not yet available for this framework.</p>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="cw-card p-6">
            <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold cw-text">
              <BarChart3 className="h-5 w-5 text-primary-700" />
              Key Metrics
            </h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="cw-text-muted">{entityLabelPlural} Implemented</span>
                <span className="font-semibold cw-text">{progress?.implemented || 0}/{progress?.total_controls || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="cw-text-muted">{entityLabelPlural} In Progress</span>
                <span className="font-semibold text-primary-700">{progress?.in_progress || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="cw-text-muted">Evidence Collected</span>
                <span className="font-semibold cw-text">{totalEvidence}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="cw-text-muted">Open Gaps</span>
                <span className="font-semibold text-orange-600">{(gaps as any)?.not_implemented?.length || 0}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    ) : (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <div className="cw-card p-6">
          <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold cw-text">
            <Clock className="h-5 w-5 text-primary-700" />
            Certification Timeline
          </h3>
          <div className="space-y-2">
            {phases.length === 0 && phasesLoading ? (
              <div className="flex items-center justify-center py-8">
                <PageLoader size="sm" />
              </div>
            ) : phases.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <p className="text-sm text-slate-500">No certification phases defined for this framework</p>
              </div>
            ) : phases.map((phase) => {
              const isExpanded = expandedPhases.includes(phase.id);
              const isCurrent = journey.current_phase === phase.id;
              const isCompleted = journey.current_phase > phase.id;
              
              return (
                <div key={phase.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
                  <button
                    onClick={() => togglePhase(phase.id)}
                    className="flex w-full items-center justify-between p-4 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                        isCompleted ? 'bg-emerald-500 text-white' : isCurrent ? 'bg-primary-600 text-[color:var(--color-on-base,#0a0a0a)]' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {isCompleted ? <Check className="h-4 w-4" /> : phase.id}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`font-medium ${isCompleted ? 'text-emerald-700' : isCurrent ? 'cw-text' : 'cw-text-muted'}`}>
                            {phase.name}
                          </span>
                          {isCurrent && (
                            <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
                              In Progress
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-slate-500">{phase.description}</p>
                      </div>
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="h-5 w-5 cw-text-muted" />
                    ) : (
                      <ChevronDown className="h-5 w-5 cw-text-muted" />
                    )}
                  </button>
                  {isExpanded && (
                    <div className="border-t border-[var(--color-border)] p-4">
                      <div className="mb-3">
                        <h4 className="mb-2 text-sm font-medium text-slate-700">Key Tasks</h4>
                        <ul className="space-y-1">
                          {phase.tasks.map((task, idx) => (
                            <li key={idx} className="flex items-center gap-2 text-sm cw-text-muted">
                              <Circle className="h-2 w-2 fill-current" />
                              {task}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h4 className="mb-2 text-sm font-medium text-slate-700">Deliverables</h4>
                        <div className="flex flex-wrap gap-2">
                          {phase.deliverables.map((deliverable, idx) => (
                            <span key={idx} className="rounded-full bg-[var(--color-subtle)] px-3 py-1 text-xs cw-text-muted">
                              {deliverable}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <div className="cw-card p-6">
          <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold cw-text">
            <BarChart3 className="h-5 w-5 text-primary-700" />
            Key Metrics
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="cw-text-muted">Controls Implemented</span>
                <span className="font-semibold cw-text">{implementedCount}/{totalControlsProgress}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="cw-text-muted">Controls In Progress</span>
                <span className="font-semibold text-primary-700">{inProgressCount || controlsWithEvidence}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="cw-text-muted">Evidence Collected</span>
              <span className="font-semibold cw-text">{totalEvidence}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="cw-text-muted">Not Applicable</span>
                <span className="font-semibold text-slate-500">{notApplicableCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="cw-text-muted">Open Gaps</span>
              <span className="font-semibold text-orange-600">{(gaps as any)?.not_implemented?.length || 0}</span>
            </div>
          </div>
        </div>

        <div className="cw-card p-6">
          <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold cw-text">
            <AlertTriangle className="h-5 w-5 text-orange-600" />
            Attention Required
          </h3>
          <div className="space-y-3">
            {(gaps as any)?.not_implemented?.length > 0 && (
              <div className="rounded-lg bg-orange-50 border border-orange-200 p-3">
                <p className="text-sm font-medium text-orange-700">{(gaps as any).not_implemented.length} {entityLabelPlural.toLowerCase()} not implemented</p>
                <p className="text-xs text-slate-600">Require implementation</p>
              </div>
            )}
            {(gaps as any)?.missing_evidence?.length > 0 && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                <p className="text-sm font-medium text-amber-700">{(gaps as any).missing_evidence.length} controls missing evidence</p>
                <p className="text-xs text-slate-600">Evidence collection needed</p>
              </div>
            )}
            {(gaps as any)?.pending_verification?.length > 0 && (
              <div className="rounded-lg bg-primary-50 border border-primary-200 p-3">
                <p className="text-sm font-medium text-primary-700">{(gaps as any).pending_verification.length} controls pending verification</p>
                <p className="text-xs text-slate-600">Ready for review</p>
              </div>
            )}
            {!(gaps as any)?.not_implemented?.length && !(gaps as any)?.missing_evidence?.length && !(gaps as any)?.pending_verification?.length && (
              <p className="text-sm text-slate-500">No attention items at this time</p>
            )}
          </div>
        </div>
      </div>
    </div>
    )}
    </div>
  );

  const renderPhasesTab = () => (
    !isCertificationFramework ? (
      <div className="cw-card p-8 text-center">
        <p className="text-lg font-semibold text-slate-900">Phases are disabled for compliance frameworks</p>
        <p className="mt-2 text-sm text-slate-600">Use the Overview and {entityLabelPlural} tabs to manage compliance implementation.</p>
      </div>
    ) : (
    <div className="cw-card p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold cw-text">Certification Journey Phases</h3>
          {phasesGenerated && (
            <span className="flex items-center gap-1 rounded-full bg-primary-50 border border-primary-200 px-2 py-0.5 text-xs text-primary-700">
              <Sparkles className="h-3 w-3" />
              AI Generated
            </span>
          )}
          {!phasesGenerated && !generatingPhaseTasks && phases.length > 0 && (
            <button
              onClick={() => generatePhasesMutation.mutate()}
              disabled={generatingPhaseTasks || generatePhasesMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-primary-50 border border-primary-200 px-3 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-100 transition-all disabled:opacity-50"
            >
              <Sparkles className="h-3 w-3" strokeWidth={1.75} />
              Generate Journey Phases
            </button>
          )}
        </div>
        <span className="text-sm text-slate-600">
          {phases.length > 0 ? `${phases.length} Phases` : ''}
        </span>
      </div>
      <div className="space-y-3">
        {(phasesLoading || generatingPhaseTasks || generatePhasesMutation.isPending) && phases.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="mb-4 relative">
              <Loader2 className="h-8 w-8 animate-spin text-primary-700" />
              <Sparkles className="h-4 w-4 text-primary-600 absolute -top-1 -right-1 animate-pulse" />
            </div>
            <p className="text-sm font-medium text-slate-900 mb-1">Generating Certification Journey Phases</p>
            <p className="text-xs text-slate-600 text-center max-w-md">AI is analyzing the framework controls and domains to create a tailored compliance roadmap with actionable tasks and deliverables...</p>
          </div>
        ) : phases.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Sparkles className="mb-3 h-10 w-10 text-slate-400" />
            <p className="text-sm text-slate-600 mb-1">No certification phases generated yet</p>
            <p className="text-xs text-slate-500 mb-4">Phases will be automatically generated using AI</p>
            <button
              onClick={() => generatePhasesMutation.mutate()}
              disabled={generatePhasesMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-[color:var(--color-on-base,#0a0a0a)] hover:bg-primary-700 transition-all disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" strokeWidth={1.75} />
              Generate Journey Phases
            </button>
          </div>
        ) : phases.map((phase) => {
          const isExpanded = expandedPhases.includes(phase.id);
          const isCurrent = journey.current_phase === phase.id;
          const isCompleted = journey.current_phase > phase.id;
          
          return (
            <div key={phase.id} className={`rounded-lg border ${isCurrent ? 'border-primary-300' : 'border-slate-200'} bg-white`}>
              <button
                onClick={() => togglePhase(phase.id)}
                className="flex w-full items-center justify-between p-4 text-left"
              >
                <div className="flex items-center gap-4">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold ${
                    isCompleted ? 'bg-emerald-500 text-white' : isCurrent ? 'bg-primary-600 text-[color:var(--color-on-base,#0a0a0a)]' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {isCompleted ? <Check className="h-5 w-5" /> : phase.id}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`text-lg font-medium ${isCompleted ? 'text-emerald-700' : isCurrent ? 'text-slate-900' : 'text-slate-600'}`}>
                        {phase.name}
                      </span>
                      {isCurrent && (
                        <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
                          Current
                        </span>
                      )}
                      {isCompleted && (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          Completed
                        </span>
                      )}
                      {phase.estimated_duration && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                          {phase.estimated_duration}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-500 line-clamp-2">{phase.description}</p>
                  </div>
                </div>
                {isExpanded ? (
                  <ChevronUp className="h-5 w-5 text-slate-600 flex-shrink-0" />
                ) : (
                  <ChevronDown className="h-5 w-5 text-slate-600 flex-shrink-0" />
                )}
              </button>
              {isExpanded && (
                <div className="border-t border-slate-200  p-4">
                  {phase.description && (
                    <p className="text-sm text-slate-600 mb-4">{phase.description}</p>
                  )}
                  {phase.tasks.length === 0 && phase.deliverables.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-4 text-center">
                      <p className="text-sm text-slate-500">No tasks or deliverables defined for this phase</p>
                    </div>
                  ) : (
                    <div className="grid gap-6 md:grid-cols-2">
                      {phase.tasks.length > 0 && (
                        <div>
                          <h4 className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700">
                            <CheckCircle2 className="h-4 w-4" />
                            Key Tasks
                          </h4>
                          <ul className="space-y-2">
                            {phase.tasks.map((task: string, idx: number) => (
                              <li key={idx} className="flex items-start gap-2 text-sm text-slate-600">
                                <Circle className="mt-1.5 h-2 w-2 flex-shrink-0 fill-slate-400 text-slate-400" />
                                {task}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {phase.deliverables.length > 0 && (
                        <div>
                          <h4 className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700">
                            <FileText className="h-4 w-4" />
                            Deliverables
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {phase.deliverables.map((deliverable: string, idx: number) => (
                              <span key={idx} className="rounded-full bg-primary-50 px-3 py-1 text-xs text-primary-700">
                                {deliverable}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
    )
  );

  const renderScopingTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="card flex items-center gap-3 !p-4">
          <div className="rounded-lg bg-primary-50 p-2">
            <MapPin className="h-5 w-5 text-primary-700" strokeWidth={1.75} />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-900">0</p>
            <p className="text-xs text-slate-500">Locations</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 !p-4">
          <div className="rounded-lg bg-amber-50 p-2">
            <XCircle className="h-5 w-5 text-amber-700" strokeWidth={1.75} />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-900">0</p>
            <p className="text-xs text-slate-500">Exclusions</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 !p-4">
          <div className="rounded-lg bg-primary-50 p-2">
            <Building2 className="h-5 w-5 text-primary-700" strokeWidth={1.75} />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-900">0</p>
            <p className="text-xs text-slate-500">Departments</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 !p-4">
          <div className="rounded-lg bg-emerald-50 p-2">
            <Percent className="h-5 w-5 text-emerald-700" strokeWidth={1.75} />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-900">0%</p>
            <p className="text-xs text-slate-500">Complete</p>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="mb-6 flex gap-4 border-b border-slate-200">
          {(['definition', 'locations', 'exclusions', 'departments'] as ScopingSubTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setScopingSubTab(tab)}
              className={`border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                scopingSubTab === tab
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              {tab === 'definition' ? 'Scope Definition' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {scopingSubTab === 'definition' && (
          <div className="space-y-6">
            <div>
              <label className="label">Scope Name</label>
              <input
                type="text"
                className="input"
                placeholder="Enter scope name..."
              />
            </div>
            <div>
              <label className="label">Description</label>
              <textarea
                className="input min-h-[100px]"
                placeholder="Describe the scope of the ISMS..."
              />
            </div>
            <div>
              <label className="label">Boundaries</label>
              <textarea
                className="input min-h-[100px]"
                placeholder="Define the boundaries of the ISMS..."
              />
            </div>
            <div className="flex gap-3">
              <button className="btn-secondary flex items-center gap-2">
                <Download className="h-4 w-4" />
                Download Scope Report
              </button>
              <button className="btn-primary flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Create Scope
              </button>
            </div>
          </div>
        )}

        {scopingSubTab === 'locations' && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <MapPin className="mb-4 h-12 w-12 text-slate-400" strokeWidth={1.75} />
            <h3 className="text-lg font-medium text-slate-900">No Locations Defined</h3>
            <p className="mt-1 text-slate-500">Add locations that are in scope for certification</p>
            <button className="btn-primary mt-4 flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add Location
            </button>
          </div>
        )}

        {scopingSubTab === 'exclusions' && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <XCircle className="mb-4 h-12 w-12 text-slate-400" strokeWidth={1.75} />
            <h3 className="text-lg font-medium text-slate-900">No Exclusions Defined</h3>
            <p className="mt-1 text-slate-500">Document any scope exclusions with justifications</p>
            <button className="btn-primary mt-4 flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add Exclusion
            </button>
          </div>
        )}

        {scopingSubTab === 'departments' && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Building2 className="mb-4 h-12 w-12 text-slate-400" strokeWidth={1.75} />
            <h3 className="text-lg font-medium text-slate-900">No Departments Defined</h3>
            <p className="mt-1 text-slate-500">Add departments that are in scope for certification</p>
            <button className="btn-primary mt-4 flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add Department
            </button>
          </div>
        )}
      </div>
    </div>
  );

  const renderSubControlsRecursive = (subControls: SubControlWithEvidence[], depth: number): JSX.Element => {
    const borderColors = ['border-primary-300', 'border-slate-300', 'border-primary-200'];
    const bgColors = ['bg-slate-50', 'bg-slate-50', 'bg-white'];
    const borderColor = borderColors[Math.min(depth, borderColors.length - 1)];
    const bgColor = bgColors[Math.min(depth, bgColors.length - 1)];
    
    return (
      <div className={`space-y-2 ${depth > 0 ? `pl-4 border-l-2 ${borderColor}` : `pl-4 border-l-2 ${borderColor}`}`}>
        {subControls.map((sub, idx) => {
          const key = makeSubControlKey(sub, depth, idx);
          const hasChildren = !!(sub.sub_controls && sub.sub_controls.length > 0);
          const isExpanded = expandedSubControlKeys.includes(key);

          return (
          <div key={sub.id || idx} className={`rounded-lg ${bgColor} border border-slate-200 p-3`}>
            <div className="flex items-start gap-3">
              <ChevronRight className={`h-4 w-4 mt-0.5 flex-shrink-0 ${depth === 0 ? 'text-primary-700' : depth === 1 ? 'text-primary-700' : 'text-primary-700'}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (hasChildren) {
                        toggleSubControl(key, { code: sub.code, depth, hasChildren });
                      } else {
                        focusControlByCode(sub.code);
                      }
                    }}
                    className="flex items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-primary-50"
                    title={hasChildren ? 'Expand/collapse sub-controls in place' : `Locate ${entityLabel.toLowerCase()} ${sub.code}`}
                  >
                    {hasChildren ? (
                      isExpanded ? <ChevronDown className="h-3 w-3 text-slate-600" /> : <ChevronRight className="h-3 w-3 text-slate-600" />
                    ) : null}
                    <span className={`font-mono text-xs ${depth === 0 ? 'text-primary-700' : depth === 1 ? 'text-primary-700' : 'text-primary-700'}`}>{sub.code}</span>
                    <span className="text-sm font-medium text-slate-900 underline decoration-dotted underline-offset-2">{sub.name}</span>
                  </button>
                  {depth > 0 && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">Level {depth + 1}</span>
                  )}
                </div>
                {sub.description && (
                  <p className="text-xs text-slate-600 mt-1 line-clamp-2">{sub.description}</p>
                )}
                {sub.evidence_requirements && sub.evidence_requirements.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {sub.evidence_requirements.slice(0, 4).map((ev, evIdx) => (
                      <span key={evIdx} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
                        {ev.title}
                      </span>
                    ))}
                    {sub.evidence_requirements.length > 4 && (
                      <span className="text-xs text-slate-600">+{sub.evidence_requirements.length - 4} more</span>
                    )}
                  </div>
                )}
                {(!sub.evidence_requirements || sub.evidence_requirements.length === 0) && sub.evidence_recommendations && sub.evidence_recommendations.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {sub.evidence_recommendations.slice(0, 4).map((rec, recIdx) => (
                      <span key={recIdx} className="rounded bg-primary-50 px-1.5 py-0.5 text-xs text-primary-700">
                        {rec}
                      </span>
                    ))}
                    {sub.evidence_recommendations.length > 4 && (
                      <span className="text-xs text-slate-600">+{sub.evidence_recommendations.length - 4} more</span>
                    )}
                  </div>
                )}
                {sub.sub_controls && sub.sub_controls.length > 0 && isExpanded && (
                  <div className="mt-3">
                    <p className="text-xs text-slate-600 mb-2">Sub-controls ({sub.sub_controls.length})</p>
                    {renderSubControlsRecursive(sub.sub_controls, depth + 1)}
                  </div>
                )}
              </div>
            </div>
          </div>
          );
        })}
      </div>
    );
  };

  const renderControlAccordion = (
    control: CertificationControl,
    showUpload = true,
    forceExpanded = false,
  ) => {
    // `forceExpanded` is set when the accordion is rendered inside the
    // spine's detail modal — the modal is the user's explicit request
    // for the deep view, so it stays open regardless of the per-row
    // expanded state used for the legacy inline-accordion tabs.
    const isExpanded = forceExpanded || expandedControls.includes(control.id);
    const category = getCategoryFromDomain(control.domain_name);
    const statusConfig: Record<string, { label: string; color: string }> = {
      not_started: { label: 'Not Implemented', color: 'bg-rose-50 text-rose-700' },
      in_progress: { label: 'Partial', color: 'bg-amber-50 text-amber-700' },
      implemented: { label: 'Implemented', color: 'bg-emerald-50 text-emerald-700' },
      verified: { label: 'Verified', color: 'bg-primary-50 text-primary-700' },
      not_applicable: { label: 'N/A', color: 'bg-slate-50 text-slate-700' },
    };
    const status = statusConfig[control.status] || statusConfig.not_started;
    const evidenceCount = control.evidence_count ?? (control.evidence ? control.evidence.length : 0);
    const requiredEvidenceCount = control.required_evidence_count ?? (control.evidence_requirements ? control.evidence_requirements.length : 0);
    const approvedEvidenceCount = control.approved_evidence_count ?? (control.evidence ? control.evidence.filter((ev) => ev.review_status === 'approved').length : 0);
    const hasEvidence = evidenceCount > 0;
    const evidenceCoverageValue = control.evidence_coverage ?? (requiredEvidenceCount > 0 ? Math.min(1, evidenceCount / requiredEvidenceCount) : hasEvidence ? 1 : 0);
    const isRequirementTextExpanded = expandedRequirementTextIds.includes(control.id);
    const requirementTextFull = control.control_statement_full || control.control_statement || '';
    const requirementTextShort = control.control_statement || requirementTextFull;
    const hasLongRequirementText = requirementTextFull.length > 160;
    
    return (
      <div id={`control-${control.id}`} key={control.id} className={forceExpanded ? '' : 'rounded-lg border border-slate-200 bg-white'}>
        {/* Accordion header. Hidden when forceExpanded is set — the
            spine modal owns its own header (code + name + scope/badge
            action bar) and rendering this row inside the modal would
            duplicate the title. Keyboard support is preserved via
            tabIndex + Enter/Space when the row is interactive. */}
        {!forceExpanded && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => toggleControl(control.id)}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
              e.preventDefault();
              toggleControl(control.id);
            }
          }}
          className="flex w-full items-center justify-between p-4 text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded-lg"
        >
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-slate-600 flex-shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-slate-600 flex-shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-primary-700">{control.control_code}</span>
                <span className="font-medium text-slate-900">{control.control_name}</span>
                {/* v2 Issue Management — show open-issue badge against this
                    control. Hides itself when there are none. Type guard via
                    `as any` matches the wider control-object pattern used
                    elsewhere in this file. */}
                {(() => {
                  const c = control as { framework_control_id?: number | null; parsed_control_id?: number | null };
                  if (c.framework_control_id) {
                    return <InlineIssueBadge sourceType="control_framework" sourceId={c.framework_control_id} />;
                  }
                  if (c.parsed_control_id) {
                    return <InlineIssueBadge sourceType="control_parsed" sourceId={c.parsed_control_id} />;
                  }
                  return null;
                })()}
              </div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                    Original: {control.original_control_code || control.control_code}
                  </span>
                  <span className="rounded bg-primary-50 px-2 py-0.5 text-xs text-primary-700">
                    System: {control.system_control_code || control.control_code}
                  </span>
                </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 ml-4">
            {control.is_critical && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-1 text-xs font-medium text-rose-700"
                title={control.criticality_reason || 'AI-flagged critical clause — requires reviewer approval to mark Not Applicable'}
              >
                <AlertTriangle className="h-3 w-3" />
                Critical
              </span>
            )}
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">{category}</span>
            {/* Inline scope toggle — one click flips applicability without
                opening the modal. Critical clauses still route the
                out-of-scope direction through the modal so the reviewer
                warning + justification step is preserved (backend records
                their decision as pending until approved). */}
            <div
              role="group"
              aria-label="Requirement scope"
              className="relative z-10 inline-flex items-center overflow-hidden rounded-lg border border-slate-300 text-xs"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                disabled={setApplicabilityMutation.isPending}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (control.is_applicable || !appFwId) return;
                  const parsedId = control.parsed_control_id ?? control.id;
                  setApplicabilityMutation.mutate({
                    control_id: parsedId,
                    uploaded_framework_id: appFwId,
                    is_applicable: true,
                    justification: '',
                  });
                }}
                title="Mark this requirement as part of scope"
                className={`px-2.5 py-1 transition-colors cursor-pointer disabled:opacity-50 ${control.is_applicable
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white text-slate-600 hover:bg-emerald-50 hover:text-emerald-700'}`}
              >
                In Scope
              </button>
              <button
                type="button"
                disabled={setApplicabilityMutation.isPending}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (!control.is_applicable || !appFwId) return;
                  // Always prompt for justification when marking Not Applicable —
                  // the audit trail needs a documented reason regardless of
                  // whether the clause was AI-flagged as critical. (Critical
                  // clauses get the additional reviewer-approval banner inside
                  // the modal; non-critical ones skip straight to a recorded
                  // decision.)
                  setApplicabilityModalControl(control);
                  setApplicabilityIsApplicable(false);
                  setApplicabilityJustification('');
                  setShowApplicabilityModal(true);
                }}
                title="Mark this requirement as out of scope (justification required)"
                className={`border-l border-slate-300 px-2.5 py-1 transition-colors cursor-pointer disabled:opacity-50 ${!control.is_applicable
                  ? 'bg-rose-600 text-white'
                  : 'bg-white text-slate-600 hover:bg-rose-50 hover:text-rose-700'}`}
              >
                Out of Scope
              </button>
            </div>
            <span className={`rounded-lg px-2 py-1 text-xs ${status.color}`}>{status.label}</span>
            <span className="text-xs text-slate-500">{approvedEvidenceCount}/{requiredEvidenceCount || '—'} approved</span>
            <span className="text-xs text-slate-500">{evidenceCount}/{requiredEvidenceCount || '—'} evidence</span>
            <div className="flex items-center gap-1">
              <Circle className={`h-4 w-4 ${hasEvidence ? 'text-emerald-600 fill-emerald-600' : 'text-slate-300'}`} />
              <span className="text-[10px] text-slate-500">{Math.round(evidenceCoverageValue * 100)}%</span>
            </div>
          </div>
        </div>
        )}
        {isExpanded && (
          <div className={forceExpanded ? '' : 'border-t border-slate-200 p-4'}>
            {/* Figure-2 identity fields — labelled (bold heading + value), one
                per field, so every value is clearly named (Domain Name, Domain
                ID, Control Name, Control ID, Priority, Version, Dependencies). */}
            {control.priority_level && (() => {
              const pl = control.priority_level || '';
              const domainId = (control.control_code || '').split('.')[0] || '—';
              const catRaw = control.objective_name || control.objective_code || '';
              const controlId = catRaw.includes(':')
                ? catRaw.split(':')[0].trim()
                : (control.control_code || '').split('.').slice(0, 2).join('.');
              const controlName = catRaw.includes(':')
                ? catRaw.split(':').slice(1).join(':').trim()
                : (catRaw || '—');
              const plMeta: Record<string, { yr: string; cls: string }> = {
                P1: { yr: 'Year 1', cls: 'bg-rose-50 text-rose-700' },
                P2: { yr: 'Year 2', cls: 'bg-amber-50 text-amber-700' },
                P3: { yr: 'Year 3', cls: 'bg-emerald-50 text-emerald-700' },
              };
              const m = plMeta[pl];
              const ver = (control.version_history && control.version_history[0]) || null;
              const L = 'text-[11px] font-bold uppercase tracking-wide text-slate-500';
              const V = 'mt-0.5 text-sm font-medium text-slate-800';
              const MONO = 'mt-0.5 font-mono text-sm font-semibold text-primary-700';
              return (
                <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50/40 px-4 py-3.5">
                  <div className="grid grid-cols-1 gap-x-10 gap-y-3 sm:grid-cols-2">
                    <div><p className={L}>Domain Name</p><p className={V}>{control.domain_name}</p></div>
                    <div><p className={L}>Domain ID</p><p className={MONO}>{domainId}</p></div>
                    <div><p className={L}>Control Name</p><p className={V}>{controlName}</p></div>
                    <div><p className={L}>Control ID</p><p className={MONO}>{controlId}</p></div>
                    <div>
                      <p className={L}>Priority</p>
                      <p className="mt-0.5"><span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${m ? m.cls : 'bg-slate-100 text-slate-600'}`}>{pl}{m ? ` · ${m.yr}` : ''}</span></p>
                    </div>
                    <div><p className={L}>Version</p><p className="mt-0.5 text-sm text-slate-700">{ver ? `${ver.version || '—'}${ver.date ? ' · ' + ver.date : ''}` : '—'}</p></div>
                    {control.control_description && (
                      <div className="sm:col-span-2 border-t border-slate-200 pt-3">
                        <p className={L}>Control Description</p>
                        <p className="mt-0.5 text-sm leading-relaxed text-slate-700">{control.control_description}</p>
                      </div>
                    )}
                    <div className="sm:col-span-2">
                      <p className={L}>Dependencies</p>
                      <p className="mt-0.5 text-sm text-slate-700">{control.dependencies && control.dependencies.length ? control.dependencies.join(', ') : 'None'}</p>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Specification requirement text (Figure-2 "Control Specification").
                Hidden for single-statement specs (exactly 1 criterion) since that
                criterion already shows the full requirement as the tickable item. */}
            {control.control_statement && control.assessment_criteria?.length !== 1 && (
              <div className="mb-3">
                {control.priority_level && (
                  <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Control Specification</p>
                )}
                <p className={`text-sm whitespace-pre-wrap break-words ${forceExpanded
                  ? 'rounded-lg border border-slate-200 bg-slate-50 p-4 leading-relaxed text-slate-700'
                  : 'text-slate-600'}`}>
                  {control.control_statement}
                </p>
              </div>
            )}

            {/* Assessment Criteria — weighted score calculator. Each criterion
                carries equal weight (100 / N); the spec score is the sum of met
                weights. Compliant only at 100% (all met) — NDMO-consistent. */}
            {control.assessment_criteria && control.assessment_criteria.length > 0 && (() => {
              const crits = control.assessment_criteria;
              const st = criteriaState[control.id] ?? control.criteria_status ?? {};
              const met = crits.filter((_, i) => st[String(i)]).length;
              const weight = Math.round(100 / crits.length);
              const pct = Math.round((met / crits.length) * 100);
              const status = pct === 100
                ? { label: 'Compliant', cls: 'bg-emerald-50 text-emerald-700', bar: 'bg-emerald-500' }
                : pct > 0
                  ? { label: 'In Progress', cls: 'bg-amber-50 text-amber-700', bar: 'bg-amber-500' }
                  : { label: 'Not Started', cls: 'bg-slate-100 text-slate-500', bar: 'bg-slate-300' };
              return (
                <div className="mb-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Assessment Criteria</p>
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${status.cls}`}>{status.label}</span>
                        <span className="text-sm font-bold text-slate-800">{pct}%</span>
                        <span className="text-xs text-slate-400">· {met}/{crits.length}</span>
                      </div>
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div className={`h-full rounded-full transition-all ${status.bar}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <ul className="divide-y divide-slate-50">
                    {crits.map((c, i) => {
                      const checked = !!st[String(i)];
                      return (
                        <li key={i}>
                          <button
                            type="button"
                            onClick={() => toggleCriterion(control, i)}
                            className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-slate-50"
                          >
                            <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] leading-none ${checked ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white text-transparent'}`}>✓</span>
                            <span className={`flex-1 text-[13px] leading-relaxed ${checked ? 'text-slate-700' : 'text-slate-600'}`}>
                              <span className="mr-1 font-mono text-xs text-slate-400">{i + 1}.</span>{c}
                            </span>
                            <span className="mt-0.5 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{weight}%</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
                    Each criterion = {weight}%. All must be met (with evidence) for this requirement to score 100%.
                  </div>
                </div>
              );
            })()}

            {/* Compliance Artifacts — inline per-requirement view of catalog
                items + tenant-created artifacts that match this clause's
                control_ref. Hidden when the framework has no artifact catalog
                or no items match this clause. Only mounted when the row is
                expanded so we don't fan out N queries on initial render. */}
            <RequirementArtifactsSection
              control={control}
              frameworkLabel={(journey as any)?.framework_name || journey?.name || ''}
              tenantUsers={(assignmentTenantUsers || []).map((u: any) => ({
                id: u.id,
                label: u.display_name || u.email || String(u.id),
                email: u.email ?? null,
              }))}
            />

            {/* Sub-controls section - recursive hierarchy */}
            {/* {control.sub_controls && control.sub_controls.length > 0 && (
              <div className="mb-6">
                <h4 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Layers className="h-4 w-4 text-primary-700" />
                  {entityLabel} Hierarchy ({control.sub_controls.length} sub-controls)
                </h4>
                {renderSubControlsRecursive(control.sub_controls, 0)}
              </div>
            )} */}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Linked Evidence - Now appears FIRST (left column) */}
              <div>
                {/* Compact "Assigned to" row, sitting above the evidence
                    upload control. Shows a count + names summary at a glance,
                    expands to the global MultiSelectDropdown picker on click.
                    Multi-assignee: any combination of users; clearing all
                    selections withdraws every assignment. */}
                {(() => {
                  const serverIds: number[] = control.assigned_user_ids
                    || (control.assigned_to_user_id ? [control.assigned_to_user_id] : []);
                  const serverNames = (control.assignees && control.assignees.length > 0)
                    ? control.assignees.map((a) => a.display_name)
                    : (control.assignee_name ? [control.assignee_name] : []);
                  const draftIds = assignDraftByControl[control.id] ?? serverIds;
                  const isOpen = assignPickerOpenFor === control.id;
                  const isPendingForThis = assignControlMutation.isPending
                    && assignControlMutation.variables?.controlId === control.id;
                  const isDirty = JSON.stringify([...draftIds].sort())
                    !== JSON.stringify([...serverIds].sort());

                  return (
                    <div className="mb-2">
                      <div className="flex items-start gap-2 text-xs">
                        <Users className="h-3.5 w-3.5 text-slate-500 mt-1 flex-shrink-0" />
                        <span className="text-slate-500 mt-1 flex-shrink-0">Assigned to:</span>
                        {serverNames.length === 0 ? (
                          <span className="italic text-slate-400 mt-1">Unassigned</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {serverNames.map((name, idx) => (
                              <span
                                key={`${idx}-${name}`}
                                className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
                              >
                                {name}
                              </span>
                            ))}
                          </div>
                        )}
                        {canEdit && !isOpen && (
                          <button
                            type="button"
                            onClick={() => {
                              setAssignDraftByControl((prev) => ({ ...prev, [control.id]: serverIds }));
                              setAssignPickerOpenFor(control.id);
                            }}
                            className="ml-auto flex items-center gap-1 rounded bg-primary-600 px-3 py-1.5 text-xs font-medium text-[color:var(--color-on-base,#0a0a0a)] hover:bg-primary-700"
                          >
                            {serverNames.length ? 'Change' : 'Assign'}
                          </button>
                        )}
                      </div>

                      {isOpen && (
                        <div className="mt-2 flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <MultiSelectDropdown
                              title="Assignees"
                              items={(assignmentTenantUsers || []).map((u: any) => ({
                                value: String(u.id),
                                label: u.display_name || u.username || u.email || `User #${u.id}`,
                                subLabel: u.email,
                              }))}
                              selectedValues={draftIds.map(String)}
                              onApply={(values) =>
                                setAssignDraftByControl((prev) => ({
                                  ...prev,
                                  [control.id]: values.map(Number),
                                }))
                              }
                              multiSelect
                              autoApply
                              forceSearch
                              triggerVariant="input"
                              triggerClassName="w-full"
                              placeholder={
                                draftIds.length === 0
                                  ? 'Select users...'
                                  : `${draftIds.length} selected`
                              }
                              searchPlaceholder="Search users"
                              size="sm"
                            />
                          </div>
                          {/* Assign button — same dimensions as the Upload button below. */}
                          <button
                            type="button"
                            onClick={() =>
                              assignControlMutation.mutate({
                                controlId: control.id,
                                userIds: draftIds,
                              })
                            }
                            disabled={!isDirty || isPendingForThis}
                            className="flex items-center gap-1 rounded bg-primary-600 px-3 py-1.5 text-xs font-medium text-[color:var(--color-on-base,#0a0a0a)] hover:bg-primary-700 disabled:bg-slate-400 disabled:cursor-not-allowed"
                          >
                            {isPendingForThis ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Check className="h-3 w-3" />
                            )}
                            {draftIds.length === 0 ? 'Withdraw' : 'Assign'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setAssignPickerOpenFor(null)}
                            className="rounded border border-slate-300 px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                          >
                            Close
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div className="flex items-center justify-between mb-4">
                  <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Paperclip className="h-4 w-4 text-primary-700" />
                    Linked Evidence ({evidenceCount})
                  </h4>
                  {showUpload && canCreate && (
                    <label className="cursor-pointer">
                      <input
                        type="file"
                        className="hidden"
                        onChange={(e) => handleFileUpload(control.id, e)}
                        disabled={uploadingControlId === control.id}
                      />
                      <span className="flex items-center gap-1 rounded bg-primary-600 px-3 py-1.5 text-xs font-medium text-[color:var(--color-on-base,#0a0a0a)] hover:bg-primary-700">
                        {uploadingControlId === control.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Upload className="h-3 w-3" />
                        )}
                        Upload
                      </span>
                    </label>
                  )}
                </div>
                {control.evidence?.length > 0 ? (
                  <div className="space-y-2">
                    {control.evidence.map((ev: ControlEvidence) => {
                      const getAIAssessmentBadge = () => {
                        const status = ev.ai_assessment_status || 'pending';
                        switch (status) {
                          case 'completed':
                            return { label: 'Assessed', className: 'bg-emerald-50 text-emerald-700' };
                          case 'processing':
                            return { label: 'Assessing...', className: 'bg-amber-50 text-amber-700' };
                          case 'pending_assessment':
                            return { label: 'Ready for Assessment', className: 'bg-primary-50 text-primary-700' };
                          case 'pending_ocr':
                            return { label: 'Processing...', className: 'bg-slate-50 text-slate-700' };
                          default:
                            return { label: 'Pending', className: 'bg-slate-50 text-slate-700' };
                        }
                      };
                      const aiBadge = getAIAssessmentBadge();
                      const canAssess = ev.ai_assessment_status === 'pending_assessment' || ev.ai_assessment_status === 'pending' || !ev.ai_assessment_status;
                      const isAssessing = assessingEvidenceId === ev.id;
                      const isPendingReview = ev.review_status === 'pending';
                      
                      return (
                        <div key={ev.id} className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                          <div className="flex items-center gap-3">
                            <Paperclip className="h-4 w-4 text-slate-600 flex-shrink-0" />
                            {ev.linked_evidence_id ? (
                              <Link
                                href={`/evidence/${ev.linked_evidence_id}`}
                                className="flex-1 min-w-0 group"
                                title="Open evidence detail"
                              >
                                <p className="text-sm text-slate-900 truncate group-hover:text-primary-700 group-hover:underline">{ev.file_name || 'Evidence file'}</p>
                                <p className="text-xs text-slate-500">{ev.uploaded_at ? new Date(ev.uploaded_at).toLocaleDateString() : ''}</p>
                              </Link>
                            ) : (
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-slate-900 truncate">{ev.file_name || 'Evidence file'}</p>
                                <p className="text-xs text-slate-500">{ev.uploaded_at ? new Date(ev.uploaded_at).toLocaleDateString() : ''}</p>
                              </div>
                            )}
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className={`rounded px-2 py-0.5 text-xs ${aiBadge.className}`} title={ev.ai_assessment_summary || ''}>
                                {aiBadge.label}
                              </span>
                              <span className={`rounded px-2 py-0.5 text-xs ${
                                ev.review_status === 'approved' ? 'bg-emerald-50 text-emerald-700' :
                                ev.review_status === 'rejected' ? 'bg-rose-50 text-rose-700' :
                                'bg-amber-50 text-amber-700'
                              }`}>
                                {ev.review_status}
                              </span>
                            </div>
                          </div>
                          {ev.ai_assessment_summary && (
                            <div className="mt-2 ml-7 rounded bg-white border border-slate-200 p-2">
                              <p className="text-xs text-slate-700">{ev.ai_assessment_summary}</p>
                            </div>
                          )}
                          {/* Action buttons row */}
                          <div className="mt-3 ml-7 flex items-center gap-2 flex-wrap">
                            {ev.file_path && (
                              <button
                                onClick={() => setPreviewEvidenceFile({
                                  // Set evidence_id so the viewer hits
                                  // /evidence/{id}/preview (the tenant-
                                  // checked endpoint) instead of trying
                                  // to GET file_path as a URL.
                                  evidence_id: ev.id,
                                  file_path: ev.file_path!,
                                  file_name: ev.file_name || 'evidence',
                                  mime_type: ev.mime_type,
                                  file_size: ev.file_size,
                                })}
                                className="flex items-center gap-1 rounded bg-primary-50 px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-100"
                                title="Preview evidence file in-browser"
                              >
                                <Eye className="h-3 w-3" />
                                Preview
                              </button>
                            )}
                            {isPendingReview && canEdit && (
                              <>
                                <button
                                  onClick={() => {
                                    reviewEvidenceMutation.mutate({ evidenceId: ev.id, action: 'approve' });
                                  }}
                                  disabled={reviewEvidenceMutation.isPending}
                                  className="flex items-center gap-1 rounded bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                                  title="Approve evidence"
                                >
                                  <CheckCircle className="h-3 w-3" />
                                  Approve
                                </button>
                                <button
                                  onClick={() => {
                                    reviewEvidenceMutation.mutate({ evidenceId: ev.id, action: 'reject' });
                                  }}
                                  disabled={reviewEvidenceMutation.isPending}
                                  className="flex items-center gap-1 rounded bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                                  title="Reject evidence"
                                >
                                  <XCircle className="h-3 w-3" />
                                  Reject
                                </button>
                              </>
                            )}
                            {canAssess && ev.linked_evidence_id && (
                              <button
                                onClick={() => {
                                  setAssessingEvidenceId(ev.id);
                                  assessEvidenceMutation.mutate(ev.linked_evidence_id!);
                                }}
                                disabled={isAssessing}
                                className="flex items-center gap-1 rounded bg-primary-600 px-2 py-1 text-xs font-medium text-[color:var(--color-on-base,#0a0a0a)] hover:bg-primary-700 disabled:opacity-50"
                                title="Trigger AI assessment"
                              >
                                {isAssessing ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Sparkles className="h-3 w-3" />
                                )}
                                Assess
                              </button>
                            )}
                            {canDelete && <button
                              onClick={() => {
                                if (window.confirm('Unlink this evidence from the control? The evidence will remain in your evidence library.')) {
                                  setDeletingEvidenceId(ev.id);
                                  deleteEvidenceMutation.mutate(ev);
                                }
                              }}
                              disabled={deletingEvidenceId === ev.id}
                              className="flex items-center gap-1 rounded bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                              title="Unlink evidence from this control"
                            >
                              {deletingEvidenceId === ev.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Unlink className="h-3 w-3" />
                              )}
                              Unlink
                            </button>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center">
                    <Paperclip className="mx-auto h-8 w-8 text-slate-400 mb-2" />
                    <p className="text-sm text-slate-900">No evidence linked yet</p>
                    <p className="text-xs text-slate-600 mt-1">Upload evidence to comply</p>
                  </div>
                )}
              </div>
              {/* Required Evidence - Now appears SECOND (right column) */}
              <div>
                <h4 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <FileCheck className="h-4 w-4 text-primary-700" />
                  Required Evidence for {entityLabel} {control.control_code}
                </h4>
                {control.evidence_requirements?.length > 0 ? (
                  <div className="space-y-2">
                    {control.evidence_requirements.map((ev, idx: number) => {
                      const evType = ev.type || 'document';
                      // Categorical evidence-type markers render as neutral slate;
                      // only genuinely status-bearing types keep a semantic tone
                      // (certificate → emerald, contract/audit → amber). Policy is
                      // the single teal accent.
                      const typeColors: Record<string, string> = {
                        'policy': 'bg-primary-50 text-primary-700',
                        'procedure': 'bg-slate-100 text-slate-600',
                        'log': 'bg-slate-100 text-slate-600',
                        'report': 'bg-slate-100 text-slate-600',
                        'screenshot': 'bg-slate-100 text-slate-600',
                        'record': 'bg-slate-100 text-slate-600',
                        'configuration': 'bg-slate-100 text-slate-600',
                        'certificate': 'bg-emerald-50 text-emerald-700',
                        'contract': 'bg-amber-50 text-amber-700',
                        'attestation': 'bg-slate-100 text-slate-600',
                        'test_results': 'bg-slate-100 text-slate-600',
                        'register': 'bg-slate-100 text-slate-600',
                      };
                      const typeColor = typeColors[evType] || 'bg-slate-100 text-slate-600';
                      const typeLabel = evType.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                      const rawFiletype = (ev.filetype || ev.format || ev.evidence_format || '').toString().toLowerCase().replace(/^\./, '');
                      const isDocumentExt = ['pdf', 'doc', 'docx', 'docs', 'xls', 'xlsx'].includes(rawFiletype);
                      const filetypeLabel = !rawFiletype
                        ? null
                        : isDocumentExt
                          ? 'Document'
                          : rawFiletype.toUpperCase();
                      
                      return (
                        <div key={`${idx}`} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 hover:bg-slate-50/60 transition-colors">
                          <div className="flex items-center gap-3">
                            <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md ${typeColor.replace('100', '50').replace('text-', 'text-')}`}>
                              <Radio className="h-3.5 w-3.5" />
                            </div>
                            <div className="min-w-0 flex-shrink">
                              <p className="text-sm font-medium text-slate-900 leading-tight truncate">{ev.title}</p>
                              {(() => {
                                const titleText = (ev.title || '').trim();
                                const descText = (ev.description || '').trim();
                                const isDuplicate = titleText.toLowerCase() === descText.toLowerCase();
                                return !descText || isDuplicate ? null : (
                                  <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{ev.description}</p>
                                );
                              })()}
                              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${typeColor}`}>
                                  {typeLabel}
                                </span>
                                {filetypeLabel && (
                                  <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-600">
                                    {filetypeLabel}
                                  </span>
                                )}
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${ev.is_required !== false ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-700'}`}>
                                  {ev.is_required !== false ? 'Required' : 'Optional'}
                                </span>
                              </div>
                            </div>
                            {showUpload && (
                              <label className="ml-auto cursor-pointer flex-shrink-0">
                                <input
                                  type="file"
                                  className="hidden"
                                  onChange={(e) => handleFileUpload(control.id, e)}
                                  disabled={uploadingControlId === control.id}
                                />
                                <span className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-2.5 py-1 text-xs font-medium text-[color:var(--color-on-base,#0a0a0a)] hover:bg-primary-700 shadow-sm">
                                  {uploadingControlId === control.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Upload className="h-3.5 w-3.5" />
                                  )}
                                  Upload
                                </span>
                              </label>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  control.evidence_recommendations?.length ? (
                    <div className="rounded-lg bg-white border border-slate-200 p-4">
                      <p className="mb-2 text-sm font-medium text-slate-900">Recommended Evidence</p>
                      <div className="flex flex-wrap gap-2">
                        {control.evidence_recommendations.map((rec: string, idx: number) => (
                          <span key={idx} className="rounded bg-primary-50 px-2 py-1 text-xs text-primary-700">{rec}</span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg bg-white border border-dashed border-slate-300 p-4 text-center">
                      <p className="text-sm text-slate-900">No evidence requirements defined</p>
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderSoaTab = () => {
    const soaChartData = [
      { name: 'Implemented', value: controlStats.implemented, fill: '#22c55e' },
      { name: 'In Progress',  value: controlStats.partial,      fill: '#f59e0b' },
      { name: 'Not Impl.',    value: controlStats.notImplemented, fill: '#ef4444' },
      { name: 'Not Applic.',  value: controlStats.notApplicable,  fill: '#94a3b8' },
    ].filter((d) => d.value > 0);
    const soaTotal = controlStats.total;
    return (
    <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* Donut: implementation status */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Implementation Status</p>
            <div className="flex items-center gap-4">
              <div className="relative h-[110px] w-[110px] flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={soaChartData.length ? soaChartData : [{ name: 'None', value: 1, fill: '#e2e8f0' }]}
                      cx="50%" cy="50%" innerRadius={30} outerRadius={50} dataKey="value" paddingAngle={2} stroke="none">
                      {(soaChartData.length ? soaChartData : [{ name: 'None', value: 1, fill: '#e2e8f0' }]).map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-lg font-bold text-slate-900">{soaTotal}</span>
                  <span className="text-[10px] text-slate-400">controls</span>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                {soaChartData.map((d) => (
                  <div key={d.name} className="flex items-center gap-2 text-xs">
                    <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: d.fill }} />
                    <span className="text-slate-500">{d.name}</span>
                    <span className="font-semibold text-slate-800 ml-auto">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Coverage progress bar */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Coverage</p>
            {[{ label: 'Applicable', value: controlStats.applicable, total: soaTotal, color: '#1ed4b0' },
              { label: 'Implemented', value: controlStats.implemented, total: Math.max(controlStats.applicable, 1), color: '#22c55e' },
            ].map(({ label, value, total: t, color }) => {
              const pct = t > 0 ? Math.round((value / t) * 100) : 0;
              return (
                <div key={label} className="mb-3">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-500">{label}</span>
                    <span className="font-semibold text-slate-800">{value} / {t} <span className="text-slate-400">({pct}%)</span></span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Stats summary */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Breakdown</p>
            <div className="space-y-2">
              {[{ label: 'Total Controls', value: controlStats.total, color: '' },
                { label: 'Applicable',     value: controlStats.applicable, color: 'text-primary-700' },
                { label: 'Not Applicable', value: controlStats.notApplicable, color: 'text-slate-500' },
                { label: 'Implemented',    value: controlStats.implemented,   color: 'text-green-600' },
                { label: 'In Progress',    value: controlStats.partial,       color: 'text-amber-600' },
                { label: 'Not Impl.',      value: controlStats.notImplemented, color: 'text-red-500' },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex justify-between text-xs">
                  <span className="text-slate-500">{label}</span>
                  <span className={`font-semibold ${color || 'text-slate-800'}`}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

      <div className="card">
        <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-slate-200 pb-4">
          {([
            { key: 'all', label: 'All', count: controlStats.total },
            { key: 'organizational', label: 'Organizational', count: controlStats.byCategory.organizational },
            { key: 'people', label: 'People', count: controlStats.byCategory.people },
            { key: 'physical', label: 'Physical', count: controlStats.byCategory.physical },
            { key: 'technological', label: 'Technological', count: controlStats.byCategory.technological },
          ] as { key: CategoryFilter; label: string; count: number }[]).map((cat) => (
            <button
              key={cat.key}
              onClick={() => setCategoryFilter(cat.key)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                categoryFilter === cat.key
                  ? 'bg-primary-500 text-[color:var(--color-on-base,#0a0a0a)]'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-900'
              }`}
            >
              {cat.label} ({cat.count})
            </button>
          ))}
        </div>

        <div className="mb-4 flex gap-4 items-center justify-end">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="input w-48"
          >
            <option value="all">All Status</option>
            <option value="implemented">Implemented</option>
            <option value="not_implemented">Not Implemented</option>
            <option value="partial">Partial</option>
          </select>
        </div>

        <div className="space-y-3">
          {filteredControls.length > 0 ? (
            filteredControls.map((control: CertificationControl) => renderControlAccordion(control))
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Shield className="mb-4 h-12 w-12 text-slate-400" />
              <p className="text-slate-600">No {entityLabelPlural.toLowerCase()} found</p>
              <p className="mt-1 text-sm text-slate-500">Try adjusting your filters</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
  };

  const renderAssignedToMeTab = () => {
    const assignedToMe = (controls || []).filter((c: CertificationControl) => {
      if (currentUserId === null) return false;
      const ids = c.assigned_user_ids
        || (c.assigned_to_user_id ? [c.assigned_to_user_id] : []);
      return ids.includes(currentUserId);
    });

    if (currentUserId === null) {
      return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary-700 mx-auto" />
          <p className="mt-3 text-sm text-slate-600">Loading your assignments...</p>
        </div>
      );
    }

    // Reuse the exact same progress-spine renderer as the main
    // Requirements (Controls) tab — same numbered section anchors,
    // L-junction branches, compact cards, requirement-detail modal,
    // and ?req=N URL state. The only differences are the slice of
    // controls (only the ones assigned to the current user) and the
    // summary banner copy (focus on the user's queue, not the
    // framework total).
    const assignedSections = buildRequirementSections(assignedToMe);
    return renderRequirementsSpine(assignedSections, {
      title: 'Your assigned requirements',
      subtitle: `${assignedToMe.length} requirement${assignedToMe.length === 1 ? '' : 's'} assigned to you`,
      hideAttestationEstimate: true,
    });
  };

  /**
   * Vertical "Progress spine" renderer for the requirements list. Each
   * top-level section becomes a numbered circle anchored to a vertical
   * spine; controls inside that section render with the existing
   * `renderControlAccordion` so the actual per-clause content stays
   * unchanged — only the surrounding hierarchy/visual rhythm is new.
   *
   * The summary banner at the top is built from the framework progress
   * payload (implementedCount, inProgressCount, totalControlsProgress).
   * In-review = `in_progress` controls; "to start" = the residual.
   */
  /**
   * Render the progress-spine layout. By default sources its sections
   * from the page-level `requirementSections` (filteredControls), but
   * callers can pass `customSections` + `summaryOverride` to reuse the
   * exact same visual on a different slice — that's how the Assigned-
   * to-me tab gets the spine treatment without duplicating any markup.
   *
   * `summaryOverride` swaps the top "your assessment" banner for a
   * caller-specific one; counts inside (compliant / in review / to
   * start) are recomputed from the supplied sections so the bar always
   * reflects the actual list being shown.
   */
  const renderRequirementsSpine = (
    customSections?: RequirementSection[],
    summaryOverride?: { title: string; subtitle?: string; hideAttestationEstimate?: boolean },
  ) => {
    const sectionsToRender = customSections ?? requirementSections;
    const isCustom = !!customSections;

    // When rendering a custom slice (e.g. "assigned to me"), recompute
    // every count from the slice itself — the framework-wide totals
    // would lie. For the default page-level call we use the
    // pre-aggregated progress payload because it already accounts for
    // controls that were trimmed by the search/category/status filters
    // (which we still want represented in the summary).
    const allSlice = sectionsToRender.flatMap((s) => s.controls);
    const compliant = isCustom
      ? allSlice.filter((c) => c.status === 'implemented' || c.status === 'verified').length
      : implementedCount + verifiedCount;
    const inReview = isCustom
      ? allSlice.filter((c) => c.status === 'in_progress').length
      : inProgressCount;
    const totalForBar = isCustom
      ? allSlice.length
      : (totalControlsProgress || filteredControls.length || 0);
    const naForBar = isCustom
      ? allSlice.filter((c) => c.status === 'not_applicable').length
      : notApplicableCount;
    const toStart = Math.max(0, totalForBar - compliant - inReview - naForBar);

    const compliantPct = totalForBar > 0 ? (compliant / totalForBar) * 100 : 0;
    const inReviewPct = totalForBar > 0 ? (inReview / totalForBar) * 100 : 0;
    const naPct = totalForBar > 0 ? (naForBar / totalForBar) * 100 : 0;

    const sectionsInProgress = sectionsToRender.filter((s) =>
      s.controls.some((c) => c.status === 'in_progress')
        || s.controls.some((c) => c.status !== 'implemented' && c.status !== 'verified' && c.status !== 'not_applicable'),
    ).length;
    const totalSections = sectionsToRender.length;
    const fwName = (journey as any)?.framework_name || journey?.framework?.name || journey?.name || 'Framework';
    const summaryTitle = summaryOverride?.title ?? `${fwName} — your assessment`;
    const defaultSubtitle = totalSections > 0
      ? `Section ${Math.min(sectionsInProgress + 1, totalSections)} of ${totalSections} in progress`
      : 'No sections yet';
    const summarySubtitle = summaryOverride?.subtitle ?? defaultSubtitle;
    const completionPct = totalForBar > 0 ? Math.round((compliant / totalForBar) * 100) : 0;
    const displayCompletionPct = isCustom ? completionPct : Math.round(completionPercentage);

    return (
      <div className="space-y-6">
        {/* ===== Top "your assessment" summary card =====
            Multi-segment bar with compliant / in-review / to-start
            counts so the user gets the whole story at a glance. */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
            <div className="min-w-0">
              <h2 className="text-xl font-semibold text-slate-900 leading-tight">
                {summaryTitle}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {summarySubtitle}
                {!summaryOverride?.hideAttestationEstimate && (journey as any)?.due_date && (() => {
                  const dueRaw = (journey as any).due_date as string;
                  const days = Math.max(0, Math.round((new Date(dueRaw).getTime() - Date.now()) / 86_400_000));
                  return ` · est. ${days} day${days === 1 ? '' : 's'} to attestation`;
                })()}
              </p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-3xl font-bold text-emerald-700 leading-none">
                {displayCompletionPct}<span className="text-base text-emerald-600/70">%</span>
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {compliant} of {totalForBar} {isCustom ? 'assigned' : 'controls'} compliant
              </p>
            </div>
          </div>

          <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100 flex">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${compliantPct}%` }} title={`${compliant} compliant`} />
            <div className="h-full bg-orange-500 transition-all" style={{ width: `${inReviewPct}%` }} title={`${inReview} in review`} />
            <div className="h-full bg-slate-300 transition-all" style={{ width: `${naPct}%` }} title={`${naForBar} N/A`} />
          </div>

          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="font-semibold text-slate-900">{compliant}</span> compliant
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-orange-500" />
              <span className="font-semibold text-slate-900">{inReview}</span> in review
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-slate-300" />
              <span className="font-semibold text-slate-900">{toStart}</span> to start
            </span>
            {naForBar > 0 && (
              <span className="inline-flex items-center gap-1.5 text-slate-500">
                <span className="h-2 w-2 rounded-full bg-slate-400" />
                <span className="font-semibold">{naForBar}</span> N/A
              </span>
            )}
          </div>
        </div>

        {/* ===== Spine ===== */}
        {sectionsToRender.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center bg-white border border-slate-200 rounded-xl">
            <Shield className="mb-4 h-12 w-12 text-slate-400" />
            <p className="text-slate-600">No {entityLabelPlural.toLowerCase()} found</p>
            <p className="mt-1 text-sm text-slate-500">Try adjusting your filters</p>
          </div>
        ) : (
          <div className="relative">
            {sectionsToRender.map((section, idx) => {
              const sCompliant = section.controls.filter((c) =>
                c.status === 'implemented' || c.status === 'verified',
              ).length;
              const sTotal = section.controls.length;
              const sRemaining = Math.max(0, sTotal - sCompliant);
              const isLast = idx === sectionsToRender.length - 1;
              const displayNum = section.sectionNumber ?? (idx + 1);

              return (
                <div key={section.key} className="relative pl-16 pb-8 last:pb-0">
                  {/* Numbered anchor circle — the "trunk node" the
                      section's spine grows out of. Thicker border to
                      match the trunk, soft ring shadow to lift it off
                      the page, and the emerald-600 ink matches the
                      branches below so the whole hierarchy reads as
                      one connected tree. */}
                  <div
                    className={`absolute left-0 top-0 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-white text-base font-semibold shadow-md ring-4 ring-white transition-colors ${
                      sCompliant === sTotal
                        ? 'border-[3px] border-emerald-600 text-emerald-700'
                        : sCompliant > 0
                          ? 'border-[3px] border-emerald-600 text-emerald-700'
                          : 'border-[3px] border-slate-400 text-slate-600'
                    }`}
                  >
                    {displayNum}
                  </div>
                  {/* Vertical spine line connecting to the next section.
                      Thicker (1.5px) and darker (emerald-600) so the
                      hierarchy reads at a glance — this is the trunk of
                      the tree the requirements branch off of. */}
                  {!isLast && (
                    <div className="absolute left-6 top-12 -ml-[0.75px] w-[3px] h-[calc(100%-3rem)] rounded-full bg-emerald-600/80" />
                  )}

                  {/* Section header */}
                  <div className="mb-3">
                    <h3 className="text-lg font-semibold text-slate-900 leading-tight">{section.label}</h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      <span className="text-emerald-700 font-medium">{sCompliant}</span> of {sTotal} compliant
                      {sRemaining > 0 && (
                        <> · <span className="text-slate-700">{sRemaining}</span> to go</>
                      )}
                    </p>
                  </div>

                  {/* Compact spine cards. Each card is a click-target
                      that opens the requirement detail modal — keeps
                      the spine visually quiet while still surfacing the
                      key per-row signal (status dot, code, name,
                      critical / evidence count). The L-junction line
                      on the left visually anchors each card to the
                      section's spine. */}
                  <div className="relative space-y-2">
                    {section.controls.map((control: CertificationControl, ctrlIdx: number) => {
                      const isCompliant = control.status === 'implemented' || control.status === 'verified';
                      const isInProgress = control.status === 'in_progress';
                      const isNA = control.status === 'not_applicable';
                      const dotClass = isCompliant
                        ? 'bg-emerald-600 border-emerald-600'
                        : isInProgress
                          ? 'bg-orange-500 border-orange-500'
                          : isNA
                            ? 'bg-slate-300 border-slate-300'
                            : 'bg-white border-slate-300';
                      const statusLabel = isCompliant
                        ? 'Compliant'
                        : isInProgress
                          ? 'In progress'
                          : isNA
                            ? 'Not applicable'
                            : 'Not implemented';
                      const evidenceTotal = control.required_evidence_count
                        ?? (control.evidence_requirements?.length || 0);
                      const evidenceApproved = control.approved_evidence_count
                        ?? (control.evidence?.filter((e) => e.review_status === 'approved').length || 0);
                      const isLastCard = ctrlIdx === section.controls.length - 1;
                      // Control grouping (NDMO Domain → Control → Specification).
                      // The control id/name come from `objective_*` (e.g.
                      // "DG.1: Strategy and Plan"). Render a control sub-header
                      // before the first specification of each control.
                      const _cat = control.objective_code || control.objective_name || '';
                      const ctrlGroupId = _cat.includes(':') ? _cat.split(':')[0].trim() : '';
                      const ctrlGroupName = _cat.includes(':') ? _cat.split(':').slice(1).join(':').trim() : '';
                      const _prev = section.controls[ctrlIdx - 1];
                      const _prevCat = _prev ? (_prev.objective_code || _prev.objective_name || '') : '';
                      const _prevId = _prevCat.includes(':') ? _prevCat.split(':')[0].trim() : '';
                      const isNewControl = !!ctrlGroupId && ctrlGroupId !== _prevId;
                      // Each requirement's branch reads as a true tree:
                      // a vertical leg dropping from the parent trunk
                      // turns into a horizontal arm that meets the card.
                      // We draw the joint with a rounded-top-left corner
                      // so it bends visually instead of looking like two
                      // disconnected sticks. The vertical sliver under
                      // the last card is hidden so the rail terminates
                      // cleanly under the final requirement of the
                      // section.
                      return (
                        <Fragment key={control.id}>
                        {/* Control sub-header (NDMO control level) — appears
                            once above the first specification of each control. */}
                        {isNewControl && (
                          <div className={`flex items-center gap-2 ${ctrlIdx === 0 ? '' : 'pt-3'} pb-0.5`}>
                            <span className="font-mono text-xs font-semibold text-slate-500">{ctrlGroupId}</span>
                            <span className="text-sm font-semibold text-slate-700">{ctrlGroupName}</span>
                          </div>
                        )}
                        <div className="relative">
                          {/* Vertical leg dropping from the parent
                              section spine down to this card's row.
                              For sibling cards it continues to the next;
                              for the final card it stops at the bend. */}
                          <div
                            aria-hidden="true"
                            className="absolute -left-[2.625rem] top-0 w-[3px] bg-emerald-600/80"
                            style={{ height: isLastCard ? '1.625rem' : 'calc(100% + 0.5rem)' }}
                          />
                          {/* Rounded L-junction: horizontal arm with a
                              soft corner where it meets the vertical
                              leg. Drawn as a single rounded segment so
                              the bend looks intentional, not stuck-on. */}
                          <div
                            aria-hidden="true"
                            className="absolute -left-[2.625rem] top-[1.4rem] h-[3px] w-6 bg-emerald-600/80 rounded-bl-md"
                            style={{ borderBottomLeftRadius: '0', borderTopLeftRadius: '0' }}
                          />
                          {/* Soft circular bullet where the arm meets
                              the card — gives the branch a finished
                              "node" feel and helps the eye land on the
                              row anchor. */}
                          <div
                            aria-hidden="true"
                            className="absolute -left-[1.05rem] top-[1.25rem] h-2 w-2 rounded-full border-2 border-emerald-600 bg-white"
                          />
                          <button
                            type="button"
                            onClick={() => openSpineControl(control)}
                            className="w-full text-left rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-emerald-300 hover:shadow-sm transition-all group"
                          >
                            <div className="flex items-center gap-3">
                              {/* Status dot */}
                              <span className={`h-4 w-4 flex-shrink-0 rounded-full border-2 ${dotClass}`} />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-mono text-sm font-medium text-primary-700">{control.control_code}</span>
                                  <span className="text-sm font-medium text-slate-900 truncate">{control.control_name}</span>
                                  {control.is_critical && (
                                    <span
                                      className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-700"
                                      title={control.criticality_reason || 'AI-flagged critical clause'}
                                    >
                                      Critical
                                    </span>
                                  )}
                                </div>
                                <p className="mt-0.5 text-xs text-slate-500">
                                  {statusLabel}
                                  {evidenceTotal > 0 && (
                                    <> · {evidenceApproved}/{evidenceTotal} evidence approved</>
                                  )}
                                </p>
                              </div>
                              <span className="flex-shrink-0 inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 group-hover:border-emerald-400 group-hover:text-emerald-700">
                                {isCompliant || isNA ? 'View' : 'Continue →'}
                              </span>
                            </div>
                          </button>
                        </div>
                        </Fragment>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderHistoryTab = () => {
    const list = snapshots || [];
    return (
      <div className="space-y-4">
        <div className="cw-card p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-lg font-semibold cw-text">
                <Clock className="h-5 w-5 text-primary-700" />
                Compliance History
              </h3>
              <p className="mt-0.5 text-sm text-slate-500">Year-by-year record of compliance. NDMO requires an annual assessment — capture a snapshot to keep a permanent, immutable record.</p>
            </div>
            <button
              type="button"
              onClick={captureSnapshot}
              disabled={capturingSnapshot}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-[color:var(--color-on-base,#0a0a0a)] transition-colors hover:bg-primary-700 disabled:opacity-50"
            >
              {capturingSnapshot ? 'Capturing…' : '+ Capture Snapshot'}
            </button>
          </div>

          {list.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 py-12 text-center text-sm text-slate-400">
              No snapshots yet. Click <span className="font-semibold text-slate-500">Capture Snapshot</span> to record this year&apos;s compliance state.
            </div>
          ) : (
            <div className="space-y-3">
              {list.map((s) => {
                const open = openSnapshotId === s.id;
                const tiers = s.breakdown?.tiers || {};
                const domains = s.breakdown?.domains || [];
                return (
                  <div key={s.id} className="overflow-hidden rounded-lg border border-slate-200">
                    <button
                      type="button"
                      onClick={() => setOpenSnapshotId(open ? null : s.id)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
                    >
                      <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-800">{s.label || (s.year ? String(s.year) : 'Snapshot')}</p>
                        <p className="text-xs text-slate-400">{s.captured_at ? new Date(s.captured_at).toLocaleString() : ''}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <span className="text-lg font-bold text-slate-900">{s.overall_pct}%</span>
                        <p className="text-[11px] text-slate-400">{s.compliant_count}/{s.total_count} compliant</p>
                      </div>
                    </button>
                    {open && (
                      <div className="border-t border-slate-100 bg-slate-50/40 p-4">
                        <div className="mb-3 grid grid-cols-3 gap-3">
                          {(['P1', 'P2', 'P3'] as const).map((pl) => {
                            const t = tiers[pl] || { total: 0, compliant: 0, avg: 0 };
                            return (
                              <div key={pl} className="rounded-lg border border-slate-200 bg-white p-2 text-center">
                                <div className="text-xs font-semibold text-slate-600">{pl} · Year {pl === 'P1' ? '1' : pl === 'P2' ? '2' : '3'}</div>
                                <div className="text-base font-bold text-slate-800">{t.avg}%</div>
                                <div className="text-[10px] text-slate-400">{t.compliant}/{t.total} compliant</div>
                              </div>
                            );
                          })}
                        </div>
                        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">By Domain</p>
                        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                          {domains.map((d) => (
                            <div key={d.domain} className="flex items-center gap-3 text-xs">
                              <span className="w-44 shrink-0 truncate text-slate-700" title={d.domain}>{d.domain}</span>
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                                <div className="h-full rounded-full bg-primary-500" style={{ width: `${d.avg}%` }} />
                              </div>
                              <span className="w-12 shrink-0 text-right text-slate-400">{d.compliant}/{d.total}</span>
                              <span className="w-9 shrink-0 text-right font-semibold text-slate-700">{d.avg}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderControlsTab = () => (
    <div className="space-y-4">
      {/* Critical Items panel moved to the Overview tab — it lives
          alongside the framework summary now so users see red-flag
          clauses immediately when they open the framework, rather
          than after navigating to Controls. The renderer lives at
          renderCriticalItemsPanel() and is mounted from
          renderOverviewTab. */}

      {/* Evidence Readiness banner hidden per design — the spine's
          top "your assessment" summary already carries this signal as
          part of its multi-segment progress bar. */}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="mb-6 flex items-center justify-between border-b border-slate-200 pb-4">
          <div className="flex gap-4">
            {(['library', 'policies', 'evidence'] as ControlsSubTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setControlsSubTab(tab)}
                className={`text-sm font-medium transition-colors ${
                  controlsSubTab === tab
                    ? 'text-primary-700'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab === 'library' ? `${entityLabel} Library` : tab === 'policies' ? '' : ''}
              </button>
            ))}
          </div>
          {/* <button className="flex items-center gap-2 rounded-lg bg-white border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <Download className="h-4 w-4" />
            Download Implementation Report
          </button> */}
        </div>

        {controlsSubTab === 'library' && (
          <div>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[180px] sm:min-w-[260px]">
                <SearchInput
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder={`Search ${entityLabelPlural.toLowerCase()}...`}
                  size="md"
                />
              </div>
              <MultiSelectDropdown
                title="Category"
                items={[
                  { value: 'organizational', label: 'Organizational' },
                  { value: 'people', label: 'People' },
                  { value: 'physical', label: 'Physical' },
                  { value: 'technological', label: 'Technological' },
                ]}
                selectedValues={categoryFilter !== 'all' ? [categoryFilter] : []}
                onApply={(v) => setCategoryFilter((v[0] as CategoryFilter) || 'all')}
                multiSelect={false}
                autoApply
                placeholder="All Categories"
                size="md"
              />
              <MultiSelectDropdown
                title="Status"
                items={[
                  { value: 'implemented', label: 'Implemented' },
                  { value: 'partial', label: 'In Progress' },
                  { value: 'not_implemented', label: 'Not Started' },
                ]}
                selectedValues={statusFilter !== 'all' ? [statusFilter] : []}
                onApply={(v) => setStatusFilter((v[0] as StatusFilter) || 'all')}
                multiSelect={false}
                autoApply
                placeholder="All Statuses"
                size="md"
              />
              <MultiSelectDropdown
                title="Sort"
                items={[
                  { value: 'default', label: 'Default' },
                  { value: 'asc', label: 'Clause # (Asc)' },
                  { value: 'desc', label: 'Clause # (Desc)' },
                ]}
                selectedValues={[sortOrder]}
                onApply={(v) => setSortOrder((v[0] as SortOrder) || 'default')}
                multiSelect={false}
                autoApply
                placeholder="Sort"
                size="md"
              />
            </div>

            {/* Progress-spine layout: hierarchy-aware vertical journey
                through the framework. Section anchors on the left
                (numbered circles tied by a spine line) surface "where am
                I" cues at a glance; the per-clause accordion content
                inside each section is unchanged. */}
            {renderRequirementsSpine()}
          </div>
        )}

        {/* {controlsSubTab === 'policies' && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <BookOpen className="mb-4 h-12 w-12 text-slate-400" />
            <h3 className="text-lg font-medium text-slate-900">Policies & Procedures</h3>
            <p className="mt-1 text-slate-600">Manage policies and procedures documentation</p>
            <button className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-[color:var(--color-on-base,#0a0a0a)] hover:bg-primary-700 mt-4">
              <Upload className="h-4 w-4" />
              Upload Policy
            </button>
          </div>
        )} */}

        {/* {controlsSubTab === 'evidence' && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="mb-4 h-12 w-12 text-slate-400" />
            <h3 className="text-lg font-medium text-slate-900">Evidence Management</h3>
            <p className="mt-1 text-slate-600">Collect and manage implementation evidence</p>
            <button className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-[color:var(--color-on-base,#0a0a0a)] hover:bg-primary-700 mt-4">
              <Upload className="h-4 w-4" />
              Upload Evidence
            </button>
          </div>
        )} */}
      </div>
    </div>
  );

  const renderPlaceholderTab = (title: string, icon: React.ReactNode, description: string) => (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-4 rounded-full bg-slate-50 p-4">
          {icon}
        </div>
        <h3 className="text-xl font-semibold text-slate-900">{title}</h3>
        <p className="mt-2 max-w-md text-slate-600">{description}</p>
        <button className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-[color:var(--color-on-base,#0a0a0a)] hover:bg-primary-700 mt-6">
          Get Started
        </button>
      </div>
    </div>
  );

  const renderCDEScopeTab = () => {
    if (cdeLoading || cdeAssetsFallbackLoading) {
      return (
        <div className="flex h-64 items-center justify-center">
          <PageLoader size="md" />
        </div>
      );
    }

    const fallbackSystems = (cdeAssetsFallback || [])
      .filter((asset) => {
        const raw = (asset as any).cde_environment;
        if (typeof raw === 'boolean') return raw;
        if (typeof raw === 'number') return raw === 1;
        if (typeof raw === 'string') return ['true', '1', 'yes', 'y', 'on'].includes(raw.toLowerCase().trim());
        return false;
      })
      .map((asset) => ({
        id: asset.id,
        name: asset.name,
        asset_type: asset.asset_type,
        description: asset.description || '',
        location: asset.location || '',
        owner_name: asset.owner_name || null,
        owner_id: asset.owner_id || null,
        vendor: asset.vendor || null,
        criticality: asset.criticality,
        status: asset.status,
        cde_environment: true,
        created_at: asset.created_at,
      }));

    const systems = (cdeData?.systems && cdeData.systems.length > 0) ? cdeData.systems : fallbackSystems;
    const summary = systems.reduce(
      (acc, asset) => {
        acc.total += 1;
        const assetType = asset.asset_type || 'other';
        const criticality = asset.criticality || 'medium';
        acc.type_breakdown[assetType] = (acc.type_breakdown[assetType] || 0) + 1;
        acc.criticality_breakdown[criticality] = (acc.criticality_breakdown[criticality] || 0) + 1;
        return acc;
      },
      { total: 0, type_breakdown: {} as Record<string, number>, criticality_breakdown: {} as Record<string, number> }
    );

    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-primary-200 bg-primary-50 p-4">
          <p className="text-sm text-primary-700">
            CDE assets are sourced from your <a href="/assets" className="font-medium underline">IT Asset Inventory</a>. Mark an IT asset as CDE Environment to include it automatically in PCI-DSS scope.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-600">CDE Assets</p>
            <p className="text-2xl font-bold text-slate-900">{summary.total}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-600">Asset Types</p>
            <p className="text-2xl font-bold text-slate-900">{Object.keys(summary.type_breakdown || {}).length}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-600">High/Critical</p>
            <p className="text-2xl font-bold text-slate-900">{(summary.criticality_breakdown?.critical || 0) + (summary.criticality_breakdown?.high || 0)}</p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-600">
                <th className="px-4 py-3">Asset</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Criticality</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {systems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                    No CDE assets found. Mark assets as CDE in IT Assets.
                  </td>
                </tr>
              ) : (
                systems.map((asset) => (
                  <tr key={asset.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{asset.name}</p>
                      {asset.description && <p className="mt-0.5 text-xs text-slate-500 line-clamp-1">{asset.description}</p>}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700 capitalize">{asset.asset_type?.replace('_', ' ') || '-'}</td>
                    <td className="px-4 py-3 text-sm text-slate-700 capitalize">{asset.criticality || '-'}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{asset.location || '-'}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{asset.vendor || '-'}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{asset.owner_name || '-'}</td>
                    <td className="px-4 py-3 text-sm text-slate-700 capitalize">{asset.status || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const openApplicabilityModal = (control: any, isApplicable: boolean) => {
    setApplicabilityModalControl(control);
    setApplicabilityIsApplicable(isApplicable);
    setApplicabilityJustification('');
    setShowApplicabilityModal(true);
  };

  const handleSetApplicability = () => {
    if (!applicabilityModalControl || !appFwId) return;
    // Backend stores applicability against ParsedFrameworkControl.id, not the
    // per-journey ControlImplementation.id. Prefer parsed_control_id when
    // present (controls coming from the journey controls endpoint).
    const parsedControlId = applicabilityModalControl.parsed_control_id ?? applicabilityModalControl.id;
    setApplicabilityMutation.mutate({
      control_id: parsedControlId,
      uploaded_framework_id: appFwId,
      is_applicable: applicabilityIsApplicable,
      justification: applicabilityJustification,
    });
  };

  const handleReviewApplicability = (status: 'approved' | 'rejected') => {
    if (!reviewingRecord) return;
    reviewApplicabilityMutation.mutate({
      id: reviewingRecord.id,
      data: { status, review_comment: reviewComment },
    });
  };

  const renderApplicabilityTab = () => {
    const applicabilityRecords = (applicabilityData as any)?.records || [];
    // Records are keyed by ParsedFrameworkControl.id, but controls coming from
    // the journey endpoint expose that under `parsed_control_id`. Look up by
    // parsed_control_id (with `id` as a fallback for any direct-parsed lists).
    const applicabilityMap = new Map<number, any>();
    applicabilityRecords.forEach((r: any) => applicabilityMap.set(r.control_id, r));
    const lookupRecord = (c: any) => applicabilityMap.get(c.parsed_control_id ?? c.id);

    const allControls = controls || [];
    const filteredApplicabilityControls = allControls.filter((c: any) => {
      if (applicabilityStatusFilter === 'all') return true;
      const record = lookupRecord(c);
      if (applicabilityStatusFilter === 'pending') return record?.status === 'pending';
      if (applicabilityStatusFilter === 'approved') return record?.status === 'approved';
      if (applicabilityStatusFilter === 'rejected') return record?.status === 'rejected';
      if (applicabilityStatusFilter === 'not_applicable') return record && !record.is_applicable;
      return true;
    });

    const totalControls = allControls.length;
    const naCount = applicabilityRecords.filter((r: any) => !r.is_applicable).length;
    const pendingCount = applicabilityRecords.filter((r: any) => r.status === 'pending').length;
    const approvedCount = applicabilityRecords.filter((r: any) => r.status === 'approved').length;
    const rejectedCount = applicabilityRecords.filter((r: any) => r.status === 'rejected').length;

    return (
      <div className="space-y-6">
        {/* Applicability summary donut */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          {(() => {
            const appChartData = [
              { name: 'Approved', value: approvedCount, fill: '#22c55e' },
              { name: 'Pending',  value: pendingCount,  fill: '#f59e0b' },
              { name: 'N/A',     value: naCount,       fill: '#94a3b8' },
              { name: 'Rejected', value: rejectedCount, fill: '#ef4444' },
            ].filter((d) => d.value > 0);
            return (
              <div className="flex items-center gap-6">
                <div className="relative h-[100px] w-[100px] flex-shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={appChartData.length ? appChartData : [{ name: 'None', value: 1, fill: '#e2e8f0' }]}
                        cx="50%" cy="50%" innerRadius={28} outerRadius={46} dataKey="value" paddingAngle={2} stroke="none"
                      >
                        {(appChartData.length ? appChartData : [{ name: 'None', value: 1, fill: '#e2e8f0' }]).map((entry, i) => (
                          <Cell key={i} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-base font-bold text-slate-900">{totalControls}</span>
                    <span className="text-[9px] text-slate-400">total</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                    <span className="text-slate-500">Approved</span>
                    <span className="font-semibold text-slate-800">{approvedCount}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                    <span className="text-slate-500">Pending Review</span>
                    <span className="font-semibold text-slate-800">{pendingCount}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
                    <span className="text-slate-500">Not Applicable</span>
                    <span className="font-semibold text-slate-800">{naCount}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                    <span className="text-slate-500">Rejected</span>
                    <span className="font-semibold text-slate-800">{rejectedCount}</span>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-600">Filter:</span>
          {['all', 'pending', 'approved', 'rejected', 'not_applicable'].map((f) => (
            <button
              key={f}
              onClick={() => setApplicabilityStatusFilter(f)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                applicabilityStatusFilter === f
                  ? 'bg-primary-50 text-primary-700 border border-primary-200'
                  : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50'
              }`}
            >
              {f === 'not_applicable' ? 'Not Applicable' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {applicabilityLoading ? (
          <div className="flex items-center justify-center py-12">
            <PageLoader size="md" />
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-600">Reference</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-600">Title</th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase text-slate-600">Applicable</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-600">Justification</th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase text-slate-600">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-600">Requested By</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-600">Owner</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-600">Impl. Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-600">Evidence</th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase text-slate-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredApplicabilityControls.map((control: any) => {
                  const record = lookupRecord(control);
                  const isApplicable = record ? record.is_applicable : true;
                  const status = record?.status || null;

                  return (
                    <tr key={control.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <span className="text-sm font-mono text-primary-700">
                          {control.control_code || control.original_reference || control.control_id || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-slate-900 line-clamp-2">
                          {control.control_name || control.title || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {isApplicable ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                            <CheckCircle2 className="h-3 w-3" />
                            Yes
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-700">
                            <XCircle className="h-3 w-3" />
                            N/A
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-slate-700 line-clamp-2">
                          {record?.justification || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {status === 'pending' && (
                          <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                            <Clock className="mr-1 h-3 w-3" />
                            Pending
                          </span>
                        )}
                        {status === 'approved' && (
                          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                            Approved
                          </span>
                        )}
                        {status === 'rejected' && (
                          <span className="inline-flex items-center rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">
                            <XCircle className="mr-1 h-3 w-3" />
                            Rejected
                          </span>
                        )}
                        {!status && (
                          <span className="text-xs text-slate-500">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-slate-700">
                          {record?.requested_by_name || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {record ? (
                          <select
                            value={record.owner_id ?? ''}
                            onChange={(e) => updateApplicabilityDetailsMut.mutate({ id: record.id, data: { owner_id: e.target.value ? Number(e.target.value) : null } })}
                            className="w-full max-w-[150px] rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                          >
                            <option value="">{record.owner_name || 'Unassigned'}</option>
                            {templateTenantUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                          </select>
                        ) : <span className="text-xs text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {record ? (
                          <select
                            value={record.implementation_status ?? ''}
                            onChange={(e) => updateApplicabilityDetailsMut.mutate({ id: record.id, data: { implementation_status: e.target.value || null } })}
                            className="w-full max-w-[150px] rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                          >
                            <option value="">—</option>
                            <option value="not_started">Not started</option>
                            <option value="in_progress">In progress</option>
                            <option value="implemented">Implemented</option>
                            <option value="verified">Verified</option>
                            <option value="not_applicable">N/A</option>
                          </select>
                        ) : <span className="text-xs text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {record ? (
                          record.linked_evidence_id ? (
                            <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">
                              {(soaEvidenceLib || []).find((x) => x.id === record.linked_evidence_id)?.name
                                || (soaEvidenceLib || []).find((x) => x.id === record.linked_evidence_id)?.title
                                || `Evidence #${record.linked_evidence_id}`}
                              <button type="button" onClick={() => updateApplicabilityDetailsMut.mutate({ id: record.id, data: { linked_evidence_id: null } })} className="text-emerald-600 hover:text-rose-600" aria-label="Unlink evidence">×</button>
                            </span>
                          ) : (
                            <InlineLinkPicker
                              triggerLabel="Link"
                              items={(soaEvidenceLib || []).map((ev) => ({ value: String(ev.id), label: ev.name || ev.title || ev.file_name || `Evidence #${ev.id}`, subLabel: ev.evidence_type }))}
                              emptyText="No evidence in library"
                              searchPlaceholder="Search evidence"
                              popoverWidth={280}
                              onSelect={(v) => updateApplicabilityDetailsMut.mutate({ id: record.id, data: { linked_evidence_id: Number(v) } })}
                            />
                          )
                        ) : <span className="text-xs text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {canEdit && record?.status === 'pending' ? (
                            <button
                              onClick={() => { setReviewingRecord(record); setReviewComment(''); setShowReviewModal(true); }}
                              className="rounded-lg bg-primary-50 border border-primary-200 px-2.5 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-100 transition-colors"
                            >
                              Review
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredApplicabilityControls.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-12 text-center text-slate-500">
                      No {entityLabelPlural.toLowerCase()} found matching the selected filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {(applicabilityAuditLog as any[])?.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold uppercase text-slate-600">Audit Trail</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {(applicabilityAuditLog as any[]).slice(0, 20).map((log: any) => (
                <div key={log.id} className="flex items-start gap-3 rounded-lg bg-slate-50 border border-slate-200 p-3">
                  <div className={`mt-0.5 h-2 w-2 rounded-full flex-shrink-0 ${
                    log.action === 'applicability_approved' ? 'bg-emerald-500' :
                    log.action === 'applicability_rejected' ? 'bg-rose-500' : 'bg-amber-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-700">{log.details}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      {log.created_at ? new Date(log.created_at).toLocaleString() : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    );
  };

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'overview':
        return renderOverviewTab();
      case 'phases':
        return renderPhasesTab();
      case 'scoping':
        return renderScopingTab();
      case 'context':
        return renderPlaceholderTab(
          'Context of Organization',
          <Building2 className="h-12 w-12 text-slate-500" />,
          'Analyze internal and external context, identify interested parties, and determine their requirements for the ISMS.'
        );
      case 'risk':
        return renderPlaceholderTab(
          'Risk Assessment & Treatment',
          <AlertTriangle className="h-12 w-12 text-slate-500" />,
          'Identify, analyze, and evaluate information security risks. Develop and implement risk treatment plans.'
        );
      case 'soa':
        return renderSoaTab();
      case 'controls':
        return renderControlsTab();
      case 'assigned-to-me':
        return renderAssignedToMeTab();
      case 'cde-scope':
        return renderCDEScopeTab();
      case 'applicability':
        return renderApplicabilityTab();
      case 'gap-analysis':
        return <FrameworkRegisterTab registerType="gap_analysis" journeyId={journeyId} frameworkId={appFwId} frameworkName={(journey as any)?.framework_name || 'ISO 27001'} tenantUsers={templateTenantUsers} />;
      case 'internal-audit':
        return <FrameworkRegisterTab registerType="internal_audit" journeyId={journeyId} frameworkId={appFwId} frameworkName={(journey as any)?.framework_name || 'ISO 27001'} tenantUsers={templateTenantUsers} />;
      case 'risk-treatment':
        return <FrameworkRegisterTab registerType="risk_treatment" journeyId={journeyId} frameworkId={appFwId} frameworkName={(journey as any)?.framework_name || 'ISO 27001'} tenantUsers={templateTenantUsers} />;
      case 'scope-statement':
        return <FrameworkDocumentTab docType="isms_scope_statement" journeyId={journeyId} frameworkId={appFwId} tenantUsers={templateTenantUsers} />;
      case 'audit-procedure':
        return <FrameworkDocumentTab docType="internal_audit_procedure" journeyId={journeyId} frameworkId={appFwId} tenantUsers={templateTenantUsers} />;
      case 'history':
        return renderHistoryTab();
      case 'artifacts':
        return (
          <ArtifactsTab
            assessmentType={(journey as any)?.framework_name || journey?.name || ''}
            tenantUsers={(assignmentTenantUsers || []).map((u: any) => ({
              id: u.id,
              label: u.display_name || u.email || String(u.id),
              email: u.email,
            }))}
          />
        );
      case 'training':
        return renderPlaceholderTab(
          'Training & Awareness',
          <GraduationCap className="h-12 w-12 text-slate-500" />,
          'Manage security awareness training programs, track completion, and assess competency across the organization.'
        );
      case 'audit':
        return renderPlaceholderTab(
          'Internal Audit',
          <ClipboardCheck className="h-12 w-12 text-slate-500" />,
          'Plan and conduct internal ISMS audits, document findings, and track corrective actions.'
        );
      case 'review':
        return renderPlaceholderTab(
          'Management Review',
          <Eye className="h-12 w-12 text-slate-500" />,
          'Conduct management reviews of ISMS performance, document decisions, and track action items.'
        );
      case 'certification':
        return renderPlaceholderTab(
          'Certification Audit',
          <Award className="h-12 w-12 text-slate-500" />,
          'Prepare for and track certification audit stages, manage non-conformities, and achieve certification.'
        );
      default:
        return renderOverviewTab();
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => router.push('/frameworks')}
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{stripCertificationPostfix(journey.name)}</h1>
              <p className="text-slate-600">{isCertificationFramework ? 'Framework certification lifecycle' : 'Framework compliance lifecycle'}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2">
              <Calendar className="h-4 w-4 text-slate-600" />
              {editingTargetDate ? (
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={targetDateValue}
                    onChange={(e) => setTargetDateValue(e.target.value)}
                    className="rounded bg-white px-2 py-1 text-sm text-slate-900 border border-slate-300 focus:border-primary-600 focus:outline-none"
                  />
                  <button
                    onClick={() => {
                      if (targetDateValue) updateTargetDateMutation.mutate(targetDateValue);
                    }}
                    disabled={updateTargetDateMutation.isPending || !targetDateValue}
                    className="rounded bg-primary-600 px-2 py-1 text-xs text-[color:var(--color-on-base,#0a0a0a)] hover:bg-primary-700 disabled:opacity-50"
                  >
                    {updateTargetDateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
                  </button>
                  <button
                    onClick={() => setEditingTargetDate(false)}
                    className="rounded px-2 py-1 text-xs text-slate-600 hover:text-slate-900"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setTargetDateValue(journey.target_date ? new Date(journey.target_date).toISOString().split('T')[0] : '');
                    setEditingTargetDate(true);
                  }}
                  className="text-sm text-slate-700 hover:text-slate-900 transition-colors"
                >
                  {journey.target_date ? `Target: ${new Date(journey.target_date).toLocaleDateString()}` : 'Set Target Date'}
                </button>
              )}
            </div>
            <button
              onClick={() => generateReportMutation.mutate()}
              disabled={generateReportMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-white border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {generateReportMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              {generateReportMutation.isPending ? 'Generating...' : 'Generate Report'}
            </button>
          </div>
        </div>

        {enhanceSuccess && (
          <div className="mt-4 rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-emerald-700">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5" />
              {enhanceSuccess}
            </div>
          </div>
        )}

        {enhanceError && (
          <div className="mt-4 rounded-lg bg-rose-50 border border-rose-200 p-4 text-rose-700">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              {enhanceError}
            </div>
          </div>
        )}

        <div
          className={`overflow-hidden transition-all duration-300 ease-in-out ${
            cardsCollapsed ? 'max-h-0 opacity-0 pointer-events-none mt-0' : 'max-h-[60rem] opacity-100 mt-6'
          }`}
        >
        {isPhasedFramework ? renderComplianceDashboard() : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex items-center justify-center p-3 sm:p-4">
            <CircularProgress percentage={readinessPercentage} />
            <div className="ml-3">
              <p className="text-sm font-semibold text-slate-900">{isCertificationFramework ? 'Certification Readiness' : 'Compliance Readiness'}</p>
              <p className="text-xs text-slate-600">Approved evidence readiness</p>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 sm:p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary-50 p-2">
                <Target className="h-4 w-4 text-primary-700" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-slate-600">{isCertificationFramework ? 'Current Phase' : 'Framework Type'}</p>
                <p className="text-sm font-semibold text-slate-900 truncate">{isCertificationFramework ? `Phase ${journey.current_phase}` : 'Compliance'}</p>
                <p className="text-xs text-primary-700 truncate">{isCertificationFramework ? (phasesLoading ? 'Loading...' : (phases[journey.current_phase - 1]?.name || 'Phase ' + journey.current_phase)) : ((journey as any)?.framework_overview?.regulatory_authority || 'Regulatory / Standard Requirements')}</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 sm:p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary-50 p-2">
                <Shield className="h-4 w-4 text-primary-700" />
              </div>
              <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-600">{entityLabel} Coverage</p>
                  <p className="text-sm font-semibold text-slate-900">{fullyEvidencedControls}/{totalControlsProgress}</p>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-primary-600"
                      style={{ width: `${evidenceCoveragePercentage}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 sm:p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary-50 p-2">
                <Calendar className="h-4 w-4 text-primary-700" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-slate-600">Target Date</p>
                <p className="text-sm font-semibold text-slate-900 truncate">
                  {journey.target_date ? new Date(journey.target_date).toLocaleDateString() : 'Not set'}
                </p>
                <p className="text-xs text-slate-500 truncate">{isCertificationFramework ? 'Stage 2 audit scheduled' : 'Compliance review target'}</p>
              </div>
            </div>
          </div>
        </div>
        )}
        </div>{/* end collapsible wrapper */}
      </div>

      <div className="mb-6 overflow-x-auto">
        <div className="flex min-w-max gap-1 border-b border-slate-200">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'border-b-2 border-primary-600 text-primary-700'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
          <button
            onClick={() => setCardsCollapsed(prev => !prev)}
            className="ml-4 flex items-center gap-1 px-3 py-2 text-xs text-slate-500 hover:text-slate-700 transition-colors border-b-2 border-transparent"
            title={cardsCollapsed ? 'Show summary cards' : 'Hide summary cards'}
          >
            {cardsCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
            <span>{cardsCollapsed ? 'Show summary' : 'Hide summary'}</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" ref={contentScrollRef}>
        {renderActiveTab()}
      </div>

      {selectedControl && (
        <ControlImplementationModal
          isOpen={showControlModal}
          onClose={() => {
            setShowControlModal(false);
            setSelectedControl(null);
          }}
          journeyId={journeyId}
          control={selectedControl}
        />
      )}

      {/* Applicability modals are mounted at the page root so they can be
          opened from any tab (the badge on Requirements, the Review button on
          the Applicability tab, etc.) without depending on which tab's render
          tree is currently mounted. */}
      {showApplicabilityModal && applicabilityModalControl && (
        // z-index sits above the requirement-detail spine modal
        // (z-100) so the Out-of-Scope justification prompt stacks on
        // top instead of disappearing behind it.
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex-1 overflow-y-auto p-6">
              <h3 className="mb-1 text-lg font-semibold text-slate-900">
                {applicabilityIsApplicable ? 'Mark as Applicable' : 'Mark as Not Applicable'}
              </h3>
              <p className="mb-4 text-sm text-slate-600">
                Control: <span className="font-mono text-primary-700">{applicabilityModalControl.control_code || applicabilityModalControl.original_reference || applicabilityModalControl.control_id}</span>
                {' — '}
                {applicabilityModalControl.control_name || applicabilityModalControl.title}
              </p>
              {applicabilityModalControl.is_critical && (
                <div className="mb-4 flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5">
                  <AlertTriangle className="h-4 w-4 text-rose-600 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-rose-900">
                    <p className="font-semibold">Critical clause — reviewer approval required.</p>
                    <p className="mt-0.5 text-rose-800">
                      This clause was AI-flagged as a red-flag control. Your request will be saved as
                      <span className="font-medium"> pending</span> and applied only after a reviewer approves it
                      from the Applicability tab. The control will remain {applicabilityModalControl.is_applicable ? 'Applicable' : 'Not Applicable'} until then.
                    </p>
                    {applicabilityModalControl.criticality_reason && (
                      <p className="mt-1 italic text-rose-700">Why: {applicabilityModalControl.criticality_reason}</p>
                    )}
                  </div>
                </div>
              )}
              <div className="mb-4">
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Justification {applicabilityIsApplicable
                    ? <span className="text-xs font-normal text-slate-500">(optional)</span>
                    : <span className="text-xs font-normal text-rose-600">* required</span>}
                </label>
                <textarea
                  value={applicabilityJustification}
                  onChange={(e) => setApplicabilityJustification(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  rows={4}
                  placeholder={applicabilityIsApplicable
                    ? 'Optionally explain why this control is being re-applied...'
                    : 'Explain why this clause is not applicable to your organization. Required for the audit trail.'}
                />
                {!applicabilityIsApplicable && !applicabilityJustification.trim() && (
                  <p className="mt-1 text-[11px] text-rose-600">
                    A justification is required when marking a requirement as Not Applicable.
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 p-6 pt-4">
              <button
                onClick={() => { setShowApplicabilityModal(false); setApplicabilityModalControl(null); }}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSetApplicability}
                disabled={
                  setApplicabilityMutation.isPending
                  || (!applicabilityIsApplicable && !applicabilityJustification.trim())
                }
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  applicabilityIsApplicable
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                {setApplicabilityMutation.isPending ? (
                  <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Saving...</span>
                ) : applicabilityIsApplicable ? 'Mark Applicable' : 'Mark Not Applicable'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showReviewModal && reviewingRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex-1 overflow-y-auto p-6">
              <h3 className="mb-1 text-lg font-semibold text-slate-900">Review Applicability Decision</h3>
              <p className="mb-2 text-sm text-slate-600">
                Control: <span className="font-mono text-primary-700">{reviewingRecord.control_reference}</span>
                {' — '}
                {reviewingRecord.control_title}
              </p>
              <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="mb-1 text-xs text-slate-600">Decision</p>
                <p className="text-sm text-slate-900">{reviewingRecord.is_applicable ? 'Applicable' : 'Not Applicable'}</p>
                <p className="mb-1 mt-2 text-xs text-slate-600">Justification</p>
                <p className="text-sm text-slate-700">{reviewingRecord.justification || '(no justification provided)'}</p>
                <p className="mb-1 mt-2 text-xs text-slate-600">Requested By</p>
                <p className="text-sm text-slate-700">{reviewingRecord.requested_by_name} on {reviewingRecord.requested_at ? new Date(reviewingRecord.requested_at).toLocaleDateString() : ''}</p>
              </div>
              <div className="mb-4">
                <label className="mb-2 block text-sm font-medium text-slate-700">Review Comment</label>
                <textarea
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  rows={3}
                  placeholder="Add a review comment (optional)..."
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 p-6 pt-4">
              <button
                onClick={() => { setShowReviewModal(false); setReviewingRecord(null); }}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleReviewApplicability('rejected')}
                disabled={reviewApplicabilityMutation.isPending}
                className="rounded-lg bg-rose-50 border border-rose-200 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100 transition-colors disabled:opacity-50"
              >
                Reject
              </button>
              <button
                onClick={() => handleReviewApplicability('approved')}
                disabled={reviewApplicabilityMutation.isPending}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                {reviewApplicabilityMutation.isPending ? (
                  <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Processing...</span>
                ) : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shared in-browser evidence viewer. Renders image / PDF / xlsx /
          csv / markdown / text inline; degrades to download for formats
          (e.g. DOCX/PPTX) that can't be portably previewed in-browser. */}
      <EvidenceViewer
        evidence={previewEvidenceFile}
        onClose={() => setPreviewEvidenceFile(null)}
      />

      {/* Large-format requirement detail popup. Opens from the progress
          spine when the user clicks a requirement card. The content
          inside is the existing renderControlAccordion forced into its
          expanded state — so every feature (per-recommendation upload,
          assign-to picker, artifacts, evidence approve/reject, create
          flow) is preserved verbatim. The modal is just a frame around
          the same accordion content the SoA/Assigned tabs use inline. */}
      {selectedSpineControl && (() => {
        const sc = selectedSpineControl;
        const requiredCount = sc.required_evidence_count
          ?? (sc.evidence_requirements ? sc.evidence_requirements.length : 0);
        const evCount = sc.evidence_count ?? (sc.evidence ? sc.evidence.length : 0);
        const approvedCount = sc.approved_evidence_count
          ?? (sc.evidence ? sc.evidence.filter((ev) => ev.review_status === 'approved').length : 0);
        const coverage = sc.evidence_coverage
          ?? (requiredCount > 0 ? Math.min(1, evCount / requiredCount) : evCount > 0 ? 1 : 0);
        const statusPill: Record<string, { label: string; className: string }> = {
          not_started: { label: 'Not Implemented', className: 'bg-rose-50 text-rose-700 border-rose-200' },
          in_progress: { label: 'Partial', className: 'bg-amber-50 text-amber-700 border-amber-200' },
          implemented: { label: 'Implemented', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
          verified: { label: 'Verified', className: 'bg-primary-50 text-primary-700 border-primary-200' },
          not_applicable: { label: 'Not Applicable', className: 'bg-slate-50 text-slate-600 border-slate-200' },
        };
        const sp = statusPill[sc.status] || statusPill.not_started;
        const category = getCategoryFromDomain(sc.domain_name);
        const parsedId = sc.parsed_control_id ?? sc.id;
        return (
        <div
          // Backdrop + container colours/spacing match the existing
          // applicability modal pattern (bg-black/60, slate-200 border,
          // slate-* text scale) so the spine modal feels like a first-
          // class citizen of the same design system rather than a one-
          // off. items-center + body-owns-scroll keeps the popup
          // anchored centre while artifacts expand inside.
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => openSpineControl(null)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header — title row (code + name once) and a compact
                action bar pulling all the chips/toggles that used to
                live on the accordion's header row. The inner accordion
                now skips its own header when forceExpanded so there's
                no duplication. Tokens (text-lg semibold for title,
                slate-200 borders, text-sm subtext) align with every
                other modal in the app. */}
            <div className="flex-shrink-0 border-b border-slate-200 bg-white px-6 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm font-semibold text-primary-700">{sc.control_code}</span>
                  <h2 className="text-lg font-semibold text-slate-900 truncate">{sc.control_name}</h2>
                  {sc.domain_name && (
                    <span className="text-sm text-slate-500">· {sc.domain_name}</span>
                  )}
                </div>
                <button
                  onClick={() => openSpineControl(null)}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 flex-shrink-0"
                  title="Close (Esc)"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                {sc.is_critical && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-1 text-xs font-medium text-rose-700"
                    title={sc.criticality_reason || 'AI-flagged critical clause'}
                  >
                    <AlertTriangle className="h-3 w-3" />
                    Critical
                  </span>
                )}
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">{category}</span>
                {/* Scope toggle: identical contract to the accordion's
                    inline scope buttons (one-click for In Scope, modal-
                    prompted justification for Out of Scope). Lives here
                    so the user can flip scope without scrolling down. */}
                <div
                  role="group"
                  aria-label="Requirement scope"
                  className="inline-flex items-center overflow-hidden rounded-lg border border-slate-300 text-xs"
                >
                  <button
                    type="button"
                    disabled={setApplicabilityMutation.isPending}
                    onClick={() => {
                      if (sc.is_applicable || !appFwId) return;
                      setApplicabilityMutation.mutate({
                        control_id: parsedId,
                        uploaded_framework_id: appFwId,
                        is_applicable: true,
                        justification: '',
                      });
                    }}
                    title="Mark this requirement as part of scope"
                    className={`px-2.5 py-1 transition-colors disabled:opacity-50 ${sc.is_applicable
                      ? 'bg-emerald-600 text-white'
                      : 'bg-white text-slate-600 hover:bg-emerald-50 hover:text-emerald-700'}`}
                  >
                    In Scope
                  </button>
                  <button
                    type="button"
                    disabled={setApplicabilityMutation.isPending}
                    onClick={() => {
                      if (!sc.is_applicable || !appFwId) return;
                      setApplicabilityModalControl(sc);
                      setApplicabilityIsApplicable(false);
                      setApplicabilityJustification('');
                      setShowApplicabilityModal(true);
                    }}
                    title="Mark this requirement as out of scope (justification required)"
                    className={`border-l border-slate-300 px-2.5 py-1 transition-colors disabled:opacity-50 ${!sc.is_applicable
                      ? 'bg-rose-600 text-white'
                      : 'bg-white text-slate-600 hover:bg-rose-50 hover:text-rose-700'}`}
                  >
                    Out of Scope
                  </button>
                </div>
                <span className={`rounded-lg border px-2 py-1 text-xs font-medium ${sp.className}`}>
                  {sp.label}
                </span>
                <span className="text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">{approvedCount}/{requiredCount || '—'}</span> approved
                </span>
                <span className="text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">{evCount}/{requiredCount || '—'}</span> evidence
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                  <Circle className={`h-3.5 w-3.5 ${evCount > 0 ? 'text-emerald-600 fill-emerald-600' : 'text-slate-300'}`} />
                  {Math.round(coverage * 100)}%
                </span>
              </div>
            </div>
            {/* Body owns the scroll: when artifacts/evidence expand
                inside, the body scrolls but the modal itself stays
                anchored to the viewport's centre. */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {renderControlAccordion(sc, true, true)}
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
