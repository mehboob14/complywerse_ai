'use client';

/**
 * Shared cell primitives for the Vulnerabilities workspace (Register / Workbench
 * views). One source of truth for the severity badge, status pill, the
 * load-bearing SLA/due cell, the composite-priority bucket, owner avatars and
 * the KEV / EPSS threat-intel chips — so every view renders identically.
 *
 * Design charter: single teal brand (primary-*), semantic pills as light
 * bg-{tone}-50 text-{tone}-700 pairs, hairline slate borders, no gradients,
 * no blue-as-brand. Severity reuses the shared charter-fixed SeverityBadge.
 */

import { SeverityBadge, type SeverityLevel } from '@/components/ui';

// ─── Title cleanup ───────────────────────────────────────────────────────────
// Scanner (Nessus) plugin names bake version ranges and release-date footnotes
// into the title — e.g. "Node.js 20.x < 20.20.0 / 22.x < 22.22.0 / … Multiple
// Vulnerabilities (Tuesday, January 13, 2026 Security Releases).". This derives
// a clean label for the list; the FULL name is always kept (tooltip + detail
// page), so nothing is lost for audit. Display-only + falls back to the original
// if the cleanup would leave too little behind.
export function shortenVulnTitle(title?: string | null): string {
  if (!title) return title || '';
  let t = title.trim();
  // 1. Drop a trailing parenthetical (dates / "Security Releases" / advisory ref).
  t = t.replace(/\s*\([^)]*\)\s*\.?\s*$/g, '').trim();
  // 2. Collapse "20.x < 20.20.0 / 22.x < 22.22.0 / …" version-range runs.
  t = t.replace(/\s*\d[\w.]*\s*[<>]=?\s*\d[\w.]*(?:\s*\/\s*\d[\w.]*\s*[<>]=?\s*\d[\w.]*)*/g, ' ');
  // 3. Strip a lone "< x.y.z" (e.g. "axios < 1.15.2 Prototype Pollution").
  t = t.replace(/\s*[<>]=?\s*\d[\w.]+/g, ' ');
  // 4. Tidy leftover separators + whitespace.
  t = t.replace(/\s*\/\s*/g, ' ').replace(/\s{2,}/g, ' ').replace(/\s+([.,])/g, '$1').trim();
  return t.length >= 3 ? t : title.trim();
}

// ─── The Vulnerability shape (mirrors page.tsx) ──────────────────────────────
export interface Vulnerability {
  id: number;
  title: string;
  description?: string;
  severity: string;
  status: string;
  cve_id?: string;
  cwe_id?: string;
  cvss_score?: number;
  affected_component?: string;
  affected_host?: string;
  plugin_family?: string;
  linked_assets?: string[];
  due_date?: string;
  assigned_to?: number;
  assignee_name?: string;
  report_id?: number;
  report_name?: string;
  created_at: string;
  epss_score?: number;
  epss_percentile?: number;
  kev_flag?: boolean;
  kev_date_added?: string;
  public_exploit_count?: number | null;
  exploitdb_count?: number | null;
  nvd_published_at?: string;
  nvd_last_modified_at?: string;
  nvd_last_synced_at?: string;
  exploit_references?: string[];
  composite_priority?: number;
  // NCA template payload — present only on bridged NCA vulns.
  template_fields?: Record<string, unknown>;
}

// Per-severity remediation-day fallback (matches page.tsx DEFAULT_SLA). Used by
// SlaCell when a row has no explicit due_date but we still want an SLA horizon.
export const SLA_REMEDIATION_DAYS: Record<string, number> = {
  critical: 7,
  high: 30,
  medium: 90,
  low: 180,
  info: 365,
};

// ─── Severity ────────────────────────────────────────────────────────────────
const SEVERITY_LEVELS: SeverityLevel[] = ['critical', 'high', 'medium', 'low', 'info'];

export function normalizeSeverity(severity: string | null | undefined): SeverityLevel {
  const s = (severity || '').toLowerCase();
  return (SEVERITY_LEVELS.includes(s as SeverityLevel) ? s : 'info') as SeverityLevel;
}

/** Severity badge + inline CVSS score. Reuses the shared charter-fixed pill. */
export function SeverityCell({
  severity,
  cvss,
  size = 'md',
}: {
  severity: string;
  cvss?: number;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <SeverityBadge severity={normalizeSeverity(severity)} size={size} showIcon={false} />
      {typeof cvss === 'number' && (
        <span className="font-mono text-xs text-slate-500" title="CVSS base score">
          {cvss.toFixed(1)}
        </span>
      )}
    </span>
  );
}

