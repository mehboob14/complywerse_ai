'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient, { assetsApi, getTenantSlug } from '@/lib/api';
import ComplianceAssessmentsModule from './ComplianceAssessmentsModule';
import NcaTab from '@/components/compliance/NcaTab';
import PDPLAssessmentTab from '@/components/compliance/PDPLAssessmentTab';
import ASVSAssessmentTab from '@/components/compliance/ASVSAssessmentTab';
import MobileAppSecurityTab from '@/components/compliance/MobileAppSecurityTab';
import OwaspTestingTab from '@/components/compliance/OwaspTestingTab';
import MaturityAssessmentTab from '@/components/compliance/MaturityAssessmentTab';
import KpiReportTab from '@/components/compliance/KpiReportTab';
import DpiaAssessmentTab from '@/components/compliance/DpiaAssessmentTab';
import NcaRegisterTab from '@/components/compliance/NcaRegisterTab';
import DccToolTab from '@/components/compliance/DccToolTab';
import type { Assessment, ControlItem, ComplianceStatus, Priority, DetailApi, EvidenceRow, AiRec, NewControl, SlaPoint } from './types';
import type { SlaPolicy } from './slaEngine';

/**
 * Real-data wrapper around the redesigned ComplianceAssessmentsModule.
 * Maps the live `/compliance/assessments` DTOs onto the design's `Assessment`
 * and `ControlItem` shapes, loads a selected assessment's controls on demand,
 * preserves the dedicated NCA / PDPL workspaces, and wires the upload button.
 */

interface RawAssessment {
  id: number;
  name: string;
  assessment_type: string;
  assessment_format?: string;
  source: string | null;
  file_name: string | null;
  status: string;
  due_date: string | null;
  assessor: string | null;
  overall_score: number | null;
  total_items: number | null;
  complied_count: number | null;
  partially_complied_count: number | null;
  not_complied_count: number | null;
  in_progress_count: number | null;
  na_count: number | null;
}

interface RawItem {
  id: number;
  item_number: string;
  area_domain: string | null;
  control_description: string | null;
  compliance_status: string;
  gaps_identified: string | null;
  proposed_solution: string | null;
  responsible_party: string | null;
  timeline: string | null;
  priority: string | null;
  evidence_reference: string | null;
  remarks: string | null;
  maturity_score: number | null;
  risk_rating: string | null;
  remediation_status: string | null;
  ai_evidence_recommendation: string | null;
  evidence_count?: number;
  created_at?: string | null;
  updated_at?: string | null;
  target_date?: string | null;
  closed_at?: string | null;
}

const FORMAT_TO_FRAMEWORK: Record<string, { key: string; label: string }> = {
  ubl_audit_master_tracking: { key: 'internal_audit', label: 'Internal Audit' },
  xlsx_maturity: { key: 'maturity', label: 'Maturity Model' },
  asvs_checklist: { key: 'asvs', label: 'OWASP ASVS' },
  mobile_app_security: { key: 'cs_mobile', label: 'Mobile App Security' },
  owasp_v4_testing_checklist: { key: 'owasp_testing', label: 'OWASP Testing' },
  csir_maturity: { key: 'cs_csir', label: 'CSIR Maturity' },
  cti_maturity: { key: 'cs_cti', label: 'CTI Maturity' },
  itsecops_maturity: { key: 'cs_itsecops', label: 'IT Security Operations' },
  incident_maturity: { key: 'cs_incident', label: 'Incident Management' },
  kpi_report: { key: 'cs_kpi', label: 'KPI Report' },
  dpia_pia: { key: 'dpia', label: 'DPIA / PIA' },
  standard: { key: 'standard', label: 'Standard' },
  nca_container: { key: 'nca', label: 'NCA' },
  nca_vuln_register: { key: 'nca_vuln', label: 'NCA Vulnerability Register' },
  nca_audit_register: { key: 'nca_audit', label: 'NCA Audit Plan' },
  nca_risk_register: { key: 'nca_risk', label: 'NCA Risk Register' },
  pdpl_assessment_toolkit: { key: 'pdpl', label: 'PDPL Assessment' },
  digital_ops_maturity: { key: 'digital_ops_maturity', label: 'Digital Operations Maturity' },
};

