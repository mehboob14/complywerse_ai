'use client';

import { Bell, ChevronDown, Search, User, LogOut, Settings, UserCircle, Check, ExternalLink } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vulnManagementApi } from '@/lib/api';

interface Notification {
  id: number;
  notification_type: string;
  title: string;
  message?: string;
  vulnerability_id: number;
  vulnerability_title?: string;
  created_at: string;
  is_read: boolean;
}

const typeColors: Record<string, string> = {
  escalation: 'border-rose-500',
  sla_breach: 'border-amber-500',
  assignment: 'border-primary-500',
  status_change: 'border-emerald-500',
  info: 'border-slate-500',
};

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  return date.toLocaleDateString();
}

interface CurrentUser {
  id: number;
  username: string;
  email: string;
  display_name: string;
  primary_tenant_id: number | null;
  primary_tenant_name: string | null;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

export default function Header() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [tenantName, setTenantName] = useState<string | null>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedTenantName = localStorage.getItem('tenant_name');
      if (storedTenantName) {
        setTenantName(storedTenantName);
      }
    }
  }, []);

  const { data: currentUser } = useQuery<CurrentUser | null>({
    queryKey: ['current-user'],
    queryFn: async () => {
      const response = await fetch(`${API_BASE}/auth/me`, {
        credentials: 'include',
      });
      if (!response.ok) return null;
      const data = await response.json();
      if (data.authenticated) {
        if (data.tenant && typeof window !== 'undefined') {
          localStorage.setItem('tenant_slug', data.tenant.slug || '');
          localStorage.setItem('tenant_name', data.tenant.name || '');
          localStorage.setItem('tenant_id', String(data.tenant.id || ''));
          setTenantName(data.tenant.name || null);
        }
        return data.user;
      }
      return null;
    },
    staleTime: 60000,
  });

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      const response = await vulnManagementApi.escalations.getNotifications();
      return response.data as Notification[];
    },
    refetchInterval: 30000,
  });

  const { data: unreadCountData } = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: async () => {
      const response = await vulnManagementApi.escalations.getUnreadCount();
      return response.data as { count: number };
    },
    refetchInterval: 30000,
  });

  const unreadCount = unreadCountData?.count || notifications.filter(n => !n.is_read).length;

  const markAsReadMutation = useMutation({
    mutationFn: (notificationId: number) => 
      vulnManagementApi.escalations.markAsRead(notificationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
  });

  const markAllAsReadMutation = useMutation({
    mutationFn: () => vulnManagementApi.escalations.markAllAsRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
  });

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.is_read) {
      markAsReadMutation.mutate(notification.id);
    }
    router.push(`/vulnerabilities/${notification.vulnerability_id}`);
    setShowNotifications(false);
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="flex h-14 items-center justify-between border-b border-slate-800 bg-slate-900/95 backdrop-blur-sm px-6">
      <div className="flex items-center gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search frameworks, controls, risks..."
            className="w-72 lg:w-96 rounded-lg border border-slate-700/50 bg-slate-800/50 py-2 pl-9 pr-4 text-sm text-slate-100 placeholder-slate-500 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-all duration-200"
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className={clsx(
              'relative rounded-lg p-2.5 transition-all duration-200',
              showNotifications 
                ? 'bg-slate-800 text-white' 
                : 'text-slate-400 hover:bg-slate-800/80 hover:text-white'
            )}
            aria-label="Notifications"
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white ring-2 ring-slate-900">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 mt-2 w-96 rounded-xl border border-slate-700 bg-slate-800 shadow-2xl animate-fade-in z-50">
              <div className="border-b border-slate-700 px-4 py-3 flex items-center justify-between">
                <h3 className="font-semibold text-white text-sm">Notifications</h3>
                <div className="flex items-center gap-2">
                  {unreadCount > 0 && (
                    <>
                      <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 text-xs font-medium">
                        {unreadCount} new
                      </span>
                      <button
                        onClick={() => markAllAsReadMutation.mutate()}
                        disabled={markAllAsReadMutation.isPending}
                        className="flex items-center gap-1 text-xs text-slate-400 hover:text-primary-400 transition-colors"
                      >
                        <Check size={12} />
                        Mark all read
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="max-h-96 overflow-y-auto scrollbar-thin">
                {notifications.length === 0 ? (
                  <div className="py-8 text-center text-slate-500 text-sm">
                    <Bell className="h-8 w-8 mx-auto mb-2 text-slate-600" />
                    No notifications yet
                  </div>
                ) : (
                  notifications.slice(0, 10).map((notif) => (
                    <div 
                      key={notif.id}
                      onClick={() => handleNotificationClick(notif)}
                      className={clsx(
                        'flex items-start gap-3 px-4 py-3 border-l-2 transition-colors cursor-pointer',
                        'hover:bg-slate-700/50',
                        typeColors[notif.notification_type] || typeColors.info,
                        !notif.is_read && 'bg-slate-700/30'
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <p className={clsx(
                          'text-sm font-medium',
                          notif.is_read ? 'text-slate-400' : 'text-slate-200'
                        )}>
                          {notif.title}
                        </p>
                        {notif.message && (
                          <p className={clsx(
                            'text-xs mt-0.5',
                            notif.is_read ? 'text-slate-500' : 'text-slate-400'
                          )}>
                            {notif.message}
                          </p>
                        )}
                        {notif.vulnerability_title && (
                          <p className="text-xs text-primary-400 mt-0.5 flex items-center gap-1">
                            <ExternalLink size={10} />
                            {notif.vulnerability_title}
                          </p>
                        )}
                        <p className="text-xs text-slate-500 mt-0.5">{formatTimeAgo(notif.created_at)}</p>
                      </div>
                      {!notif.is_read && (
                        <span className="w-2 h-2 rounded-full bg-primary-500 flex-shrink-0 mt-1.5" />
                      )}
                    </div>
                  ))
                )}
              </div>
              {notifications.length > 0 && (
                <div className="border-t border-slate-700 p-2">
                  <Link 
                    href="/vulnerabilities/notifications"
                    className="w-full text-center text-sm text-primary-400 hover:text-primary-300 py-2 rounded-lg hover:bg-slate-700/50 transition-colors block"
                  >
                    View all notifications
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="h-6 w-px bg-slate-700/50 mx-1" />

        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className={clsx(
              'flex items-center gap-2.5 rounded-lg p-1.5 transition-all duration-200',
              showUserMenu 
                ? 'bg-slate-800' 
                : 'hover:bg-slate-800/80'
            )}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-lg shadow-primary-600/20">
              <User size={16} />
            </div>
            <div className="hidden lg:block text-left">
              <p className="text-sm font-medium text-slate-200">{currentUser?.display_name || 'User'}</p>
              <p className="text-xs text-slate-500">{currentUser?.primary_tenant_name || tenantName || 'No Organization'}</p>
            </div>
            <ChevronDown 
              size={14} 
              className={clsx(
                'text-slate-500 hidden lg:block transition-transform duration-200',
                showUserMenu && 'rotate-180'
              )} 
            />
          </button>

          {showUserMenu && (
            <div className="absolute right-0 mt-2 w-56 rounded-xl border border-slate-700 bg-slate-800 shadow-2xl animate-fade-in z-50">
              <div className="p-4 border-b border-slate-700">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 text-white">
                    <User size={20} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{currentUser?.display_name || 'User'}</p>
                    <p className="text-xs text-slate-400">{currentUser?.email || ''}</p>
                  </div>
                </div>
              </div>
              <div className="py-1.5">
                <Link 
                  href="/profile" 
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-700/50 hover:text-white transition-colors"
                >
                  <UserCircle size={16} className="text-slate-500" />
                  Profile
                </Link>
                <Link 
                  href="/settings" 
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-700/50 hover:text-white transition-colors"
                >
                  <Settings size={16} className="text-slate-500" />
                  Settings
                </Link>
              </div>
              <div className="border-t border-slate-700 py-1.5">
                <button 
                  onClick={async () => {
                    try {
                      await vulnManagementApi.escalations.markAllAsRead().catch(() => {});
                      const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL || '/api'}/auth/logout`, { 
                        method: 'POST', 
                        credentials: 'include' 
                      });
                      localStorage.removeItem('token');
                      window.location.href = '/login';
                    } catch (error) {
                      console.error('Logout failed:', error);
                      localStorage.removeItem('token');
                      window.location.href = '/login';
                    }
                  }}
                  className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 transition-colors"
                >
                  <LogOut size={16} />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