// ─── Status pill ─────────────────────────────────────────────────────────────
const STATUS_PILL: Record<string, { tone: string; label: string }> = {
  open: { tone: 'bg-rose-50 text-rose-700', label: 'Open' },
  in_progress: { tone: 'bg-amber-50 text-amber-700', label: 'In Progress' },
  remediated: { tone: 'bg-primary-50 text-primary-700', label: 'Remediated' },
  verified: { tone: 'bg-emerald-50 text-emerald-700', label: 'Verified' },
  closed: { tone: 'bg-slate-100 text-slate-600', label: 'Closed' },
  accepted: { tone: 'bg-primary-50 text-primary-700', label: 'Risk Accepted' },
  false_positive: { tone: 'bg-slate-100 text-slate-600', label: 'False Positive' },
};

export function statusLabel(status: string | null | undefined): string {
  const s = (status || '').toLowerCase();
  return STATUS_PILL[s]?.label || (status || '—').replace(/_/g, ' ');
}

export function StatusPill({ status }: { status: string }) {
  const s = (status || '').toLowerCase();
  const cfg = STATUS_PILL[s] || { tone: 'bg-slate-100 text-slate-600', label: statusLabel(status) };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.tone}`}>
      {cfg.label}
    </span>
  );
}

// Closed / mitigated statuses that no longer carry an SLA obligation.
const RESOLVED_STATUSES = new Set(['remediated', 'verified', 'closed', 'accepted', 'false_positive']);

// ─── SLA / Due cell (the load-bearing overdue signal) ────────────────────────
/**
 * Derives days-to-due from `due_date`. When no due_date is present it falls back
 * to created_at + the per-severity remediation window so the row still surfaces
 * an SLA horizon. Renders an "overdue Nd" (rose) / "due in Nd" (amber ≤ 7d,
 * else slate) pill. Resolved rows show a muted "—" (no active clock).
 */
export function slaFromVuln(v: Pick<Vulnerability, 'due_date' | 'severity' | 'status' | 'created_at'>): {
  due: Date | null;
  days: number | null;
  overdue: boolean;
  derived: boolean;
} {
  const resolved = RESOLVED_STATUSES.has((v.status || '').toLowerCase());
  let due: Date | null = null;
  let derived = false;

  if (v.due_date) {
    const d = new Date(v.due_date);
    if (!Number.isNaN(d.getTime())) due = d;
  }
  if (!due && v.created_at) {
    const created = new Date(v.created_at);
    const window = SLA_REMEDIATION_DAYS[normalizeSeverity(v.severity)];
    if (!Number.isNaN(created.getTime()) && window) {
      due = new Date(created.getTime() + window * 86_400_000);
      derived = true;
    }
  }

  if (!due) return { due: null, days: null, overdue: false, derived: false };

  const days = Math.ceil((due.getTime() - Date.now()) / 86_400_000);
  return { due, days, overdue: !resolved && days < 0, derived };
}

export function SlaCell({
  vuln,
}: {
  vuln: Pick<Vulnerability, 'due_date' | 'severity' | 'status' | 'created_at'>;
}) {
  const resolved = RESOLVED_STATUSES.has((vuln.status || '').toLowerCase());
  const { due, days, overdue, derived } = slaFromVuln(vuln);

  if (resolved) {
    return <span className="text-xs text-slate-400">—</span>;
  }
  if (due == null || days == null) {
    return <span className="text-xs text-slate-400">No due date</span>;
  }

  const dueLabel = due.toLocaleDateString();
  let tone: string;
  let text: string;
  if (overdue) {
    tone = 'bg-rose-50 text-rose-700';
    text = `overdue ${Math.abs(days)}d`;
  } else if (days <= 7) {
    tone = 'bg-amber-50 text-amber-700';
    text = days === 0 ? 'due today' : `due in ${days}d`;
  } else {
    tone = 'bg-slate-100 text-slate-600';
    text = `due in ${days}d`;
  }

  return (
    <span
      className="inline-flex flex-col gap-0.5"
      title={`${derived ? 'Derived SLA horizon' : 'Due'} ${dueLabel}`}
    >
      <span className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>
        {text}
      </span>
      <span className="text-[10px] text-slate-400">
        {dueLabel}
        {derived && ' · est.'}
      </span>
    </span>
  );
}

// ─── Priority (composite_priority bucket) ────────────────────────────────────
export function priorityBucket(p: number): { tone: string; label: string } {
  if (p >= 9) return { tone: 'bg-rose-50 text-rose-700', label: 'Critical' };
  if (p >= 7) return { tone: 'bg-orange-50 text-orange-700', label: 'High' };
  if (p >= 4) return { tone: 'bg-amber-50 text-amber-700', label: 'Medium' };
  return { tone: 'bg-slate-100 text-slate-600', label: 'Low' };
}

export function PriorityCell({ priority }: { priority?: number }) {
  if (typeof priority !== 'number') {
    return <span className="text-xs italic text-slate-400">—</span>;
  }
  const b = priorityBucket(priority);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${b.tone}`}
      title="Risk score — CVSS, EPSS, exploit maturity, KEV, attack vector, exposure, asset criticality. Same number shown on the finding's Analysis tab."
    >
      {/* /100 scale, matching the finding detail page — one score, one scale
          everywhere it appears. */}
      {Math.round(priority * 10)} · {b.label}
    </span>
  );
}

