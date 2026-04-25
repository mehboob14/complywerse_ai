'use client';

import { useState } from 'react';
import { Building2, Users as UsersIcon, ShieldCheck, ScrollText } from 'lucide-react';
import OrganizationProfilePage from './organization/page';
import UsersManagementPage from './users/page';
import RolesManagementPage from './roles/page';
import AuditLogsPage from './audit-logs/page';

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<'company' | 'users' | 'roles' | 'audit'>('company');

  const adminTabs = [
    { id: 'company' as const, label: 'Company', icon: Building2 },
    { id: 'users' as const, label: 'User Management', icon: UsersIcon },
    { id: 'roles' as const, label: 'Role Management', icon: ShieldCheck },
    { id: 'audit' as const, label: 'Audit Logs', icon: ScrollText },
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
        {activeTab === 'audit' && <AuditLogsPage />}
      </div>
    </div>
  );
}
