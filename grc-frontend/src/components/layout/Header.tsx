'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, LogOut, UserCircle, Users, Search, Loader2, Sparkles, AlertCircle, ClipboardCheck } from 'lucide-react';
import Link from 'next/link';
import { apiClient, searchApi } from '@/lib/api';

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
  '/vulnerabilities/exceptions': { title: 'Exception Queue', subtitle: 'Cross-tenant exception review and approval workflow' },
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
  '/erm/rcsa/templates': { title: 'RCSA Templates', subtitle: 'Upload and download RCSA templates' },
  '/erm/analytics': { title: 'Advanced Risk Analytics', subtitle: 'Comprehensive risk analysis tools for enterprise risk intelligence' },
  '/erm/analytics/heatmap': { title: 'Interactive Risk Heat Map', subtitle: 'Visualize risk distribution across likelihood and impact dimensions' },
  '/erm/analytics/bowtie': { title: 'Bow-Tie Risk Analysis', subtitle: 'Visualize threats, controls, and consequences for any risk' },
  '/erm/analytics/scenario': { title: 'Scenario Analysis', subtitle: 'Model what-if scenarios to understand risk impact changes' },
  '/erm/analytics/aggregation': { title: 'Risk Aggregation', subtitle: 'Enterprise-wide risk aggregation and analysis' },
  '/erm/analytics/kri-triggers': { title: 'Automated KRI Triggers', subtitle: 'Real-time alerts for Key Risk Indicator threshold breaches' },
  '/erm/rcsa': { title: 'RCSA Dashboard', subtitle: 'Risk and control self-assessment overview' },
  '/compliance/assessments': { title: 'Assessment Control Center' },
  '/compliance/assessments/approvals': { title: 'Pending Approvals', subtitle: 'Compliance assessments awaiting review' },
  '/control-library': { title: 'Control Library' },
  '/auditor-portal': { title: 'Auditor Portal', subtitle: 'Review certification journeys, evidence, and compliance progress' },
  '/assets': { title: 'IT Asset Inventory & Valuation', subtitle: 'Manage and track IT assets with CIA ratings and valuations.' },
  '/integrations': { title: 'Integrations', subtitle: 'Configure and manage third-party integrations.' },
  '/integrations/connections': { title: 'Scanner Connections', subtitle: 'Manage vulnerability scanner connections and sync schedules.' },
  '/integrations/exceptions': { title: 'Integration Exceptions', subtitle: 'Review and manage integration exceptions.' },
  '/tasks': { title: 'Task Board' },
  '/admin': { title: 'Administration' },
  '/is-projects': { title: 'IS Projects', subtitle: 'Track and manage information security projects across the organization' },
};

