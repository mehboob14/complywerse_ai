'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Building2, Users as UsersIcon, ShieldCheck, ScrollText, Lock, UsersRound, Plug } from 'lucide-react';
import OrganizationProfilePage from './organization/page';
import UsersManagementPage from './users/page';
import RolesManagementPage from './roles/page';
import DepartmentsAdminPage from './departments/page';
import AuditLogsPage from './audit-logs/page';
import PasswordPolicyPage from './password-policy/page';
import ConnectorsHub from './_connectors-hub';

type AdminTab = 'company' | 'users' | 'roles' | 'departments' | 'connectors' | 'password-policy' | 'audit';

// Tabs folded into the unified Connectors tab (External Connectors, Vulnerability Scanners,
// Cloud, Discovery Hosts and Identity/SSO are categories there): old deep-links land on it.
const CONNECTOR_TABS = new Set(['integrations', 'cloud-connectors', 'evidence-collectors', 'identity']);

const VALID_ADMIN_TABS = new Set<AdminTab>([
  'company','users','roles','departments','connectors','password-policy','audit',
]);

const tabOf = (asked: string | null | undefined): AdminTab | null => {
  const raw = asked === 'teams' ? 'departments'               // ?tab=teams: teams are departments now (old links and bookmarks)
    : asked && CONNECTOR_TABS.has(asked) ? 'connectors' : asked;
  return raw && VALID_ADMIN_TABS.has(raw as AdminTab) ? (raw as AdminTab) : null;
};

export default function AdminPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // Sidebar Administration popover deep-links via ?tab=<id>. Default
  // landing stays 'company' when no/invalid param is given — preserves
  // existing behavior for anyone hitting /admin without a query string.
  const [activeTab, setActiveTab] = useState<AdminTab>(tabOf(searchParams?.get('tab')) ?? 'company');
  // a sidebar link to another tab while this page is open changes ?tab= without remounting the page: follow it
  useEffect(() => {
    const asked = tabOf(searchParams?.get('tab'));
    if (asked) setActiveTab(asked);
  }, [searchParams]);
  // the address always names the tab on show, so the same sidebar link works again after a tab was picked by hand
  const choose = (id: AdminTab) => { setActiveTab(id); router.replace(`${pathname ?? ''}?tab=${id}`, { scroll: false }); };

  const adminTabs: { id: AdminTab; label: string; icon: typeof Building2 }[] = [
    { id: 'company', label: 'Company', icon: Building2 },
    { id: 'users', label: 'User Management', icon: UsersIcon },
    { id: 'roles', label: 'Role Management', icon: ShieldCheck },
    // Org departments — the one list the document, sign-off, asset, assessment and risk pickers read.
    { id: 'departments', label: 'Departments', icon: UsersRound },
    // Password & session policy — controls complexity, lockout, and idle timeout.
    { id: 'password-policy', label: 'Password Policy', icon: Lock },
    // Unified connectors — External Connectors, Vulnerability Scanners, Cloud,
    // Discovery Hosts and Identity/SSO as categories on one page.
    { id: 'connectors', label: 'Connectors', icon: Plug },
    // Tenant-scoped activity trail — who did what, when (audit_log middleware).
    { id: 'audit', label: 'Audit Logs', icon: ScrollText },
  ];

  return (
    <div className="-m-4 lg:-m-5 text-slate-900">
      {/* zoom:0.85 — same density knob the dashboards use; scales the tab bar
          AND every tab's content uniformly so admin cards aren't oversized.
          Kept off the negative-margin wrapper so edge alignment stays exact. */}
      <div style={{ zoom: 0.85 }}>
      <div className="border-b border-slate-200 px-3 sm:px-6 pt-3 overflow-x-auto">
        <div className="flex items-center gap-0 min-w-max">
          {adminTabs.map(({ id, label, icon: Icon }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => choose(id)}
                className={`inline-flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${
                  isActive
                    ? 'border-primary-600 text-primary-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
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
        {activeTab === 'departments' && <DepartmentsAdminPage />}
        {activeTab === 'password-policy' && <PasswordPolicyPage />}
        {activeTab === 'connectors' && <ConnectorsHub />}
        {activeTab === 'audit' && <AuditLogsPage />}
      </div>
      </div>
    </div>
  );
}
