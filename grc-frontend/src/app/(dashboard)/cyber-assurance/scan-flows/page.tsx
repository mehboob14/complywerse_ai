'use client';

import Link from 'next/link';
import { Crosshair, ArrowRight, KeyRound, Globe, Plug } from 'lucide-react';

// Landing for vulnerability scanning. The top-level choice is the scan DEPTH:
// credential-based (deep, authenticated) vs surface (no credentials). Both run
// from the managed-scan launcher; credentials (or the lack of them) realise the
// choice there. Connecting the client's own scanner stays available below.
// ponytail: the ?mode= hint is inert until hosted/page.tsx reads it to preselect.
export default function ScanFlowsPage() {
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2">
          <Crosshair size={22} className="text-primary-600" /> Vulnerability Scanning
        </h1>
        <p className="text-sm text-slate-500 mt-1 max-w-2xl">
          Choose how deep the scan goes. Credential-based scans log in and see inside each host;
          surface scans need no credentials and only see what&apos;s exposed on the network.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Credential-based (deep) */}
        <Link
          href="/cyber-assurance/scan-flows/hosted?mode=credentialed"
          className="group block bg-white rounded-2xl border border-slate-200 p-6 hover:border-primary-300 hover:shadow-lg transition-all"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-[#EFF5FA] text-primary-700">
              <KeyRound size={20} />
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-primary-700 bg-[#EFF5FA] rounded-full px-2.5 py-1">Deep</span>
          </div>
          <h2 className="text-lg font-semibold text-slate-900 mb-1">Credential-based (deep)</h2>
          <p className="text-sm text-slate-500 mb-4">
            We log in to each target (WinRM / SSH / SMB) and run an <b>authenticated</b> scan — so it
            finds installed-software CVEs, missing patches and local misconfiguration, not just what&apos;s
            exposed on the wire.
          </p>
          <ul className="text-xs text-slate-500 space-y-1 mb-5">
            <li>• Needs credentials for each target</li>
            <li>• Collects deep host detail + authenticated findings</li>
            <li>• Findings badged <b>Authenticated</b></li>
          </ul>
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-700 group-hover:gap-2.5 transition-all">
            Start a credentialed scan <ArrowRight size={15} />
          </span>
        </Link>

        {/* Surface (no credentials) */}
        <Link
          href="/cyber-assurance/scan-flows/hosted?mode=surface"
          className="group block bg-white rounded-2xl border border-slate-200 p-6 hover:border-slate-400 hover:shadow-lg transition-all"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-slate-100 text-slate-600">
              <Globe size={20} />
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 bg-slate-100 rounded-full px-2.5 py-1">No credentials</span>
          </div>
          <h2 className="text-lg font-semibold text-slate-900 mb-1">Surface (no credentials)</h2>
          <p className="text-sm text-slate-500 mb-4">
            No logins required. We scan only what&apos;s visible from the network — open ports, exposed
            service versions, missing TLS, default credentials. Best for clients who <b>won&apos;t share
            credentials</b>.
          </p>
          <ul className="text-xs text-slate-500 space-y-1 mb-5">
            <li>• No credentials needed</li>
            <li>• Finds externally-visible issues only</li>
            <li>• Findings badged <b>Surface / Unauthenticated</b></li>
          </ul>
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 group-hover:gap-2.5 transition-all">
            Start a surface scan <ArrowRight size={15} />
          </span>
        </Link>
      </div>

      {/* Secondary: the client already runs their own scanner. */}
      <Link
        href="/cyber-assurance/scan-flows/connect"
        className="group mt-5 flex items-center gap-3 bg-white rounded-2xl border border-slate-200 p-4 hover:border-primary-300 hover:shadow-md transition-all"
      >
        <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-slate-100 text-slate-600 flex-none">
          <Plug size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-900">Client runs their own scanner?</div>
          <div className="text-xs text-slate-500">Connect it with a URL + API keys and pull their findings into ComplyVerse — no scanning from our side.</div>
        </div>
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-700 group-hover:gap-2.5 transition-all flex-none">
          Connect scanner <ArrowRight size={15} />
        </span>
      </Link>
    </div>
  );
}
