'use client';

import { usePathname } from 'next/navigation';

// The Documents area's tabs (Documents · AI Studio · Attestation · Policy Exceptions) are in the top bar
// (components/governance/DocumentsTabs, rendered by the Header), so the pages here start right under it.
// "Overview" lives in the sidebar (Governance Oversight).

export default function GovernanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // A document open in the AI Studio fills the whole page itself (it cancels the page padding), so it gets no padding here
  if (/^\/governance\/documents\/studio\/[^/]+/.test(pathname ?? '')) return <div className="text-slate-900">{children}</div>;
  return (
    <div className="-m-4 lg:-m-5 text-slate-900">
      <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-4 sm:space-y-6">{children}</div>
    </div>
  );
}
