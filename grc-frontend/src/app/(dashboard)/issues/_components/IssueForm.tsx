'use client';

// IssueForm
// ─────────────────────────────────────────────────────────────────────────
// Modal create/edit form for an Issue. Severity is computed from
// Impact × Urgency by the backend; the user can override with a captured
// reason. Used by:
//  - The "+ New Issue" button on /issues
//  - The "Create Issue from…" buttons on Vuln/Risk/Asset/Control detail pages
//    (via the `presetSource` + `presetFields` props)

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  X, Loader2, AlertCircle, ChevronDown, Bug, AlertTriangle,
  Shield, Server, FileBadge, Building2, Briefcase, FileText,
  ListChecks, Link2,
} from 'lucide-react';
import {
  issuesApi, vulnManagementApi, risksApi, criticalTasksApi,
  assetsApi, evidenceApi, vendorRiskApi, governanceApi, complianceApi, ermApi,
  isProjectsApi,
} from '@/lib/api';
import { ISSUE_TYPES, CATEGORIES, SEVERITIES, IMPACTS, URGENCIES } from './shared';
import { EntityMultiCombobox, type EntityOption } from './EntityMultiCombobox';

// ── Lazy entity-list loaders ────────────────────────────────────────────
// Each loader maps the underlying API response to the shared EntityOption
// shape the combobox renders. Lazy — only fires when the picker is opened
// for the first time (see EntityMultiCombobox `enabled` gate).

async function loadVulns(): Promise<EntityOption[]> {
  const r = await vulnManagementApi.vulnerabilities.getAll();
  const items = (r.data as { items?: Array<Record<string, unknown>> })?.items
    ?? (Array.isArray(r.data) ? r.data : []);
  return (items as Array<Record<string, unknown>>).map((v) => ({
    id: Number(v.id),
    label: String(v.title || v.vuln_id || `Vulnerability #${v.id}`),
    subtitle: typeof v.cve_id === 'string' ? v.cve_id : undefined,
    meta: typeof v.severity === 'string' ? v.severity : undefined,
  }));
}

async function loadRisks(): Promise<EntityOption[]> {
  const r = await risksApi.getAll();
  const items = (Array.isArray(r.data) ? r.data : (r.data as { items?: unknown[] })?.items) ?? [];
  return (items as Array<Record<string, unknown>>).map((x) => ({
    id: Number(x.id),
    label: String(x.title || x.name || `Risk #${x.id}`),
    subtitle: typeof x.category === 'string' ? x.category : undefined,
    meta: typeof x.status === 'string' ? x.status : undefined,
  }));
}

async function loadTasks(): Promise<EntityOption[]> {
  const r = await criticalTasksApi.list({});
  const items = (Array.isArray(r.data) ? r.data : (r.data as { items?: unknown[] })?.items) ?? [];
  return (items as Array<Record<string, unknown>>).map((x) => ({
    id: Number(x.id),
    label: String(x.title || `Task #${x.id}`),
    subtitle: typeof x.category === 'string' ? x.category : undefined,
    meta: typeof x.status === 'string' ? x.status : undefined,
  }));
}

async function loadProjects(): Promise<EntityOption[]> {
  const r = await isProjectsApi.getAll();
  const items = (Array.isArray(r.data) ? r.data : (r.data as { items?: unknown[] })?.items) ?? [];
  return (items as Array<Record<string, unknown>>).map((x) => ({
    id: Number(x.id),
    label: String(x.name || x.title || `Project #${x.id}`),
    subtitle: typeof x.status === 'string' ? x.status : undefined,
  }));
}

async function loadInternalControls(): Promise<EntityOption[]> {
  const r = await ermApi.internalControls.getAll();
  const items = (Array.isArray(r.data) ? r.data : (r.data as { items?: unknown[] })?.items) ?? [];
  return (items as Array<Record<string, unknown>>).map((x) => ({
    id: Number(x.id),
    label: String(x.name || x.title || `Control #${x.id}`),
    subtitle: typeof x.control_id === 'string' ? x.control_id : undefined,
    meta: typeof x.status === 'string' ? x.status : undefined,
  }));
}

async function loadGovernanceDocuments(): Promise<EntityOption[]> {
  const r = await governanceApi.getDocuments({ limit: 500 });
  const items = (Array.isArray(r.data) ? r.data : (r.data as { items?: unknown[] })?.items) ?? [];
  return (items as Array<Record<string, unknown>>).map((x) => ({
    id: Number(x.id),
    label: String(x.title || `Document #${x.id}`),
    subtitle: typeof x.doc_type === 'string' ? x.doc_type : undefined,
    meta: typeof x.status === 'string' ? x.status : undefined,
  }));
}

