'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { complianceApi, evidenceApi } from '@/lib/api';
import {
  FileText,
  Search,
  X,
  Eye,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  CheckCircle,
  Link as LinkIcon,
  Save,
  Shield,
} from 'lucide-react';

interface Statement {
  id: number;
  tenant_id: number;
  document_id: number;
  document_title: string | null;
  document_code: string | null;
  statement_code: string | null;
  statement_text: string | null;
  statement_summary: string | null;
  category: string | null;
  sub_category: string | null;
  priority: string | null;
  is_mandatory: boolean;
  status: string | null;
  effective_date: string | null;
  review_date: string | null;
  source_section: string | null;
  ai_confidence: number | null;
  compliance_status: string;
  compliance_score: number | null;
  next_assessment_date: string | null;
  created_at: string | null;
}

interface StatementDetail {
  id: number;
  statement_code: string | null;
  statement_text: string | null;
  statement_summary: string | null;
  document_title: string | null;
  document_code: string | null;
  category: string | null;
  sub_category: string | null;
  priority: string | null;
  is_mandatory: boolean;
  compliance: {
    id: number | null;
    compliance_status: string;
    compliance_score: number | null;
    owner_id: number | null;
    owner_name: string | null;
    department: string | null;
    assessment_date: string | null;
    findings: string | null;
    remediation_notes: string | null;
    remediation_due_date: string | null;
    next_assessment_date: string | null;
    evidence_ids: number[];
  } | null;
  evidence: Array<{
    id: number;
    name: string;
    file_name: string | null;
    status: string | null;
  }>;
}

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'compliant', label: 'Compliant' },
  { value: 'partially_compliant', label: 'Partially Compliant' },
  { value: 'non_compliant', label: 'Non-Compliant' },
  { value: 'not_assessed', label: 'Not Assessed' },
  { value: 'not_applicable', label: 'Not Applicable' },
];