function frameworkFor(format?: string): { key: string; label: string } {
  if (!format) return { key: 'standard', label: 'Standard' };
  if (FORMAT_TO_FRAMEWORK[format]) return FORMAT_TO_FRAMEWORK[format];
  if (format.startsWith('cis_')) return { key: 'cis', label: 'CIS Benchmark' };
  if (format.startsWith('nca_')) return { key: 'nca', label: 'NCA' };
  return { key: 'standard', label: 'Standard' };
}

function mapStatus(s: string): Assessment['status'] {
  if (s === 'completed' || s === 'archived') return 'completed';
  if (s === 'in_progress') return 'in_progress';
  return 'draft';
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function mapAssessment(a: RawAssessment): Assessment {
  const fw = frameworkFor(a.assessment_format);
  const complied = a.complied_count || 0;
  const partial = a.partially_complied_count || 0;
  const notc = a.not_complied_count || 0;
  const inprog = a.in_progress_count || 0;
  const na = a.na_count || 0;
  const total = a.total_items || complied + partial + notc + inprog + na;
  const assessed = complied + partial + notc + na;
  return {
    id: a.id,
    name: a.name,
    type: fw.label,
    framework: fw.key,
    status: mapStatus(a.status),
    score: Math.round(a.overall_score ?? 0),
    total,
    counts: { complied, partial, not_complied: notc, in_progress: inprog, na },
    assessedPct: total > 0 ? Math.round((assessed / total) * 100) : 0,
    openGaps: notc + inprog,
    domainCount: 0,
    assessor: a.assessor || 'Unassigned',
    due: formatDate(a.due_date),
    source: a.source || a.file_name || '—',
  };
}

const VALID_STATUS = new Set(['complied', 'partially_complied', 'not_complied', 'in_progress', 'na']);
const VALID_PRIORITY = new Set(['critical', 'high', 'medium', 'low']);

function mapRisk(r: string | null): ControlItem['risk_rating'] {
  const v = (r || '').trim().toLowerCase();
  if (v === 'high') return 'High';
  if (v === 'medium') return 'Medium';
  if (v === 'low') return 'Low';
  return null;
}
function mapRemediation(r: string | null): ControlItem['remediation_status'] {
  const v = (r || '').trim().toLowerCase();
  if (v === 'closed') return 'Closed';
  if (v === 'in_progress' || v === 'in progress') return 'In Progress';
  if (v === 'open') return 'Open';
  return null;
}

function mapItem(it: RawItem, auditMaster: boolean): ControlItem {
  let domain = (it.area_domain || 'Uncategorized').trim();
  // Internal Audit groups by the prefix before " - " (e.g. "Audit_OS_Points").
  if (auditMaster) {
    const sep = domain.indexOf(' - ');
    if (sep > 0) domain = domain.slice(0, sep).trim();
  }
  const status = (it.compliance_status || '').toLowerCase();
  const priority = (it.priority || '').toLowerCase();
  return {
    id: it.id,
    item_number: it.item_number,
    area_domain: domain || 'Uncategorized',
    control_description: it.control_description || '',
    compliance_status: (VALID_STATUS.has(status) ? status : 'in_progress') as ComplianceStatus,
    priority: (VALID_PRIORITY.has(priority) ? priority : null) as Priority | null,
    gaps_identified: it.gaps_identified,
    proposed_solution: it.proposed_solution,
    responsible_party: it.responsible_party,
    timeline: it.timeline,
    evidence_reference: it.evidence_reference,
    remarks: it.remarks,
    maturity_score: it.maturity_score,
    risk_rating: mapRisk(it.risk_rating),
    remediation_status: mapRemediation(it.remediation_status),
    ai_evidence_recommendation: it.ai_evidence_recommendation ?? null,
    evidence_count: it.evidence_count ?? 0,
    created_at: it.created_at ?? null,
    updated_at: it.updated_at ?? null,
    target_date: it.target_date ?? null,
    closed_at: it.closed_at ?? null,
  };
}

function fileExt(name?: string | null): string {
  if (!name) return 'FILE';
  const m = name.split('.').pop();
  return (m || 'FILE').toUpperCase().slice(0, 4);
}

function parseAiRec(jsonStr: string | null): AiRec | null {
  if (!jsonStr) return null;
  try {
    const v = JSON.parse(jsonStr);
    if (v && Array.isArray(v.recommendations)) return v as AiRec;
    return null;
  } catch {
    return null;
  }
}

export default function AssessmentsRedesignClient({ initialTab }: { initialTab?: string }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // Full assessment list — base list plus the NCA + PDPL containers that the
  // default list hides — deduped by id.
  const { data: assessments = [] } = useQuery<Assessment[]>({
    queryKey: ['redesign-assessments'],
    staleTime: 30_000,
    queryFn: async () => {
      const [base, nca, pdpl] = await Promise.all([
        apiClient.get('/compliance/assessments', { params: { skip: 0, limit: 200 } }),
        apiClient.get('/compliance/assessments', { params: { skip: 0, limit: 50, assessment_format: 'nca_container' } }),
        apiClient.get('/compliance/assessments', { params: { skip: 0, limit: 50, assessment_format: 'pdpl_assessment_toolkit' } }),
      ]);
      const all: RawAssessment[] = [
        ...((base.data?.assessments as RawAssessment[]) || []),
        ...((nca.data?.assessments as RawAssessment[]) || []),
        ...((pdpl.data?.assessments as RawAssessment[]) || []),
      ];
      const seen = new Set<number>();
      const out: Assessment[] = [];
      for (const a of all) { if (!seen.has(a.id)) { seen.add(a.id); out.push(mapAssessment(a)); } }
      return out;
    },
  });

  // Flat list of every point across all assessments — feeds the closure board.
  const { data: slaPoints = [] } = useQuery<SlaPoint[]>({
    queryKey: ['redesign-sla-points'],
    staleTime: 30_000,
    queryFn: async () => {
      const res = await apiClient.get('/compliance/assessments/points');
      return (res.data?.points as SlaPoint[]) || [];
    },
  });

  // Tenant SLA policy (days per tier + due-soon horizon). Tunable on the board.
  const { data: slaPolicy } = useQuery<SlaPolicy>({
    queryKey: ['redesign-sla-policy'],
    staleTime: 60_000,
    queryFn: async () => (await apiClient.get('/compliance/assessments/sla-policy')).data,
  });
  const saveSlaPolicy = async (p: SlaPolicy) => {
    await apiClient.put('/compliance/assessments/sla-policy', null, { params: p as unknown as Record<string, number> });
    queryClient.invalidateQueries({ queryKey: ['redesign-sla-policy'] });
  };

  // Dedicated NCA workspace deps (only fetched when the tab/back-end need them).
  const { data: ncaContainer } = useQuery<{ id: number }>({
    queryKey: ['nca-container'],
    queryFn: async () => (await apiClient.get('/compliance/nca/container')).data,
    staleTime: 60_000,
  });
  // Whether the user has uploaded their own DCC-1:2022 Excel tool. If so, the
  // DCC Assessment tab shows THAT (their file), else the curated NCA container.
  const { data: dccToolList = [] } = useQuery<{ id: number }[]>({
    queryKey: ['dcc-tool-exists'],
    queryFn: async () => (await apiClient.get('/compliance/assessments', { params: { limit: 1, assessment_format: 'nca_dcc_tool' } })).data?.assessments || [],
    staleTime: 60_000,
  });
  const { data: ncaTenantUsers = [] } = useQuery<Array<{ id: number; label: string; email: string | null }>>({
    queryKey: ['nca-tenant-users'],
    queryFn: async () => {
      const r = await assetsApi.getTenantUsers();
      return (r.data as any[]).map((u) => ({ id: u.id, label: u.display_name || u.email || `User ${u.id}`, email: u.email || null }));
    },
    staleTime: 60_000,
  });

  const loadControls = async (a: Assessment): Promise<ControlItem[]> => {
    const res = await apiClient.get(`/compliance/assessments/${a.id}`);
    const data = res.data || {};
    const auditMaster = a.framework === 'internal_audit';
    const items: RawItem[] = data.items || Object.values(data.items_by_domain || {}).flat() as RawItem[];
    return items.map((it) => mapItem(it, auditMaster));
  };

  const triggerUpload = () => fileInputRef.current?.click();

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('name', file.name.replace(/\.[^.]+$/, ''));
      fd.append('assessment_type', 'gap_assessment');
      const slug = getTenantSlug();
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      const resp = await fetch('/api/compliance/assessments/upload', {
        method: 'POST',
        body: fd,
        credentials: 'include',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(slug ? { 'X-Tenant-Slug': slug } : {}),
        },
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: 'Upload failed' }));
        alert(err.detail || 'Upload failed');
      } else {
        queryClient.invalidateQueries({ queryKey: ['redesign-assessments'] });
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const renderTab = (tabKey: string) => {
    if (tabKey === 'asvs') return <ASVSAssessmentTab />;
    if (tabKey === 'cs_mobile') return <MobileAppSecurityTab />;
    if (tabKey === 'owasp_testing') return <OwaspTestingTab />;
    if (tabKey === 'cs_csir') return <MaturityAssessmentTab format="csir_maturity" />;
    if (tabKey === 'cs_cti') return <MaturityAssessmentTab format="cti_maturity" />;
    if (tabKey === 'cs_itsecops') return <MaturityAssessmentTab format="itsecops_maturity" />;
    if (tabKey === 'cs_incident') return <MaturityAssessmentTab format="incident_maturity" />;
    if (tabKey === 'digital_ops_maturity') return <MaturityAssessmentTab format="digital_ops_maturity" />;
    if (tabKey === 'cs_kpi') return <KpiReportTab />;
    if (tabKey === 'dpia') return <DpiaAssessmentTab />;
    if (tabKey === 'nca_vuln') return <NcaRegisterTab kind="vuln" />;
    if (tabKey === 'nca_audit') return <NcaRegisterTab kind="audit" />;
    if (tabKey === 'nca_risk') return <NcaRegisterTab kind="risk" />;
    if (tabKey === 'pdpl') return <PDPLAssessmentTab />;
    if (tabKey === 'nca') {
      // If the user uploaded their own DCC-1:2022 Excel tool, show that; else
      // fall back to the curated NCA container (DCC catalog + audit plan).
      if (dccToolList.length > 0) return <DccToolTab />;
      return ncaContainer ? <NcaTab assessmentId={ncaContainer.id} tenantUsers={ncaTenantUsers} /> : <DccToolTab />;
    }
    return undefined;
  };

  // Real backend wiring for the detail view (evidence, AI, add control, export).
  const api: DetailApi = {
    loadEvidence: async (assessmentId, itemId) => {
      const res = await apiClient.get(`/compliance/assessments/${assessmentId}/items/${itemId}/evidence`);
      const list: any[] = res.data?.evidence || res.data || [];
      if (!Array.isArray(list)) return [];
      return list.map((ev): EvidenceRow => {
        const fileName = ev.evidence_file_name || ev.evidence?.file_name || ev.evidence_name || ev.file_name || `Evidence-${ev.id}`;
        const name = ev.evidence_name || ev.evidence?.name || fileName;
        const isFramework = (ev.source || '') === 'framework_link';
        const status = ev.approval_status || ev.status || 'linked';
        const when = ev.created_at || ev.submitted_at || ev.evidence_uploaded_at;
        return {
          id: ev.id,
          name,
          ext: fileExt(fileName),
          meta: `${isFramework ? 'Framework-linked' : 'Linked'} · ${status}${when ? ' · ' + formatDate(when) : ''}`,
          tone: isFramework ? 'teal' : 'slate',
        };
      });
    },
    uploadEvidence: async (assessmentId, itemId, file) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('name', file.name.replace(/\.[^.]+$/, ''));
      await apiClient.post(
        `/compliance/assessments/${assessmentId}/items/${itemId}/evidence/upload`,
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      queryClient.invalidateQueries({ queryKey: ['redesign-controls', assessmentId] });
    },
    generateAi: async (assessmentId, itemId) => {
      const res = await apiClient.post(`/compliance/assessments/${assessmentId}/items/${itemId}/ai-recommendation`);
      queryClient.invalidateQueries({ queryKey: ['redesign-controls', assessmentId] });
      const data = res.data;
      // Response shape: { item_id, recommendation: { recommendations[], summary }, generated_at }
      const rec = data?.recommendation ?? data;
      if (rec && Array.isArray(rec.recommendations)) return rec as AiRec;
      return parseAiRec(data?.ai_evidence_recommendation ?? null);
    },
    applyRemediation: async (itemId, text) => {
      await apiClient.put(`/compliance/assessments/items/${itemId}`, null, {
        params: { proposed_solution: text, remediation_status: 'In Progress' },
      });
    },
    createControl: async (assessmentId, payload: NewControl) => {
      await apiClient.post(`/compliance/assessments/${assessmentId}/items`, payload);
      queryClient.invalidateQueries({ queryKey: ['redesign-controls', assessmentId] });
      queryClient.invalidateQueries({ queryKey: ['redesign-assessments'] });
    },
    updateControl: async (assessmentId, itemId, patch) => {
      // PUT takes fields as query params; only send the keys present in the patch.
      const params: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(patch)) {
        if (v !== undefined) params[k] = v as string | number;
      }
      await apiClient.put(`/compliance/assessments/items/${itemId}`, null, { params });
      queryClient.invalidateQueries({ queryKey: ['redesign-controls', assessmentId] });
      queryClient.invalidateQueries({ queryKey: ['redesign-assessments'] });
    },
    reupload: async (assessmentId, file) => {
      const fd = new FormData();
      fd.append('file', file);
      const res = await apiClient.post(`/compliance/assessments/${assessmentId}/reupload`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      queryClient.invalidateQueries({ queryKey: ['redesign-controls', assessmentId] });
      queryClient.invalidateQueries({ queryKey: ['redesign-assessments'] });
      return res.data || {};
    },
    exportReport: async (assessment) => {
      try {
        const res = await apiClient.get(`/compliance/assessments/${assessment.id}/export`, { responseType: 'blob' });
        const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${assessment.name || 'assessment'}_export.xlsx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      } catch {
        alert('Failed to export assessment.');
      }
    },
    tenantUsers: ncaTenantUsers,
  };

  return (
    <>
      <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv,.pdf" className="hidden" onChange={onFileChosen} />
      {uploading && (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-lg">
          Uploading & parsing…
        </div>
      )}
      <ComplianceAssessmentsModule
        embedded
        initialTab={initialTab}
        assessments={assessments}
        loadControls={loadControls}
        onUpload={triggerUpload}
        renderTab={renderTab}
        api={api}
        slaPoints={slaPoints}
        slaPolicy={slaPolicy}
        onSlaPolicyChange={saveSlaPolicy}
      />
    </>
  );
}
