'use client';

/**
 * ESG architecture diagram — detailed.
 *
 * Shows the real picture: the bank owns its Complyverse tenant.
 * Inside that tenant, ESG is ONE MODULE alongside compliance, risk,
 * controls, evidence. The loan management system is external — it
 * feeds data IN. State Bank of Pakistan receives reports OUT.
 */
import {
  Building2, Database, Leaf, Landmark, ArrowRight, ArrowDown, ArrowUp,
  Users, Shield, FileText, CheckCircle2, AlertTriangle,
  Server, Globe, Cloud, Lock, BarChart3, BookOpen, ClipboardCheck,
  AlertCircle, FileCheck, TrendingUp, Cpu, Workflow,
} from 'lucide-react';

const C = {
  bank:    'border-blue-400 bg-blue-50 text-blue-900',
  tenant:  'border-emerald-400 bg-emerald-50',
  module:  'border-emerald-300 bg-white text-emerald-900',
  esg:     'border-emerald-500 bg-emerald-100 text-emerald-900 ring-2 ring-emerald-400',
  loansys: 'border-amber-400 bg-amber-50 text-amber-900',
  external:'border-purple-400 bg-purple-50 text-purple-900',
  sbp:     'border-purple-500 bg-purple-100 text-purple-900',
  user:    'border-gray-300 bg-white text-gray-800',
};

function Pill({ children, color = 'gray' }: { children: React.ReactNode; color?: string }) {
  const m: Record<string, string> = {
    green:  'bg-emerald-100 text-emerald-800',
    amber:  'bg-amber-100 text-amber-800',
    blue:   'bg-blue-100 text-blue-800',
    purple: 'bg-purple-100 text-purple-800',
    gray:   'bg-gray-100 text-gray-700',
  };
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${m[color]}`}>{children}</span>;
}

function ModuleChip({ icon, label, highlight = false }: { icon: React.ReactNode; label: string; highlight?: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 ${highlight ? C.esg : C.module}`}>
      {icon}
      <span className={`text-[11px] font-medium ${highlight ? 'font-bold' : ''}`}>{label}</span>
      {highlight && <Pill color="green">ESG</Pill>}
    </div>
  );
}