export default function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const { data: me } = useQuery({
    queryKey: ['current-user'],
    queryFn: () => apiClient.get('/auth/me').then((r) => r.data),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnReconnect: 'always',
    refetchOnWindowFocus: true,
  });

  const currentUser = me?.user;
  const displayName = currentUser?.display_name || currentUser?.username || 'User';
  const tenantName = currentUser?.primary_tenant_name || 'Organization';
  const userEmail = currentUser?.email || '';
  const isAdmin = !!currentUser?.is_admin;
  const initials = displayName.charAt(0).toUpperCase();

  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  const [approvalsOpen, setApprovalsOpen] = useState(false);
  const approvalsRef = useRef<HTMLDivElement>(null);
  const [chatQ, setChatQ] = useState('');

  const submitChat = (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = chatQ.trim();
    router.push(q ? `/complychat?q=${encodeURIComponent(q)}` : '/complychat');
    setChatQ('');
  };

  // Real workflow in-app notifications
  const { data: notifData, refetch: refetchNotifs } = useQuery({
    queryKey: ['workflow-notifications'],
    queryFn: () => apiClient.get('/workflow-engine/notifications/in-app?limit=20').then((r) => r.data),
    refetchInterval: 30000, // poll every 30s
    enabled: !!currentUser,
  });

  const notifications: Array<{id: number; subject: string; message: string; notification_type: string; is_read: boolean; created_at: string}> =
    notifData?.items ?? [];
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  // Pending compliance approvals — surfaced as a top-bar quick-action so it's
  // visible from anywhere (it used to be a Compliance sidebar row).
  const { data: pendingApprovalsData } = useQuery({
    queryKey: ['header-pending-approvals'],
    queryFn: () => apiClient.get('/compliance/assessments/pending-approvals').then((r) => r.data),
    refetchInterval: 60000,
    enabled: !!currentUser,
  });
  const pendingApprovalItems: Array<{
    id: number; assessment_name?: string; control_description?: string;
    item_number?: number; evidence_name?: string; status?: string; submitted_at?: string;
  }> = Array.isArray(pendingApprovalsData?.pending_approvals)
    ? pendingApprovalsData.pending_approvals
    : Array.isArray(pendingApprovalsData) ? pendingApprovalsData : [];
  const pendingApprovalCount = pendingApprovalItems.length;

  const markAllRead = async () => {
    try {
      await apiClient.post('/workflow-engine/notifications/in-app/read-all');
      refetchNotifs();
    } catch {/* ignore */}
  };

  const markOneRead = async (id: number) => {
    try {
      await apiClient.post(`/workflow-engine/notifications/in-app/${id}/read`);
      refetchNotifs();
    } catch {/* ignore */}
  };

  const timeAgo = (iso: string) => {
    const normalized = iso && !/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? `${iso}Z` : iso;
    const diff = Math.floor((Date.now() - new Date(normalized).getTime()) / 1000);
    if (Number.isNaN(diff) || diff < 60) return 'now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setNotifOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
      if (approvalsRef.current && !approvalsRef.current.contains(event.target as Node)) {
        setApprovalsOpen(false);
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
    sessionStorage.clear(); // Clear permission cache so next user gets fresh permissions
    queryClient.clear();
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
        {/* ComplyChat — global AI assistant, as a wide input (replaces the
            old search bar). Type a question and hit Enter to open the chat. */}
        <form onSubmit={submitChat} className="relative hidden md:block">
          <Sparkles size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-base)]" />
          <input
            value={chatQ}
            onChange={(e) => setChatQ(e.target.value)}
            placeholder="Ask ComplyChat anything…"
            aria-label="Ask ComplyChat"
            className="h-8 w-64 rounded-md border border-[var(--color-base)]/30 bg-[var(--color-base)]/5 pl-7 pr-8 text-xs text-[var(--color-text)] placeholder:text-[var(--color-muted)] transition-colors focus:w-80 focus:border-[var(--color-base)]/60 focus:bg-white focus:outline-none focus:ring-1 focus:ring-[var(--color-base)]/30"
          />
          <button type="submit" aria-label="Send" className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--color-base)] hover:bg-[var(--color-base)]/10">
            <ChevronRight size={14} />
          </button>
        </form>

        {/* Issues — applies across all modules, so it lives in the top bar. */}
        <Link
          href="/issues"
          title="Issues"
          className="relative rounded-md p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-subtle)] hover:text-[var(--color-text)]"
          aria-label="Issues"
        >
          <AlertCircle size={18} strokeWidth={1.75} />
        </Link>

        {/* Pending compliance approvals — opens a dropdown (not a page). */}
        <div className="relative" ref={approvalsRef}>
          <button
            type="button"
            onClick={() => setApprovalsOpen((p) => !p)}
            title="Pending approvals"
            aria-label="Pending approvals"
            className="relative rounded-md p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-subtle)] hover:text-[var(--color-text)]"
          >
            <ClipboardCheck size={18} strokeWidth={1.75} />
            {pendingApprovalCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white leading-none">
                {pendingApprovalCount > 99 ? '99+' : pendingApprovalCount}
              </span>
            )}
          </button>
          {approvalsOpen && (
            <div className="absolute right-0 z-50 mt-2 w-96 rounded-lg border border-gray-200 bg-white shadow-xl">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
                <span className="text-sm font-semibold text-gray-800">Pending Approvals</span>
                {pendingApprovalCount > 0 && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-600">{pendingApprovalCount} pending</span>
                )}
              </div>
              <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
                {pendingApprovalItems.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-gray-400">Nothing awaiting your approval.</div>
                ) : (
                  pendingApprovalItems.slice(0, 12).map((item) => (
                    <Link
                      key={item.id}
                      href="/compliance/assessments/approvals"
                      onClick={() => setApprovalsOpen(false)}
                      className="flex gap-3 px-4 py-3 text-xs hover:bg-amber-50/60"
                    >
                      <ClipboardCheck size={14} className="mt-0.5 flex-shrink-0 text-amber-500" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium leading-snug truncate text-gray-800">
                          {item.assessment_name || item.evidence_name || item.control_description || `Item #${item.item_number ?? item.id}`}
                        </p>
                        {(item.control_description || item.evidence_name) && (
                          <p className="mt-0.5 text-gray-500 leading-snug truncate">{item.control_description || item.evidence_name}</p>
                        )}
                        <p className="mt-0.5 text-gray-400">
                          {item.status ? String(item.status).replace(/_/g, ' ') : 'pending'}{item.submitted_at ? ` · ${timeAgo(item.submitted_at)}` : ''}
                        </p>
                      </div>
                    </Link>
                  ))
                )}
              </div>
              <Link
                href="/compliance/assessments/approvals"
                onClick={() => setApprovalsOpen(false)}
                className="block border-t border-gray-100 px-4 py-2.5 text-center text-xs font-medium text-blue-600 hover:bg-gray-50"
              >
                Open approvals queue →
              </Link>
            </div>
          )}
        </div>

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
                <div className="flex items-center gap-2">
                  {unreadCount > 0 && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-600">{unreadCount} new</span>
                  )}
                  {unreadCount > 0 && (
                    <button onClick={markAllRead} className="text-xs text-blue-600 hover:underline">Mark all read</button>
                  )}
                </div>
              </div>
              <div className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-gray-400">No notifications</div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      className={`flex gap-3 px-4 py-3 text-xs cursor-pointer ${!n.is_read ? 'bg-blue-50' : 'bg-white'}`}
                      onClick={() => !n.is_read && markOneRead(n.id)}
                    >
                      <span className={`mt-0.5 h-2 w-2 flex-shrink-0 rounded-full ${
                        n.notification_type === 'error' ? 'bg-red-500' :
                        n.notification_type === 'warning' ? 'bg-yellow-500' :
                        n.notification_type === 'success' ? 'bg-green-500' : 'bg-blue-500'
                      } ${n.is_read ? 'opacity-30' : ''}`} />
                      <div className="flex-1 min-w-0">
                        <p className={`font-medium leading-snug truncate ${!n.is_read ? 'text-gray-800' : 'text-gray-500'}`}>{n.subject}</p>
                        {n.message && <p className="mt-0.5 text-gray-500 leading-snug">{n.message}</p>}
                        <p className="mt-0.5 text-gray-400">{timeAgo(n.created_at)}</p>
                      </div>
                    </div>
                  ))
                )}
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