const PRIORITY_OPTIONS = [
  { value: '', label: 'All Priorities' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const CONTROL_CATEGORY_OPTIONS = [
  { value: '', label: 'No Category' },
  { value: 'security', label: 'Security' },
  { value: 'privacy', label: 'Privacy' },
  { value: 'operational', label: 'Operational' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'governance', label: 'Governance' },
  { value: 'risk_management', label: 'Risk Management' },
  { value: 'hr', label: 'HR' },
  { value: 'it', label: 'IT' },
  { value: 'financial', label: 'Financial' },
  { value: 'legal', label: 'Legal' },
  { value: 'environmental', label: 'Environmental' },
  { value: 'quality', label: 'Quality' },
];

const CONTROL_PRIORITY_OPTIONS = [
  { value: '', label: 'No Priority' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  compliant: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'Compliant' },
  partially_compliant: { bg: 'bg-amber-500/20', text: 'text-amber-400', label: 'Partially Compliant' },
  non_compliant: { bg: 'bg-rose-500/20', text: 'text-rose-400', label: 'Non-Compliant' },
  not_assessed: { bg: 'bg-slate-500/20', text: 'text-slate-400', label: 'Not Assessed' },
  not_applicable: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'Not Applicable' },
};

const PRIORITY_STYLES: Record<string, { bg: string; text: string }> = {
  critical: { bg: 'bg-rose-500/20', text: 'text-rose-400' },
  high: { bg: 'bg-orange-500/20', text: 'text-orange-400' },
  medium: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  low: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
};

export default function PolicyStatementsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize] = useState(10);
  const [selectedStatement, setSelectedStatement] = useState<StatementDetail | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [complianceForm, setComplianceForm] = useState({
    compliance_status: 'not_assessed',
    findings: '',
    remediation_notes: '',
    next_assessment_date: '',
  });
  const [evidenceToLink, setEvidenceToLink] = useState<number[]>([]);
  const [selectedStatementIds, setSelectedStatementIds] = useState<number[]>([]);
  const [isConvertModalOpen, setIsConvertModalOpen] = useState(false);
  const [convertForm, setConvertForm] = useState({
    category: '',
    priority: '',
  });
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['compliance-statements', statusFilter, priorityFilter, categoryFilter, page, pageSize],
    queryFn: async () => {
      const params: Record<string, any> = {
        skip: page * pageSize,
        limit: pageSize,
      };
      if (statusFilter) params.compliance_status = statusFilter;
      if (priorityFilter) params.priority = priorityFilter;
      if (categoryFilter) params.category = categoryFilter;
      const response = await complianceApi.statements.getAll(params);
      return response.data;
    },
  });

  const { data: evidenceList } = useQuery({
    queryKey: ['evidence-list'],
    queryFn: async () => {
      const response = await evidenceApi.getAll();
      return response.data;
    },
    enabled: isModalOpen,
  });

  const updateComplianceMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      return complianceApi.statements.updateCompliance(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compliance-statements'] });
      queryClient.invalidateQueries({ queryKey: ['compliance-dashboard-summary'] });
      setIsModalOpen(false);
      setSelectedStatement(null);
    },
  });

  const linkEvidenceMutation = useMutation({
    mutationFn: async ({ id, evidenceIds }: { id: number; evidenceIds: number[] }) => {
      return complianceApi.statements.linkEvidence(id, evidenceIds);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compliance-statements'] });
      setEvidenceToLink([]);
    },
  });

  const convertMutation = useMutation({
    mutationFn: (data: { documentId: number; statement_ids: number[]; category?: string; priority?: string }) =>
      complianceApi.statements.convertToControls(data.documentId, {
        statement_ids: data.statement_ids,
        category: data.category,
        priority: data.priority,
      }),
    onSuccess: (response) => {
      const controlsCreated = (response.data as any)?.controls_created || selectedStatementIds.length;
      setSuccessMessage(`Successfully created ${controlsCreated} internal control(s) from selected statements.`);
      setSelectedStatementIds([]);
      setIsConvertModalOpen(false);
      setConvertForm({ category: '', priority: '' });
      queryClient.invalidateQueries({ queryKey: ['compliance-statements'] });
      setTimeout(() => setSuccessMessage(null), 5000);
    },
    onError: (error: any) => {
      console.error('Failed to convert statements to controls', error);
    },
  });

  const handleOpenModal = async (statementId: number) => {
    try {
      const response = await complianceApi.statements.getById(statementId);
      const detail = response.data as StatementDetail;
      setSelectedStatement(detail);
      setComplianceForm({
        compliance_status: detail.compliance?.compliance_status || 'not_assessed',
        findings: detail.compliance?.findings || '',
        remediation_notes: detail.compliance?.remediation_notes || '',
        next_assessment_date: detail.compliance?.next_assessment_date?.split('T')[0] || '',
      });
      setEvidenceToLink(detail.compliance?.evidence_ids || []);
      setIsModalOpen(true);
    } catch (err) {
      console.error('Failed to load statement details', err);
    }
  };

  const handleSaveCompliance = () => {
    if (!selectedStatement) return;
    const data: any = {
      compliance_status: complianceForm.compliance_status,
    };
    if (complianceForm.findings) data.findings = complianceForm.findings;
    if (complianceForm.remediation_notes) data.remediation_notes = complianceForm.remediation_notes;
    if (complianceForm.next_assessment_date) data.next_assessment_date = complianceForm.next_assessment_date;

    updateComplianceMutation.mutate({ id: selectedStatement.id, data });

    if (evidenceToLink.length > 0) {
      linkEvidenceMutation.mutate({ id: selectedStatement.id, evidenceIds: evidenceToLink });
    }
  };

  const handleToggleStatement = (statementId: number) => {
    setSelectedStatementIds((prev) =>
      prev.includes(statementId)
        ? prev.filter((id) => id !== statementId)
        : [...prev, statementId]
    );
  };

  const handleSelectAll = () => {
    if (selectedStatementIds.length === filteredStatements.length) {
      setSelectedStatementIds([]);
    } else {
      setSelectedStatementIds(filteredStatements.map((s: Statement) => s.id));
    }
  };

  const handleConvertToControls = () => {
    if (selectedStatementIds.length === 0) return;
    
    const selectedStmts = filteredStatements.filter((s: Statement) => selectedStatementIds.includes(s.id));
    if (selectedStmts.length === 0) return;
    
    const uniqueDocumentIds = [...new Set(selectedStmts.map((s: Statement) => s.document_id))];
    
    if (uniqueDocumentIds.length > 1) {
      alert('Please select statements from a single policy document only. The selected statements belong to ' + uniqueDocumentIds.length + ' different documents.');
      return;
    }

    const documentId = uniqueDocumentIds[0];
    convertMutation.mutate({
      documentId,
      statement_ids: selectedStatementIds,
      category: convertForm.category || undefined,
      priority: convertForm.priority || undefined,
    });
  };

  const statements = data?.statements || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize);

  const categories: string[] = Array.from(new Set(statements.map((s: Statement) => s.category).filter(Boolean))) as string[];

  const filteredStatements = searchTerm
    ? statements.filter((s: Statement) =>
        s.statement_code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.statement_text?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.document_title?.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : statements;

  const allSelected = filteredStatements.length > 0 && selectedStatementIds.length === filteredStatements.length;

  if (error) {
    return (
      <div className="card">
        <div className="flex flex-col items-center justify-center py-12">
          <AlertCircle className="h-12 w-12 text-rose-400 mb-4" />
          <p className="text-slate-400">Failed to load policy statements</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {successMessage && (
        <div className="bg-emerald-500/20 border border-emerald-500/30 rounded-lg p-4 flex items-center gap-3">
          <CheckCircle className="h-5 w-5 text-emerald-400" />
          <p className="text-emerald-300">{successMessage}</p>
          <button
            onClick={() => setSuccessMessage(null)}
            className="ml-auto text-emerald-400 hover:text-emerald-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search statements..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input pl-10"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {selectedStatementIds.length > 0 && (
            <button
              onClick={() => setIsConvertModalOpen(true)}
              className="btn-primary flex items-center gap-2"
            >
              <Shield className="h-4 w-4" />
              Convert to Controls ({selectedStatementIds.length})
            </button>
          )}
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
            className="select min-w-[150px]"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <select
            value={priorityFilter}
            onChange={(e) => { setPriorityFilter(e.target.value); setPage(0); }}
            className="select min-w-[130px]"
          >
            {PRIORITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {categories.length > 0 && (
            <select
              value={categoryFilter}
              onChange={(e) => { setCategoryFilter(e.target.value); setPage(0); }}
              className="select min-w-[130px]"
            >
              <option value="">All Categories</option>
              {categories.map((cat: string) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th className="w-12">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={handleSelectAll}
                  className="rounded border-slate-600 bg-slate-800 text-primary-500"
                />
              </th>
              <th>Code</th>
              <th>Statement</th>
              <th>Document</th>
              <th>Category</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={8} className="text-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary-400" />
                </td>
              </tr>
            ) : filteredStatements.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-8">
                  <FileText className="h-12 w-12 text-slate-500 mx-auto mb-3" />
                  <p className="text-slate-400">No policy statements found</p>
                </td>
              </tr>
            ) : (
              filteredStatements.map((stmt: Statement) => {
                const statusStyle = STATUS_STYLES[stmt.compliance_status] || STATUS_STYLES.not_assessed;
                const priorityStyle = PRIORITY_STYLES[stmt.priority || 'medium'] || PRIORITY_STYLES.medium;
                const isSelected = selectedStatementIds.includes(stmt.id);
                return (
                  <tr key={stmt.id} className={isSelected ? 'bg-primary-500/10' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleStatement(stmt.id)}
                        className="rounded border-slate-600 bg-slate-800 text-primary-500"
                      />
                    </td>
                    <td className="font-mono text-xs">{stmt.statement_code || '-'}</td>
                    <td className="max-w-xs">
                      <p className="truncate text-sm">
                        {stmt.statement_summary || stmt.statement_text?.slice(0, 80) + '...' || '-'}
                      </p>
                    </td>
                    <td>
                      <span className="text-sm text-slate-400">{stmt.document_title || '-'}</span>
                    </td>
                    <td>
                      <span className="text-sm capitalize">{stmt.category?.replace(/_/g, ' ') || '-'}</span>
                    </td>
                    <td>
                      <span className={`badge ${priorityStyle.bg} ${priorityStyle.text} capitalize`}>
                        {stmt.priority || 'medium'}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${statusStyle.bg} ${statusStyle.text}`}>
                        {statusStyle.label}
                      </span>
                    </td>
                    <td>
                      <button
                        onClick={() => handleOpenModal(stmt.id)}
                        className="btn-ghost btn-sm"
                        title="View Details"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-400">
            Showing {page * pageSize + 1} to {Math.min((page + 1) * pageSize, total)} of {total} statements
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="btn-secondary btn-sm"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm text-slate-400">
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="btn-secondary btn-sm"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {isConvertModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-slate-700">
              <div>
                <h2 className="text-lg font-semibold text-white">Convert to Internal Controls</h2>
                <p className="text-sm text-slate-400">Create controls from {selectedStatementIds.length} selected statement(s)</p>
              </div>
              <button onClick={() => setIsConvertModalOpen(false)} className="btn-ghost btn-sm">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="bg-slate-900 rounded-lg p-4">
                <p className="text-sm text-slate-300">
                  <span className="font-semibold text-white">{selectedStatementIds.length}</span> statement(s) will be converted to internal controls.
                </p>
              </div>

              <div>
                <label className="label">Category (Optional)</label>
                <select
                  value={convertForm.category}
                  onChange={(e) => setConvertForm({ ...convertForm, category: e.target.value })}
                  className="select"
                >
                  {CONTROL_CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">Priority (Optional)</label>
                <select
                  value={convertForm.priority}
                  onChange={(e) => setConvertForm({ ...convertForm, priority: e.target.value })}
                  className="select"
                >
                  {CONTROL_PRIORITY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 p-6 border-t border-slate-700">
              <button onClick={() => setIsConvertModalOpen(false)} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={handleConvertToControls}
                disabled={convertMutation.isPending}
                className="btn-primary flex items-center gap-2"
              >
                {convertMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Shield className="h-4 w-4" />
                )}
                Convert to Controls
              </button>
            </div>
          </div>
        </div>
      )}

      {isModalOpen && selectedStatement && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-slate-700">
              <div>
                <h2 className="text-lg font-semibold text-white">Statement Details</h2>
                <p className="text-sm text-slate-400">{selectedStatement.statement_code}</p>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="btn-ghost btn-sm">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div>
                <label className="label">Statement Text</label>
                <div className="bg-slate-900 rounded-lg p-4 text-sm text-slate-300">
                  {selectedStatement.statement_text || 'No text available'}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Document</label>
                  <p className="text-sm text-slate-300">{selectedStatement.document_title || '-'}</p>
                </div>
                <div>
                  <label className="label">Category</label>
                  <p className="text-sm text-slate-300 capitalize">{selectedStatement.category?.replace(/_/g, ' ') || '-'}</p>
                </div>
              </div>

              <div>
                <label className="label">Compliance Status</label>
                <select
                  value={complianceForm.compliance_status}
                  onChange={(e) => setComplianceForm({ ...complianceForm, compliance_status: e.target.value })}
                  className="select"
                >
                  {STATUS_OPTIONS.filter(o => o.value).map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">Findings</label>
                <textarea
                  value={complianceForm.findings}
                  onChange={(e) => setComplianceForm({ ...complianceForm, findings: e.target.value })}
                  className="input min-h-[100px]"
                  placeholder="Document your findings..."
                />
              </div>

              <div>
                <label className="label">Remediation Notes</label>
                <textarea
                  value={complianceForm.remediation_notes}
                  onChange={(e) => setComplianceForm({ ...complianceForm, remediation_notes: e.target.value })}
                  className="input min-h-[80px]"
                  placeholder="Remediation plan..."
                />
              </div>

              <div>
                <label className="label">Next Assessment Date</label>
                <input
                  type="date"
                  value={complianceForm.next_assessment_date}
                  onChange={(e) => setComplianceForm({ ...complianceForm, next_assessment_date: e.target.value })}
                  className="input"
                />
              </div>

              <div>
                <label className="label flex items-center gap-2">
                  <LinkIcon className="h-4 w-4" />
                  Link Evidence
                </label>
                <div className="space-y-2 max-h-40 overflow-y-auto bg-slate-900 rounded-lg p-3">
                  {(evidenceList || []).map((ev: any) => (
                    <label key={ev.id} className="flex items-center gap-2 cursor-pointer hover:bg-slate-800 p-2 rounded">
                      <input
                        type="checkbox"
                        checked={evidenceToLink.includes(ev.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setEvidenceToLink([...evidenceToLink, ev.id]);
                          } else {
                            setEvidenceToLink(evidenceToLink.filter(id => id !== ev.id));
                          }
                        }}
                        className="rounded border-slate-600 bg-slate-800 text-primary-500"
                      />
                      <span className="text-sm text-slate-300">{ev.name}</span>
                    </label>
                  ))}
                  {(!evidenceList || evidenceList.length === 0) && (
                    <p className="text-sm text-slate-500 text-center py-2">No evidence available</p>
                  )}
                </div>
              </div>

              {selectedStatement.evidence && selectedStatement.evidence.length > 0 && (
                <div>
                  <label className="label">Linked Evidence</label>
                  <div className="space-y-2">
                    {selectedStatement.evidence.map((ev) => (
                      <div key={ev.id} className="flex items-center gap-2 bg-slate-900 p-2 rounded-lg">
                        <CheckCircle className="h-4 w-4 text-emerald-400" />
                        <span className="text-sm text-slate-300">{ev.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 p-6 border-t border-slate-700">
              <button onClick={() => setIsModalOpen(false)} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={handleSaveCompliance}
                disabled={updateComplianceMutation.isPending}
                className="btn-primary"
              >
                {updateComplianceMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