export default function ESGPreviewPage() {
  return (
    <div className="space-y-8 p-6">
      {/* Header */}
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-center">
        <h1 className="text-2xl font-bold text-emerald-900">ESG inside Complyverse — full architecture</h1>
        <p className="mt-1 text-sm text-emerald-800">
          Bank owns the Complyverse tenant. ESG is one module inside it, alongside the other compliance modules.
        </p>
      </div>

      {/* ─── THE MAIN DIAGRAM ─── */}
      <section className="rounded-xl border-2 border-gray-200 bg-gray-50 p-6">
        <div className="grid gap-6 lg:grid-cols-[1fr_2fr_1fr]">
          {/* LEFT: data sources flowing in */}
          <div className="space-y-3">
            <h3 className="text-center text-xs font-bold uppercase tracking-wide text-gray-500">Data flows IN</h3>

            <div className={`rounded-lg border-2 p-3 ${C.loansys}`}>
              <div className="flex items-center gap-2">
                <Server className="h-5 w-5" />
                <div className="text-sm font-bold">Bank's Loan System</div>
              </div>
              <div className="mt-1 text-[10px] opacity-80">(T24 / Flexcube / Finacle — separate system)</div>
              <ul className="mt-2 space-y-0.5 text-[10px]">
                <li>• Customer master</li>
                <li>• Loan applications</li>
                <li>• Repayment history</li>
                <li>• Officer notes</li>
              </ul>
            </div>

            <div className="flex justify-end pr-2">
              <Pill color="amber">nightly API sync</Pill>
            </div>

            <div className={`rounded-lg border-2 p-3 ${C.external}`}>
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                <div className="text-sm font-bold">Borrower (client)</div>
              </div>
              <div className="mt-1 text-[10px] opacity-80">(fills 5-10 fields online)</div>
              <ul className="mt-2 space-y-0.5 text-[10px]">
                <li>• Worker count + safety</li>
                <li>• Permits + certificates</li>
                <li>• Self-declarations</li>
              </ul>
            </div>

            <div className="flex justify-end pr-2">
              <Pill color="purple">borrower portal</Pill>
            </div>

            <div className={`rounded-lg border-2 p-3 ${C.external}`}>
              <div className="flex items-center gap-2">
                <Globe className="h-5 w-5" />
                <div className="text-sm font-bold">Public data sources</div>
              </div>
              <div className="mt-1 text-[10px] opacity-80">(we pull, no human needed)</div>
              <ul className="mt-2 space-y-0.5 text-[10px]">
                <li>• EPA pollution records</li>
                <li>• SECP filings</li>
                <li>• Court cases</li>
                <li>• News / satellite</li>
              </ul>
            </div>

            <div className="flex justify-end pr-2">
              <Pill color="purple">scheduled fetch</Pill>
            </div>
          </div>

          {/* MIDDLE: THE TENANT */}
          <div className={`relative rounded-2xl border-4 ${C.tenant} p-4`}>
            {/* Tenant label badge */}
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-emerald-600 px-3 py-1 text-[11px] font-bold text-white">
              BANK OWNS THIS — Complyverse Tenant
            </div>

            <div className="mt-3 mb-2 text-center text-xs font-semibold text-emerald-900">
              Inside the tenant: 8 modules. ESG is one of them.
            </div>

            {/* Module grid */}
            <div className="grid grid-cols-2 gap-2">
              <ModuleChip icon={<Leaf className="h-3.5 w-3.5 text-emerald-700" />} label="ESG Compliance" highlight />
              <ModuleChip icon={<ClipboardCheck className="h-3.5 w-3.5" />} label="Frameworks (CIS, ISO, NIST)" />
              <ModuleChip icon={<Shield className="h-3.5 w-3.5" />} label="Risk Register" />
              <ModuleChip icon={<FileCheck className="h-3.5 w-3.5" />} label="Controls + Evidence" />
              <ModuleChip icon={<AlertCircle className="h-3.5 w-3.5" />} label="Vulnerability Mgmt" />
              <ModuleChip icon={<BookOpen className="h-3.5 w-3.5" />} label="Policies + Docs" />
              <ModuleChip icon={<Workflow className="h-3.5 w-3.5" />} label="Audit + Workflows" />
              <ModuleChip icon={<BarChart3 className="h-3.5 w-3.5" />} label="Dashboards + Reports" />
            </div>

            {/* ESG module zoom-in */}
            <div className="mt-4 rounded-lg border-2 border-dashed border-emerald-400 bg-white p-3">
              <div className="mb-2 flex items-center gap-2">
                <Leaf className="h-4 w-4 text-emerald-600" />
                <span className="text-xs font-bold text-emerald-900">ESG module — what it does inside</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-[10px]">
                <div className="rounded bg-emerald-50 p-1.5 text-center">
                  <Cpu className="mx-auto h-3 w-3 text-emerald-700" />
                  <div className="mt-1 font-semibold">1. Score</div>
                  <div className="text-emerald-700">E + S + G formula</div>
                </div>
                <div className="rounded bg-emerald-50 p-1.5 text-center">
                  <AlertTriangle className="mx-auto h-3 w-3 text-emerald-700" />
                  <div className="mt-1 font-semibold">2. Flag</div>
                  <div className="text-emerald-700">red issues</div>
                </div>
                <div className="rounded bg-emerald-50 p-1.5 text-center">
                  <TrendingUp className="mx-auto h-3 w-3 text-emerald-700" />
                  <div className="mt-1 font-semibold">3. Monitor</div>
                  <div className="text-emerald-700">every 90 days</div>
                </div>
              </div>

              {/* 3-band output */}
              <div className="mt-2 grid grid-cols-3 gap-1">
                <div className="rounded border border-emerald-300 bg-emerald-50 p-1 text-center text-[9px] font-semibold text-emerald-800">🟢 GREEN</div>
                <div className="rounded border border-amber-300 bg-amber-50 p-1 text-center text-[9px] font-semibold text-amber-800">🟡 YELLOW</div>
                <div className="rounded border border-red-300 bg-red-50 p-1 text-center text-[9px] font-semibold text-red-800">🔴 RED</div>
              </div>
            </div>

            {/* Storage */}
            <div className="mt-3 rounded-md bg-emerald-100 p-2">
              <div className="flex items-center gap-1.5 text-[10px]">
                <Database className="h-3 w-3 text-emerald-800" />
                <span className="font-semibold text-emerald-900">Tenant database (bank's data, isolated):</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                <Pill color="green">customer_esg_profile</Pill>
                <Pill color="green">loan_esg_screening</Pill>
                <Pill color="green">esg_exclusion_list</Pill>
                <Pill color="green">esg_quarterly_reports</Pill>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-center gap-2 rounded border border-emerald-300 bg-white p-2 text-[10px] text-emerald-900">
              <Lock className="h-3 w-3" />
              <span>Bank's tenant is isolated. Other banks can't see this data.</span>
            </div>
          </div>

          {/* RIGHT: outputs */}
          <div className="space-y-3">
            <h3 className="text-center text-xs font-bold uppercase tracking-wide text-gray-500">Data flows OUT</h3>

            <div className={`rounded-lg border-2 p-3 ${C.user}`}>
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-blue-600" />
                <div className="text-sm font-bold">Risk Officer</div>
              </div>
              <div className="mt-1 text-[10px] text-gray-600">sees the score on every loan</div>
            </div>
            <div className="flex justify-start pl-2">
              <Pill color="blue">decides approve/reject</Pill>
            </div>

            <div className={`rounded-lg border-2 p-3 ${C.user}`}>
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-purple-600" />
                <div className="text-sm font-bold">Compliance Officer</div>
              </div>
              <div className="mt-1 text-[10px] text-gray-600">downloads quarterly report</div>
            </div>
            <div className="flex justify-start pl-2">
              <Pill color="purple">submits to SBP</Pill>
            </div>

            <div className={`rounded-lg border-2 p-3 ${C.sbp}`}>
              <div className="flex items-center gap-2">
                <Landmark className="h-5 w-5" />
                <div className="text-sm font-bold">State Bank of Pakistan</div>
              </div>
              <div className="mt-1 text-[10px] opacity-80">receives the report</div>
              <ul className="mt-2 space-y-0.5 text-[10px]">
                <li>• Green financing %</li>
                <li>• Exclusion list compliance</li>
                <li>• Climate risk exposure</li>
                <li>• Women borrowers</li>
              </ul>
            </div>
            <div className="flex justify-start pl-2">
              <Pill color="green">bank stays compliant</Pill>
            </div>

            <div className={`rounded-lg border-2 p-3 ${C.user}`}>
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-emerald-600" />
                <div className="text-sm font-bold">Borrower</div>
              </div>
              <div className="mt-1 text-[10px] text-gray-600">gets verdict + conditions</div>
            </div>
            <div className="flex justify-start pl-2">
              <Pill color="green">discount if green</Pill>
            </div>
          </div>
        </div>
      </section>

      {/* The 4 connection points */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-gray-900">The 4 integration touchpoints (loan system ↔ ESG)</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
            <div className="flex items-center gap-2 text-sm font-bold text-blue-900">
              <ArrowRight className="h-4 w-4" /> 1. Nightly bulk sync
            </div>
            <p className="mt-1 text-xs text-blue-800">
              Bank loan system → ESG module. Every night: new customers, new loans, repayment status.
            </p>
            <code className="mt-2 block rounded bg-white px-2 py-1 text-[10px] text-blue-900">
              POST /api/loan-sync (cron @ 2am)
            </code>
          </div>

          <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-center gap-2 text-sm font-bold text-amber-900">
              <ArrowRight className="h-4 w-4" /> 2. Real-time webhook
            </div>
            <p className="mt-1 text-xs text-amber-800">
              New loan application → ESG scoring fires immediately. Verdict ready in 30 seconds.
            </p>
            <code className="mt-2 block rounded bg-white px-2 py-1 text-[10px] text-amber-900">
              POST /api/v1/loan-events
            </code>
          </div>

          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
            <div className="flex items-center gap-2 text-sm font-bold text-emerald-900">
              <ArrowUp className="h-4 w-4" /> 3. Embedded widget
            </div>
            <p className="mt-1 text-xs text-emerald-800">
              ESG verdict appears INSIDE the loan officer's screen (iframe widget). No app switching.
            </p>
            <code className="mt-2 block rounded bg-white px-2 py-1 text-[10px] text-emerald-900">
              GET /widget/screening/&#123;loan_id&#125;
            </code>
          </div>

          <div className="rounded-md border border-purple-200 bg-purple-50 p-3">
            <div className="flex items-center gap-2 text-sm font-bold text-purple-900">
              <ArrowRight className="h-4 w-4" /> 4. Quarterly alerts
            </div>
            <p className="mt-1 text-xs text-purple-800">
              ESG re-scores all borrowers. If anyone moves green→red, push alert to bank's risk team.
            </p>
            <code className="mt-2 block rounded bg-white px-2 py-1 text-[10px] text-purple-900">
              POST &#123;bank_url&#125;/api/esg-alerts
            </code>
          </div>
        </div>
      </section>

      {/* Multi-tenant clarity */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-gray-900">How it works across multiple banks (multi-tenancy)</h2>
        <p className="mb-4 text-sm text-gray-600">
          Each bank gets their own isolated Complyverse tenant. Their data never mixes with another bank's.
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-blue-300 bg-blue-50 p-3">
            <div className="flex items-center gap-2 text-sm font-bold text-blue-900">
              <Building2 className="h-4 w-4" /> Tenant: Demo Bank PK
            </div>
            <ul className="mt-2 space-y-0.5 text-[11px] text-blue-800">
              <li>• Their loan system</li>
              <li>• Their customers</li>
              <li>• Their ESG scores</li>
              <li>• Their SBP reports</li>
            </ul>
          </div>
          <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3">
            <div className="flex items-center gap-2 text-sm font-bold text-emerald-900">
              <Building2 className="h-4 w-4" /> Tenant: HBL
            </div>
            <ul className="mt-2 space-y-0.5 text-[11px] text-emerald-800">
              <li>• Their loan system</li>
              <li>• Their customers</li>
              <li>• Their ESG scores</li>
              <li>• Their SBP reports</li>
            </ul>
          </div>
          <div className="rounded-lg border border-purple-300 bg-purple-50 p-3">
            <div className="flex items-center gap-2 text-sm font-bold text-purple-900">
              <Building2 className="h-4 w-4" /> Tenant: Meezan Bank
            </div>
            <ul className="mt-2 space-y-0.5 text-[11px] text-purple-800">
              <li>• Their loan system</li>
              <li>• Their customers</li>
              <li>• Their ESG scores</li>
              <li>• Their SBP reports</li>
            </ul>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-md bg-gray-50 p-2 text-[11px] text-gray-700">
          <Lock className="h-3.5 w-3.5" />
          <span>Same Complyverse platform. Different tenants. Hard data isolation — Demo Bank can never see HBL's scores or vice versa.</span>
        </div>
      </section>

      {/* Bottom summary */}
      <section className="rounded-lg border border-gray-300 bg-gray-50 p-6">
        <div className="mx-auto max-w-3xl">
          <h3 className="mb-3 text-base font-bold text-gray-900">In 5 lines</h3>
          <ol className="space-y-2 text-sm text-gray-800">
            <li><span className="font-bold text-blue-600">1.</span> Each bank gets their own Complyverse tenant (isolated).</li>
            <li><span className="font-bold text-emerald-600">2.</span> ESG is one module inside the tenant, next to compliance / risk / controls.</li>
            <li><span className="font-bold text-amber-600">3.</span> The bank's loan system feeds in customer + loan data via API.</li>
            <li><span className="font-bold text-purple-600">4.</span> The ESG module scores every borrower (green/yellow/red) using bank data + public sources + a short borrower form.</li>
            <li><span className="font-bold text-red-600">5.</span> Risk officer sees the score on loan decisions. Compliance officer sends quarterly reports to SBP. Done.</li>
          </ol>
        </div>
      </section>
    </div>
  );
}
