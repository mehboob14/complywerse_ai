'use client';

import { Bell, ChevronDown, Search, User } from 'lucide-react';
import { useState } from 'react';

export default function Header() {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  return (
    <header className="flex h-16 items-center justify-between border-b border-slate-700 bg-slate-800 px-6">
      <div className="flex items-center gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search..."
            className="input pl-10 w-64"
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative">
          <select className="input appearance-none pr-8 bg-slate-700 border-slate-600 text-sm">
            <option value="default">Default Tenant</option>
          </select>
          <ChevronDown className="absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>

        <div className="relative">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative rounded-full p-2 text-slate-400 hover:bg-slate-700 hover:text-white"
          >
            <Bell size={20} />
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500"></span>
          </button>

          {showNotifications && (
            <div className="absolute right-0 top-full mt-2 w-80 rounded-lg border border-slate-700 bg-slate-800 shadow-lg">
              <div className="border-b border-slate-700 px-4 py-3">
                <h3 className="font-semibold text-white">Notifications</h3>
              </div>
              <div className="max-h-96 overflow-y-auto p-2">
                <div className="rounded p-3 hover:bg-slate-700">
                  <p className="text-sm text-slate-300">New evidence uploaded for review</p>
                  <p className="text-xs text-slate-500 mt-1">2 minutes ago</p>
                </div>
                <div className="rounded p-3 hover:bg-slate-700">
                  <p className="text-sm text-slate-300">Risk assessment due tomorrow</p>
                  <p className="text-xs text-slate-500 mt-1">1 hour ago</p>
                </div>
                <div className="rounded p-3 hover:bg-slate-700">
                  <p className="text-sm text-slate-300">Control testing completed</p>
                  <p className="text-xs text-slate-500 mt-1">3 hours ago</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2 rounded-full p-2 text-slate-400 hover:bg-slate-700 hover:text-white"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-600 text-white">
              <User size={16} />
            </div>
            <span className="text-sm text-slate-300">Admin User</span>
            <ChevronDown size={16} />
          </button>

          {showUserMenu && (
            <div className="absolute right-0 top-full mt-2 w-48 rounded-lg border border-slate-700 bg-slate-800 shadow-lg">
              <div className="p-2">
                <a href="/profile" className="block rounded px-3 py-2 text-sm text-slate-300 hover:bg-slate-700">
                  Profile
                </a>
                <a href="/settings" className="block rounded px-3 py-2 text-sm text-slate-300 hover:bg-slate-700">
                  Settings
                </a>
                <hr className="my-2 border-slate-700" />
                <button className="block w-full rounded px-3 py-2 text-left text-sm text-red-400 hover:bg-slate-700">
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
