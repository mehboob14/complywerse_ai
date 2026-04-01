'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Bell, ChevronDown, LogOut, User, UserCircle, Users } from 'lucide-react';
import { apiClient } from '@/lib/api';

const navIconProps = {
  size: 18,
  strokeWidth: 1.5,
};

export default function Header() {
  const router = useRouter();
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

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
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
    <header className="top-nav flex h-14 items-center justify-between px-6">
      <div className="flex-1" />

      <div className="ml-4 flex items-center gap-3">
        <button
          type="button"
          className="rounded-md p-2 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-subtle)] hover:text-[var(--color-text)]"
          aria-label="Notifications"
        >
          <Bell {...navIconProps} />
        </button>
        <div className="relative" ref={userMenuRef}>
          <button
            type="button"
            onClick={() => setIsUserMenuOpen((prev) => !prev)}
            className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--color-text)] transition-colors hover:bg-[var(--color-subtle)]"
            aria-label="User menu"
            aria-expanded={isUserMenuOpen}
          >
            <User {...navIconProps} className="text-[var(--color-text-muted)]" />
            <span className="text-sm font-medium">{displayName}</span>
            <ChevronDown
              size={16}
              className={`text-[var(--color-text-muted)] transition-transform ${
                isUserMenuOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {isUserMenuOpen && (
            <div className="absolute right-0 z-50 mt-2 w-64 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
              <div className="border-b border-[var(--color-border)] px-4 py-3">
                <p className="text-sm font-semibold text-[var(--color-text)]">{displayName}</p>
                {userEmail && (
                  <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{userEmail}</p>
                )}
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">{tenantName}</p>
              </div>

              <div className="py-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setIsUserMenuOpen(false);
                    router.push('/users');
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-subtle)]"
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
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-subtle)]"
                  >
                    <UserCircle size={16} className="text-[var(--color-text-muted)]" />
                    Admin Users
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-rose-600 transition-colors hover:bg-rose-50"
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
