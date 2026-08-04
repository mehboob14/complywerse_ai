'use client';

// 360° auto-mapped linkage for a policy statement: controls grouped by universe
// (normalized / framework / parsed / internal) + evidence count. Sourced from
// the saved StatementControlMapping rows the AI auto-mapper writes after parsing
// — no LLM call here, just display.

import { useQuery } from '@tanstack/react-query';
import { complianceApi } from '@/lib/api';
import { Loader2, Layers, Shield, FileText, Building2, Sparkles, GitBranch } from 'lucide-react';

interface CtrlLink {
  id: number;
  control_kind: string;
  control_code?: string | null;
  control_title?: string | null;
  framework_name?: string | null;
  domain?: string | null;
  confidence?: number | null;
  coverage_type?: string | null;
  rationale?: string | null;
  link_source?: string | null;
}
interface Linkage {
  statement_id: number;
  ai_suggested_controls: string[];
  controls: Record<string, CtrlLink[]>;
  evidence: Array<{ id: number; name?: string | null }>;
  counts: Record<string, number>;
}

const KIND_ORDER = ['normalized', 'framework', 'parsed', 'internal'] as const;
const KIND_META: Record<string, { label: string; icon: typeof Layers; tint: string }> = {
  normalized: { label: 'Normalized Controls', icon: Layers, tint: 'bg-violet-50 text-violet-700 border-violet-200' },
  framework: { label: 'Framework Controls', icon: Shield, tint: 'bg-blue-50 text-blue-700 border-blue-200' },
  parsed: { label: 'Framework Requirements', icon: FileText, tint: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  internal: { label: 'Internal Controls', icon: Building2, tint: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};

export default function StatementLinkagePanel({ statementId }: { statementId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['statement-linkage', statementId],
    queryFn: async () => (await complianceApi.statements.getLinkage(statementId)).data as Linkage,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading linkage…
      </div>
    );
  }

  const counts = data?.counts || {};
  const totalCtrls = (counts.normalized || 0) + (counts.framework || 0) + (counts.parsed || 0) + (counts.internal || 0);

  return (
    <div>
      <label className="mb-2 flex flex-wrap items-center gap-2 text-sm font-medium text-gray-700">
        <Sparkles className="h-4 w-4 text-indigo-600" /> Auto-mapped Controls &amp; Evidence (360°)
        {totalCtrls > 0 && (
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
            {totalCtrls} controls · {counts.evidence || 0} evidence
          </span>
        )}
      </label>

      {totalCtrls === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 text-xs text-gray-500">
          No control linkage yet. Auto-mapping runs automatically after the source document is parsed.
        </p>
      ) : (
        <div className="space-y-3">
          {KIND_ORDER.map((kind) => {
            const items = data?.controls?.[kind] || [];
            if (!items.length) return null;
            const meta = KIND_META[kind];
            const Icon = meta.icon;
            return (
              <div key={kind}>
                <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  <Icon className="h-3.5 w-3.5" /> {meta.label} <span className="text-gray-400">({items.length})</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {items.map((c) => (
                    <div
                      key={c.id}
                      title={c.rationale || (c.link_source === 'derived' ? 'Linked via control-to-control mapping' : '')}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${meta.tint}`}
                    >
                      <span className="font-semibold">{c.control_code || '—'}</span>
                      {c.control_title && <span className="max-w-[200px] truncate opacity-90">{c.control_title}</span>}
                      {c.framework_name && <span className="text-[10px] opacity-70">· {c.framework_name}</span>}
                      {typeof c.confidence === 'number' && c.link_source === 'ai' && (
                        <span className="rounded bg-white/70 px-1 text-[10px] font-medium">{Math.round(c.confidence * 100)}%</span>
                      )}
                      {c.link_source === 'derived' && <GitBranch className="h-3 w-3 opacity-60" />}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          <p className="text-[10px] text-gray-400">
            <span className="font-medium">%</span> = AI confidence for direct matches · <GitBranch className="inline h-3 w-3" /> = derived via existing control mappings. Linked evidence is auto-attached and shown above.
          </p>
        </div>
      )}
    </div>
  );
}
