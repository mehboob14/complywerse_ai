'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { complianceApi, evidenceApi, governanceApi } from '@/lib/api';

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
  compliant: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Compliant' },
  partially_compliant: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Partially Compliant' },
  non_compliant: { bg: 'bg-rose-50', text: 'text-rose-700', label: 'Non-Compliant' },
  not_assessed: { bg: 'bg-gray-50', text: 'text-gray-700', label: 'Not Assessed' },
  not_applicable: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Not Applicable' },
};

const PRIORITY_STYLES: Record<string, { bg: string; text: string }> = {
  critical: { bg: 'bg-rose-50', text: 'text-rose-700' },
  high: { bg: 'bg-orange-50', text: 'text-orange-700' },
  medium: { bg: 'bg-amber-50', text: 'text-amber-700' },
  low: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
};

export default function PolicyStatementsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [documentFilter, setDocumentFilter] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 20;
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
    queryKey: ['compliance-statements', statusFilter, priorityFilter, categoryFilter, documentFilter, page],
    queryFn: async () => {
      const params: Record<string, any> = {
        skip: page * pageSize,
        limit: pageSize,
      };
      if (statusFilter) params.compliance_status = statusFilter;
      if (priorityFilter) params.priority = priorityFilter;
      if (categoryFilter) params.category = categoryFilter;
      if (documentFilter) params.document_id = Number(documentFilter);
      const response = await complianceApi.statements.getAll(params);
      return response.data;
    },
  });

  const { data: documentsData } = useQuery({
    queryKey: ['governance-documents', 'compliance-statements'],
    queryFn: async () => {
      const response = await governanceApi.getDocuments({ limit: 500 });
      if (Array.isArray(response.data)) return response.data;
      return (response.data as any)?.items || [];
    },
  });
  const documents = documentsData || [];

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
    onSuccess: async (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['compliance-statements'] });
      if (selectedStatement?.id === id) {
        try {
          const refreshed = await complianceApi.statements.getById(id);
          const detail = refreshed.data as StatementDetail;
          setSelectedStatement(detail);
          setEvidenceToLink(detail.compliance?.evidence_ids || []);
        } catch (error) {
          console.error('Failed to refresh statement details', error);
        }
      }
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
    
    const uniqueDocumentIds: number[] = Array.from(
      new Set<number>(selectedStmts.map((s: Statement) => Number(s.document_id)))
    );
    
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
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <div className="flex flex-col items-center justify-center py-12">
          <AlertCircle className="h-12 w-12 text-rose-600 mb-4" />
          <p className="text-gray-600">Failed to load policy statements</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {successMessage && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-center gap-3">
          <CheckCircle className="h-5 w-5 text-emerald-600" />
          <p className="text-emerald-700">{successMessage}</p>
          <button
            onClick={() => setSuccessMessage(null)}
            className="ml-auto text-emerald-600 hover:text-emerald-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search statements..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black placeholder-gray-400"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {selectedStatementIds.length > 0 && (
            <button
              onClick={() => setIsConvertModalOpen(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 font-medium"
            >
              <Shield className="h-4 w-4" />
              Convert to Controls ({selectedStatementIds.length})
            </button>
          )}
          <select
            value={documentFilter}
            onChange={(e) => { setDocumentFilter(e.target.value); setPage(0); }}
            className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-black focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[180px]"
          >
            <option value="">All Documents</option>
            {documents.map((doc: any) => (
              <option key={doc.id} value={String(doc.id)}>
                {doc.title || doc.document_code || `Document ${doc.id}`}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
            className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-black focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[150px]"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <select
            value={priorityFilter}
            onChange={(e) => { setPriorityFilter(e.target.value); setPage(0); }}
            className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-black focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[130px]"
          >
            {PRIORITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {categories.length > 0 && (
            <select
              value={categoryFilter}
              onChange={(e) => { setCategoryFilter(e.target.value); setPage(0); }}
              className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-black focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[130px]"
            >
              <option value="">All Categories</option>
              {categories.map((cat: string) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider w-12">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={handleSelectAll}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Code</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Statement</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Document</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Category</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Priority</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="text-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-blue-600" />
                  </td>
                </tr>
              ) : filteredStatements.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8">
                    <FileText className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                    <p className="text-gray-600">No policy statements found</p>
                  </td>
                </tr>
              ) : (
                filteredStatements.map((stmt: Statement) => {
                  const statusStyle = STATUS_STYLES[stmt.compliance_status] || STATUS_STYLES.not_assessed;
                  const priorityStyle = PRIORITY_STYLES[stmt.priority || 'medium'] || PRIORITY_STYLES.medium;
                  const isSelected = selectedStatementIds.includes(stmt.id);
                  return (
                    <tr key={stmt.id} className={`hover:bg-gray-50 transition-colors ${isSelected ? 'bg-blue-50' : 'bg-white'}`}>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleStatement(stmt.id)}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">{stmt.statement_code || '-'}</td>
                      <td className="px-4 py-3 max-w-xs">
                        <p className="truncate text-sm text-black">
                          {stmt.statement_summary || stmt.statement_text?.slice(0, 80) + '...' || '-'}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-gray-600">{stmt.document_title || '-'}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm capitalize text-gray-700">{stmt.category?.replace(/_/g, ' ') || '-'}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 text-xs font-medium rounded capitalize ${priorityStyle.bg} ${priorityStyle.text}`}>
                          {stmt.priority || 'medium'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 text-xs font-medium rounded ${statusStyle.bg} ${statusStyle.text}`}>
                          {statusStyle.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleOpenModal(stmt.id)}
                          className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
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
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <p className="text-sm text-gray-600">
            Showing {page * pageSize + 1} to {Math.min((page + 1) * pageSize, total)} of {total} statements
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm text-gray-600">
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {isConvertModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-semibold text-black">Convert to Internal Controls</h2>
                <p className="text-sm text-gray-600">Create controls from {selectedStatementIds.length} selected statement(s)</p>
              </div>
              <button onClick={() => setIsConvertModalOpen(false)} className="p-2 text-gray-500 hover:text-black hover:bg-gray-100 rounded-lg transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-gray-700">
                  <span className="font-semibold text-black">{selectedStatementIds.length}</span> statement(s) will be converted to internal controls.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Category (Optional)</label>
                <select
                  value={convertForm.category}
                  onChange={(e) => setConvertForm({ ...convertForm, category: e.target.value })}
                  className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-black focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-full"
                >
                  {CONTROL_CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Priority (Optional)</label>
                <select
                  value={convertForm.priority}
                  onChange={(e) => setConvertForm({ ...convertForm, priority: e.target.value })}
                  className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-black focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-full"
                >
                  {CONTROL_PRIORITY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200">
              <button onClick={() => setIsConvertModalOpen(false)} className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium">
                Cancel
              </button>
              <button
                onClick={handleConvertToControls}
                disabled={convertMutation.isPending}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center gap-2 font-medium"
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
        <>
          <div
            className="fixed inset-0 bg-black/30 z-40"
            onClick={() => setIsModalOpen(false)}
          />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-white shadow-2xl flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <div>
                <h2 className="text-base font-semibold text-black">Statement Details</h2>
                <p className="text-sm text-gray-500">{selectedStatement.statement_code}</p>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="p-2 text-gray-500 hover:text-black hover:bg-gray-100 rounded-lg transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Statement Text</label>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-700">
                  {selectedStatement.statement_text || 'No text available'}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Document</label>
                  <p className="text-sm text-black">{selectedStatement.document_title || '-'}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
                  <p className="text-sm text-black capitalize">{selectedStatement.category?.replace(/_/g, ' ') || '-'}</p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Compliance Status</label>
                <select
                  value={complianceForm.compliance_status}
                  onChange={(e) => setComplianceForm({ ...complianceForm, compliance_status: e.target.value })}
                  className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-black focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-full"
                >
                  {STATUS_OPTIONS.filter(o => o.value).map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Findings</label>
                <textarea
                  value={complianceForm.findings}
                  onChange={(e) => setComplianceForm({ ...complianceForm, findings: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-black placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-h-[100px]"
                  placeholder="Document your findings..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Remediation Notes</label>
                <textarea
                  value={complianceForm.remediation_notes}
                  onChange={(e) => setComplianceForm({ ...complianceForm, remediation_notes: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-black placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-h-[80px]"
                  placeholder="Remediation plan..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Next Assessment Date</label>
                <input
                  type="date"
                  value={complianceForm.next_assessment_date}
                  onChange={(e) => setComplianceForm({ ...complianceForm, next_assessment_date: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-black focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                  <LinkIcon className="h-4 w-4" />
                  Link Evidence
                </label>
                <div className="space-y-2 max-h-40 overflow-y-auto bg-gray-50 border border-gray-200 rounded-lg p-3">
                  {(evidenceList || []).map((ev: any) => (
                    <label key={ev.id} className="flex items-center gap-2 cursor-pointer hover:bg-white p-2 rounded">
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
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700">{ev.name}</span>
                    </label>
                  ))}
                  {(!evidenceList || evidenceList.length === 0) && (
                    <p className="text-sm text-gray-500 text-center py-2">No evidence available</p>
                  )}
                </div>
              </div>

              {selectedStatement.evidence && selectedStatement.evidence.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Linked Evidence</label>
                  <div className="space-y-2">
                    {selectedStatement.evidence.map((ev) => (
                      <div key={ev.id} className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 p-2 rounded-lg">
                        <CheckCircle className="h-4 w-4 text-emerald-600" />
                        <span className="text-sm text-gray-700">{ev.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 p-5 border-t border-gray-200">
              <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium">
                Cancel
              </button>
              <button
                onClick={handleSaveCompliance}
                disabled={updateComplianceMutation.isPending}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center gap-2 font-medium"
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
        </>
      )}
    </div>
  );
}
