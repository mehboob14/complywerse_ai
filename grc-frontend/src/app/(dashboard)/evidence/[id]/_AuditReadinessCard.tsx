'use client';

/**
 * Audit-readiness card for the evidence detail page. Surfaces the AI
 * audit-readiness score as a READY bar plus a short line, and lists the
 * clauses this evidence satisfies for audit (coverage_type full | partial).
 *
 * Presentational only — reuses normPct from the workspace lib. Charter:
 * single teal brand (primary-*), emerald/amber semantic tints for coverage,
 * hairline borders, no gradients, lucide strokeWidth 1.75.
 */

import { ShieldCheck } from 'lucide-react';
import { normPct } from '../_workspace/lib';

export interface AuditClauseMapping {
  framework_name: string;
  control_id: string;
  control_title: string;
  coverage_type: string;
}

export default function AuditReadinessCard({
  auditReadiness,
  summary,
  clauseMappings,
}: {
  auditReadiness: number | null | undefined;
  summary: string | null | undefined;
  clauseMappings: AuditClauseMapping[] | undefined;
}) {
  const pct = normPct(auditReadiness ?? null);
  const satisfies = (clauseMappings || []).filter((c) => {
    const t = (c.coverage_type || '').toLowerCase();
    return t === 'full' || t === 'partial';
  });

  const readyLine =
    pct == null
      ? 'Run the AI assessment to gauge how audit-ready this evidence is.'
      : pct >= 80
      ? 'This evidence is well positioned to stand up in an audit.'
      : pct >= 50
      ? 'This evidence partially supports audit needs — address the gaps to strengthen it.'
      : 'This evidence needs work before it will hold up in an audit.';

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <ShieldCheck className="h-4 w-4 text-primary-600" strokeWidth={1.75} />
          Audit readiness
        </h3>
        <span className="text-2xl font-bold text-slate-800">{pct == null ? '—' : `${pct}%`}</span>
      </div>

      <div className="mt-2">
        <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-slate-400">
          <span>Ready</span>
        </div>
        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-2 rounded-full bg-primary-500" style={{ width: `${pct ?? 0}%` }} />
        </div>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-slate-500">{summary?.trim() || readyLine}</p>

      <div className="mt-4 border-t border-slate-100 pt-3">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
          Satisfies for audit ({satisfies.length})
        </p>
        {satisfies.length > 0 ? (
          <ul className="space-y-1.5">
            {satisfies.map((c, i) => {
              const full = (c.coverage_type || '').toLowerCase() === 'full';
              return (
                <li
                  key={`${c.framework_name}:${c.control_id}:${i}`}
                  className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-slate-700">{c.framework_name}</span>
                      <span className="text-xs text-slate-400">·</span>
                      <span className="font-mono text-[11px] text-slate-500">{c.control_id}</span>
                    </div>
                    {c.control_title && (
                      <p className="mt-0.5 truncate text-xs text-slate-500">{c.control_title}</p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${
                      full ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                    }`}
                  >
                    {full ? 'Full' : 'Partial'}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-xs text-slate-400">
            No clauses are fully or partially satisfied yet — link controls or re-run the assessment.
          </p>
        )}
      </div>
    </div>
  );
}
