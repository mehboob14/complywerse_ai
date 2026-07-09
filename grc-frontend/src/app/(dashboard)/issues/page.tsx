'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { LayoutDashboard, ListChecks, ClipboardList, Building2, BarChart3, Sliders, Settings2, Plus, Zap } from 'lucide-react';
import IssuesOverviewCards from '@/components/dashboard/IssuesOverviewCards';
import { IssueList } from './_components/IssueList';
import { CAPABoard } from './_components/CAPABoard';
import { ClosureTracker } from './_components/ClosureTracker';
import { SeverityMatrixEditor } from './_components/SeverityMatrixEditor';
import { ClassificationMatrixEditor } from './_components/ClassificationMatrixEditor';
import { IssueForm } from './_components/IssueForm';
import { AutomationFlags } from './_components/AutomationFlags';

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

export default function IssuesPage() {
  const [tab, setTab] = useState<TabId>('overview');
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900 tracking-tight">Issue Management</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Enterprise issue log, CAPA actions, contract compliance and closure tracking — linked to vulns, risks, controls, assets, evidence, vendors.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] shadow-sm hover:bg-primary-700"
          >
            <Plus className="h-3.5 w-3.5" />
            New Issue
          </button>
        </div>
      </div>

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

      <IssueForm open={showForm} onClose={() => setShowForm(false)} />
    </div>
  );
}
