import AuthGuard from '@/components/AuthGuard';
import PageShell from '@/components/shell/PageShell';
import { ShellMenuProvider } from '@/components/layout/ShellMenu';
import { GuideProvider } from '@/components/guide';

// The frame (rail, top bar, page, Work and context panel) is components/shell/PageShell.tsx; this file puts the guards and the providers around it.
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <GuideProvider>
        <ShellMenuProvider>
          <PageShell>{children}</PageShell>
        </ShellMenuProvider>
      </GuideProvider>
    </AuthGuard>
  );
}
