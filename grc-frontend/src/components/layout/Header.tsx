'use client';

import { Bell, ChevronDown, Search, User, ChevronRight, Home } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';

const pathLabels: Record<string, string> = {
  dashboard: 'Dashboard',
  frameworks: 'Frameworks',
  'framework-upload': 'Framework Upload',
  controls: 'Controls',
  evidence: 'Evidence',
  erm: 'Risk Management',
  risks: 'Risk Register',
  'mitigation-actions': 'Mitigation Actions',
  appetite: 'Risk Appetite',
  kris: 'Key Risk Indicators',
  incidents: 'Incidents',
  governance: 'Governance',
  documents: 'Documents',
  workflows: 'Workflows',
  reviews: 'Reviews',
  assets: 'Assets',
  settings: 'Settings',
  alignment: 'Control Alignment',
  assessment: 'Assessment',
};

function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) return null;

  const breadcrumbs = segments.map((segment, index) => {
    const path = '/' + segments.slice(0, index + 1).join('/');
    const label = pathLabels[segment] || segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ');
    const isLast = index === segments.length - 1;

    return { path, label, isLast };
  });

  return (
    <nav className="breadcrumb">
      <Link href="/dashboard" className="hover:text-white transition-colors">
        <Home size={14} />
      </Link>
      {breadcrumbs.map((crumb, index) => (
        <span key={crumb.path} className="flex items-center gap-2">
          <ChevronRight size={14} className="breadcrumb-separator" />
          {crumb.isLast ? (
            <span className="breadcrumb-current">{crumb.label}</span>
          ) : (
            <Link href={crumb.path} className="hover:text-white transition-colors">
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}

export default function Header() {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

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
    <header className="flex h-14 items-center justify-between border-b border-slate-800 bg-slate-900 px-6">
      <Breadcrumbs />

      <div className="flex items-center gap-3">
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search..."
            className="w-56 rounded-lg border border-slate-700 bg-slate-800 py-2 pl-9 pr-4 text-sm text-slate-100 placeholder-slate-500 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/20"
          />
        </div>

        <div className="h-6 w-px bg-slate-700 hidden md:block" />

        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
            aria-label="Notifications"
          >
            <Bell size={18} />
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-slate-900"></span>
          </button>

          {showNotifications && (
            <div className="dropdown right-0 animate-fade-in">
              <div className="border-b border-slate-700 px-4 py-3 flex items-center justify-between">
                <h3 className="font-semibold text-white text-sm">Notifications</h3>
                <span className="badge-danger text-xs">3 new</span>
              </div>
              <div className="max-h-80 overflow-y-auto scrollbar-thin">
                <div className="dropdown-item border-l-2 border-primary-500">
                  <div>
                    <p className="text-sm text-slate-200">New evidence uploaded for review</p>
                    <p className="text-xs text-slate-500 mt-0.5">2 minutes ago</p>
                  </div>
                </div>
                <div className="dropdown-item border-l-2 border-amber-500">
                  <div>
                    <p className="text-sm text-slate-200">Risk assessment due tomorrow</p>
                    <p className="text-xs text-slate-500 mt-0.5">1 hour ago</p>
                  </div>
                </div>
                <div className="dropdown-item border-l-2 border-emerald-500">
                  <div>
                    <p className="text-sm text-slate-200">Control testing completed</p>
                    <p className="text-xs text-slate-500 mt-0.5">3 hours ago</p>
                  </div>
                </div>
              </div>
              <div className="border-t border-slate-700 p-2">
                <button className="w-full text-center text-sm text-primary-400 hover:text-primary-300 py-2">
                  View all notifications
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2 rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 transition-colors"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 text-white">
              <User size={16} />
            </div>
            <div className="hidden md:block text-left">
              <p className="text-sm font-medium text-slate-200">Admin User</p>
              <p className="text-xs text-slate-500">Default Tenant</p>
            </div>
            <ChevronDown size={14} className="text-slate-500 hidden md:block" />
          </button>

          {showUserMenu && (
            <div className="dropdown right-0 animate-fade-in">
              <div className="p-3 border-b border-slate-700">
                <p className="text-sm font-medium text-white">Admin User</p>
                <p className="text-xs text-slate-400">admin@company.com</p>
              </div>
              <div className="py-1">
                <Link href="/profile" className="dropdown-item">
                  Profile Settings
                </Link>
                <Link href="/settings" className="dropdown-item">
                  Preferences
                </Link>
              </div>
              <div className="border-t border-slate-700 py-1">
                <button className="dropdown-item text-rose-400 hover:text-rose-300 w-full text-left">
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
