'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vulnManagementApi, assetsApi, ermApi, controlsApi } from '@/lib/api';
import {
  Bug,
  Loader2,
  ArrowLeft,
  AlertCircle,
  Server,
  Shield,
  Clock,
  CheckCircle,
  RefreshCw,
  Sparkles,
  Plus,
  X,
  Trash2,
  FileText,
  Link as LinkIcon,
  Calendar,
  User,
  ExternalLink,
} from 'lucide-react';
import Link from 'next/link';

interface VulnerabilityDetail {
  id: number;
  title: string;
  description?: string;
  severity: string;
  status: string;
  cve_id?: string;
  cwe_id?: string;
  cvss_score?: number;
  affected_component?: string;
  affected_host?: string;
  due_date?: string;
  assigned_to?: number;
  assigned_user_name?: string;
  report_id?: number;
  report_name?: string;
  ai_recommendation?: string;
  created_at: string;
  updated_at?: string;
}

interface Mitigation {
  id: number;
  title: string;
  description?: string;
  status: string;
  priority?: string;
  due_date?: string;
  assigned_to?: number;
  assigned_user_name?: string;
  completed_at?: string;
}

interface AssetLink {
  id: number;
  asset_id: number;
  asset_name: string;
  asset_type?: string;
  relationship_type?: string;
}

interface ControlLink {
  id: number;
  control_type: string;
  framework_control_id?: number;
  internal_control_id?: number;
  control_name?: string;
  control_id_display?: string;
}

interface Retest {
  id: number;
  test_date: string;
  result: string;
  tester_name?: string;
  notes?: string;
}

interface RiskException {
  id: number;
  reason: string;
  status: string;
  approved_by?: number;
  approved_at?: string;
  expiry_date?: string;
}

const TABS = [
  { id: 'overview', label: 'Overview', icon: FileText },
  { id: 'mitigations', label: 'Mitigations', icon: CheckCircle },
  { id: 'assets', label: 'Assets', icon: Server },
  { id: 'controls', label: 'Controls', icon: Shield },
  { id: 'retests', label: 'Retests', icon: RefreshCw },
  { id: 'ai', label: 'AI Analysis', icon: Sparkles },
  { id: 'exception', label: 'Exception', icon: AlertCircle },
];

const SEVERITY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  critical: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Critical' },
  high: { bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'High' },
  medium: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Medium' },
  low: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'Low' },
  info: { bg: 'bg-slate-500/20', text: 'text-slate-400', label: 'Info' },
};

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  open: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Open' },
  in_progress: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'In Progress' },
  remediated: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'Remediated' },
  verified: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Verified' },
  closed: { bg: 'bg-slate-500/20', text: 'text-slate-400', label: 'Closed' },
  accepted: { bg: 'bg-purple-500/20', text: 'text-purple-400', label: 'Risk Accepted' },
  false_positive: { bg: 'bg-slate-500/20', text: 'text-slate-400', label: 'False Positive' },
};

function getSeverityStyle(severity: string) {
  return SEVERITY_STYLES[severity?.toLowerCase()] || SEVERITY_STYLES.info;
}

function getStatusStyle(status: string) {
  return STATUS_STYLES[status?.toLowerCase()] || STATUS_STYLES.open;
}

