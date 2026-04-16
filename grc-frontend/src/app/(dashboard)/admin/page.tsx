'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/ui';
import OrganizationProfilePage from './organization/page';
import UsersManagementPage from './users/page';
import RolesManagementPage from './roles/page';
import AuditLogsPage from './audit-logs/page';

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<'overview' | 'company' | 'users' | 'roles' | 'audit'>('overview');

  const adminTabs = [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'company' as const, label: 'Company' },
    { id: 'users' as const, label: 'User Management' },
    { id: 'roles' as const, label: 'Role Management' },
    { id: 'audit' as const, label: 'Audit Logs' },
  ];

  const adminSections = [
    {
      title: 'Company Profile',
      description: 'View and manage your company settings and information',
      id: 'company' as const,
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      ),
    },
    {
      title: 'User Management',
      description: 'Create, edit, and manage user accounts and their access',
      id: 'users' as const,
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
        </svg>
      ),
    },
    {
      title: 'Role Management',
      description: 'Configure roles and assign permissions to control access',
      id: 'roles' as const,
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      ),
    },
    {
      title: 'Audit Logs',
      description: 'View system activity and track user actions',
      id: 'audit' as const,
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
      ),
    },
  ];

  return (
    <div className="space-y-6 text-slate-900">
      <div className="border-b border-slate-200 bg-white rounded-xl px-2 py-2 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {adminTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === 'overview' && (
        <div className="space-y-6">
          <PageHeader
            title="Administration"
            subtitle="Manage your company, users, roles, and permissions"
          />

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {adminSections.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => setActiveTab(section.id)}
                className="group rounded-xl border border-slate-200 bg-white p-6 text-left shadow-card transition-all hover:border-primary-300 hover:shadow-card-hover"
              >
                <div className="flex items-start space-x-4">
                  <div className="text-primary-600 transition-colors group-hover:text-primary-700">
                    {section.icon}
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-black transition-colors group-hover:text-primary-700">
                      {section.title}
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {section.description}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'company' && <OrganizationProfilePage />}
      {activeTab === 'users' && <UsersManagementPage />}
      {activeTab === 'roles' && <RolesManagementPage />}
      {activeTab === 'audit' && <AuditLogsPage />}
    </div>
  );
}
