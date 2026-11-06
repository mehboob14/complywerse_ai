'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { LayoutDashboard, ListChecks, ClipboardList, Building2, BarChart3, Sliders, Settings2, Plus, Zap, Upload, Loader2 } from 'lucide-react';
import { auditRegisterApi } from '@/lib/api';
import { AuditRegister } from '@/components/audit-register/AuditRegister';
import IssuesOverviewCards from '@/components/dashboard/IssuesOverviewCards';
import { IssueList } from './_components/IssueList';
import { CAPABoard } from './_components/CAPABoard';
import { ClosureTracker } from './_components/ClosureTracker';
import { SeverityMatrixEditor } from './_components/SeverityMatrixEditor';
import { ClassificationMatrixEditor } from './_components/ClassificationMatrixEditor';
import { IssueForm } from './_components/IssueForm';
import { AutomationFlags } from './_components/AutomationFlags';
import { ImportIssuesModal } from './_components/ImportIssuesModal';

type TabId = 'overview' | 'log' | 'capa' | 'contract' | 'closure' | 'severity_matrix' | 'classification_matrix' | 'automation';

const TABS: Array<{ id: TabId; label: string; icon: React.ElementType }> = [
  { id: 'overview',              label: 'Overview',               icon: LayoutDashboard },
  { id: 'log',                   label: 'Enterprise Log',         icon: ListChecks },
  { id: 'capa',                  label: 'CAPA Actions',           icon: ClipboardList },
  { id: 'contract',              label: 'Contract Compliance',    icon: Building2 },
  { id: 'closure',               label: 'Closure Tracker',        icon: BarChart3 },
  { id: 'severity_matrix',       label: 'Severity Matrix',        icon: Sliders },
  { id: 'classification_matrix', label: 'Classification Matrix',  icon: Settings2 },
  { id: 'automation',            label: 'Automation',             icon: Zap },
];

type RegisterType = 'audit' | 'platform';
const REGISTER_KEY = 'issues.register';

export default function IssuesPage() {
  // ?tab=<id> opens a tab directly; ?register=audit|platform picks the register.
  const params = useSearchParams();
  const router = useRouter();
  const tabFromUrl = (): TabId => {
    const wanted = params.get('tab');
    return (TABS.some((t) => t.id === wanted) ? wanted : 'overview') as TabId;
  };
  const [tab, setTab] = useState<TabId>(tabFromUrl);
  useEffect(() => { setTab(tabFromUrl()); }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // A tenant that keeps the client's audit register (a workbook was uploaded)
  // sees it here in their template by default; the platform's own issue log —
  // issues raised from vulnerabilities, controls, incidents and the rest — is
  // one pick away. Tenants without a register see the page as it always was.
  const registerStatus = useQuery<{ has_register: boolean; findings: number; last_import: { file_name: string | null } | null }>({
    queryKey: ['audit-register-status'],
    queryFn: async () => (await auditRegisterApi.status()).data,
    retry: false,
    staleTime: 60_000,
  });
  const [choice, setChoice] = useState<RegisterType | null>(null);
  useEffect(() => {
    const wanted = params.get('register') || (params.get('tab') === 'register' ? 'audit' : null);
    let saved: string | null = null;
    try { saved = localStorage.getItem(REGISTER_KEY); } catch { /* private mode */ }
    const pickFrom = wanted || saved;
    if (pickFrom === 'audit' || pickFrom === 'platform') setChoice(pickFrom);
  }, [params]);
  const hasRegister = !!registerStatus.data?.has_register;
  const register: RegisterType = hasRegister ? (choice ?? 'audit') : 'platform';
  const templateName = (registerStatus.data?.last_import?.file_name || 'client template').replace(/\.(xlsb|xlsx|xlsm)$/i, '');
  const pickRegister = (value: RegisterType) => {
    setChoice(value);
    try { localStorage.setItem(REGISTER_KEY, value); } catch { /* private mode */ }
    router.replace(`/issues?register=${value}`);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900 tracking-tight">Issue Management</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {register === 'audit'
              ? `The audit register in the client's own template (${templateName}) — every finding is also a platform issue with its owner, actions and links.`
              : 'Enterprise issue log, CAPA actions, contract compliance and closure tracking — linked to vulns, risks, controls, assets, evidence, vendors.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasRegister && (
            <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
              Register
              <select
                value={register}
                onChange={(e) => pickRegister(e.target.value as RegisterType)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 shadow-sm"
              >
                <option value="audit">Audit register — {templateName}</option>
                <option value="platform">Platform issues (all modules)</option>
              </select>
            </label>
          )}
          {register === 'platform' && (
          <>
          <button
            onClick={() => setShowImport(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <Upload className="h-3.5 w-3.5" />
            Import
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] shadow-sm hover:bg-primary-700"
          >
            <Plus className="h-3.5 w-3.5" />
            New Issue
          </button>
          </>
          )}
        </div>
      </div>

      {registerStatus.isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-300" /></div>
      ) : register === 'audit' ? (
        <AuditRegister initialSource={params.get('source') || ''} />
      ) : (
      <>
      {/* Tabs */}
      <nav className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                active
                  ? 'bg-primary-600 text-[#0a0a0a] shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </nav>

      {/* Body */}
      {tab === 'overview' && <IssuesOverviewCards />}
      {tab === 'log' && <IssueList />}
      {tab === 'capa' && <CAPABoard />}
      {tab === 'contract' && <IssueList defaultFilters={{ category: 'contract' }} />}
      {tab === 'closure' && <ClosureTracker />}
      {tab === 'severity_matrix' && <SeverityMatrixEditor />}
      {tab === 'classification_matrix' && <ClassificationMatrixEditor />}
      {tab === 'automation' && <AutomationFlags />}
      </>
      )}

      <IssueForm open={showForm} onClose={() => setShowForm(false)} />
      {showImport && <ImportIssuesModal onClose={() => setShowImport(false)} />}
    </div>
  );
}
