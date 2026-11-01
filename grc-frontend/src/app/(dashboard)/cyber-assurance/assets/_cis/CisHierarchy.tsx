'use client';

// CIS Benchmark — Rule Library (hierarchical browser)
// -----------------------------------------------------------------------------
// Self-contained port of /compliance-plugins/library/page.tsx into a reusable,
// prop-less component for the IT Asset Inventory area. Same data layer, same
// lazy section/rule fetch-on-expand — only the skin changes to ComplyVerse's light
// cyber palette (brand accent var(--color-base) = #005B96, via the .inv2 tokens
// in inventory-redesign.css that the compliance-overview page already uses).
//
// Tree depth is preserved end-to-end:
//   Family (Windows/Linux/Cisco/Cloud/DB/Container)
//   └─ Product (Windows 11 / Cisco ASA / Oracle 19c)
//      └─ Build (23H2 / 22H2 / 19c)
//         └─ Benchmark version (CIS Win 11 Enterprise v5.0.1)
//            └─ Section (1, 2, 17, 18 …)        ┐ fetched lazily when a
//               └─ Subsection (1.1, 1.2 …)      │ benchmark row is expanded
//                  └─ Rule (1.1.2: "Max password age…")  ┘
//
// Clicking a rule opens the AI-verdict detail drawer (which tenant assets the
// rule applies to + per-asset run / manual-attest actions) — same panel the
// library page ships.

import { useMemo, useState, type CSSProperties } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { compliancePluginsApi } from '@/cyber-assurance/lib/api';
import '../inventory-redesign.css';
import {
  Library, ChevronRight, ChevronDown, FileText, Loader2, BookOpen,
  Folder, FolderOpen, ShieldCheck, Cpu, X, Search,
} from 'lucide-react';

// ─── Types (verbatim from the library page) ──────────────────────────────────
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

type Subsection = { number: string; label: string; rule_count: number; rules: RuleRow[] };
type Section = { number: string; label: string; rule_count: number; subsections: Subsection[] };

// ─── Palette (the .inv2 asset-area tokens) ───────────────────────────────────
const AC = 'var(--ac)';          // #005B96 == var(--color-base)
const AC_STRONG = 'var(--ac-strong)';
const AC_SOFT = 'var(--ac-soft)';
const INK = '#0F1F2B';
const SEC = '#334049';
const MUTED = '#5F6A76';
const FAINT = '#78838F';
const BD = '#E8ECEE';
const HAIR = '#F0F3F5';

const CARD: CSSProperties = {
  background: '#fff', border: `1px solid ${BD}`, borderRadius: 14,
  boxShadow: '0 1px 2px rgba(16,24,40,.04)',
};
const INDENT = (depth: number) => 10 + depth * 18;

// confidence → verdict-box colours (replaces the library page's dynamic
// Tailwind class names, which are purge-fragile)
const VERDICT: Record<string, { bg: string; bd: string; head: string; num: string; body: string }> = {
  high:   { bg: '#E7F5EE', bd: '#BEE3D1', head: '#145239', num: '#0F4A33', body: '#1F6B4C' },
  medium: { bg: '#FBF6E5', bd: '#EAD9AE', head: '#7A6427', num: '#5C4B12', body: '#8A6D1B' },
  low:    { bg: '#FBEAEA', bd: '#F1C9C7', head: '#8A2F2F', num: '#7A2626', body: '#B23A3A' },
};

function sevStyle(sev?: string | null): CSSProperties {
  const map: Record<string, [string, string]> = {
    critical: ['#F7D8D8', '#A32B2B'], high: ['#F6E7C2', '#8A5A0C'],
    medium: ['#FBF6E5', '#8A6D1B'], low: ['#DBE8FA', '#28578F'], info: ['#EEF1F3', '#5B6673'],
  };
  const [bg, fg] = map[(sev || '').toLowerCase()] || ['#EEF1F3', '#5B6673'];
  return {
    flex: 'none', display: 'inline-flex', alignItems: 'center', borderRadius: 999,
    padding: '1px 7px', fontSize: 9.5, fontWeight: 600, background: bg, color: fg,
  };
}

