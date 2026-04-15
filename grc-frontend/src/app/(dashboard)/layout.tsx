import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="platform-ui compact-density cw-dashboard flex h-screen overflow-hidden bg-[var(--color-subtle)]">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto bg-[var(--color-subtle)] p-4 lg:p-5 scrollbar-thin">
          {children}
        </main>
      </div>
    </div>
  );
}