// ─── Before / after enrichment priority ──────────────────────────────────────
// "Before" = the naive priority from CVSS/severity ALONE. "After" = the 7-signal
// composite once EPSS, KEV, exploit maturity, attack vector, internet exposure and
// asset criticality are folded in. Showing both makes the value of enrichment
// explicit: a CVSS 6.5 (65) that is internal, has no public exploit and sits on a
// medium asset lands at 31 — the contextual score. Pure derivation from fields the
// row already carries, so it can never drift from the composite the backend stored.
const SEVERITY_BASELINE: Record<string, number> = { critical: 9, high: 7.5, medium: 5, low: 2.5, info: 1 };

export function enrichmentPriority(v: { cvss_score?: number | null; severity?: string; composite_priority?: number | null }) {
  const hasCvss = typeof v.cvss_score === 'number' && v.cvss_score > 0;
  const base10 = hasCvss ? (v.cvss_score as number) : (SEVERITY_BASELINE[(v.severity || '').toLowerCase()] ?? 0);
  const before = Math.round(base10 * 10);   // /100, matching the composite's scale
  const after = typeof v.composite_priority === 'number' ? Math.round(v.composite_priority * 10) : null;
  return { before, after, delta: after != null ? after - before : null, baseFrom: hasCvss ? 'CVSS' : 'severity' };
}

export function PriorityDelta({ delta }: { delta: number }) {
  if (delta === 0) return <span className="text-[10px] font-medium text-slate-400" title="Enrichment did not change the priority">±0</span>;
  const down = delta < 0;
  return (
    <span className={`text-[10px] font-semibold ${down ? 'text-emerald-600' : 'text-rose-600'}`}
      title={down ? 'Context LOWERED the priority (e.g. internal / no exploit)' : 'Context RAISED the priority (e.g. exploited / internet-facing)'}>
      {down ? '↓' : '↑'}{Math.abs(delta)}
    </span>
  );
}

/** Raw/"before" priority ONLY — for its own column. The naive score from CVSS
 *  (or severity) alone, before any context is folded in. Neutral styling because
 *  it's the starting point the contextual column then adjusts. */
export function PriorityRawCell({ v }: { v: { cvss_score?: number | null; severity?: string; composite_priority?: number | null } }) {
  const { before, baseFrom } = enrichmentPriority(v);
  return (
    <span className="inline-flex flex-col leading-tight"
      title={`Raw priority from ${baseFrom} alone — before any context: ${before}/100`}>
      <span className="w-fit rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600">{before}</span>
      <span className="mt-0.5 text-[10px] text-slate-400">{baseFrom} alone</span>
    </span>
  );
}

/** Contextual/"after" priority ONLY — for its own column. The 7-signal composite
 *  with the drop/rise delta versus the raw score. */
