'use client';

import { usePathname } from 'next/navigation';

export default function ComplianceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() || '';
  const hideModuleHeader = pathname.startsWith('/compliance/assessments');

  if (hideModuleHeader) {
    return <div>{children}</div>;
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="min-w-0">
        <h1 className="text-lg sm:text-xl font-semibold text-black tracking-tight">Compliance</h1>
        <p className="mt-1 text-sm text-slate-600">Real-time posture across frameworks, controls, evidence, and the unified library</p>
      </div>
      <div>{children}</div>
    </div>
  );
}
