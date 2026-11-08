// The lists the "Related records" pickers of the Create issue drawer choose from, one loader per kind of record, each read only when its disclosure is first opened (never ten at once: the
// database pool is small). A loader maps another module's list to the kit's options; a refusal by that module reaches the picker as an error with Retry (the person may hold the Issues right
// and not that module's), except the policy statements, whose list is the documents the person may open, and an empty list is its honest answer.
import type { ListOption } from '@/components/ui/ds';
import {
  apiClient, assetsApi, complianceApi, criticalTasksApi, ermApi, evidenceApi, governanceApi, isProjectsApi, vendorRiskApi, vulnManagementApi,
} from '@/lib/api';
import type { LinkKey } from './embedModel';

type Row = Record<string, unknown>;
const rowsOf = (data: unknown): Row[] => (Array.isArray(data) ? data : ((data as { items?: unknown[] })?.items ?? [])) as Row[];
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const option = (x: Row, label: string, description?: unknown): ListOption => ({ value: String(x.id), label, description: text(description) });

export const LINK_LOADERS: Record<LinkKey, () => Promise<ListOption[]>> = {
  linked_vulnerability_ids: async () => rowsOf((await vulnManagementApi.vulnerabilities.getAll()).data)
    .map((v) => option(v, text(v.title) ?? text(v.vuln_id) ?? 'Vulnerability', text(v.cve_id) ?? v.severity)),
  // the complete lean list of risks (the older list stops at the newest 100)
  linked_risk_ids: async () => rowsOf((await apiClient.get('/erm/monitoring/risks')).data)
    .map((r) => option(r, text(r.title) ?? 'Risk', r.risk_category ?? r.category)),
  // the complete lean list of the tasks the person may see (the older list stopped at the newest 100)
  linked_task_ids: async () => rowsOf((await criticalTasksApi.list({ lean: 1, limit: 10000 })).data)
    .map((t) => option(t, text(t.title) ?? 'Task', t.status)),
  linked_is_project_ids: async () => rowsOf((await isProjectsApi.getAll()).data)
    .map((p) => option(p, text(p.name) ?? text(p.title) ?? 'Project', p.status)),
  linked_asset_ids: async () => rowsOf((await assetsApi.getAll({ limit: 500 })).data)
    .map((a) => option(a, text(a.name) ?? 'Asset', a.asset_type)),
  linked_internal_control_ids: async () => rowsOf((await ermApi.internalControls.getAll()).data)
    .map((c) => option(c, text(c.name) ?? text(c.title) ?? 'Control', c.control_id)),
  // titles, also for people without a governance right
  linked_governance_document_ids: async () => rowsOf((await governanceApi.getDocumentsBrief({ limit: 500 })).data)
    .map((d) => option(d, text(d.title) ?? 'Document', d.doc_type)),
  // the statements of the documents the person may read; a refusal is an empty list
  linked_policy_statement_ids: async () => {
    const r = await complianceApi.statements.getAll().catch((e) => {
      if (e?.response?.status === 403) return { data: [] };
      throw e;
    });
    return rowsOf(r.data).map((s) => option(s, text(s.title) ?? text(s.statement) ?? 'Policy statement', s.category));
  },
  linked_evidence_ids: async () => rowsOf((await evidenceApi.getAll()).data)
    .map((e) => option(e, text(e.name) ?? text(e.file_name) ?? 'Evidence', e.file_name)),
  linked_vendor_ids: async () => rowsOf((await vendorRiskApi.getVendors()).data)
    .map((v) => option(v, text(v.name) ?? 'Vendor', v.tier)),
};
