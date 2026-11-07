import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';
import AuthGuard from '@/components/AuthGuard';
import IdleLogout from '@/components/IdleLogout';
import NavProgress from '@/components/layout/NavProgress';
import { ShellMenuProvider } from '@/components/layout/ShellMenu';
import { GuideProvider, GuidePanel } from '@/components/guide';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <GuideProvider>
        <ShellMenuProvider>
          <div className="platform-ui compact-density cw-dashboard flex h-screen overflow-hidden bg-[var(--color-subtle)]">
            {/* First stop for the keyboard: past the menu and the top bar, to the page. Visible only while it has focus. */}
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[3000] focus:rounded-md focus:bg-[#0f766e] focus:px-3 focus:py-2 focus:text-[13px] focus:font-medium focus:text-[#ffffff] focus:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e] focus-visible:ring-offset-2"
            >
              Skip to content
            </a>
            <NavProgress />
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <Header />
              <main id="main-content" tabIndex={-1} className="flex-1 overflow-auto bg-[var(--color-subtle)] p-4 lg:p-5 scrollbar-thin focus:outline-none">
                {children}
              </main>
            </div>
            {/* Idle-timeout sentinel — reads the tenant's policy and logs the
                user out after the configured window of no activity. */}
            <IdleLogout />
            {/* Guide mode slide-over — renders nothing until a marker is clicked. */}
            <GuidePanel />
          </div>
        </ShellMenuProvider>
      </GuideProvider>
    </AuthGuard>
  );
}

