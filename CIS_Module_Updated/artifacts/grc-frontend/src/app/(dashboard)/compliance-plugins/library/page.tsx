'use client';

export const dynamic = 'force-dynamic';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { compliancePluginsApi } from '@/lib/api';
import { Link } from 'wouter';
import { Library, ChevronRight, ChevronDown, FileText, Loader2, BookOpen, Folder, FolderOpen, ShieldCheck, Cpu, Target, X, Brain, Server, List } from 'lucide-react';

// Rule Library
// ------------------------------------------------------------------
// Hierarchical CIS rule browser. Tree:
//
//   Family (Windows / Linux / Cisco / Cloud / DB / Container / ...)
//   └─ Product (Windows 11 / Cisco ASA / Oracle 19c / ...)
//      └─ Build (23H2 / 22H2 / 17.9 / 19c / ...)
//         └─ Benchmark version (CIS Win 11 Enterprise v5.0.1)
//            └─ Section (1, 2, 17, 18, ...)
//               └─ Subsection (1.1, 1.2, 17.5, ...)
//                  └─ Rule (1.1.2: "Maximum password age...")
//
// The deepest two levels (sections/rules) are fetched lazily when the
// user expands a benchmark — keeps the initial payload tiny.

type LibNode = {
  key: string;
  label: string;
  kind?: 'family' | 'benchmark';
  family?: string;
  build?: string | null;
  is_supported?: boolean;
  rule_count: number;
  children?: LibNode[];
  benchmarks?: LibNode[];
  os_keys?: string[];
};

type RuleRow = {
  id: number;
  rule_id: string;
  title: string;
  severity: string | null;
  runner_type: string | null;
  os_keys: string[];
};

type Subsection = {
  number: string;
  label: string;
  rule_count: number;
  rules: RuleRow[];
};

type Section = {
  number: string;
  label: string;
  rule_count: number;
  subsections: Subsection[];
};

export default function RuleLibraryPage() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [showEol, setShowEol] = useState(false);
  const [drawerRuleId, setDrawerRuleId] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['compliance-plugins', 'library-tree'],
    queryFn: () => compliancePluginsApi.libraryTree().then((r: any) => r.data),
  });

  const tree: LibNode[] = data?.tree || [];
  const totalRules: number = data?.total_rules ?? 0;
  const totalBenchmarks: number = data?.total_benchmarks ?? 0;

  const toggle = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const expandAll = () => {
    const all = new Set<string>();
    const walk = (n: LibNode) => {
      all.add(n.key);
      (n.children || []).forEach(walk);
    };
    tree.forEach(walk);
    setExpanded(all);
  };
  const collapseAll = () => setExpanded(new Set());

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const matchNode = (n: LibNode): boolean => {
      if (!q && (showEol || n.is_supported !== false)) return true;
      if (q && n.label.toLowerCase().includes(q)) return true;
      if ((n.benchmarks || []).some(b => !q || b.label.toLowerCase().includes(q))) return true;
      return (n.children || []).some(matchNode);
    };
    const prune = (n: LibNode): LibNode | null => {
      if (!matchNode(n)) return null;
      const kept_children = (n.children || []).map(prune).filter(Boolean) as LibNode[];
      const kept_benchmarks = (n.benchmarks || []).filter(b => !q || b.label.toLowerCase().includes(q));
      return { ...n, children: kept_children, benchmarks: kept_benchmarks };
    };
    return tree.map(prune).filter(Boolean) as LibNode[];
  }, [tree, search, showEol]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-gray-900">
            <Library className="h-6 w-6 text-blue-600" />
            Compliance Rules
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">
            Browse the CIS catalogue grouped by OS family → product → build → benchmark → section → rule. Click any rule for the AI verdict on which assets it applies to.
          </p>
        </div>
        <div className="flex flex-shrink-0 flex-wrap gap-2">
          {/* "My runs & team activity" replaces the old "Manage (flat
              view)" button. The old link went to /compliance/plugins —
              a mixed page that bundled platform-admin mutations
              (reviewBulk, classification edits) with genuinely
              tenant-valuable data (pass rate, team activity, recent
              runs). The valuable bits live at /my-runs now; the
              platform-admin half stays in the codebase but no tenant
              route exposes it. */}
          <Link
            href="/my-runs"
            className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
            title="Your scan pass-rate, team activity, and the recent runs feed"
          >
            <List className="h-3.5 w-3.5" /> My runs & team activity
          </Link>
          {/* "AI Classifier" + "OS Registry" buttons hidden — they linked
          {/* "AI Classifier" + "OS Registry" buttons hidden — they linked
              to /compliance/plugins/classify and /compliance/plugins/os-registry,
              both pre-strict-matcher tooling (Stage 2 AI router + os_keys
              catalogue). The strict matcher replaced both with the
              operator-owned grc_benchmark_os_mappings table; the real
              admin surface for that lives at the benchmark-mappings
              endpoints. Files preserved on disk in case we ever expose
              them as platform-admin diagnostics. */}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <StatCard label="Total rules" value={totalRules} hint="approved + enabled" />
        <StatCard label="Unique benchmarks" value={totalBenchmarks} hint="distinct CIS sources" />
        {/* "OS targets" card hidden — counted second-level tree nodes
            (the legacy os_keys breakdown). Under the strict matcher the
            operator-owned mapping count is what matters, and that is
            now shown in admin/overview's per-benchmark coverage table. */}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by name (e.g. windows, cisco, 22H2)…"
          className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs"
        />
        <label className="flex items-center gap-1 text-xs text-gray-700">
          <input type="checkbox" checked={showEol} onChange={e => setShowEol(e.target.checked)} />
          Include EOL OS
        </label>
        <button onClick={expandAll} className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50">Expand all</button>
        <button onClick={collapseAll} className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50">Collapse all</button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 p-6 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading rule library…
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Couldn't load the library tree.
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <ul className="divide-y divide-gray-100">
            {filtered.map(node => (
              <TreeRow key={node.key} node={node} depth={0} expanded={expanded} onToggle={toggle} onClickRule={setDrawerRuleId} />
            ))}
          </ul>
        </div>
      )}

      {drawerRuleId && (
        <RuleTargetsDrawer ruleId={drawerRuleId} onClose={() => setDrawerRuleId(null)} />
      )}
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-[10px] font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-gray-900">{value.toLocaleString()}</div>
      {hint && <div className="mt-0.5 text-[10px] text-gray-500">{hint}</div>}
    </div>
  );
}

