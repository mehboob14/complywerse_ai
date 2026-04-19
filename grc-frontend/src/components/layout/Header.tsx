'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, LogOut, UserCircle, Users } from 'lucide-react';
import { apiClient } from '@/lib/api';

const navIconProps = {
  size: 18,
  strokeWidth: 1.5,
};

const PAGE_TITLES: Record<string, { title: string; subtitle?: string }> = {
  '/vulnerabilities': { title: 'Vulnerability Register', subtitle: 'Track, manage, and remediate security vulnerabilities across your organization' },
  '/vulnerabilities/dashboard': { title: 'Vulnerability Dashboard', subtitle: 'Real-time security posture' },
  '/vulnerabilities/sla': { title: 'SLA Configuration' },
  '/vulnerabilities/reports': { title: 'Vulnerability Reports' },
  '/vulnerabilities/departments': { title: 'Department Management' },
  '/dashboard': { title: 'Overview' },
  '/governance': { title: 'Governance', subtitle: 'Policy and document lifecycle management' },
  '/governance/documents': { title: 'Governance', subtitle: 'Policy and document lifecycle management' },
  '/governance/mappings': { title: 'Governance', subtitle: 'Policy and document lifecycle management' },
  '/governance/approvals': { title: 'Governance', subtitle: 'Policy and document lifecycle management' },
  '/governance/exceptions': { title: 'Governance', subtitle: 'Policy and document lifecycle management' },
  '/governance/reviews': { title: 'Governance', subtitle: 'Policy and document lifecycle management' },
  '/governance/attestations': { title: 'Governance', subtitle: 'Policy and document lifecycle management' },
  '/governance/workflows': { title: 'Governance', subtitle: 'Policy and document lifecycle management' },
  '/evidence': { title: 'Evidence Library' },
  '/frameworks': { title: 'Frameworks' },
  '/controls': { title: 'Controls' },
  '/erm': { title: 'Enterprise Risk Management', subtitle: 'Comprehensive risk identification, assessment, and monitoring' },
  '/erm/risks': { title: 'Risk Register' },
  '/erm/risk-assessments': { title: 'Risk Assessments', subtitle: 'Manage and track risk assessment activities' },
  '/erm/rcsa': { title: 'RCSA Templates', subtitle: 'Upload and download RCSA templates' },
  '/erm/analytics': { title: 'Advanced Risk Analytics', subtitle: 'Comprehensive risk analysis tools for enterprise risk intelligence' },
  '/erm/analytics/heatmap': { title: 'Interactive Risk Heat Map', subtitle: 'Visualize risk distribution across likelihood and impact dimensions' },
  '/erm/analytics/bowtie': { title: 'Bow-Tie Risk Analysis', subtitle: 'Visualize threats, controls, and consequences for any risk' },
  '/erm/analytics/scenario': { title: 'Scenario Analysis', subtitle: 'Model what-if scenarios to understand risk impact changes' },
  '/erm/analytics/aggregation': { title: 'Risk Aggregation', subtitle: 'Enterprise-wide risk aggregation and analysis' },
  '/erm/analytics/kri-triggers': { title: 'Automated KRI Triggers', subtitle: 'Real-time alerts for Key Risk Indicator threshold breaches' },
  '/risks/rcsa': { title: 'RCSA Dashboard', subtitle: 'Risk and control self-assessment overview' },
  '/compliance/assessments': { title: 'Compliance Assessments' },
  '/compliance/assessments/approvals': { title: 'Pending Approvals', subtitle: 'Compliance assessments awaiting review' },
  '/control-library': { title: 'Control Library' },
  '/assets': { title: 'IT Asset Inventory & Valuation', subtitle: 'Manage and track IT assets with CIA ratings and valuations.' },
  '/integrations': { title: 'Integrations', subtitle: 'Configure and manage third-party integrations.' },
  '/integrations/connections': { title: 'Scanner Connections', subtitle: 'Manage vulnerability scanner connections and sync schedules.' },
  '/integrations/exceptions': { title: 'Integration Exceptions', subtitle: 'Review and manage integration exceptions.' },
  '/tasks': { title: 'Task Board' },
  '/admin': { title: 'Administration' },
};