async function loadPolicyStatements(): Promise<EntityOption[]> {
  const r = await complianceApi.statements.getAll();
  const items = (Array.isArray(r.data) ? r.data : (r.data as { items?: unknown[] })?.items) ?? [];
  return (items as Array<Record<string, unknown>>).map((x) => ({
    id: Number(x.id),
    label: String(x.title || x.statement || `Statement #${x.id}`),
    subtitle: typeof x.category === 'string' ? x.category : undefined,
    meta: typeof x.compliance_status === 'string' ? x.compliance_status : undefined,
  }));
}

async function loadEvidence(): Promise<EntityOption[]> {
  const r = await evidenceApi.getAll();
  const items = (Array.isArray(r.data) ? r.data : (r.data as { items?: unknown[] })?.items) ?? [];
  return (items as Array<Record<string, unknown>>).map((x) => ({
    id: Number(x.id),
    label: String(x.name || x.file_name || `Evidence #${x.id}`),
    subtitle: typeof x.file_name === 'string' ? x.file_name : undefined,
    meta: typeof x.status === 'string' ? x.status : undefined,
  }));
}

async function loadVendors(): Promise<EntityOption[]> {
  const r = await vendorRiskApi.getVendors();
  const items = (Array.isArray(r.data) ? r.data : (r.data as { items?: unknown[] })?.items) ?? [];
  return (items as Array<Record<string, unknown>>).map((x) => ({
    id: Number(x.id),
    label: String(x.name || `Vendor #${x.id}`),
    subtitle: typeof x.tier === 'string' ? x.tier : undefined,
    meta: typeof x.status === 'string' ? x.status : undefined,
  }));
}

async function loadAssets(): Promise<EntityOption[]> {
  const r = await assetsApi.getAll({ limit: 500 });
  const items = (Array.isArray(r.data) ? r.data : (r.data as { items?: unknown[] })?.items) ?? [];
  return (items as Array<Record<string, unknown>>).map((x) => ({
    id: Number(x.id),
    label: String(x.name || `Asset #${x.id}`),
    subtitle: typeof x.asset_type === 'string' ? x.asset_type : undefined,
    meta: typeof x.criticality === 'string' ? x.criticality : undefined,
  }));
}

export interface IssueFormProps {
  open: boolean;
  onClose: () => void;
  /** When set, calls /issues/from-source instead of /issues so the linkage is pinned. */
  presetSource?: {
    source_type:
      | 'vulnerability' | 'risk' | 'asset'
      | 'control_framework' | 'control_parsed' | 'control_normalized' | 'control_internal'
      // v2 — governance + policy types accepted by /issues/from-source
      | 'governance_document' | 'policy_statement';
    source_id: number;
  };
  /** Pre-filled form values (title/description/impact/urgency etc.). */
  presetFields?: Partial<{
    title: string;
    description: string;
    impact: string;
    urgency: string;
    category: string;
    issue_type: string;
  }>;
  /** Where to redirect on success. Defaults to /issues/{newId}. */
  onCreated?: (id: number) => void;
}