function TreeRow({
  node, depth, expanded, onToggle, onClickRule,
}: {
  node: LibNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  onClickRule: (ruleId: number) => void;
}) {
  const isOpen = expanded.has(node.key);
  const hasKids = (node.children && node.children.length > 0) || (node.benchmarks && node.benchmarks.length > 0);
  const isBuildNode = !!node.build;
  const isFamily = node.kind === 'family';

  return (
    <>
      <li
        className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50"
        style={{ paddingLeft: 8 + depth * 18 }}
      >
        {hasKids ? (
          <button onClick={() => onToggle(node.key)} className="rounded text-gray-500 hover:text-gray-900">
            {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : <span className="w-3.5" />}
        {isFamily ? <Folder className="h-3.5 w-3.5 text-gray-400" /> : <FolderOpen className="h-3.5 w-3.5 text-blue-500" />}
        <span className={`${isFamily ? 'text-sm font-semibold text-gray-900' : 'font-medium text-gray-800'}`}>
          {node.label}
        </span>
        {isBuildNode && <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">build {node.build}</span>}
        {node.is_supported === false && (
          <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">EOL</span>
        )}
        <span className="ml-auto font-mono text-[11px] text-gray-600">{node.rule_count.toLocaleString()}&nbsp;rules</span>
      </li>
      {isOpen && (node.children || []).map(child => (
        <TreeRow key={child.key} node={child} depth={depth + 1} expanded={expanded} onToggle={onToggle} onClickRule={onClickRule} />
      ))}
      {isOpen && (node.benchmarks || []).map(bench => (
        <BenchmarkRow
          key={bench.key}
          benchmarkName={bench.label}
          ruleCount={bench.rule_count}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
          onClickRule={onClickRule}
        />
      ))}
    </>
  );
}

// ─── Benchmark row — lazily loads sections + rules when expanded ───
function BenchmarkRow({
  benchmarkName, ruleCount, depth, expanded, onToggle, onClickRule,
}: {
  benchmarkName: string;
  ruleCount: number;
  depth: number;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  onClickRule: (ruleId: number) => void;
}) {
  const key = `benchmark::${benchmarkName}`;
  const isOpen = expanded.has(key);
  const friendly = friendlyBenchmark(benchmarkName);

  const sectionsQuery = useQuery({
    queryKey: ['compliance-plugins', 'benchmark-sections', benchmarkName],
    queryFn: () => compliancePluginsApi.benchmarkSections(benchmarkName).then((r: any) => r.data),
    enabled: isOpen,
  });

  return (
    <>
      <li
        className="flex items-center gap-2 bg-slate-50/40 px-3 py-1.5 text-xs hover:bg-slate-50"
        style={{ paddingLeft: 8 + depth * 18 }}
      >
        <button onClick={() => onToggle(key)} className="rounded text-gray-500 hover:text-gray-900">
          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <BookOpen className="h-3.5 w-3.5 text-indigo-500" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium text-gray-900">{friendly.product}</span>
          <code className="truncate text-[10px] text-gray-500">{friendly.suffix}</code>
        </div>
        <span className="font-mono text-[11px] text-gray-600">{ruleCount.toLocaleString()}&nbsp;rules</span>
      </li>
      {isOpen && (
        <>
          {sectionsQuery.isLoading && (
            <li className="px-3 py-1.5 text-xs text-gray-500" style={{ paddingLeft: 8 + (depth + 1) * 18 }}>
              <Loader2 className="inline h-3 w-3 animate-spin" /> Loading sections…
            </li>
          )}
          {sectionsQuery.isError && (
            <li className="px-3 py-1.5 text-xs text-red-600" style={{ paddingLeft: 8 + (depth + 1) * 18 }}>
              Couldn't load rules for this benchmark.
            </li>
          )}
          {sectionsQuery.data?.sections?.map((sec: Section) => (
            <SectionRow key={sec.number} section={sec} depth={depth + 1} expanded={expanded} onToggle={onToggle} keyPrefix={key} onClickRule={onClickRule} />
          ))}
        </>
      )}
    </>
  );
}

function SectionRow({
  section, depth, expanded, onToggle, keyPrefix, onClickRule,
}: {
  section: Section;
  depth: number;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  keyPrefix: string;
  onClickRule: (ruleId: number) => void;
}) {
  const key = `${keyPrefix}::section::${section.number}`;
  const isOpen = expanded.has(key);
  return (
    <>
      <li className="flex items-center gap-2 px-3 py-1 text-xs hover:bg-gray-50" style={{ paddingLeft: 8 + depth * 18 }}>
        <button onClick={() => onToggle(key)} className="rounded text-gray-500 hover:text-gray-900">
          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <span className="inline-flex items-center justify-center rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-gray-700">{section.number}</span>
        <span className="font-medium text-gray-800">{section.label}</span>
        <span className="ml-auto font-mono text-[10px] text-gray-500">{section.rule_count.toLocaleString()}</span>
      </li>
      {isOpen && section.subsections.map(sub => (
        <SubsectionRow key={sub.number} subsection={sub} depth={depth + 1} expanded={expanded} onToggle={onToggle} keyPrefix={key} onClickRule={onClickRule} />
      ))}
    </>
  );
}

function SubsectionRow({
  subsection, depth, expanded, onToggle, keyPrefix, onClickRule,
}: {
  subsection: Subsection;
  depth: number;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  keyPrefix: string;
  onClickRule: (ruleId: number) => void;
}) {
  const key = `${keyPrefix}::sub::${subsection.number}`;
  const isOpen = expanded.has(key);
  return (
    <>
      <li className="flex items-center gap-2 px-3 py-1 text-xs hover:bg-gray-50" style={{ paddingLeft: 8 + depth * 18 }}>
        <button onClick={() => onToggle(key)} className="rounded text-gray-500 hover:text-gray-900">
          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <span className="inline-flex items-center justify-center rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-blue-700">{subsection.number}</span>
        <span className="text-gray-700">{subsection.label}</span>
        <span className="ml-auto font-mono text-[10px] text-gray-500">{subsection.rule_count.toLocaleString()}</span>
      </li>
      {isOpen && subsection.rules.map(rule => (
        <RuleListItem
          key={rule.id}
          rule={rule}
          depth={depth + 1}
          onClick={onClickRule}
        />
      ))}
    </>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const sev = severity.toLowerCase();
  const colors: Record<string, string> = {
    critical: 'bg-red-100 text-red-800',
    high: 'bg-orange-100 text-orange-800',
    medium: 'bg-yellow-100 text-yellow-800',
    low: 'bg-blue-100 text-blue-800',
    info: 'bg-gray-100 text-gray-700',
  };
  return (
    <span className={`flex-shrink-0 rounded-full px-1.5 py-0 text-[9px] font-medium ${colors[sev] || 'bg-gray-100 text-gray-700'}`}>
      {severity}
    </span>
  );
}

// ─── Rule row + AI verdict drawer ────────────────────────────────────
function RuleListItem({ rule, depth, onClick }: { rule: RuleRow; depth: number; onClick: (id: number) => void }) {
  const qc = useQueryClient();
  const [runState, setRunState] = useState<'idle' | 'running' | 'done' | 'fail'>('idle');

  const runAll = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setRunState('running');
    try {
      // Quick scan on every matching asset for this rule. Fan out via the
      // execute endpoint; backend rejects gracefully if no asset matches.
      const targets = await compliancePluginsApi.ruleTargets(rule.id).then((r: any) => r.data);
      const assets = targets?.assets || [];
      if (assets.length === 0) { setRunState('done'); return; }
      const results = await Promise.allSettled(
        assets.map((a: any) => compliancePluginsApi.execute(rule.id, { asset_id: a.id }))
      );
      const ok = results.filter(r => r.status === 'fulfilled').length;
      setRunState(ok > 0 ? 'done' : 'fail');
      qc.invalidateQueries({ queryKey: ['compliance-plugins', 'runs'] });
    } catch {
      setRunState('fail');
    }
  };

  return (
    <li
      className="flex cursor-pointer items-center gap-2 border-l-2 border-blue-200 bg-blue-50/20 px-3 py-1 text-xs hover:bg-blue-100/60"
      style={{ paddingLeft: 8 + depth * 18 }}
      onClick={() => onClick(rule.id)}
    >
      <FileText className="h-3 w-3 flex-shrink-0 text-blue-500" />
      <code className="flex-shrink-0 font-mono text-[10px] font-semibold text-blue-700">{rule.rule_id}</code>
      <span className="min-w-0 flex-1 truncate text-gray-800">{rule.title}</span>
      {rule.severity && <SeverityBadge severity={rule.severity} />}
      {rule.os_keys && rule.os_keys.length > 0 && (
        <span className="hidden flex-shrink-0 items-center gap-0.5 rounded-full bg-violet-50 px-1.5 py-0 text-[9px] text-violet-700 lg:inline-flex">
          <Cpu className="h-2.5 w-2.5" /> AI tagged
        </span>
      )}
      <button
        onClick={runAll}
        disabled={runState === 'running'}
        className={`flex-shrink-0 inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] font-medium ${
          runState === 'running' ? 'border-amber-300 bg-amber-50 text-amber-700' :
          runState === 'done' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' :
          runState === 'fail' ? 'border-red-300 bg-red-50 text-red-700' :
          'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
        }`}
        title="Run this check on all matching assets"
      >
        {runState === 'running' ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Target className="h-2.5 w-2.5" />}
        {runState === 'running' ? 'Running' : runState === 'done' ? 'Queued' : runState === 'fail' ? 'Failed' : 'Run check'}
      </button>
    </li>
  );
}

function RuleTargetsDrawer({ ruleId, onClose }: { ruleId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [runToast, setRunToast] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['compliance-plugins', 'rule-targets', ruleId],
    queryFn: () => compliancePluginsApi.ruleTargets(ruleId).then((r: any) => r.data),
  });

  const runSingleMut = useMutation({
    mutationFn: (assetId: number) =>
      compliancePluginsApi.execute(ruleId, { asset_id: assetId }).then((r: any) => r.data),
    onSuccess: (data: any, assetId) => {
      setRunToast(`Run queued on asset #${assetId} (run id: ${data?.id ?? '-'})`);
      qc.invalidateQueries({ queryKey: ['compliance-plugins', 'runs'] });
    },
    onError: (e: any) => setRunToast(e?.response?.data?.detail || e?.message || 'Run failed'),
  });

  const runAllMut = useMutation({
    mutationFn: async () => {
      const assets = data?.assets || [];
      const results = await Promise.allSettled(
        assets.map((a: any) => compliancePluginsApi.execute(ruleId, { asset_id: a.id }))
      );
      return results;
    },
    onSuccess: (results: any) => {
      const ok = results.filter((r: any) => r.status === 'fulfilled').length;
      const fail = results.filter((r: any) => r.status === 'rejected').length;
      setRunToast(`Queued ${ok} runs${fail ? `, ${fail} failed` : ''}.`);
      qc.invalidateQueries({ queryKey: ['compliance-plugins', 'runs'] });
    },
  });

  const ai = data?.ai_verdict;
  const rule = data?.rule;
  const assets = data?.assets || [];
  const verdictColor = ai?.confidence === 'high' ? 'emerald' : ai?.confidence === 'medium' ? 'amber' : 'red';

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40" onClick={onClose}>
      <div className="flex w-full max-w-lg flex-col bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Rule AI verdict</h2>
          <button onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 p-6 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading rule details…
          </div>
        )}
        {error && (
          <div className="m-5 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Couldn't load rule.
          </div>
        )}

        {data && (
          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            <div>
              <div className="flex items-center gap-2">
                <code className="rounded bg-blue-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-blue-800">{rule.rule_id}</code>
                {rule.severity && <SeverityBadge severity={rule.severity} />}
              </div>
              <p className="mt-2 text-sm font-medium text-gray-900">{rule.title}</p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <div className="text-gray-500">Benchmark</div>
                  <code className="text-[10px] text-gray-700">{rule.benchmark}</code>
                </div>
                <div>
                  <div className="text-gray-500">Runner</div>
                  <code className="text-[10px] text-gray-700">{rule.runner_type || '-'}</code>
                </div>
              </div>
              {rule.os_keys?.length > 0 && (
                <div className="mt-2">
                  <div className="text-[11px] text-gray-500">AI-tagged OS keys</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {rule.os_keys.map((k: string) => (
                      <span key={k} className="rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-[10px] text-gray-700">{k}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className={`rounded-md border p-3 bg-${verdictColor}-50 border-${verdictColor}-200`}>
              <div className="flex items-center gap-2">
                <Cpu className={`h-4 w-4 text-${verdictColor}-600`} />
                <span className={`text-xs font-semibold text-${verdictColor}-800`}>AI verdict</span>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className={`text-2xl font-bold text-${verdictColor}-900`}>{ai.applies_to_count}</span>
                <span className={`text-xs text-${verdictColor}-700`}>of {ai.tenant_asset_count} tenant assets</span>
              </div>
              <p className={`mt-2 text-[11px] text-${verdictColor}-800`}>{ai.reasoning}</p>
              <p className={`mt-1 text-[10px] text-${verdictColor}-700`}>Confidence: <strong>{ai.confidence}</strong></p>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-700">Will run on these assets:</span>
                {assets.length > 0 && (
                  <button
                    onClick={() => runAllMut.mutate()}
                    disabled={runAllMut.isPending}
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {runAllMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Target className="h-3 w-3" />}
                    Run check on all {assets.length}
                  </button>
                )}
              </div>
              {runToast && (
                <div className="mb-2 rounded-md border border-blue-200 bg-blue-50 p-2 text-[11px] text-blue-800">
                  {runToast}
                  <button onClick={() => setRunToast(null)} className="float-right text-[10px] underline">dismiss</button>
                </div>
              )}
              {assets.length === 0 ? (
                <div className="rounded-md border border-dashed border-gray-300 p-4 text-center text-xs text-gray-500">
                  No tenant assets match this rule's OS keys yet.
                </div>
              ) : (
                <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
                  {assets.map((a: any) => (
                    <li key={a.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-gray-900">{a.name}</div>
                        <div className="truncate text-[10px] text-gray-500">{a.host_name || a.ip_address}</div>
                      </div>
                      <span className="font-mono text-[10px] text-blue-700">{a.os_normalized || 'unknown'}</span>
                      {a.os_build && <span className="rounded-full bg-blue-50 px-1 text-[9px] text-blue-700">{a.os_build}</span>}
                      <button
                        onClick={() => runSingleMut.mutate(a.id)}
                        disabled={runSingleMut.isPending}
                        className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                      >
                        Run
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Turn "CIS_Microsoft_Windows_11_Enterprise_Benchmark_v5.0.1" into
// { product: "Windows 11 Enterprise", suffix: "v5.0.1" }
function friendlyBenchmark(raw: string): { product: string; suffix: string } {
  const m = raw.match(/^(.*?)(_Benchmark|_v\d)/);
  let base = m ? m[1] : raw;
  base = base.replace(/^CIS_/, '').replace(/_/g, ' ');
  const vmatch = raw.match(/(v\d+\.\d+(?:\.\d+)?(?:-[A-Z]+)?)/);
  return { product: base, suffix: vmatch ? vmatch[1] : raw };
}
