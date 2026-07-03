'use client';

/**
 * WorkspaceList — the CENTER "Tree" pane of the Governance Documents workspace.
 * Presentational master list: a breadcrumb + selected-node header, a segmented
 * doc-type filter row (local state), and a dense clickable document list.
 *
 * Data (rows, header, breadcrumb) is owned by the shell and passed via props;
 * only framework-name resolution is fetched internally via useFrameworkNames().
 *
 * Design charter: single teal brand (primary-*), category tints only as
 * doc-type/framework/status markers, no gradients, hairline borders.
 */

import { useMemo, useState } from 'react';
import { FileText, ChevronRight } from 'lucide-react';
import {
  GovDoc,
  DocTypeTile,
  StatusDot,
  ReviewStatus,
  FrameworkPills,
  useFrameworkNames,
  docTypeStyle,
  verLabel,
} from './lib';
import { PageLoader } from '@/components/ui';

export interface WorkspaceListProps {
  docs: GovDoc[]; // rows to show (already filtered by shell to the selected node+descendants and toolbar filters)
  headerDoc: GovDoc | null; // the selected tree node for the header block; null => 'All documents'
  breadcrumb: string[]; // e.g. ['Policies','Information Security Policy']
  onOpenDoc: (id: number) => void;
  loading?: boolean;
}

type TypeFilter = 'all' | 'policy' | 'standard' | 'procedure';

const FILTER_CHIPS: { key: TypeFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'policy', label: 'Policies' },
  { key: 'standard', label: 'Standards' },
  { key: 'procedure', label: 'Procedures' },
];

export function WorkspaceList({
  docs,
  headerDoc,
  breadcrumb,
  onOpenDoc,
  loading = false,
}: WorkspaceListProps) {
  const nameMap = useFrameworkNames();
  const [filter, setFilter] = useState<TypeFilter>('all');

  const rows = docs ?? [];

  // Segmented-chip counts by doc_type.
  const counts = useMemo(() => {
    const c: Record<TypeFilter, number> = { all: rows.length, policy: 0, standard: 0, procedure: 0 };
    for (const d of rows) {
      if (d.doc_type === 'policy') c.policy += 1;
      else if (d.doc_type === 'standard') c.standard += 1;
      else if (d.doc_type === 'procedure') c.procedure += 1;
    }
    return c;
  }, [rows]);

  const visible = useMemo(
    () => (filter === 'all' ? rows : rows.filter((d) => d.doc_type === filter)),
    [rows, filter],
  );

  const segs = breadcrumb ?? [];

  return (
    <div className="card p-0">
      {/* 1) Breadcrumb */}
      <div className="flex items-center gap-2 px-5 pt-4 text-sm text-slate-500">
        {segs.length === 0 ? (
          <span className="font-medium text-slate-800">All documents</span>
        ) : (
          segs.map((seg, i) => {
            const last = i === segs.length - 1;
            return (
              <span key={`${seg}-${i}`} className="flex items-center gap-2">
                {i > 0 && <span className="text-slate-300">/</span>}
                <span className={last ? 'font-medium text-slate-800' : ''}>{seg}</span>
              </span>
            );
          })
        )}
      </div>

      {/* 2) Header */}
      <div className="px-5 pt-2 pb-4">
        {headerDoc ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-semibold text-slate-900">{headerDoc.title}</h2>
              <StatusDot status={headerDoc.status} />
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {[
                headerDoc.document_code || null,
                docTypeStyle(headerDoc.doc_type).label,
                verLabel(headerDoc.current_version),
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {headerDoc.description && (
              <p className="mt-2 text-sm text-slate-600">{headerDoc.description}</p>
            )}
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-slate-900">All documents</h2>
            <p className="mt-1 text-sm text-slate-500">
              Policies, standards &amp; procedures across their full lifecycle.
            </p>
          </>
        )}
      </div>

      {/* 3) Filter chips */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
        {FILTER_CHIPS.map((chip) => {
          const active = filter === chip.key;
          return (
            <button
              key={chip.key}
              type="button"
              onClick={() => setFilter(chip.key)}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                active
                  ? 'border-primary-200 bg-primary-50 text-primary-700'
                  : 'border-transparent text-slate-600 hover:bg-slate-50'
              }`}
            >
              {chip.label} {counts[chip.key]}
            </button>
          );
        })}
        <span className="ml-auto text-xs text-slate-400">Sorted by review date</span>
      </div>

      {/* 4) Document list */}
      {loading ? (
        <div className="py-16">
          <PageLoader />
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-slate-400">
          <FileText className="h-8 w-8" strokeWidth={1.75} />
          <span className="text-sm">No documents</span>
        </div>
      ) : (
        <ul>
          {visible.map((doc) => (
            <li key={doc.id}>
              <button
                type="button"
                onClick={() => onOpenDoc(doc.id)}
                className="flex w-full items-center gap-4 border-b border-slate-100 px-5 py-3 text-left hover:bg-slate-50"
              >
                <DocTypeTile docType={doc.doc_type} size="md" />

                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-slate-900">{doc.title}</span>
                  <span className="truncate text-xs text-slate-500">
                    {[
                      doc.document_code || null,
                      docTypeStyle(doc.doc_type).label,
                      verLabel(doc.current_version),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>

                <span className="hidden w-32 shrink-0 sm:flex">
                  <StatusDot status={doc.status} />
                </span>

                <span className="hidden w-40 shrink-0 md:flex">
                  <FrameworkPills
                    ids={doc.applicable_framework_ids ?? doc.framework_ids ?? []}
                    nameMap={nameMap}
                  />
                </span>

                <span className="hidden w-28 shrink-0 justify-end sm:flex">
                  <ReviewStatus date={doc.next_review_date} />
                </span>

                <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" strokeWidth={1.75} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