export default function VulnerabilityDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const vulnId = Number(params.id);

  const [activeTab, setActiveTab] = useState('overview');
  const [showMitigationModal, setShowMitigationModal] = useState(false);
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [showControlModal, setShowControlModal] = useState(false);
  const [showRetestModal, setShowRetestModal] = useState(false);
  const [showExceptionModal, setShowExceptionModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);

  const { data: vulnerability, isLoading, error } = useQuery({
    queryKey: ['vulnerability', vulnId],
    queryFn: async () => {
      const response = await vulnManagementApi.vulnerabilities.getById(vulnId);
      return response.data as VulnerabilityDetail;
    },
  });

  const { data: mitigations } = useQuery({
    queryKey: ['vuln-mitigations', vulnId],
    queryFn: async () => {
      const response = await vulnManagementApi.mitigations.list(vulnId);
      return response.data as Mitigation[];
    },
    enabled: activeTab === 'mitigations',
  });

  const { data: assetLinks } = useQuery({
    queryKey: ['vuln-assets', vulnId],
    queryFn: async () => {
      const response = await vulnManagementApi.assetLinks.list(vulnId);
      return response.data as AssetLink[];
    },
    enabled: activeTab === 'assets',
  });

  const { data: controlLinks } = useQuery({
    queryKey: ['vuln-controls', vulnId],
    queryFn: async () => {
      const response = await vulnManagementApi.controlLinks.list(vulnId);
      return response.data as ControlLink[];
    },
    enabled: activeTab === 'controls',
  });

  const { data: retests } = useQuery({
    queryKey: ['vuln-retests', vulnId],
    queryFn: async () => {
      const response = await vulnManagementApi.retests.list(vulnId);
      return response.data as Retest[];
    },
    enabled: activeTab === 'retests',
  });

  const { data: exceptions } = useQuery({
    queryKey: ['vuln-exceptions', vulnId],
    queryFn: async () => {
      const response = await vulnManagementApi.exceptions.list(vulnId);
      return response.data as RiskException[];
    },
    enabled: activeTab === 'exception',
  });

  const { data: assets } = useQuery({
    queryKey: ['assets-list'],
    queryFn: async () => {
      const response = await assetsApi.getAll();
      return response.data;
    },
    enabled: showAssetModal,
  });

  const { data: frameworkControls } = useQuery({
    queryKey: ['framework-controls-list'],
    queryFn: async () => {
      const response = await controlsApi.getAll();
      return response.data;
    },
    enabled: showControlModal,
  });

  const changeStatusMutation = useMutation({
    mutationFn: ({ status, notes }: { status: string; notes?: string }) =>
      vulnManagementApi.vulnerabilities.changeStatus(vulnId, status, notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vulnerability', vulnId] });
      queryClient.invalidateQueries({ queryKey: ['vulnerabilities'] });
      setShowStatusModal(false);
    },
  });

  const suggestFixMutation = useMutation({
    mutationFn: () => vulnManagementApi.ai.suggestFix(vulnId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vulnerability', vulnId] });
    },
  });

  const createMitigationMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => vulnManagementApi.mitigations.create(vulnId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vuln-mitigations', vulnId] });
      setShowMitigationModal(false);
    },
  });

  const createAssetLinkMutation = useMutation({
    mutationFn: (data: { asset_id: number; relationship_type?: string }) =>
      vulnManagementApi.assetLinks.create(vulnId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vuln-assets', vulnId] });
      setShowAssetModal(false);
    },
  });

  const deleteAssetLinkMutation = useMutation({
    mutationFn: (linkId: number) => vulnManagementApi.assetLinks.delete(vulnId, linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vuln-assets', vulnId] });
    },
  });

  const createControlLinkMutation = useMutation({
    mutationFn: (data: { control_type: string; framework_control_id?: number; internal_control_id?: number }) =>
      vulnManagementApi.controlLinks.create(vulnId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vuln-controls', vulnId] });
      setShowControlModal(false);
    },
  });

  const deleteControlLinkMutation = useMutation({
    mutationFn: (linkId: number) => vulnManagementApi.controlLinks.delete(vulnId, linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vuln-controls', vulnId] });
    },
  });

  const createRetestMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => vulnManagementApi.retests.create(vulnId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vuln-retests', vulnId] });
      setShowRetestModal(false);
    },
  });

  const createExceptionMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => vulnManagementApi.exceptions.create(vulnId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vuln-exceptions', vulnId] });
      setShowExceptionModal(false);
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  if (error || !vulnerability) {
    return (
      <div className="rounded-xl border border-red-700 bg-red-900/20 p-6 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-red-400" />
        <p className="mt-2 text-red-400">Failed to load vulnerability details</p>
        <Link href="/vulnerabilities" className="mt-4 inline-flex items-center gap-2 text-primary-400 hover:text-primary-300">
          <ArrowLeft size={16} />
          Back to Vulnerabilities
        </Link>
      </div>
    );
  }

  const severityStyle = getSeverityStyle(vulnerability.severity);
  const statusStyle = getStatusStyle(vulnerability.status);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/vulnerabilities" className="text-slate-400 hover:text-white transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">{vulnerability.title}</h1>
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${severityStyle.bg} ${severityStyle.text}`}>
              {severityStyle.label}
            </span>
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
              {statusStyle.label}
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1">VULN-{vulnerability.id}</p>
        </div>
        <button onClick={() => setShowStatusModal(true)} className="btn-secondary">
          Change Status
        </button>
      </div>

      <div className="border-b border-slate-700">
        <nav className="flex gap-1 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-primary-500 text-primary-400'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              <tab.icon size={16} />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'overview' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <div className="rounded-xl border border-slate-700 bg-slate-800 p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Description</h2>
              <p className="text-slate-300 whitespace-pre-wrap">
                {vulnerability.description || 'No description provided.'}
              </p>
            </div>

            {vulnerability.ai_recommendation && (
              <div className="rounded-xl border border-purple-700/50 bg-purple-900/20 p-6">
                <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-purple-400" />
                  AI Recommendation
                </h2>
                <p className="text-slate-300 whitespace-pre-wrap">{vulnerability.ai_recommendation}</p>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-slate-700 bg-slate-800 p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Details</h2>
              <dl className="space-y-3">
                {vulnerability.cvss_score && (
                  <div>
                    <dt className="text-sm text-slate-400">CVSS Score</dt>
                    <dd className="text-white font-medium">{vulnerability.cvss_score}</dd>
                  </div>
                )}
                {vulnerability.cve_id && (
                  <div>
                    <dt className="text-sm text-slate-400">CVE ID</dt>
                    <dd className="text-white font-mono">{vulnerability.cve_id}</dd>
                  </div>
                )}
                {vulnerability.cwe_id && (
                  <div>
                    <dt className="text-sm text-slate-400">CWE ID</dt>
                    <dd className="text-white font-mono">{vulnerability.cwe_id}</dd>
                  </div>
                )}
                {vulnerability.affected_component && (
                  <div>
                    <dt className="text-sm text-slate-400">Affected Component</dt>
                    <dd className="text-white">{vulnerability.affected_component}</dd>
                  </div>
                )}
                {vulnerability.affected_host && (
                  <div>
                    <dt className="text-sm text-slate-400">Affected Host</dt>
                    <dd className="text-white">{vulnerability.affected_host}</dd>
                  </div>
                )}
                {vulnerability.due_date && (
                  <div>
                    <dt className="text-sm text-slate-400">Due Date</dt>
                    <dd className="text-white flex items-center gap-1.5">
                      <Calendar size={14} className="text-slate-400" />
                      {new Date(vulnerability.due_date).toLocaleDateString()}
                    </dd>
                  </div>
                )}
                {vulnerability.assigned_user_name && (
                  <div>
                    <dt className="text-sm text-slate-400">Assigned To</dt>
                    <dd className="text-white flex items-center gap-1.5">
                      <User size={14} className="text-slate-400" />
                      {vulnerability.assigned_user_name}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-sm text-slate-400">Created</dt>
                  <dd className="text-white">{new Date(vulnerability.created_at).toLocaleString()}</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'mitigations' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-white">Mitigations</h2>
            <button onClick={() => setShowMitigationModal(true)} className="btn-primary flex items-center gap-2">
              <Plus size={16} />
              Add Mitigation
            </button>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
            {(!mitigations || mitigations.length === 0) ? (
              <div className="p-8 text-center text-slate-400">No mitigations added yet</div>
            ) : (
              <table className="w-full">
                <thead className="bg-slate-900/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">Title</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">Due Date</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">Assigned To</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {mitigations.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-700/50">
                      <td className="px-4 py-3 text-white">{m.title}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                          m.status === 'completed' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
                        }`}>
                          {m.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-300">{m.due_date ? new Date(m.due_date).toLocaleDateString() : '-'}</td>
                      <td className="px-4 py-3 text-slate-300">{m.assigned_user_name || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {activeTab === 'assets' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-white">Linked Assets</h2>
            <button onClick={() => setShowAssetModal(true)} className="btn-primary flex items-center gap-2">
              <Plus size={16} />
              Link Asset
            </button>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
            {(!assetLinks || assetLinks.length === 0) ? (
              <div className="p-8 text-center text-slate-400">No assets linked yet</div>
            ) : (
              <table className="w-full">
                <thead className="bg-slate-900/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">Asset</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">Relationship</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {assetLinks.map((link) => (
                    <tr key={link.id} className="hover:bg-slate-700/50">
                      <td className="px-4 py-3 text-white">{link.asset_name}</td>
                      <td className="px-4 py-3 text-slate-300">{link.asset_type || '-'}</td>
                      <td className="px-4 py-3 text-slate-300">{link.relationship_type || 'affected'}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => deleteAssetLinkMutation.mutate(link.id)}
                          className="text-slate-400 hover:text-red-400"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {activeTab === 'controls' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-white">Linked Controls</h2>
            <button onClick={() => setShowControlModal(true)} className="btn-primary flex items-center gap-2">
              <Plus size={16} />
              Link Control
            </button>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
            {(!controlLinks || controlLinks.length === 0) ? (
              <div className="p-8 text-center text-slate-400">No controls linked yet</div>
            ) : (
              <table className="w-full">
                <thead className="bg-slate-900/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">Control</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">ID</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {controlLinks.map((link) => (
                    <tr key={link.id} className="hover:bg-slate-700/50">
                      <td className="px-4 py-3 text-white">{link.control_name || '-'}</td>
                      <td className="px-4 py-3 text-slate-300 capitalize">{link.control_type}</td>
                      <td className="px-4 py-3 text-slate-300 font-mono">{link.control_id_display || '-'}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => deleteControlLinkMutation.mutate(link.id)}
                          className="text-slate-400 hover:text-red-400"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {activeTab === 'retests' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-white">Retest History</h2>
            <button onClick={() => setShowRetestModal(true)} className="btn-primary flex items-center gap-2">
              <Plus size={16} />
              Add Retest
            </button>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
            {(!retests || retests.length === 0) ? (
              <div className="p-8 text-center text-slate-400">No retests recorded yet</div>
            ) : (
              <table className="w-full">
                <thead className="bg-slate-900/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">Result</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">Tester</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {retests.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-700/50">
                      <td className="px-4 py-3 text-white">{new Date(r.test_date).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                          r.result === 'pass' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                        }`}>
                          {r.result}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-300">{r.tester_name || '-'}</td>
                      <td className="px-4 py-3 text-slate-300 truncate max-w-xs">{r.notes || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {activeTab === 'ai' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-700 bg-slate-800 p-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-400" />
              AI-Powered Analysis
            </h2>
            <p className="text-slate-400 mb-4">
              Get AI-powered recommendations for fixing this vulnerability based on the description, severity, and affected components.
            </p>
            <button
              onClick={() => suggestFixMutation.mutate()}
              disabled={suggestFixMutation.isPending}
              className="btn-primary flex items-center gap-2"
            >
              {suggestFixMutation.isPending ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  Get AI Recommendation
                </>
              )}
            </button>
            {vulnerability.ai_recommendation && (
              <div className="mt-6 p-4 rounded-lg bg-purple-900/20 border border-purple-700/50">
                <h3 className="text-sm font-medium text-purple-400 mb-2">Recommendation</h3>
                <p className="text-slate-300 whitespace-pre-wrap">{vulnerability.ai_recommendation}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'exception' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-white">Risk Exception</h2>
            <button onClick={() => setShowExceptionModal(true)} className="btn-primary flex items-center gap-2">
              <Plus size={16} />
              Create Exception
            </button>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
            {(!exceptions || exceptions.length === 0) ? (
              <div className="p-8 text-center text-slate-400">No exception requests</div>
            ) : (
              <table className="w-full">
                <thead className="bg-slate-900/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">Reason</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-400">Expiry</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {exceptions.map((ex) => (
                    <tr key={ex.id} className="hover:bg-slate-700/50">
                      <td className="px-4 py-3 text-white">{ex.reason}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                          ex.status === 'approved' ? 'bg-green-500/20 text-green-400' :
                          ex.status === 'rejected' ? 'bg-red-500/20 text-red-400' :
                          'bg-yellow-500/20 text-yellow-400'
                        }`}>
                          {ex.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-300">
                        {ex.expiry_date ? new Date(ex.expiry_date).toLocaleDateString() : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {showStatusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white">Change Status</h2>
              <button onClick={() => setShowStatusModal(false)} className="text-slate-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                changeStatusMutation.mutate({
                  status: formData.get('status') as string,
                  notes: formData.get('notes') as string || undefined,
                });
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">New Status</label>
                <select name="status" required className="input-field w-full" defaultValue={vulnerability.status}>
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="remediated">Remediated</option>
                  <option value="verified">Verified</option>
                  <option value="closed">Closed</option>
                  <option value="accepted">Risk Accepted</option>
                  <option value="false_positive">False Positive</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Notes</label>
                <textarea name="notes" rows={3} className="input-field w-full" />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setShowStatusModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={changeStatusMutation.isPending} className="btn-primary">
                  {changeStatusMutation.isPending ? 'Updating...' : 'Update Status'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showMitigationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white">Add Mitigation</h2>
              <button onClick={() => setShowMitigationModal(false)} className="text-slate-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                createMitigationMutation.mutate({
                  title: formData.get('title'),
                  description: formData.get('description') || undefined,
                  due_date: formData.get('due_date') || undefined,
                });
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Title *</label>
                <input type="text" name="title" required className="input-field w-full" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Description</label>
                <textarea name="description" rows={3} className="input-field w-full" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Due Date</label>
                <input type="date" name="due_date" className="input-field w-full" />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setShowMitigationModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={createMitigationMutation.isPending} className="btn-primary">
                  {createMitigationMutation.isPending ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAssetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white">Link Asset</h2>
              <button onClick={() => setShowAssetModal(false)} className="text-slate-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                createAssetLinkMutation.mutate({
                  asset_id: parseInt(formData.get('asset_id') as string),
                  relationship_type: formData.get('relationship_type') as string || undefined,
                });
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Asset *</label>
                <select name="asset_id" required className="input-field w-full">
                  <option value="">Select an asset</option>
                  {assets?.map((asset: { id: number; name: string }) => (
                    <option key={asset.id} value={asset.id}>{asset.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Relationship Type</label>
                <select name="relationship_type" className="input-field w-full">
                  <option value="affected">Affected</option>
                  <option value="related">Related</option>
                  <option value="hosting">Hosting</option>
                </select>
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setShowAssetModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={createAssetLinkMutation.isPending} className="btn-primary">
                  {createAssetLinkMutation.isPending ? 'Linking...' : 'Link Asset'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showControlModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white">Link Control</h2>
              <button onClick={() => setShowControlModal(false)} className="text-slate-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const controlType = formData.get('control_type') as string;
                const data: { control_type: string; framework_control_id?: number; internal_control_id?: number } = {
                  control_type: controlType,
                };
                if (controlType === 'framework') {
                  data.framework_control_id = parseInt(formData.get('control_id') as string);
                } else {
                  data.internal_control_id = parseInt(formData.get('control_id') as string);
                }
                createControlLinkMutation.mutate(data);
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Control Type *</label>
                <select name="control_type" required className="input-field w-full">
                  <option value="framework">Framework Control</option>
                  <option value="internal">Internal Control</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Control *</label>
                <select name="control_id" required className="input-field w-full">
                  <option value="">Select a control</option>
                  {frameworkControls?.map((ctrl: { id: number; control_id: string; title: string }) => (
                    <option key={ctrl.id} value={ctrl.id}>{ctrl.control_id} - {ctrl.title}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setShowControlModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={createControlLinkMutation.isPending} className="btn-primary">
                  {createControlLinkMutation.isPending ? 'Linking...' : 'Link Control'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showRetestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white">Add Retest</h2>
              <button onClick={() => setShowRetestModal(false)} className="text-slate-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                createRetestMutation.mutate({
                  test_date: formData.get('test_date'),
                  result: formData.get('result'),
                  tester_name: formData.get('tester_name') || undefined,
                  notes: formData.get('notes') || undefined,
                });
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Test Date *</label>
                <input type="date" name="test_date" required className="input-field w-full" defaultValue={new Date().toISOString().split('T')[0]} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Result *</label>
                <select name="result" required className="input-field w-full">
                  <option value="pass">Pass - Vulnerability Remediated</option>
                  <option value="fail">Fail - Still Vulnerable</option>
                  <option value="partial">Partial - Partially Remediated</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Tester Name</label>
                <input type="text" name="tester_name" className="input-field w-full" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Notes</label>
                <textarea name="notes" rows={3} className="input-field w-full" />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setShowRetestModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={createRetestMutation.isPending} className="btn-primary">
                  {createRetestMutation.isPending ? 'Adding...' : 'Add Retest'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showExceptionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white">Create Exception</h2>
              <button onClick={() => setShowExceptionModal(false)} className="text-slate-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                createExceptionMutation.mutate({
                  reason: formData.get('reason'),
                  expiry_date: formData.get('expiry_date') || undefined,
                });
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Reason *</label>
                <textarea name="reason" rows={4} required className="input-field w-full" placeholder="Explain why this vulnerability should be excepted from remediation..." />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Expiry Date</label>
                <input type="date" name="expiry_date" className="input-field w-full" />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setShowExceptionModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={createExceptionMutation.isPending} className="btn-primary">
                  {createExceptionMutation.isPending ? 'Creating...' : 'Submit Exception'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