export function PriorityContextualCell({ v }: { v: { cvss_score?: number | null; severity?: string; composite_priority?: number | null } }) {
  const { after, delta } = enrichmentPriority(v);
  if (after == null) return <span className="text-xs italic text-slate-400">not scored</span>;
  const b = priorityBucket(v.composite_priority ?? 0);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap"
      title="7-signal contextual composite: CVSS, EPSS, exploit maturity, KEV, attack vector, internet exposure, asset criticality">
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${b.tone}`}>{after} · {b.label}</span>
      {delta != null && <PriorityDelta delta={delta} />}
    </span>
  );
}

/** Compact "before → after" for list rows: e.g. 65 → 31 · Medium ↓34. */
export function PriorityBeforeAfter({ v }: { v: { cvss_score?: number | null; severity?: string; composite_priority?: number | null } }) {
  const { before, after, delta, baseFrom } = enrichmentPriority(v);
  if (after == null) return <PriorityCell priority={v.composite_priority ?? undefined} />;
  const b = priorityBucket(v.composite_priority ?? 0);
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap"
      title={`Before enrichment (${baseFrom} alone): ${before}/100  →  After (7-signal composite): ${after}/100`}>
      <span className="text-[11px] tabular-nums text-slate-400 line-through decoration-slate-300">{before}</span>
      <span className="text-slate-300">→</span>
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${b.tone}`}>{after} · {b.label}</span>
      {delta != null && <PriorityDelta delta={delta} />}
    </span>
  );
}

// ─── Owner initials avatar (cloned from governance / assets lib) ─────────────
export function initialsOf(name: string | null | undefined): string {
  if (!name) return '';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_TINTS = [
  'bg-blue-100 text-blue-700',
  'bg-emerald-100 text-emerald-700',
  'bg-violet-100 text-violet-700',
  'bg-amber-100 text-amber-700',
  'bg-cyan-100 text-cyan-700',
  'bg-rose-100 text-rose-700',
  'bg-primary-100 text-primary-700',
];

export function avatarTint(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}

export function InitialsAvatar({ name, size = 'md' }: { name: string | null | undefined; size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-7 w-7 text-xs';
  if (!name) {
    return (
      <span className={`inline-flex shrink-0 items-center justify-center rounded-full bg-slate-100 font-semibold text-slate-400 ${dim}`} title="Unassigned">
        ?
      </span>
    );
  }
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${avatarTint(name)} ${dim}`} title={name}>
      {initialsOf(name)}
    </span>
  );
}

/** Owner cell: avatar + name (or Unassigned). */
export function OwnerCell({ name, size = 'md' }: { name: string | null | undefined; size?: 'sm' | 'md' }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-700">
      <InitialsAvatar name={name} size={size} />
      <span className="truncate">{name || <span className="text-slate-400">Unassigned</span>}</span>
    </span>
  );
}

// ─── KEV / EPSS threat-intel chips ───────────────────────────────────────────
export function KevChip() {
  return (
    <span
      className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700"
      title="CISA Known Exploited Vulnerability — actively exploited in the wild"
    >
      KEV
    </span>
  );
}

export function EpssChip({ percentile, score }: { percentile?: number; score?: number }) {
  if (typeof percentile !== 'number') return null;
  return (
    <span
      className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
      title={`EPSS percentile — ${(percentile * 100).toFixed(0)}% of CVEs score lower. Probability ${(score ?? 0).toFixed(3)}.`}
    >
      {/* Labelled "EPSS pct" — this is the PERCENTILE, not the probability.
          Shown as bare "EPSS 37%" it read as a 37% chance of exploitation when
          the actual EPSS probability was 0.5%: a ~70x overstatement on the one
          number a triager scans a list by. The tooltip said "percentile"; the
          visible text did not, and nobody hovers every row. */}
      EPSS pct {(percentile * 100).toFixed(0)}%
    </span>
  );
}

/** Inline threat-intel chip row (KEV + EPSS), rendered only when present. */
export function ThreatChips({ vuln }: { vuln: Pick<Vulnerability, 'kev_flag' | 'epss_percentile' | 'epss_score'> }) {
  if (!vuln.kev_flag && typeof vuln.epss_percentile !== 'number') return null;
  return (
    <span className="inline-flex items-center gap-1">
      {vuln.kev_flag && <KevChip />}
      <EpssChip percentile={vuln.epss_percentile} score={vuln.epss_score} />
    </span>
  );
}

// ─── Vuln letter/id tile ─────────────────────────────────────────────────────
export function VulnIdTile({ id, size = 'md' }: { id: number; size?: 'sm' | 'md' | 'lg' }) {
  const dim =
    size === 'lg' ? 'h-10 w-10 text-[11px] rounded-[10px]'
    : size === 'sm' ? 'h-7 w-7 text-[9px] rounded-lg'
    : 'h-8 w-8 text-[10px] rounded-lg';
  return (
    <span className={`inline-flex shrink-0 flex-col items-center justify-center bg-slate-100 font-bold leading-none text-slate-500 ${dim}`}>
      <span className="text-[8px] font-semibold text-slate-400">VULN</span>
      <span>{id}</span>
    </span>
  );
}
