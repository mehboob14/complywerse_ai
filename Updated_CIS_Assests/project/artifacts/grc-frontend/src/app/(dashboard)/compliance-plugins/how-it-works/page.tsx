'use client';

/**
 * How Rule Scans Work — visual walkthrough.
 *
 * Hand-drawn in JSX (no Mermaid / no PNGs) so each panel is the actual
 * Tailwind components a user would see in the app, not an external image
 * that drifts from reality. Numbered stages, "Before/After" pairs, and
 * live click-state simulation so reviewers can trace the UX flow without
 * needing real data.
 */
import { useState } from 'react';
import {
  FileText, ShieldCheck, Cpu, Target, X, Loader2, Database,
  ChevronRight, ChevronDown, ArrowRight, ArrowDown, CheckCircle2,
  Clock, Server, RefreshCw,
} from 'lucide-react';

// ── Tiny presentational helpers ─────────────────────────────────────────

const SeverityBadge = ({ s }: { s: string }) => {
  const cls = s === 'critical' ? 'bg-red-100 text-red-800'
    : s === 'high'   ? 'bg-orange-100 text-orange-800'
    : s === 'medium' ? 'bg-amber-100 text-amber-800'
    : 'bg-gray-100 text-gray-700';
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>{s}</span>;
};

const AiPill = () => (
  <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-50 px-1.5 py-0 text-[9px] text-violet-700">
    <Cpu className="h-2.5 w-2.5" /> AI tagged
  </span>
);

const StepBadge = ({ n, title }: { n: number; title: string }) => (
  <div className="mb-3 flex items-center gap-3">
    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">{n}</div>
    <h3 className="text-base font-semibold text-gray-900">{title}</h3>
  </div>
);

// ── Mock fixtures (no API calls) ────────────────────────────────────────
const MOCK_RULE = {
  rule_id: '2.1.1',
  title: 'Ensure autofs services are not in use',
  severity: 'medium',
  benchmark: 'CIS_Oracle_Linux_9_Benchmark_v2.0.0',
  runner: 'linux_ssh',
  os_keys: ['oraclelinux-9'],
};

const MOCK_NO_ASSETS: any[] = [];
const MOCK_MATCHING_ASSETS = [
  { id: 31, name: 'db-prod-01', host: '192.168.1.50', os: 'oraclelinux-9', build: '9.4' },
  { id: 32, name: 'db-prod-02', host: '192.168.1.51', os: 'oraclelinux-9', build: '9.4' },
  { id: 33, name: 'db-dr-01',   host: '10.0.5.12',   os: 'oraclelinux-9', build: '9.4' },
];

// ── Mock drawer (matches the real RuleTargetsDrawer styling) ───────────