// ─── Root ────────────────────────────────────────────────────────────────────
export default function CisHierarchy() {
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

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const expandAll = () => {
    const all = new Set<string>();
    const walk = (n: LibNode) => { all.add(n.key); (n.children || []).forEach(walk); };
    tree.forEach(walk);
    setExpanded(all);
  };
  const collapseAll = () => setExpanded(new Set());

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const matchNode = (n: LibNode): boolean => {
      if (!q && (showEol || n.is_supported !== false)) return true;
      if (q && n.label.toLowerCase().includes(q)) return true;
      if ((n.benchmarks || []).some((b) => !q || b.label.toLowerCase().includes(q))) return true;
      return (n.children || []).some(matchNode);
    };
    const prune = (n: LibNode): LibNode | null => {
      if (!matchNode(n)) return null;
      const kept_children = (n.children || []).map(prune).filter(Boolean) as LibNode[];
      const kept_benchmarks = (n.benchmarks || []).filter((b) => !q || b.label.toLowerCase().includes(q));
      return { ...n, children: kept_children, benchmarks: kept_benchmarks };
    };
    return tree.map(prune).filter(Boolean) as LibNode[];
  }, [tree, search, showEol]);

  return (
    <div className="inv2" style={{ background: '#F4F6F7', padding: '20px 22px' }}>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 17, letterSpacing: '-.02em', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Library size={18} style={{ color: AC }} /> CIS Benchmark Library
        </h2>
        <p style={{ fontSize: 12, color: MUTED, marginTop: 3, maxWidth: 680 }}>
          Browse the CIS catalogue by OS family → product → build → benchmark → section → rule.
          Click any rule for the AI verdict on which of your assets it applies to.
        </p>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 12, maxWidth: 520, marginBottom: 14 }}>
        <StatCard label="Total rules" value={totalRules} hint="approved + enabled" />
        <StatCard label="Unique benchmarks" value={totalBenchmarks} hint="distinct CIS sources" />
      </div>

      {/* Toolbar */}
      <div style={{ ...CARD, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '10px 12px', marginBottom: 14 }}>
        <div style={{ position: 'relative', flex: '1 1 240px' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: '#9BA6B2' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by name (e.g. windows, cisco, 22H2)…"
            style={{ width: '100%', height: 32, border: `1px solid ${BD}`, borderRadius: 9, background: '#fff', padding: '0 12px 0 32px', fontSize: 12, color: SEC }}
          />
        </div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: SEC, cursor: 'pointer' }}>
          <input type="checkbox" checked={showEol} onChange={(e) => setShowEol(e.target.checked)} />
          Include EOL OS
        </label>
        <button type="button" onClick={expandAll} style={toolBtn}>Expand all</button>
        <button type="button" onClick={collapseAll} style={toolBtn}>Collapse all</button>
      </div>

      {isLoading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 22, fontSize: 12.5, color: MUTED }}>
          <Loader2 size={15} className="animate-spin" /> Loading rule library…
        </div>
      )}
      {error && (
        <div style={{ ...CARD, border: '1px solid #F1C9C7', background: '#FBEAEA', padding: '12px 14px', fontSize: 12, color: '#B23A3A' }}>
          Couldn&apos;t load the library tree.
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <div style={{ ...CARD, overflow: 'hidden' }}>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {filtered.map((node) => (
              <TreeRow key={node.key} node={node} depth={0} expanded={expanded} onToggle={toggle} onClickRule={setDrawerRuleId} />
            ))}
          </ul>
        </div>
      )}

      {!isLoading && !error && filtered.length === 0 && (
        <div style={{ ...CARD, border: `1px dashed #D6DCE1`, padding: 26, textAlign: 'center', fontSize: 12.5, color: MUTED }}>
          No benchmarks match the current filter.
        </div>
      )}

      {drawerRuleId !== null && (
        <RuleTargetsDrawer ruleId={drawerRuleId} onClose={() => setDrawerRuleId(null)} />
      )}
    </div>
  );
}

const toolBtn: CSSProperties = {
  height: 30, padding: '0 11px', border: `1px solid ${BD}`, borderRadius: 9,
  background: '#fff', color: SEC, fontSize: 11.5, fontWeight: 500, cursor: 'pointer',
};

