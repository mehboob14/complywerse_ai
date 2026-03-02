import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--color-subtle)' }}>
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto p-6 scrollbar-thin" style={{ backgroundColor: 'var(--color-subtle)' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