// ─── Phase 9: Global search bar ───────────────────────────────────────────
// Debounced cross-domain search. Triggers after 2+ characters with a 250ms
// delay so we don't slam the backend on every keystroke. Results are typed
// (vulnerability / asset / risk) and link straight to the detail page.

function GlobalSearchBar() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isFetching } = useQuery({
    queryKey: ['global-search', debounced],
    queryFn: () => searchApi.power({ q: debounced, per_domain_limit: 6 }).then((r) => r.data),
    enabled: debounced.length >= 2,
    staleTime: 30 * 1000,
  });

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const hasResults =
    !!data &&
    Object.values(data.results || {}).some((arr) => Array.isArray(arr) && arr.length > 0);

  const onHit = (url: string) => {
    setOpen(false);
    setQ('');
    router.push(url);
  };

  return (
    <div className="relative hidden md:block" ref={containerRef}>
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search…"
          className="h-8 w-56 rounded-md border border-slate-200 bg-white pl-7 pr-7 text-xs text-slate-700 focus:border-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-200"
        />
        {isFetching && (
          <Loader2
            size={12}
            className="absolute right-2 top-1/2 -translate-y-1/2 animate-spin text-slate-400"
          />
        )}
      </div>

      {open && debounced.length >= 2 && (
        <div className="absolute right-0 z-50 mt-1 w-96 rounded-lg border border-slate-200 bg-white shadow-xl">
          {!hasResults && !isFetching && (
            <p className="px-3 py-3 text-xs text-slate-500">No results for &ldquo;{debounced}&rdquo;.</p>
          )}
          {data && hasResults && (
            <div className="max-h-96 overflow-y-auto p-1">
              {(['vulnerabilities', 'assets', 'risks'] as const).map((domain) => {
                const arr = (data.results || {})[domain] || [];
                if (arr.length === 0) return null;
                return (
                  <div key={domain} className="px-1 py-1">
                    <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-slate-400">
                      {domain}
                    </p>
                    {arr.map((hit) => (
                      <button
                        key={`${hit.type}-${hit.id}`}
                        onClick={() => onHit(hit.url)}
                        className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-slate-50"
                      >
                        <p className="font-medium text-slate-800 truncate">{hit.title}</p>
                        <p className="text-slate-500 text-[11px] truncate">
                          {hit.subtitle || ''}
                          {hit.severity ? ` · ${hit.severity}` : ''}
                          {hit.criticality ? ` · ${hit.criticality}` : ''}
                          {hit.asset_type ? ` · ${hit.asset_type}` : ''}
                        </p>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
