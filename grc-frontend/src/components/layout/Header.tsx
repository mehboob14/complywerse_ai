'use client';

import { Bell, ChevronDown, Search, User, LogOut, Settings, UserCircle } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';

interface Notification {
  id: string;
  message: string;
  time: string;
  type: 'info' | 'warning' | 'success' | 'danger';
  read: boolean;
}

const mockNotifications: Notification[] = [
  { id: '1', message: 'New evidence uploaded for review', time: '2 minutes ago', type: 'info', read: false },
  { id: '2', message: 'Risk assessment due tomorrow', time: '1 hour ago', type: 'warning', read: false },
  { id: '3', message: 'Control testing completed', time: '3 hours ago', type: 'success', read: false },
  { id: '4', message: 'High severity vulnerability detected', time: '5 hours ago', type: 'danger', read: true },
];

const typeColors = {
  info: 'border-primary-500',
  warning: 'border-amber-500',
  success: 'border-emerald-500',
  danger: 'border-rose-500',
};

export default function Header() {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [notifications] = useState<Notification[]>(mockNotifications);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter(n => !n.read).length;

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
            <div className="absolute right-0 mt-2 w-80 rounded-xl border border-slate-700 bg-slate-800 shadow-2xl animate-fade-in z-50">
              <div className="border-b border-slate-700 px-4 py-3 flex items-center justify-between">
                <h3 className="font-semibold text-white text-sm">Notifications</h3>
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 text-xs font-medium">
                    {unreadCount} new
                  </span>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto scrollbar-thin">
                {notifications.length === 0 ? (
                  <div className="py-8 text-center text-slate-500 text-sm">
                    No notifications
                  </div>
                ) : (
                  notifications.map((notif) => (
                    <div 
                      key={notif.id}
                      className={clsx(
                        'flex items-start gap-3 px-4 py-3 border-l-2 transition-colors cursor-pointer',
                        'hover:bg-slate-700/50',
                        typeColors[notif.type],
                        !notif.read && 'bg-slate-700/30'
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <p className={clsx(
                          'text-sm',
                          notif.read ? 'text-slate-400' : 'text-slate-200'
                        )}>
                          {notif.message}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">{notif.time}</p>
                      </div>
                      {!notif.read && (
                        <span className="w-2 h-2 rounded-full bg-primary-500 flex-shrink-0 mt-1.5" />
                      )}
                    </div>
                  ))
                )}
              </div>
              <div className="border-t border-slate-700 p-2">
                <button className="w-full text-center text-sm text-primary-400 hover:text-primary-300 py-2 rounded-lg hover:bg-slate-700/50 transition-colors">
                  View all notifications
                </button>
              </div>
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
              <p className="text-sm font-medium text-slate-200">Admin User</p>
              <p className="text-xs text-slate-500">Default Tenant</p>
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
                    <p className="text-sm font-semibold text-white">Admin User</p>
                    <p className="text-xs text-slate-400">admin@company.com</p>
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
                <button className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 transition-colors">
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