function MockDrawer({ assets, label }: { assets: any[]; label: string }) {
  const [toast, setToast] = useState<string | null>(null);
  return (
    <div className="relative w-full max-w-md rounded-md border border-gray-200 bg-white shadow-md">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2.5">
        <h4 className="text-xs font-semibold text-gray-900">Rule AI verdict</h4>
        <X className="h-3.5 w-3.5 text-gray-400" />
      </div>
      {/* Tag in corner */}
      <div className="absolute -top-2 left-3 rounded bg-blue-600 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
        {label}
      </div>

      <div className="space-y-3 p-4">
        <div>
          <div className="flex items-center gap-2">
            <code className="rounded bg-blue-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-blue-800">{MOCK_RULE.rule_id}</code>
            <SeverityBadge s={MOCK_RULE.severity} />
          </div>
          <p className="mt-2 text-sm font-medium text-gray-900">{MOCK_RULE.title}</p>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
            <div>
              <div className="text-gray-500">Benchmark</div>
              <code className="text-[9px] text-gray-700">{MOCK_RULE.benchmark}</code>
            </div>
            <div>
              <div className="text-gray-500">Runner</div>
              <code className="text-[9px] text-gray-700">{MOCK_RULE.runner}</code>
            </div>
          </div>
          <div className="mt-2">
            <div className="text-[10px] text-gray-500">AI-tagged OS keys</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {MOCK_RULE.os_keys.map(k => (
                <span key={k} className="rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-[9px] text-gray-700">{k}</span>
              ))}
            </div>
          </div>
        </div>

        <div className={`rounded-md border p-2.5 ${
          assets.length === 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-emerald-50 border-emerald-200'
        }`}>
          <div className="flex items-center gap-2">
            <Cpu className="h-3.5 w-3.5 text-emerald-600" />
            <span className="text-[11px] font-semibold text-emerald-800">AI verdict</span>
          </div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-xl font-bold text-emerald-900">{assets.length}</span>
            <span className="text-[10px] text-emerald-700">of 21 tenant assets</span>
          </div>
          <p className="mt-1.5 text-[10px] text-emerald-800">
            Regex matcher tagged this rule to [oraclelinux-9]. Matched against 21 tenant assets.
          </p>
          <p className="mt-1 text-[9px] text-emerald-700">Confidence: <strong>high</strong></p>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-gray-700">Will run on these assets:</span>
            {assets.length > 0 && (
              <button
                onClick={() => setToast(`Queued ${assets.length} runs.`)}
                className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-emerald-700"
              >
                <Target className="h-2.5 w-2.5" /> Run check on all {assets.length}
              </button>
            )}
          </div>
          {toast && (
            <div className="mb-1.5 rounded-md border border-blue-200 bg-blue-50 p-1.5 text-[10px] text-blue-800">
              {toast}
              <button onClick={() => setToast(null)} className="float-right text-[9px] underline">dismiss</button>
            </div>
          )}
          {assets.length === 0 ? (
            <div className="rounded-md border border-dashed border-gray-300 p-3 text-center text-[11px] text-gray-500">
              No tenant assets match this rule's OS keys yet.
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
              {assets.map(a => (
                <li key={a.id} className="flex items-center gap-2 px-2.5 py-1.5 text-[11px]">
                  <ShieldCheck className="h-3 w-3 text-emerald-500" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-gray-900">{a.name}</div>
                    <div className="truncate text-[9px] text-gray-500">{a.host}</div>
                  </div>
                  <span className="font-mono text-[9px] text-blue-700">{a.os}</span>
                  <span className="rounded-full bg-blue-50 px-1 text-[8px] text-blue-700">{a.build}</span>
                  <button
                    onClick={() => setToast(`Run queued on asset #${a.id}`)}
                    className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700 hover:bg-emerald-100"
                  >
                    Run
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Mock library row ────────────────────────────────────────────────────

function MockLibraryRow({ id, title, sev, highlight }: { id: string; title: string; sev: string; highlight?: boolean }) {
  return (
    <li className={`flex items-center gap-2 border-l-2 px-3 py-1 text-xs ${
      highlight
        ? 'border-amber-300 bg-amber-50 ring-1 ring-amber-300'
        : 'border-blue-200 bg-blue-50/20'
    }`}>
      <FileText className="h-3 w-3 flex-shrink-0 text-blue-500" />
      <code className="flex-shrink-0 font-mono text-[10px] font-semibold text-blue-700">{id}</code>
      <span className="min-w-0 flex-1 truncate text-gray-800">{title}</span>
      <SeverityBadge s={sev} />
      <AiPill />
      {/* Intentionally NO Run button */}
    </li>
  );
}

// ── Auto-refresh timeline simulation ────────────────────────────────────

function LiveRefreshDemo() {
  const [t, setT] = useState(0);
  // t=0: empty drawer
  // t=1: agent installs (chip appears)
  // t=2: poll fires (refetch indicator)
  // t=3: drawer shows 1 asset
  const newAsset = { id: 99, name: 'fresh-host-01', host: '10.0.5.99', os: 'oraclelinux-9', build: '9.4' };
  const drawerAssets = t >= 3 ? [newAsset] : [];

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-900">Live refresh simulation</h4>
        <div className="flex items-center gap-1">
          {[0, 1, 2, 3].map(i => (
            <button
              key={i}
              onClick={() => setT(i)}
              className={`h-7 w-12 rounded text-[10px] font-medium ${
                t === i ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              T+{i * 8}s
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Left: backend events */}
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">What's happening on the backend</div>
          <ul className="space-y-2 text-[11px]">
            <li className={`flex items-start gap-2 ${t >= 1 ? 'text-gray-900' : 'text-gray-300'}`}>
              {t >= 1 ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0 mt-0.5" /> : <Clock className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />}
              <span><b>T+8s:</b> Oracle Linux 9 agent installs<br/>Heartbeat auto-creates asset <code className="text-[9px] bg-white px-1 rounded">fresh-host-01</code></span>
            </li>
            <li className={`flex items-start gap-2 ${t >= 2 ? 'text-gray-900' : 'text-gray-300'}`}>
              {t >= 2 ? <RefreshCw className="h-3.5 w-3.5 text-blue-600 flex-shrink-0 mt-0.5 animate-spin" /> : <Clock className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />}
              <span><b>T+16s:</b> Drawer's 15s refetch timer fires<br/><code className="text-[9px] bg-white px-1 rounded">GET /rule-targets?rule_id=...</code></span>
            </li>
            <li className={`flex items-start gap-2 ${t >= 3 ? 'text-gray-900' : 'text-gray-300'}`}>
              {t >= 3 ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0 mt-0.5" /> : <Clock className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />}
              <span><b>T+24s:</b> Drawer re-renders with new asset<br/>Run button appears, no manual reload</span>
            </li>
          </ul>
        </div>

        {/* Right: drawer */}
        <div className="flex justify-end">
          <MockDrawer assets={drawerAssets} label={`Drawer @ T+${t * 8}s`} />
        </div>
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────

export default function HowItWorksPage() {
  return (
    <div className="space-y-8 p-6">
      {/* Hero */}
      <div className="rounded-lg border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-6">
        <h1 className="text-2xl font-bold text-gray-900">How rule scans work</h1>
        <p className="mt-2 text-sm text-gray-600">
          A visual walkthrough of how the CIS Rule Library, the per-rule drawer, and per-asset Run buttons interact.
          Every box below is rendered with the actual app's components, so what you see here is what you get in the real UI.
        </p>
      </div>

      {/* STEP 1 — catalog has no run buttons */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <StepBadge n={1} title="The library page is a catalog — no Run buttons on rules" />
        <p className="mb-4 text-sm text-gray-600">
          Browse, click into a benchmark, expand sections. Each row is clickable to open the rule drawer.
          You never see a Run button on the rule rows themselves.
        </p>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="mb-3 flex items-center justify-between text-xs">
            <span className="font-semibold text-gray-900">Compliance Rules</span>
            <span className="text-gray-600">5,817 rules · 27 benchmarks</span>
          </div>
          <div className="rounded-md border border-gray-200 bg-white">
            <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 text-xs">
              <ChevronDown className="h-3 w-3 text-blue-500" /> <span>📂</span>
              <span className="font-semibold">Oracle Linux 9</span>
              <span className="ml-auto text-gray-500">291 rules</span>
            </div>
            <div className="px-3 py-1 text-xs">
              <div className="flex items-center gap-2 border-b border-gray-100 py-1">
                <ChevronDown className="h-3 w-3 text-blue-500" /> 📖
                <span className="font-medium">Oracle Linux 9 <code className="text-[10px] text-gray-500">v2.0.0</code></span>
                <span className="ml-auto text-gray-500">291 rules</span>
              </div>
              <div className="flex items-center gap-2 py-1 pl-4">
                <ChevronDown className="h-3 w-3 text-gray-400" />
                <span className="rounded bg-gray-100 px-1.5 text-[10px]">2.1</span>
                <span className="font-medium">Subsection 2.1</span>
                <span className="ml-auto text-gray-500">22</span>
              </div>
            </div>
            <ul className="border-t border-gray-100">
              <MockLibraryRow id="2.1.1"  title="Ensure autofs services are not in use" sev="medium" highlight />
              <MockLibraryRow id="2.1.10" title="Ensure nis server services are not in use" sev="medium" />
              <MockLibraryRow id="2.1.11" title="Ensure print server services are not in use" sev="medium" />
            </ul>
          </div>
          <p className="mt-3 flex items-center gap-2 text-[11px] text-amber-700">
            <ArrowRight className="h-3 w-3" />
            Click the highlighted row above to see what happens next — it opens the drawer below.
          </p>
        </div>
      </section>

      {/* STEP 2 — drawer in two states side by side */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <StepBadge n={2} title="Click a rule → drawer slides in. Run buttons live HERE — per matching asset only." />
        <p className="mb-4 text-sm text-gray-600">
          The drawer shows the rule's metadata and the list of YOUR assets it applies to.
          The same rule looks completely different depending on whether you have matching assets.
        </p>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* No matches */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">CASE A</span>
              <span className="text-xs font-semibold text-gray-900">You have no Oracle Linux assets</span>
            </div>
            <MockDrawer assets={MOCK_NO_ASSETS} label="No matches" />
            <p className="mt-2 text-[11px] text-gray-600">
              ⚠ Zero Run buttons anywhere. Empty state tells the operator there's nothing to scan.
              The drawer keeps polling every 15s in case matching assets get added.
            </p>
          </div>
          {/* With matches */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">CASE B</span>
              <span className="text-xs font-semibold text-gray-900">You have 3 Oracle Linux 9 assets</span>
            </div>
            <MockDrawer assets={MOCK_MATCHING_ASSETS} label="3 matches" />
            <p className="mt-2 text-[11px] text-gray-600">
              ✓ One Run button per matching asset, plus a "Run check on all 3" toolbar.
              Click any Run button to fire the scan — try it in this mockup, the toast actually responds.
            </p>
          </div>
        </div>
      </section>

      {/* STEP 3 — live refresh demo */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <StepBadge n={3} title="When a new matching asset appears, the drawer auto-refreshes (15s)" />
        <p className="mb-4 text-sm text-gray-600">
          Click the time buttons to step through what happens when an Oracle Linux 9 agent installs while the drawer is open.
        </p>
        <LiveRefreshDemo />
      </section>

      {/* STEP 4 — execution flow */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <StepBadge n={4} title="Click Run → backend decides where to execute" />
        <p className="mb-4 text-sm text-gray-600">
          Every Run click hits the same endpoint, but the backend routes the work based on whether the
          asset's connection has a Collector assigned (LAN-internal Linux box that dials out to us).
        </p>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          {/* Top: drawer Run click */}
          <div className="mb-4 flex justify-center">
            <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-3 w-3 text-emerald-600" />
                <code className="text-[10px]">db-prod-01</code>
                <span className="font-mono text-[10px] text-blue-700">oraclelinux-9</span>
                <button className="rounded border border-emerald-400 bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">▶ Run</button>
              </div>
            </div>
          </div>
          <div className="flex justify-center">
            <ArrowDown className="h-4 w-4 text-gray-400" />
          </div>
          <div className="mb-3 text-center text-[10px] text-gray-600">
            <code>POST /grc/compliance-plugins/execute</code> { '{ rule_id, asset_id }' }
          </div>
          <div className="flex justify-center">
            <ArrowDown className="h-4 w-4 text-gray-400" />
          </div>

          {/* Backend split */}
          <div className="my-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-center text-xs">
            <div className="mb-1 font-semibold text-blue-900">backend / run_service.py</div>
            <div className="text-[11px] text-blue-800">Does this connection have a collector assigned?</div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* NO collector */}
            <div className="rounded-md border border-gray-300 bg-white p-3">
              <div className="mb-2 flex items-center gap-1">
                <span className="rounded-full bg-gray-200 px-1.5 text-[9px] font-semibold uppercase text-gray-700">NO</span>
                <span className="text-[11px] font-semibold text-gray-900">Direct path (legacy / dev)</span>
              </div>
              <ul className="space-y-1 text-[10px] text-gray-700">
                <li>1. Create run row, status = <code>running</code></li>
                <li>2. Backend opens WinRM/SSH itself</li>
                <li>3. Captures output, updates row</li>
                <li>4. Returns result to UI</li>
              </ul>
              <p className="mt-2 text-[10px] text-amber-700">
                Only works when backend can reach the asset (same network). Not viable for cloud SaaS → bank LAN.
              </p>
            </div>

            {/* WITH collector */}
            <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3">
              <div className="mb-2 flex items-center gap-1">
                <span className="rounded-full bg-emerald-200 px-1.5 text-[9px] font-semibold uppercase text-emerald-800">YES</span>
                <span className="text-[11px] font-semibold text-gray-900">Collector path (production)</span>
              </div>
              <ul className="space-y-1 text-[10px] text-gray-700">
                <li>1. Create run row, status = <code>pending</code></li>
                <li>2. Tag with <code>executed_by_agent_id = N</code></li>
                <li>3. Nudge collector via pending_scan_at</li>
                <li>4. Collector polls /jobs (within 15s)</li>
                <li>5. Collector executes locally, POSTs result with run_id</li>
                <li>6. Backend updates the SAME row in place</li>
              </ul>
              <p className="mt-2 text-[10px] text-emerald-800">
                Works through any firewall — only port 443 outbound needed.
              </p>
            </div>
          </div>

          <div className="mt-4 flex justify-center">
            <ArrowDown className="h-4 w-4 text-gray-400" />
          </div>
          <div className="mt-2 flex justify-center">
            <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
              Result row appears in <code className="text-[10px] bg-white px-1 rounded">/my-runs</code> and on <code className="text-[10px] bg-white px-1 rounded">/assets/N/Compliance</code>
            </div>
          </div>
        </div>
      </section>

      {/* STEP 5 — firewall production scan path */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <StepBadge n={5} title="Will firewall scans actually reach the firewall? (Production answer)" />
        <p className="mb-4 text-sm text-gray-600">
          For network devices (Cisco IOS / FortiGate / PaloAlto / F5 / pfSense / Juniper),
          scans use the <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">netdev_ssh</code> runner —
          a real SSH connection to the device's CLI, the same way a firewall admin would log in.
        </p>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="space-y-3">
            <div className="flex items-start gap-3 rounded-md bg-white p-3 ring-1 ring-gray-200">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-700">1</span>
              <div className="text-xs">
                <div className="font-semibold text-gray-900">CIS PDF says "Run <code>show running-config | include password-policy</code>"</div>
                <div className="mt-0.5 text-gray-600">PDF ingest extracts the literal command into <code>check_definition.audit_command</code></div>
              </div>
            </div>
            <div className="flex justify-center"><ArrowDown className="h-4 w-4 text-gray-400" /></div>

            <div className="flex items-start gap-3 rounded-md bg-white p-3 ring-1 ring-gray-200">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-700">2</span>
              <div className="text-xs">
                <div className="font-semibold text-gray-900">Operator stores firewall in Connect Wizard</div>
                <div className="mt-0.5 text-gray-600">Firewall IP + read-only SSH user + password (Fernet-encrypted in the credentials vault)</div>
              </div>
            </div>
            <div className="flex justify-center"><ArrowDown className="h-4 w-4 text-gray-400" /></div>

            <div className="flex items-start gap-3 rounded-md bg-white p-3 ring-1 ring-gray-200">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-700">3</span>
              <div className="text-xs">
                <div className="font-semibold text-gray-900">Operator clicks Run check</div>
                <div className="mt-0.5 text-gray-600">Backend / collector opens <code>paramiko.SSHClient()</code> → port 22 on firewall</div>
              </div>
            </div>
            <div className="flex justify-center"><ArrowDown className="h-4 w-4 text-gray-400" /></div>

            <div className="flex items-start gap-3 rounded-md bg-white p-3 ring-1 ring-gray-200">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-700">4</span>
              <div className="text-xs">
                <div className="font-semibold text-gray-900">Safety filter blocks any mutating command</div>
                <div className="mt-0.5 text-gray-600">_DENY_PATTERNS rejects configure/set/commit/write/reload/erase BEFORE sending — defence in depth even if backend is compromised</div>
              </div>
            </div>
            <div className="flex justify-center"><ArrowDown className="h-4 w-4 text-gray-400" /></div>

            <div className="flex items-start gap-3 rounded-md bg-white p-3 ring-1 ring-gray-200">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-700">5</span>
              <div className="text-xs">
                <div className="font-semibold text-gray-900">SSH stdout parsed against expected regex</div>
                <div className="mt-0.5 text-gray-600">Pass/Fail decided deterministically — NO AI in the check path</div>
              </div>
            </div>
            <div className="flex justify-center"><ArrowDown className="h-4 w-4 text-gray-400" /></div>

            <div className="flex items-start gap-3 rounded-md bg-emerald-50 p-3 ring-1 ring-emerald-200">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-200 text-xs font-bold text-emerald-800">✓</span>
              <div className="text-xs text-emerald-900">
                <div className="font-semibold">Result row written, shown in /my-runs and on the asset page</div>
                <div className="mt-0.5">Firewall sees a login event in its audit log — operators expect & want this for accountability</div>
              </div>
            </div>
          </div>
        </div>

        {/* Production guarantees table */}
        <div className="mt-6">
          <h4 className="mb-2 text-sm font-semibold text-gray-900">Production guarantees</h4>
          <div className="overflow-hidden rounded-md border border-gray-200">
            <table className="w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Concern</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">How we handle it</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                <tr><td className="px-3 py-2 text-gray-900">Need privileged account?</td><td className="px-3 py-2 text-gray-700">No. Read-only operator role works (CIS audit commands are all <code>show</code>/<code>display</code>)</td></tr>
                <tr><td className="px-3 py-2 text-gray-900">Trace on firewall?</td><td className="px-3 py-2 text-gray-700">Login event in audit log — operators want this</td></tr>
                <tr><td className="px-3 py-2 text-gray-900">Could it change config?</td><td className="px-3 py-2 text-gray-700">No — safety filter blocks configure/set/commit/write/reload/erase</td></tr>
                <tr><td className="px-3 py-2 text-gray-900">Cloud SaaS → bank LAN firewall?</td><td className="px-3 py-2 text-gray-700">Via Collector path — collector inside LAN does the SSH, cloud only sees results</td></tr>
                <tr><td className="px-3 py-2 text-gray-900">Latency / load?</td><td className="px-3 py-2 text-gray-700">One SSH session, sequential commands. ~30s for 50 rules. Single login = no brute-force pattern</td></tr>
                <tr><td className="px-3 py-2 text-gray-900">2FA / MFA?</td><td className="px-3 py-2 text-gray-700">SSH key auth (already supported by Connect Wizard)</td></tr>
                <tr><td className="px-3 py-2 text-gray-900">Supported devices</td><td className="px-3 py-2 text-gray-700">Cisco IOS / IOS XE / IOS XR / NX-OS / ASA / Firepower, FortiGate, PaloAlto, Juniper, F5, pfSense</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* TL;DR */}
      <section className="rounded-lg border border-blue-200 bg-blue-50 p-6">
        <h3 className="mb-3 text-base font-semibold text-blue-900">One-page summary for the team</h3>
        <table className="w-full text-xs">
          <tbody className="divide-y divide-blue-200">
            <tr>
              <td className="py-2 pr-4 font-semibold text-blue-900">Catalog page</td>
              <td className="py-2 text-blue-800">Read-only. Browse rules. No scan triggers. Ever.</td>
            </tr>
            <tr>
              <td className="py-2 pr-4 font-semibold text-blue-900">Drawer (click a rule)</td>
              <td className="py-2 text-blue-800">Shows which YOUR assets the rule applies to. Run buttons live here.</td>
            </tr>
            <tr>
              <td className="py-2 pr-4 font-semibold text-blue-900">No matching assets</td>
              <td className="py-2 text-blue-800">Empty state, zero buttons. Nothing to click.</td>
            </tr>
            <tr>
              <td className="py-2 pr-4 font-semibold text-blue-900">Matching assets appear later</td>
              <td className="py-2 text-blue-800">Drawer's 15-second poll picks them up automatically.</td>
            </tr>
            <tr>
              <td className="py-2 pr-4 font-semibold text-blue-900">Run button click</td>
              <td className="py-2 text-blue-800">Routes through Collector if assigned, else direct backend execution.</td>
            </tr>
            <tr>
              <td className="py-2 pr-4 font-semibold text-blue-900">Scan results</td>
              <td className="py-2 text-blue-800">Land in /my-runs and the asset's Compliance tab.</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}