function StatCard({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div style={{ ...CARD, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: FAINT }}>{label}</div>
      <div className="num" style={{ marginTop: 3, fontSize: 22, fontWeight: 700, color: INK }}>{value.toLocaleString()}</div>
      {hint && <div style={{ marginTop: 1, fontSize: 10, color: '#9BA6B2' }}>{hint}</div>}
    </div>
  );
}

// ─── Caret helper ─────────────────────────────────────────────────────────────
function Caret({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: MUTED, display: 'inline-flex', flex: 'none' }}
    >
      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
    </button>
  );
}

// ─── Family / Product / Build rows ────────────────────────────────────────────
function TreeRow({
  node, depth, expanded, onToggle, onClickRule,
}: {
  node: LibNode; depth: number; expanded: Set<string>;
  onToggle: (key: string) => void; onClickRule: (ruleId: number) => void;
}) {
  const isOpen = expanded.has(node.key);
  const hasKids = (node.children && node.children.length > 0) || (node.benchmarks && node.benchmarks.length > 0);
  const isBuildNode = !!node.build;
  const isFamily = node.kind === 'family';

  return (
    <>
      <li
        className="rrow"
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', paddingLeft: INDENT(depth), fontSize: 12, borderTop: `1px solid ${HAIR}` }}
      >
        {hasKids ? <Caret open={isOpen} onClick={() => onToggle(node.key)} /> : <span style={{ width: 14, flex: 'none' }} />}
        {isFamily
          ? <Folder size={14} style={{ color: '#9BA6B2', flex: 'none' }} />
          : <FolderOpen size={14} style={{ color: AC, flex: 'none' }} />}
        <span style={{ fontSize: isFamily ? 13 : 12, fontWeight: isFamily ? 600 : 500, color: isFamily ? INK : SEC }}>
          {node.label}
        </span>
        {isBuildNode && (
          <span style={{ borderRadius: 999, background: AC_SOFT, color: AC_STRONG, padding: '1px 7px', fontSize: 9.5, fontWeight: 600 }}>
            build {node.build}
          </span>
        )}
        {node.is_supported === false && (
          <span style={{ borderRadius: 999, background: '#F7D8D8', color: '#A32B2B', padding: '1px 7px', fontSize: 9.5, fontWeight: 600 }}>EOL</span>
        )}
        <span className="num" style={{ marginLeft: 'auto', fontSize: 11, color: MUTED }}>{node.rule_count.toLocaleString()}&nbsp;rules</span>
      </li>
      {isOpen && (node.children || []).map((child) => (
        <TreeRow key={child.key} node={child} depth={depth + 1} expanded={expanded} onToggle={onToggle} onClickRule={onClickRule} />
      ))}
      {isOpen && (node.benchmarks || []).map((bench) => (
        <BenchmarkRow key={bench.key} benchmarkName={bench.label} ruleCount={bench.rule_count} depth={depth + 1} expanded={expanded} onToggle={onToggle} onClickRule={onClickRule} />
      ))}
    </>
  );
}

