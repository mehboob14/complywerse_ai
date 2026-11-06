'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import ConnectionsPage from '@/app/(dashboard)/cyber-assurance/integrations/connections/page';

// Flow 2 — client's own Nessus. Reuses the existing scanner-connection form +
// list (Add Connection with URL/access-key/secret-key, Test, Sync Now), just
// surfaced here under the Vulnerability Scanning sidebar with a Flow-2 header.
export default function Flow2ConnectPage() {
  return (
    <div>
      <div className="px-6 pt-6">
        <Link href="/cyber-assurance/scan-flows" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-2">
          <ArrowLeft size={15} /> Back to flows
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-blue-600 text-lg leading-none">●</span>
          <h1 className="text-xl font-semibold text-slate-900">Flow 2 — Client&apos;s own Nessus</h1>
        </div>
        <p className="text-sm text-slate-500 mt-1">
          Add the client&apos;s Nessus connection — URL + access key + secret key — then <b>Sync Now</b> on it to pull their findings into Complyverse.
        </p>
      </div>
      <ConnectionsPage />
    </div>
  );
}
