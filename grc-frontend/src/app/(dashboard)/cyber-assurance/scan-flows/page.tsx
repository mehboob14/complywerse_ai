'use client';

import Link from 'next/link';
import { Crosshair, ArrowRight, Cloud, Building2 } from 'lucide-react';

// Landing for vulnerability scanning: pick one of the two flows, then its own
// form opens. Flow 1 = we host the scanner. Flow 2 = the client's own Nessus.
export default function ScanFlowsPage() {
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2">
          <Crosshair size={22} className="text-primary-600" /> Vulnerability Scanning
        </h1>
        <p className="text-sm text-slate-500 mt-1 max-w-2xl">
          Two ways to bring vulnerabilities into Complyverse. Pick the flow that matches the client, then fill its form.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Flow 1 */}
        <Link
          href="/cyber-assurance/scan-flows/hosted"
          className="group block bg-white rounded-2xl border border-slate-200 p-6 hover:border-amber-300 hover:shadow-lg transition-all"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="inline-flex items-center gap-2 text-amber-600 font-semibold">
              <span className="text-lg leading-none">◆</span> Flow 1
            </span>
            <Cloud size={20} className="text-amber-500" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900 mb-1">Managed Scanning</h2>
          <p className="text-sm text-slate-500 mb-4">
            For clients with <b>no scanner of their own</b>. Complyverse&apos;s scan engine scans their network — you enter the target subnet and start the scan.
          </p>
          <ul className="text-xs text-slate-500 space-y-1 mb-5">
            <li>• Complyverse&apos;s scan engine (behind our backend, private)</li>
            <li>• Enter the client subnet → start a scan</li>
            <li>• Findings pulled into Complyverse automatically</li>
          </ul>
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-700 group-hover:gap-2.5 transition-all">
            Open Flow 1 <ArrowRight size={15} />
          </span>
        </Link>

        {/* Flow 2 */}
        <Link
          href="/cyber-assurance/scan-flows/connect"
          className="group block bg-white rounded-2xl border border-slate-200 p-6 hover:border-blue-300 hover:shadow-lg transition-all"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="inline-flex items-center gap-2 text-blue-600 font-semibold">
              <span className="text-lg leading-none">●</span> Flow 2
            </span>
            <Building2 size={20} className="text-blue-500" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900 mb-1">Connect Their Scanner</h2>
          <p className="text-sm text-slate-500 mb-4">
            Client already runs their own scanner. Enter its <b>URL + API keys</b> and Complyverse pulls the findings via the API.
          </p>
          <ul className="text-xs text-slate-500 space-y-1 mb-5">
            <li>• Client&apos;s on-prem scanner (they scan)</li>
            <li>• Paste access key + secret key</li>
            <li>• Sync Now → findings pulled in</li>
          </ul>
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-700 group-hover:gap-2.5 transition-all">
            Open Flow 2 <ArrowRight size={15} />
          </span>
        </Link>
      </div>
    </div>
  );
}