// ─── Benchmark row — lazily loads sections + rules when expanded ──────────────
function BenchmarkRow({
  benchmarkName, ruleCount, depth, expanded, onToggle, onClickRule,
}: {
  benchmarkName: string; ruleCount: number; depth: number; expanded: Set<string>;
  onToggle: (key: string) => void; onClickRule: (ruleId: number) => void;
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
        className="rrow"
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', paddingLeft: INDENT(depth), fontSize: 12, borderTop: `1px solid ${HAIR}`, background: '#FAFBFC' }}
      >
        <Caret open={isOpen} onClick={() => onToggle(key)} />
        <BookOpen size={14} style={{ color: AC, flex: 'none' }} />
        <div style={{ display: 'flex', minWidth: 0, flex: 1, flexDirection: 'column' }}>
          <span style={{ fontWeight: 600, color: INK }}>{friendly.product}</span>
          <code className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10, color: '#9BA6B2' }}>{friendly.suffix}</code>
        </div>
        <span className="num" style={{ fontSize: 11, color: MUTED }}>{ruleCount.toLocaleString()}&nbsp;rules</span>
      </li>
      {isOpen && (
        <>
          {sectionsQuery.isLoading && (
            <li style={{ padding: '6px 12px', paddingLeft: INDENT(depth + 1), fontSize: 11.5, color: MUTED }}>
              <Loader2 size={12} className="animate-spin" style={{ display: 'inline', verticalAlign: '-2px' }} /> Loading sections…
            </li>
          )}
          {sectionsQuery.isError && (
            <li style={{ padding: '6px 12px', paddingLeft: INDENT(depth + 1), fontSize: 11.5, color: '#B23A3A' }}>
              Couldn&apos;t load rules for this benchmark.
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
  section: Section; depth: number; expanded: Set<string>;
  onToggle: (key: string) => void; keyPrefix: string; onClickRule: (ruleId: number) => void;
}) {
  const key = `${keyPrefix}::section::${section.number}`;
  const isOpen = expanded.has(key);
  return (
    <>
      <li className="rrow" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', paddingLeft: INDENT(depth), fontSize: 12, borderTop: `1px solid ${HAIR}` }}>
        <Caret open={isOpen} onClick={() => onToggle(key)} />
        <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 5, background: '#EEF1F3', color: SEC, padding: '1px 6px', fontSize: 10, fontWeight: 600 }}>{section.number}</span>
        <span style={{ fontWeight: 500, color: SEC }}>{section.label}</span>
        <span className="num" style={{ marginLeft: 'auto', fontSize: 10, color: '#9BA6B2' }}>{section.rule_count.toLocaleString()}</span>
      </li>
      {isOpen && section.subsections.map((sub) => (
        <SubsectionRow key={sub.number} subsection={sub} depth={depth + 1} expanded={expanded} onToggle={onToggle} keyPrefix={key} onClickRule={onClickRule} />
      ))}
    </>
  );
}

function SubsectionRow({
  subsection, depth, expanded, onToggle, keyPrefix, onClickRule,
}: {
  subsection: Subsection; depth: number; expanded: Set<string>;
  onToggle: (key: string) => void; keyPrefix: string; onClickRule: (ruleId: number) => void;
}) {
  const key = `${keyPrefix}::sub::${subsection.number}`;
  const isOpen = expanded.has(key);
  return (
    <>
      <li className="rrow" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', paddingLeft: INDENT(depth), fontSize: 12, borderTop: `1px solid ${HAIR}` }}>
        <Caret open={isOpen} onClick={() => onToggle(key)} />
        <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 5, background: AC_SOFT, color: AC_STRONG, padding: '1px 6px', fontSize: 10, fontWeight: 600 }}>{subsection.number}</span>
        <span style={{ color: SEC }}>{subsection.label}</span>
        <span className="num" style={{ marginLeft: 'auto', fontSize: 10, color: '#9BA6B2' }}>{subsection.rule_count.toLocaleString()}</span>
      </li>
      {isOpen && subsection.rules.map((rule) => (
        <RuleListItem key={rule.id} rule={rule} depth={depth + 1} onClick={onClickRule} />
      ))}
    </>
  );
}

// ─── Rule row ─────────────────────────────────────────────────────────────────
// Read-only catalogue row. Scanning/attestation happens from the drawer (or an
// asset's own CIS scans), not inline here.
function RuleListItem({ rule, depth, onClick }: { rule: RuleRow; depth: number; onClick: (id: number) => void }) {
  return (
    <li
      className="rrow"
      onClick={() => onClick(rule.id)}
      title="View this rule's detail"
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', paddingLeft: INDENT(depth), fontSize: 11.5, cursor: 'pointer', borderTop: `1px solid ${HAIR}`, borderLeft: `2px solid ${AC}`, background: AC_SOFT }}
    >
      <FileText size={13} style={{ color: AC, flex: 'none' }} />
      <code className="mono" style={{ flex: 'none', fontSize: 10, fontWeight: 600, color: AC_STRONG }}>{rule.rule_id}</code>
      <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: SEC }}>{rule.title}</span>
      {rule.severity && <span style={sevStyle(rule.severity)}>{rule.severity}</span>}
      {rule.runner_type === 'manual' && (
        <span style={{ flex: 'none', borderRadius: 999, background: '#F6E7C2', color: '#7A4E0A', padding: '1px 7px', fontSize: 9, fontWeight: 600 }}>Manual</span>
      )}
      {rule.os_keys && rule.os_keys.length > 0 && rule.runner_type !== 'manual' && (
        <span style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 3, borderRadius: 999, background: '#EDE7F6', color: '#5B3F9E', padding: '1px 7px', fontSize: 9, fontWeight: 600 }}>
          <Cpu size={10} /> Auto-scanned
        </span>
      )}
      <ChevronRight size={13} style={{ flex: 'none', color: '#C4CCD4' }} />
    </li>
  );
}