export function IssueForm({ open, onClose, presetSource, presetFields, onCreated }: IssueFormProps) {
  const router = useRouter();
  const qc = useQueryClient();
  const [title, setTitle] = useState(presetFields?.title || '');
  const [description, setDescription] = useState(presetFields?.description || '');
  const [issueType, setIssueType] = useState(presetFields?.issue_type || 'incident');
  const [category, setCategory] = useState(presetFields?.category || 'security');
  const [impact, setImpact] = useState(presetFields?.impact || 'medium');
  const [urgency, setUrgency] = useState(presetFields?.urgency || 'medium');
  const [override, setOverride] = useState<string>('');
  const [overrideReason, setOverrideReason] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // ── Linkages (optional) ───────────────────────────────────────────────
  // Each picker stores a list of selected IDs that ride along in the
  // create payload. Backend creates the link rows atomically in the same
  // transaction as the new issue. Section is collapsed by default so the
  // form's top-of-fold stays focused on the required fields.
  const [linksOpen, setLinksOpen] = useState(false);
  const [linkedVulns, setLinkedVulns] = useState<number[]>([]);
  const [linkedRisks, setLinkedRisks] = useState<number[]>([]);
  const [linkedTasks, setLinkedTasks] = useState<number[]>([]);
  const [linkedProjects, setLinkedProjects] = useState<number[]>([]);
  const [linkedAssets, setLinkedAssets] = useState<number[]>([]);
  const [linkedControls, setLinkedControls] = useState<number[]>([]);
  const [linkedDocs, setLinkedDocs] = useState<number[]>([]);
  const [linkedStatements, setLinkedStatements] = useState<number[]>([]);
  const [linkedEvidence, setLinkedEvidence] = useState<number[]>([]);
  const [linkedVendors, setLinkedVendors] = useState<number[]>([]);

  const totalLinks =
    linkedVulns.length + linkedRisks.length + linkedTasks.length
    + linkedProjects.length + linkedAssets.length + linkedControls.length
    + linkedDocs.length + linkedStatements.length + linkedEvidence.length
    + linkedVendors.length;

  const createMutation = useMutation({
    mutationFn: async () => {
      // Drop empty arrays so the JSON payload stays small + the activity
      // log doesn't fire "linked_on_create" with all-zero counts.
      const linkages: Record<string, unknown> = {};
      if (linkedVulns.length)      linkages.linked_vulnerability_ids = linkedVulns;
      if (linkedRisks.length)      linkages.linked_risk_ids = linkedRisks;
      if (linkedTasks.length)      linkages.linked_task_ids = linkedTasks;
      if (linkedProjects.length)   linkages.linked_is_project_ids = linkedProjects;
      if (linkedAssets.length)     linkages.linked_asset_ids = linkedAssets;
      if (linkedControls.length)   linkages.linked_internal_control_ids = linkedControls;
      if (linkedDocs.length)       linkages.linked_governance_document_ids = linkedDocs;
      if (linkedStatements.length) linkages.linked_policy_statement_ids = linkedStatements;
      if (linkedEvidence.length)   linkages.linked_evidence_ids = linkedEvidence;
      if (linkedVendors.length)    linkages.linked_vendor_ids = linkedVendors;

      const body = {
        title, description, impact, urgency,
        issue_type: issueType, category,
        severity_override: override || undefined,
        severity_override_reason: override ? overrideReason : undefined,
        ...linkages,
      };
      if (presetSource) {
        return await issuesApi.fromSource({ ...presetSource, ...body });
      }
      return await issuesApi.create(body);
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['issues'] });
      qc.invalidateQueries({ queryKey: ['issues-dashboard'] });
      const id = res.data?.id;
      onClose();
      if (id) {
        if (onCreated) onCreated(id);
        else router.push(`/issues/${id}`);
      }
    },
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { detail?: string } }; message?: string };
      setError(err?.response?.data?.detail || err?.message || 'Failed to create issue');
    },
  });

  if (!open) return null;

  const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[92vh] flex flex-col rounded-2xl bg-white shadow-2xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              {presetSource ? 'Create Issue from source' : 'New Issue'}
            </h3>
            <p className="text-[11px] text-slate-500">
              Impact × Urgency drives the computed severity; override with a reason if you must.
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} placeholder="Brief one-liner" />
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={inputClass + ' resize-none'} placeholder="What broke, what was found, scope of impact…" />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Type</label>
              <select value={issueType} onChange={(e) => setIssueType(e.target.value)} className={inputClass}>
                {ISSUE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Impact</label>
              <select value={impact} onChange={(e) => setImpact(e.target.value)} className={inputClass}>
                {IMPACTS.map((i) => <option key={i} value={i}>{i.charAt(0).toUpperCase() + i.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Urgency</label>
              <select value={urgency} onChange={(e) => setUrgency(e.target.value)} className={inputClass}>
                {URGENCIES.map((u) => <option key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</option>)}
              </select>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">Severity</span>
              {!override && (
                <button onClick={() => setOverride('high')} className="text-[10px] font-medium text-primary-700 hover:underline">
                  Override
                </button>
              )}
            </div>
            {override ? (
              <div className="mt-1.5 space-y-1.5">
                <select value={override} onChange={(e) => setOverride(e.target.value)} className={inputClass}>
                  {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <textarea
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  rows={2}
                  className={inputClass + ' resize-none'}
                  placeholder="Required: why are you overriding the computed severity?"
                />
                <button onClick={() => { setOverride(''); setOverrideReason(''); }} className="text-[10px] text-slate-500 hover:underline">
                  Cancel override (use computed severity)
                </button>
              </div>
            ) : (
              <p className="mt-1 text-xs text-slate-700">
                Computed from Impact ({impact}) × Urgency ({urgency}) by the Severity Matrix on submit.
              </p>
            )}
          </div>

          {/* ── Linkages (collapsible, optional) ─────────────────────────
              Wire the new issue to existing entities at create time. Each
              picker is a searchable multi-select; everything written
              atomically by POST /issue-management/issues. */}
          <div className="rounded-lg border border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => setLinksOpen((o) => !o)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left"
            >
              <Link2 className={`h-3.5 w-3.5 ${totalLinks > 0 ? 'text-primary-600' : 'text-slate-400'}`} />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                Linkages
              </span>
              {totalLinks > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-4 px-1 rounded-full bg-primary-100 text-[10px] font-semibold text-primary-700">
                  {totalLinks}
                </span>
              )}
              <span className="ml-auto text-[10px] text-slate-500">
                {linksOpen ? 'Hide' : 'Add links to vulns, risks, tasks, projects, controls, evidence…'}
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 text-slate-400 transition-transform ${linksOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {linksOpen && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 px-3 pb-3">
                <LinkRow label="Vulnerabilities" icon={Bug}>
                  <EntityMultiCombobox
                    queryKey={['issue-form.entities.vulns']}
                    queryFn={loadVulns}
                    value={linkedVulns}
                    onChange={setLinkedVulns}
                    placeholder="Pick vulnerabilities…"
                    icon={Bug}
                  />
                </LinkRow>
                <LinkRow label="Risks" icon={AlertTriangle}>
                  <EntityMultiCombobox
                    queryKey={['issue-form.entities.risks']}
                    queryFn={loadRisks}
                    value={linkedRisks}
                    onChange={setLinkedRisks}
                    placeholder="Pick risks…"
                    icon={AlertTriangle}
                  />
                </LinkRow>
                <LinkRow label="Critical Tasks" icon={ListChecks}>
                  <EntityMultiCombobox
                    queryKey={['issue-form.entities.tasks']}
                    queryFn={loadTasks}
                    value={linkedTasks}
                    onChange={setLinkedTasks}
                    placeholder="Pick tasks…"
                    icon={ListChecks}
                  />
                </LinkRow>
                <LinkRow label="IS Projects" icon={Briefcase}>
                  <EntityMultiCombobox
                    queryKey={['issue-form.entities.projects']}
                    queryFn={loadProjects}
                    value={linkedProjects}
                    onChange={setLinkedProjects}
                    placeholder="Pick projects…"
                    icon={Briefcase}
                  />
                </LinkRow>
                <LinkRow label="Assets" icon={Server}>
                  <EntityMultiCombobox
                    queryKey={['issue-form.entities.assets']}
                    queryFn={loadAssets}
                    value={linkedAssets}
                    onChange={setLinkedAssets}
                    placeholder="Pick assets…"
                    icon={Server}
                  />
                </LinkRow>
                <LinkRow label="Internal Controls" icon={Shield}>
                  <EntityMultiCombobox
                    queryKey={['issue-form.entities.internal-controls']}
                    queryFn={loadInternalControls}
                    value={linkedControls}
                    onChange={setLinkedControls}
                    placeholder="Pick controls…"
                    icon={Shield}
                  />
                </LinkRow>
                <LinkRow label="Governance Documents" icon={FileText}>
                  <EntityMultiCombobox
                    queryKey={['issue-form.entities.gov-docs']}
                    queryFn={loadGovernanceDocuments}
                    value={linkedDocs}
                    onChange={setLinkedDocs}
                    placeholder="Pick documents…"
                    icon={FileText}
                  />
                </LinkRow>
                <LinkRow label="Policy Statements" icon={FileText}>
                  <EntityMultiCombobox
                    queryKey={['issue-form.entities.policy-statements']}
                    queryFn={loadPolicyStatements}
                    value={linkedStatements}
                    onChange={setLinkedStatements}
                    placeholder="Pick statements…"
                    icon={FileText}
                  />
                </LinkRow>
                <LinkRow label="Evidence" icon={FileBadge}>
                  <EntityMultiCombobox
                    queryKey={['issue-form.entities.evidence']}
                    queryFn={loadEvidence}
                    value={linkedEvidence}
                    onChange={setLinkedEvidence}
                    placeholder="Pick evidence…"
                    icon={FileBadge}
                  />
                </LinkRow>
                <LinkRow label="Vendors" icon={Building2}>
                  <EntityMultiCombobox
                    queryKey={['issue-form.entities.vendors']}
                    queryFn={loadVendors}
                    value={linkedVendors}
                    onChange={setLinkedVendors}
                    placeholder="Pick vendors…"
                    icon={Building2}
                  />
                </LinkRow>
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">
              <AlertCircle className="h-3.5 w-3.5" />
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3 bg-slate-50/60">
          <button onClick={onClose} disabled={createMutation.isPending} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">
            Cancel
          </button>
          <button
            onClick={() => createMutation.mutate()}
            disabled={!title.trim() || createMutation.isPending || (!!override && !overrideReason.trim())}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-1.5 text-xs font-semibold text-[#0a0a0a] shadow-sm hover:bg-primary-700 disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed"
          >
            {createMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Create Issue
          </button>
        </div>
      </div>
    </div>
  );
}

// Small labelled-wrapper used by each picker row inside the Linkages
// section so the form keeps a consistent label / combobox stack regardless
// of the entity type.
function LinkRow({
  label, icon: Icon, children,
}: {
  label: string;
  icon: typeof Bug;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        <Icon className="h-3 w-3" />
        {label}
      </label>
      {children}
    </div>
  );
}
