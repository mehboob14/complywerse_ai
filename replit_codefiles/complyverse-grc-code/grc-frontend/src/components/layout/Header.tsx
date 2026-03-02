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
  escalation: 'border-l-[var(--color-danger)]',
  sla_breach: 'border-l-[var(--color-warning)]',
  assignment: 'border-l-[var(--color-base)]',
  status_change: 'border-l-[var(--color-success)]',
  info: 'border-l-[var(--color-muted)]',
};

const typeBorderStyles: Record<string, string> = {
  escalation: 'var(--color-danger)',
  sla_breach: 'var(--color-warning)',
  assignment: 'var(--color-base)',
  status_change: 'var(--color-success)',
  info: 'var(--color-muted)',
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

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/grc';

export default function Header() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const userMenuRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  const { data: currentUser } = useQuery<CurrentUser | null>({
    queryKey: ['current-user'],
    queryFn: async () => {
      const response = await fetch(`${API_BASE}/auth/me`, {
        credentials: 'include',
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data.authenticated ? data.user : null;
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
    <header
      className="flex h-14 items-center justify-between px-6"
      style={{
        backgroundColor: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <div className="flex items-center gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--color-muted)' }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search frameworks, controls, risks..."
            className="w-72 lg:w-96 rounded-lg py-2 pl-9 pr-4 text-sm transition-all duration-200 focus:outline-none focus:ring-2"
            style={{
              backgroundColor: 'var(--color-subtle)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-border)',
            }}
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--color-muted)' }}
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
            className="relative rounded-lg p-2.5 transition-all duration-200"
            style={{
              color: showNotifications ? 'var(--color-text)' : 'var(--color-muted)',
              backgroundColor: showNotifications ? 'var(--color-subtle)' : undefined,
            }}
            aria-label="Notifications"
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span
                className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ring-2"
                style={{
                  backgroundColor: 'var(--color-danger)',
                  color: 'var(--color-surface)',
                  ringColor: 'var(--color-surface)',
                }}
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <div
              className="absolute right-0 mt-2 w-96 rounded-xl shadow-2xl animate-fade-in z-50"
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
              }}
            >
              <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border)' }}>
                <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>Notifications</h3>
                <div className="flex items-center gap-2">
                  {unreadCount > 0 && (
                    <>
                      <span
                        className="px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{ backgroundColor: 'rgba(155, 28, 28, 0.1)', color: 'var(--color-danger)' }}
                      >
                        {unreadCount} new
                      </span>
                      <button
                        onClick={() => markAllAsReadMutation.mutate()}
                        disabled={markAllAsReadMutation.isPending}
                        className="flex items-center gap-1 text-xs transition-colors"
                        style={{ color: 'var(--color-muted)' }}
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
                  <div className="py-8 text-center text-sm" style={{ color: 'var(--color-muted)' }}>
                    <Bell className="h-8 w-8 mx-auto mb-2" style={{ color: 'var(--color-border)' }} />
                    No notifications yet
                  </div>
                ) : (
                  notifications.slice(0, 10).map((notif) => (
                    <div 
                      key={notif.id}
                      onClick={() => handleNotificationClick(notif)}
                      className="flex items-start gap-3 px-4 py-3 border-l-2 transition-colors cursor-pointer"
                      style={{
                        borderLeftColor: typeBorderStyles[notif.notification_type] || typeBorderStyles.info,
                        backgroundColor: !notif.is_read ? 'var(--color-subtle)' : undefined,
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <p
                          className="text-sm font-medium"
                          style={{ color: notif.is_read ? 'var(--color-muted)' : 'var(--color-text)' }}
                        >
                          {notif.title}
                        </p>
                        {notif.message && (
                          <p
                            className="text-xs mt-0.5"
                            style={{ color: 'var(--color-muted)' }}
                          >
                            {notif.message}
                          </p>
                        )}
                        {notif.vulnerability_title && (
                          <p className="text-xs mt-0.5 flex items-center gap-1" style={{ color: 'var(--color-base)' }}>
                            <ExternalLink size={10} />
                            {notif.vulnerability_title}
                          </p>
                        )}
                        <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{formatTimeAgo(notif.created_at)}</p>
                      </div>
                      {!notif.is_read && (
                        <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ backgroundColor: 'var(--color-base)' }} />
                      )}
                    </div>
                  ))
                )}
              </div>
              {notifications.length > 0 && (
                <div className="p-2" style={{ borderTop: '1px solid var(--color-border)' }}>
                  <Link 
                    href="/vulnerabilities/notifications"
                    className="w-full text-center text-sm py-2 rounded-lg transition-colors block"
                    style={{ color: 'var(--color-base)' }}
                  >
                    View all notifications
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="h-6 w-px mx-1" style={{ backgroundColor: 'var(--color-border)' }} />

        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2.5 rounded-lg p-1.5 transition-all duration-200"
            style={{
              backgroundColor: showUserMenu ? 'var(--color-subtle)' : undefined,
            }}
          >
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg shadow-sm"
              style={{ backgroundColor: 'var(--color-base)', color: 'var(--color-surface)' }}
            >
              <User size={16} />
            </div>
            <div className="hidden lg:block text-left">
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{currentUser?.display_name || 'User'}</p>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{currentUser?.primary_tenant_name || 'No Organization'}</p>
            </div>
            <ChevronDown 
              size={14} 
              className={clsx(
                'hidden lg:block transition-transform duration-200',
                showUserMenu && 'rotate-180'
              )}
              style={{ color: 'var(--color-muted)' }}
            />
          </button>

          {showUserMenu && (
            <div
              className="absolute right-0 mt-2 w-56 rounded-xl shadow-2xl animate-fade-in z-50"
              style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
            >
              <div className="p-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-lg"
                    style={{ backgroundColor: 'var(--color-base)', color: 'var(--color-surface)' }}
                  >
                    <User size={20} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{currentUser?.display_name || 'User'}</p>
                    <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{currentUser?.email || ''}</p>
                  </div>
                </div>
              </div>
              <div className="py-1.5">
                <Link 
                  href="/profile" 
                  className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors"
                  style={{ color: 'var(--color-text)' }}
                >
                  <UserCircle size={16} style={{ color: 'var(--color-muted)' }} />
                  Profile
                </Link>
                <Link 
                  href="/settings" 
                  className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors"
                  style={{ color: 'var(--color-text)' }}
                >
                  <Settings size={16} style={{ color: 'var(--color-muted)' }} />
                  Settings
                </Link>
              </div>
              <div className="py-1.5" style={{ borderTop: '1px solid var(--color-border)' }}>
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
                  className="flex items-center gap-3 w-full px-4 py-2.5 text-sm transition-colors"
                  style={{ color: 'var(--color-danger)' }}
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
