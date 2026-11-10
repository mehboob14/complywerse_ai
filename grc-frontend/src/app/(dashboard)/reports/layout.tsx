'use client';

// Reports: the four pages of the area (Reports, Dashboards, Trends, Analytics) share one strip across their top. The builder (a workspace that needs the whole window), the print view (chrome-free) and
// any other page of the folder have no strip.
import { usePathname } from 'next/navigation';
import { ReportsStrip } from './_library/ReportsStrip';
import { showsStrip } from './_library/stripModel';

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  if (!showsStrip(pathname)) return <>{children}</>;
  return (
    <div className="flex min-w-0 flex-col gap-[12px]">
      <ReportsStrip pathname={pathname} />
      {children}
    </div>
  );
}
