'use client';

/**
 * LifecycleBoard — Kanban "Board" view for the Governance Documents workspace (frame 1C).
 * Five columns follow the approval lifecycle (STAGE_ORDER); each holds the docs currently
 * sitting in that stage. Presentational only — no drag-and-drop, no data fetching (except
 * useFrameworkNames()). Terminal-status docs (expired/archived/exception) are omitted.
 */

import {
  type GovDoc,
  STAGE_ORDER,
  statusLabel,
  statusTone,
  TypePill,
  FrameworkPills,
  InitialsAvatar,
  ReviewStatus,
  verLabel,
  useFrameworkNames,
} from './lib';

export interface LifecycleBoardProps {
  docs: GovDoc[];
  onOpenDoc: (id: number) => void;
  loading?: boolean;
}

const COLUMN_DOT: Record<ReturnType<typeof statusTone>, string> = {
  draft: 'bg-slate-400',
  progress: 'bg-amber-500',
  pending: 'bg-amber-500',
  approved: 'bg-blue-500',
  published: 'bg-emerald-500',
  terminal: 'bg-slate-400',
};

function BoardCard({
  doc,
  nameMap,
  onOpenDoc,
}: {
  doc: GovDoc;
  nameMap: Record<string, string>;
  onOpenDoc: (id: number) => void;
}) {
  const descriptor = doc.doc_sub_type || doc.description || '';
  return (
    <button
      type="button"
      onClick={() => onOpenDoc(doc.id)}
      className="card w-full p-3 text-left hover:border-primary-300"
    >
      <div className="flex items-start justify-between gap-2">
        <TypePill docType={doc.doc_type} />
        <span className="truncate text-[11px] text-slate-400">
          {(doc.document_code || '—')} · {verLabel(doc.current_version)}
        </span>
      </div>

      <p className="mt-2 line-clamp-2 text-sm font-medium text-slate-900">{doc.title}</p>

      {descriptor && (
        <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{descriptor}</p>
      )}

      <div className="mt-2">
        <FrameworkPills ids={doc.framework_ids ?? []} nameMap={nameMap} max={3} />
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <InitialsAvatar name={doc.owner_name} size="sm" />
        <ReviewStatus date={doc.next_review_date} />
      </div>
    </button>
  );
}

export function LifecycleBoard({ docs, onOpenDoc, loading = false }: LifecycleBoardProps) {
  const nameMap = useFrameworkNames();
  const list = docs ?? [];

  const byStage = STAGE_ORDER.map((stage) => ({
    stage,
    items: list.filter((d) => d.status === stage),
  }));

  if (loading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-2">
        {STAGE_ORDER.map((stage) => (
          <div key={stage} className="w-72 shrink-0">
            <div className="mb-2 flex items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${COLUMN_DOT[statusTone(stage)]}`} />
              <span className="text-sm font-semibold text-slate-900">{statusLabel(stage)}</span>
            </div>
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="card h-28 animate-pulse bg-slate-50" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {byStage.map(({ stage, items }) => (
        <div key={stage} className="w-72 shrink-0">
          <div className="mb-2 flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${COLUMN_DOT[statusTone(stage)]}`} />
            <span className="text-sm font-semibold text-slate-900">{statusLabel(stage)}</span>
            <span className="text-sm text-slate-400">{items.length}</span>
          </div>

          <div className="space-y-2">
            {items.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-300">
                None
              </div>
            ) : (
              items.map((doc) => (
                <BoardCard key={doc.id} doc={doc} nameMap={nameMap} onOpenDoc={onOpenDoc} />
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