// ─── Rule AI-verdict drawer ────────────────────────────────────────────────────
function RuleTargetsDrawer({ ruleId, onClose }: { ruleId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [runToast, setRunToast] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['compliance-plugins', 'rule-targets', ruleId],
    queryFn: () => compliancePluginsApi.ruleTargets(ruleId).then((r: any) => r.data),
  });

  const runSingleMut = useMutation({
    mutationFn: ({ assetId, result }: { assetId: number; result?: string }) =>
      compliancePluginsApi
        .execute(ruleId, { asset_id: assetId, ...(result ? { manual_result: result } : {}) })
        .then((r: any) => r.data),
    onSuccess: (resp: any, vars) => {
      const verb = vars.result ? `Recorded "${vars.result}"` : 'Run queued';
      setRunToast(`${verb} on asset #${vars.assetId} (run id: ${resp?.id ?? '-'}, status: ${resp?.status ?? '-'})`);
      qc.invalidateQueries({ queryKey: ['compliance-plugins', 'runs'] });
    },
    onError: (e: any) => setRunToast(e?.response?.data?.detail || e?.message || 'Run failed'),
  });

  const ai = data?.ai_verdict;
  const rule = data?.rule;
  const isManual = rule?.runner_type === 'manual';
  const assets = data?.assets || [];
  const vc = VERDICT[ai?.confidence as string] || VERDICT.low;

  return (
    <div
      className="inv2"
      style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', justifyContent: 'flex-end', background: 'rgba(0,0,0,.4)' }}
      onClick={onClose}
    >
      <div
        style={{ display: 'flex', width: '100%', maxWidth: 520, flexDirection: 'column', background: '#fff', boxShadow: '-8px 0 24px rgba(16,24,40,.18)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${BD}`, padding: '12px 18px' }}>
          <h3 style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>Rule AI verdict</h3>
          <button type="button" onClick={onClose} style={{ border: 0, background: 'none', padding: 4, cursor: 'pointer', color: MUTED, borderRadius: 6 }}>
            <X size={16} />
          </button>
        </div>

        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 22, fontSize: 12.5, color: MUTED }}>
            <Loader2 size={15} className="animate-spin" /> Loading rule details…
          </div>
        )}
        {error && (
          <div style={{ margin: 18, borderRadius: 10, border: '1px solid #F1C9C7', background: '#FBEAEA', padding: 12, fontSize: 12.5, color: '#B23A3A' }}>
            Couldn&apos;t load rule.
          </div>
        )}

        {data && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Rule identity */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <code className="mono" style={{ borderRadius: 5, background: AC_SOFT, color: AC_STRONG, padding: '2px 7px', fontSize: 11, fontWeight: 600 }}>{rule.rule_id}</code>
                {rule.severity && <span style={sevStyle(rule.severity)}>{rule.severity}</span>}
              </div>
              <p style={{ marginTop: 8, fontSize: 13, fontWeight: 500, color: INK }}>{rule.title}</p>
              <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 11 }}>
                <div>
                  <div style={{ color: FAINT }}>Benchmark</div>
                  <code className="mono" style={{ fontSize: 10, color: SEC }}>{rule.benchmark}</code>
                </div>
                <div>
                  <div style={{ color: FAINT }}>Runner</div>
                  <code className="mono" style={{ fontSize: 10, color: SEC }}>{rule.runner_type || '-'}</code>
                </div>
              </div>
              {rule.os_keys?.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, color: FAINT }}>AI-tagged OS keys</div>
                  <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {rule.os_keys.map((k: string) => (
                      <span key={k} className="mono" style={{ borderRadius: 6, border: `1px solid ${BD}`, background: '#F7F9FA', padding: '1px 6px', fontSize: 10, color: SEC }}>{k}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* AI verdict */}
            {ai && (
              <div style={{ borderRadius: 10, border: `1px solid ${vc.bd}`, background: vc.bg, padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Cpu size={15} style={{ color: vc.body }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: vc.head }}>AI verdict</span>
                </div>
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span className="num" style={{ fontSize: 24, fontWeight: 700, color: vc.num }}>{ai.applies_to_count}</span>
                  <span style={{ fontSize: 12, color: vc.body }}>of {ai.tenant_asset_count} tenant assets</span>
                </div>
                <p style={{ marginTop: 8, fontSize: 11, color: vc.head }}>{ai.reasoning}</p>
                <p style={{ marginTop: 4, fontSize: 10, color: vc.body }}>Confidence: <strong>{ai.confidence}</strong></p>
              </div>
            )}

            {/* Applies-to assets */}
            <div>
              <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: SEC }}>Applies to these assets:</span>
                <span style={{ fontSize: 10, color: '#9BA6B2' }}>Scan from the asset&apos;s CIS scans →</span>
              </div>
              {isManual && (
                <div style={{ marginBottom: 8, borderRadius: 8, border: '1px solid #EAD9AE', background: '#FBF6E5', padding: 8, fontSize: 10, color: '#7A6427' }}>
                  This is a manual-attestation rule (no automated check). Review the audit &amp; remediation guidance, then record a Pass / Fail / N-A decision per asset.
                </div>
              )}
              {runToast && (
                <div style={{ marginBottom: 8, borderRadius: 8, border: `1px solid ${BD}`, background: AC_SOFT, padding: 8, fontSize: 11, color: AC_STRONG }}>
                  {runToast}
                  <button type="button" onClick={() => setRunToast(null)} style={{ float: 'right', border: 0, background: 'none', fontSize: 10, textDecoration: 'underline', cursor: 'pointer', color: AC_STRONG }}>dismiss</button>
                </div>
              )}
              {assets.length === 0 ? (
                <div style={{ borderRadius: 8, border: '1px dashed #D6DCE1', padding: 16, textAlign: 'center', fontSize: 12, color: MUTED }}>
                  No tenant assets match this rule&apos;s OS keys yet.
                </div>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, borderRadius: 8, border: `1px solid ${BD}`, overflow: 'hidden' }}>
                  {assets.map((a: any) => (
                    <li key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', fontSize: 11.5, borderTop: `1px solid ${HAIR}` }}>
                      <ShieldCheck size={14} style={{ color: '#186A49', flex: 'none' }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500, color: INK }}>{a.name}</div>
                        <div className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10, color: '#9BA6B2' }}>{a.host_name || a.ip_address}</div>
                      </div>
                      <span className="mono" style={{ fontSize: 10, color: AC_STRONG }}>{a.os_normalized || 'unknown'}</span>
                      {a.os_build && <span style={{ borderRadius: 999, background: AC_SOFT, color: AC_STRONG, padding: '1px 5px', fontSize: 9 }}>{a.os_build}</span>}
                      {isManual ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <button type="button" onClick={() => runSingleMut.mutate({ assetId: a.id, result: 'pass' })} disabled={runSingleMut.isPending} style={pfBtn('#D3EEE1', '#186A49')}>Pass</button>
                          <button type="button" onClick={() => runSingleMut.mutate({ assetId: a.id, result: 'fail' })} disabled={runSingleMut.isPending} style={pfBtn('#F7D8D8', '#A32B2B')}>Fail</button>
                          <button type="button" onClick={() => runSingleMut.mutate({ assetId: a.id, result: 'na' })} disabled={runSingleMut.isPending} style={pfBtn('#EEF1F3', '#5B6673')}>N/A</button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => runSingleMut.mutate({ assetId: a.id })} disabled={runSingleMut.isPending} style={pfBtn('#D3EEE1', '#186A49')}>Run</button>
                      )}
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

function pfBtn(bg: string, fg: string): CSSProperties {
  return {
    borderRadius: 6, border: `1px solid ${fg}33`, background: bg, color: fg,
    padding: '2px 8px', fontSize: 10, fontWeight: 600, cursor: 'pointer',
  };
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