export default function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const { data: me } = useQuery({
    queryKey: ['current-user'],
    queryFn: () => apiClient.get('/auth/me').then((r) => r.data),
  });

  const currentUser = me?.user;
  const displayName = currentUser?.display_name || currentUser?.username || 'User';
  const tenantName = currentUser?.primary_tenant_name || 'Organization';
  const userEmail = currentUser?.email || '';
  const isAdmin = !!currentUser?.is_admin;
  const initials = displayName.charAt(0).toUpperCase();

  // Demo notifications
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const demoNotifications = [
    { id: 1, text: '3 Critical vulnerabilities require immediate attention', time: '5m ago', unread: true },
    { id: 2, text: 'SLA breach: 2 vulnerabilities overdue',                 time: '1h ago', unread: true },
    { id: 3, text: 'Evidence assessment completed for Framework A',          time: '3h ago', unread: false },
  ];
  const unreadCount = demoNotifications.filter((n) => n.unread).length;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setNotifOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    try {
      await apiClient.post('/auth/logout');
    } catch (error) {
      console.error('Logout failed:', error);
    }
    localStorage.clear();
    setIsUserMenuOpen(false);
    router.push('/login');
    router.refresh();
  };

  return (
    <header className="top-nav flex h-12 items-center justify-between px-4 lg:px-5">
      <div className="flex-1 min-w-0 px-1">
        {(() => {
          const info = PAGE_TITLES[pathname ?? ''];
          if (!info) return null;
          return (
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-sm font-semibold text-[var(--color-text)] truncate leading-none">{info.title}</span>
              {info.subtitle && (
                <span className="hidden xl:block text-[11px] text-[var(--color-muted)] truncate">{info.subtitle}</span>
              )}
            </div>
          );
        })()}
      </div>

      <div className="ml-3 flex items-center gap-2.5">
        {/* Notification bell */}
        <div className="relative" ref={notifRef}>
          <button
            type="button"
            onClick={() => setNotifOpen((p) => !p)}
            className="relative rounded-md p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-subtle)] hover:text-[var(--color-text)]"
            aria-label="Notifications"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white leading-none">
                {unreadCount}
              </span>
            )}
          </button>
          {notifOpen && (
            <div className="absolute right-0 z-50 mt-2 w-80 rounded-lg border border-gray-200 bg-white shadow-xl">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
                <span className="text-sm font-semibold text-gray-800">Notifications</span>
                {unreadCount > 0 && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-600">{unreadCount} new</span>
                )}
              </div>
              <div className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
                {demoNotifications.map((n) => (
                  <div key={n.id} className={`flex gap-3 px-4 py-3 text-xs ${n.unread ? 'bg-red-50' : 'bg-white'}`}>
                    <span className={`mt-0.5 h-2 w-2 flex-shrink-0 rounded-full ${n.unread ? 'bg-red-500' : 'bg-gray-300'}`} />
                    <div className="flex-1 min-w-0">
                      <p className={`leading-snug ${n.unread ? 'font-medium text-gray-800' : 'text-gray-600'}`}>{n.text}</p>
                      <p className="mt-0.5 text-gray-400">{n.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* User avatar + menu */}
        <div className="relative" ref={userMenuRef}>
          <button
            type="button"
            onClick={() => setIsUserMenuOpen((prev) => !prev)}
            className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[var(--color-text)] transition-colors hover:bg-[var(--color-subtle)]"
            aria-label="User menu"
            aria-expanded={isUserMenuOpen}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-white text-sm font-bold flex-shrink-0">
              {initials}
            </span>
            <ChevronDown
              size={14}
              className={`text-[var(--color-text-muted)] transition-transform ${isUserMenuOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {isUserMenuOpen && (
            <div className="absolute right-0 z-50 mt-2 w-64 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
              <div className="border-b border-[var(--color-border)] px-3 py-2.5">
                <p className="text-sm font-semibold text-[var(--color-text)]">{displayName}</p>
                {userEmail && (
                  <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{userEmail}</p>
                )}
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">{tenantName}</p>
              </div>

              <div className="py-1">
                <button
                  type="button"
                  onClick={() => {
                    setIsUserMenuOpen(false);
                    router.push('/users');
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-subtle)]"
                >
                  <Users size={16} className="text-[var(--color-text-muted)]" />
                  Users
                </button>

                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      router.push('/admin/users');
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-subtle)]"
                  >
                    <UserCircle size={16} className="text-[var(--color-text-muted)]" />
                    Admin Users
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-rose-600 transition-colors hover:bg-rose-50"
                >
                  <LogOut size={16} />
                  Logout
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
