'use client';

// The top bar (48px: pages that fill the window size themselves against it). Left to right:
//   the menu button (below 1024, where the menu is the drawer) · where you are (the trail of crumbs, or in the Documents area its tab strip) · the command bar (Ctrl K) ·
//   Comply Agent (a question box from 1440, an icon below) · the Guide · Work and context (the panel, with the queue's count) · notifications · the account.
// Titles and trails come from the navigation registry (components/shell/Breadcrumbs.tsx); the queue, its count and the panel are components/shell/WorkPanel.tsx.
import { useEffect, useId, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, LogOut, Menu, PanelRight, UserCircle, Users, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { apiClient } from '@/lib/api';
import { GuideToggle } from '@/components/guide';
import DocumentsTabs, { inDocumentsArea } from '@/components/governance/DocumentsTabs';
import Breadcrumbs from '@/components/shell/Breadcrumbs';
import CommandBar from '@/components/shell/CommandBar';
import { mayAskComplyAgent, offeredEntry, visibleLeafHrefs } from '@/components/shell/shellAccess';
import { useShell, useShellAccess, useShellQueue } from '@/components/shell/ShellProvider';
import { useFirstRunHint } from '@/components/shell/useFirstRunHint';
import { useNotifications } from '@/components/shell/useNotifications';
import { routeFor } from '@/lib/navRegistry';
import { notificationHref } from './headerLinks';
import { holds } from './navAccess';
import { MAIN_MENU_ID, useShellMenu } from './ShellMenu';

// a dropdown item that opens what it is about (a link: Tab, Enter)
const ITEM_LINK = 'flex gap-3 px-4 py-3 text-xs hover:bg-[#f3f6f8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0f766e]';
// the Notifications dropdown: under the bar across a phone's width, else at the button
const DROPDOWN = 'fixed inset-x-3 top-14 z-50 rounded-lg border border-gray-200 bg-white shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2';
// the bar's icon buttons: the control height (32px; 44px on a phone or a coarse pointer)
const BAR_BUTTON = 'relative inline-flex h-ds-control min-w-[var(--ds-control-h)] shrink-0 items-center justify-center rounded-ds-control text-ds-fg-muted transition-colors hover:bg-ds-surface-hover hover:text-ds-fg focus-visible:outline-none focus-visible:shadow-ds-ring';

export default function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const userButtonRef = useRef<HTMLButtonElement>(null);
  const { open: menuOpen, setOpen: setMenuOpen } = useShellMenu();
  const dropdownIds = { notifications: useId(), user: useId() };

  const { me, access, nav } = useShellAccess();
  const ui = useShell();
  const queue = useShellQueue();
  const hint = useFirstRunHint();

  const currentUser = me?.user;
  const displayName = currentUser?.display_name || currentUser?.username || 'User';
  const tenantName = currentUser?.primary_tenant_name || 'Organization';
  const userEmail = currentUser?.email || '';
  const isAdmin = !!currentUser?.is_admin;
  const initials = displayName.charAt(0).toUpperCase();

  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const notifButtonRef = useRef<HTMLButtonElement>(null);
  const [chatQ, setChatQ] = useState('');

  const submitChat = (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = chatQ.trim();
    router.push(q ? `/complychat?q=${encodeURIComponent(q)}` : '/complychat');
    setChatQ('');
  };

  // Real workflow in-app notifications (30 s poll, the 20 newest; the palette's "Mark all notifications read" uses the same query)
  const { items: notifications, unread: unreadCount, refetch: refetchNotifs, markAllRead, markOneRead } = useNotifications(!!currentUser);

  // the top bar's own links, each shown to the people its page lets in (as the menu's entries are)
  const leaves = visibleLeafHrefs(nav);
  const canAskComplyChat = mayAskComplyAgent(access, leaves);
  const usersPage = routeFor('/users');
  const canSeeUsers = !!usersPage && offeredEntry(usersPage, access, leaves);
  const canSeeGovernance = access.isAdmin || holds(access.permissions, 'governance:policies:*');

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
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Escape closes an open dropdown, and gives focus back to its button when focus was inside it
  useEffect(() => {
    if (!notifOpen && !isUserMenuOpen) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const dropdowns = [
        { open: notifOpen, close: () => setNotifOpen(false), wrap: notifRef, button: notifButtonRef },
        { open: isUserMenuOpen, close: () => setIsUserMenuOpen(false), wrap: userMenuRef, button: userButtonRef },
      ];
      dropdowns.forEach(({ open, close, wrap, button }) => {
        if (!open) return;
        close();
        if (wrap.current?.contains(document.activeElement)) button.current?.focus();
      });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [notifOpen, isUserMenuOpen]);

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

  // The Documents area keeps its tab strip in the bar (the open tab names the page, and the pages below it get the row they would otherwise lose); it is the library's, so
  // someone only asked about a document (no library right) gets the trail. The owner of a department who holds no governance right gets the two tabs made for them.
  const showTabs = inDocumentsArea(pathname) && (canSeeGovernance || access.headsDepartment);

  return (
    <header className="top-nav flex h-12 items-center justify-between gap-[6px] px-4 lg:px-5">
      {/* Below lg the menu is the off-canvas drawer (Sidebar.tsx); from lg there is the rail. */}
      <button
        type="button"
        onClick={(e) => { e.currentTarget.focus({ preventScroll: true }); setMenuOpen(true); }}
        aria-label="Open menu"
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? MAIN_MENU_ID : undefined}
        className={`-ml-1 ${BAR_BUTTON} lg:hidden`}
      >
        <Menu size={20} strokeWidth={1.75} />
      </button>
      <div className="flex min-w-0 flex-1 self-stretch items-center px-1">
        {showTabs ? <DocumentsTabs ownerOnly={!canSeeGovernance} /> : <Breadcrumbs />}
      </div>

      <div className="flex shrink-0 items-center gap-[4px] sm:gap-[6px]">
        <CommandBar />

        {/* Comply Agent — global AI assistant: a question box from 1440 (type a question and hit Enter to open the chat), an icon below that. */}
        {canAskComplyChat && (
          <form onSubmit={submitChat} className="relative hidden min-[1440px]:block">
            <Sparkles size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-base)]" aria-hidden />
            <input
              value={chatQ}
              onChange={(e) => setChatQ(e.target.value)}
              placeholder="Ask Comply Agent anything…"
              aria-label="Ask Comply Agent"
              className={`h-8 ${showTabs ? 'w-44 2xl:w-64' : 'w-64'} rounded-md border border-[var(--color-base)]/30 bg-[var(--color-base)]/5 pl-7 pr-8 text-xs text-[var(--color-text)] placeholder:text-[var(--color-muted)] transition-colors focus:w-72 focus:border-[var(--color-base)]/60 focus:bg-white focus:outline-none focus:ring-1 focus:ring-[var(--color-base)]/30`}
            />
            <button type="submit" aria-label="Send" className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--color-base)] hover:bg-[var(--color-base)]/10">
              <ChevronRight size={14} />
            </button>
          </form>
        )}
        {canAskComplyChat && (
          <Link href="/complychat" aria-label="Ask Comply Agent" title="Ask Comply Agent" className={`${BAR_BUTTON} !text-[var(--color-base)] hover:bg-[var(--color-base)]/10 max-md:hidden min-[1440px]:hidden`}>
            <Sparkles size={18} strokeWidth={1.75} />
          </Link>
        )}

        {/* Guide mode — toggles small numbered markers on key UI elements. A phone's bar has no room for it: it is a row of the menu there. */}
        <span className="hidden md:inline-flex"><GuideToggle /></span>

        {/* Work and context: the panel with the person's queue (it replaced the Pending approvals dropdown); the number is the queue's, the inbox's count rule */}
        <button
          ref={ui.panelButton}
          type="button"
          onClick={ui.togglePanel}
          aria-pressed={ui.panelShown}
          aria-label={`Work and context. ${queue.label}`}
          title="Work and context (Ctrl .)"
          className={`${BAR_BUTTON} ${ui.panelShown ? 'bg-ds-surface-hover !text-ds-fg' : ''} ${queue.text ? 'gap-[4px] px-[6px]' : ''} ${hint ? 'min-[1280px]:gap-[6px] min-[1280px]:bg-ds-primary-soft min-[1280px]:px-[10px] min-[1280px]:!text-ds-primary-text' : ''}`}
        >
          <PanelRight size={18} strokeWidth={1.75} aria-hidden />
          {/* the first-run pointer (useFirstRunHint): the button's name beside its icon until the palette or the panel has been used once; in the bar, so it covers nothing of the page */}
          {hint && <span className="hidden text-ds-body font-[600] min-[1280px]:inline">Work and context</span>}
          {queue.text && (
            <span aria-hidden className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-[4px] text-[12px] font-[600] leading-none text-ds-on-primary ${queue.urgent ? 'bg-ds-danger' : 'bg-ds-warning'}`}>{queue.text}</span>
          )}
        </button>

        {/* Notification bell */}
        <div className="relative" ref={notifRef}>
          <button
            ref={notifButtonRef}
            type="button"
            onClick={() => {
              if (!notifOpen) refetchNotifs();
              setNotifOpen(!notifOpen);
            }}
            className={BAR_BUTTON}
            aria-label="Notifications"
            aria-haspopup="dialog"
            aria-expanded={notifOpen}
            aria-controls={notifOpen ? dropdownIds.notifications : undefined}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#b42318] px-[4px] text-[12px] font-bold text-white leading-none">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
          {notifOpen && (
            <div id={dropdownIds.notifications} role="dialog" aria-label="Notifications" className={`${DROPDOWN} sm:w-80`}>
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
                <span className="text-sm font-semibold text-gray-800">Notifications</span>
                <div className="flex items-center gap-2">
                  {unreadCount > 0 && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-600">{unreadCount} new</span>
                  )}
                  {unreadCount > 0 && (
                    <button onClick={markAllRead} className="text-xs text-blue-600 hover:underline [@media(pointer:coarse)]:min-h-[44px]">Mark all read</button>
                  )}
                </div>
              </div>
              <div className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-gray-400">No notifications</div>
                ) : (
                  notifications.map((n) => {
                    // opens what it is about (only a page of the app); nothing to open: plain text
                    const href = notificationHref(n);
                    const body = (
                      <>
                        <span className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${
                          n.notification_type === 'error' ? 'bg-red-500' :
                          n.notification_type === 'warning' ? 'bg-yellow-500' :
                          n.notification_type === 'success' ? 'bg-green-500' : 'bg-blue-500'
                        } ${n.is_read ? 'opacity-30' : ''}`} />
                        <div className="flex-1 min-w-0">
                          <p className={`font-medium leading-snug truncate ${!n.is_read ? 'text-[#1f2933]' : 'text-[#586472]'}`}>{n.subject}</p>
                          {/* the message is cut at two lines and its whole text is the tooltip */}
                          {n.message && <p title={n.message} className="mt-0.5 line-clamp-2 text-[#586472] leading-snug">{n.message}</p>}
                          <p className="mt-0.5 text-[#7b8794]">{timeAgo(n.created_at)}</p>
                        </div>
                      </>
                    );
                    return href ? (
                      <Link
                        key={n.id}
                        href={href}
                        onClick={() => { if (!n.is_read) markOneRead(n.id); setNotifOpen(false); }}
                        className={`${ITEM_LINK} ${!n.is_read ? 'bg-blue-50' : ''}`}
                      >
                        {body}
                        <ChevronRight size={14} className="mt-0.5 flex-shrink-0 text-[#7b8794]" aria-hidden />
                      </Link>
                    ) : (
                      <div key={n.id} className={`flex gap-3 px-4 py-3 text-xs ${!n.is_read ? 'bg-blue-50' : ''}`}>
                        {body}
                        {!n.is_read && (
                          <button type="button" onClick={() => markOneRead(n.id)}
                            className="h-fit flex-shrink-0 rounded px-1.5 py-0.5 text-[12px] font-medium text-[#0f766e] hover:bg-[#e6f4f1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e] [@media(pointer:coarse)]:min-h-[44px]">
                            Mark read
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* User avatar + menu */}
        <div className="relative" ref={userMenuRef}>
          <button
            ref={userButtonRef}
            type="button"
            onClick={() => setIsUserMenuOpen((prev) => !prev)}
            className="flex min-h-ds-control items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[var(--color-text)] transition-colors hover:bg-[var(--color-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e] max-md:min-w-[44px] max-md:justify-center max-md:border-0 max-md:bg-transparent"
            aria-label="User menu"
            aria-haspopup="dialog"
            aria-expanded={isUserMenuOpen}
            aria-controls={isUserMenuOpen ? dropdownIds.user : undefined}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-white text-sm font-bold flex-shrink-0">
              {initials}
            </span>
            <ChevronDown
              size={14}
              className={`hidden text-[var(--color-text-muted)] transition-transform sm:block ${isUserMenuOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {isUserMenuOpen && (
            <div id={dropdownIds.user} role="dialog" aria-label="Account" className="absolute right-0 z-50 mt-2 w-64 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
              <div className="border-b border-[var(--color-border)] px-3 py-2.5">
                <p className="text-sm font-semibold text-[var(--color-text)]">{displayName}</p>
                {userEmail && (
                  <p title={userEmail} className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">{userEmail}</p>
                )}
                {/* a tenant name can be long: two lines, the whole name as its tooltip */}
                <p title={tenantName} className="mt-1 line-clamp-2 break-words text-xs text-[var(--color-text-muted)]">{tenantName}</p>
              </div>

              <div className="py-1">
                {canSeeUsers && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      router.push('/users');
                    }}
                    className="flex min-h-ds-control w-full items-center gap-2 px-3 py-2 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-subtle)]"
                  >
                    <Users size={16} className="text-[var(--color-text-muted)]" />
                    Users
                  </button>
                )}

                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      router.push('/admin/users');
                    }}
                    className="flex min-h-ds-control w-full items-center gap-2 px-3 py-2 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-subtle)]"
                  >
                    <UserCircle size={16} className="text-[var(--color-text-muted)]" />
                    Admin Users
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex min-h-ds-control w-full items-center gap-2 px-3 py-2 text-sm text-rose-600 transition-colors hover:bg-rose-50"
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
