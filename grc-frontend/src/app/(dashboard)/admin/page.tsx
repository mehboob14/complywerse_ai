'use client';

import { useState } from 'react';
import { Building2, Users as UsersIcon, ShieldCheck, ScrollText, Bot, GitPullRequest, KeyRound } from 'lucide-react';
import OrganizationProfilePage from './organization/page';
import UsersManagementPage from './users/page';
import RolesManagementPage from './roles/page';
import AuditLogsPage from './audit-logs/page';
import IntegrationsConnectionsPage from '../integrations/connections/page';
import WorkflowEnginePage from '../workflow-engine/page';
import { IdentityProvidersCard } from '@/components/integrations/IdentityProvidersCard';

type AdminTab = 'company' | 'users' | 'roles' | 'integrations' | 'identity' | 'workflow' | 'audit';

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<AdminTab>('company');

  const adminTabs: { id: AdminTab; label: string; icon: typeof Building2 }[] = [
    { id: 'company', label: 'Company', icon: Building2 },
    { id: 'users', label: 'User Management', icon: UsersIcon },
    { id: 'roles', label: 'Role Management', icon: ShieldCheck },
    { id: 'integrations', label: 'Integrations', icon: Bot },
    { id: 'identity', label: 'Identity Providers', icon: KeyRound },
    { id: 'workflow', label: 'Workflow Engine', icon: GitPullRequest },
    { id: 'audit', label: 'Audit Logs', icon: ScrollText },
  ];

  return (
    <div className="-m-4 lg:-m-5 text-slate-900">
      <div className="border-b border-gray-200 px-3 sm:px-6 pt-3 overflow-x-auto">
        <div className="flex items-center gap-0 min-w-max">
          {adminTabs.map(({ id, label, icon: Icon }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`inline-flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${
                  isActive
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Icon size={14} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-4 sm:space-y-6">
        {activeTab === 'company' && <OrganizationProfilePage />}
        {activeTab === 'users' && <UsersManagementPage />}
        {activeTab === 'roles' && <RolesManagementPage />}
        {activeTab === 'integrations' && <IntegrationsConnectionsPage />}
        {activeTab === 'identity' && <IdentityProvidersCard />}
        {activeTab === 'workflow' && <WorkflowEnginePage />}
        {activeTab === 'audit' && <AuditLogsPage />}
      </div>
    </div>
  );
}
