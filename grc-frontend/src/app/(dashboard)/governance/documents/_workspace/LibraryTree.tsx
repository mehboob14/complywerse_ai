'use client';

/**
 * LibraryTree — LEFT sidebar of the governance documents workspace.
 * Section 1: LIBRARY quick-filters (All / Recently updated / My documents).
 * Section 2: BY HIERARCHY — recursive, expandable tree of the policy hierarchy.
 * Presentational: selection + active-library state are owned by the shell.
 */

import { useEffect, useMemo, useState } from 'react';
import { FileText, Clock, User, ChevronRight, ChevronDown } from 'lucide-react';
import { DocTypeTile } from './lib';
import type { GovDocNode } from './lib';
import type { DashboardSummary } from './api';

export interface LibraryTreeProps {
  summary?: DashboardSummary;
  hierarchy: GovDocNode[];
  myDocsCount: number;
  activeLibrary: 'all' | 'recent' | 'mine';
  onSelectLibrary: (key: 'all' | 'recent' | 'mine') => void;
  selectedNodeId: number | null;
  onSelectNode: (id: number | null) => void;
  loading?: boolean;
}

function LibraryRow({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center justify-between px-3 py-2 text-sm rounded-md ${
        active ? 'bg-primary-50 text-primary-700 font-medium' : 'text-slate-700 hover:bg-slate-50'
      }`}
    >
      <span className="inline-flex items-center gap-2 truncate">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      {count != null && <span className="text-xs text-slate-400 tabular-nums">{count}</span>}
    </button>
  );
}

function TreeNode({
  node,
  depth,
  expanded,
  toggle,
  selectedNodeId,
  onSelectNode,
}: {
  node: GovDocNode;
  depth: number;
  expanded: Set<number>;
  toggle: (id: number) => void;
  selectedNodeId: number | null;
  onSelectNode: (id: number | null) => void;
}) {
  const children = node.children ?? [];
  const hasChildren = children.length > 0;
  const isOpen = expanded.has(node.id);
  const isSelected = selectedNodeId === node.id;

  return (
    <div>
      <button
        type="button"
        onClick={() => onSelectNode(node.id)}
        style={{ paddingLeft: 8 + depth * 14 }}
        className={`group w-full flex items-center gap-1.5 pr-2 py-1.5 rounded-md text-sm ${
          isSelected ? 'bg-primary-50 text-primary-700 font-medium' : 'text-slate-700 hover:bg-slate-50'
        }`}
      >
        <span
          role={hasChildren ? 'button' : undefined}
          onClick={
            hasChildren
              ? (e) => {
                  e.stopPropagation();
                  toggle(node.id);
                }
              : undefined
          }
          className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded ${
            hasChildren ? 'text-slate-400 hover:text-slate-600 hover:bg-slate-100' : ''
          }`}
        >
          {hasChildren &&
            (isOpen ? <ChevronDown className="h-4 w-4" strokeWidth={1.75} /> : <ChevronRight className="h-4 w-4" strokeWidth={1.75} />)}
        </span>
        <DocTypeTile docType={node.doc_type} size="sm" />
        <span className="min-w-0 flex-1 truncate text-left">{node.title}</span>
        {hasChildren && <span className="shrink-0 text-xs text-slate-400 tabular-nums">{children.length}</span>}
      </button>
      {hasChildren && isOpen && (
        <div>
          {children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              toggle={toggle}
              selectedNodeId={selectedNodeId}
              onSelectNode={onSelectNode}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function LibraryTree({
  summary,
  hierarchy,
  myDocsCount,
  activeLibrary,
  onSelectLibrary,
  selectedNodeId,
  onSelectNode,
  loading = false,
}: LibraryTreeProps) {
  const roots = hierarchy ?? [];
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [didAutoExpand, setDidAutoExpand] = useState(false);

  // Auto-expand roots once, on first load of hierarchy data.
  useEffect(() => {
    if (didAutoExpand || roots.length === 0) return;
    setExpanded(new Set(roots.map((r) => r.id)));
    setDidAutoExpand(true);
  }, [roots, didAutoExpand]);

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const totalDocs = summary?.total_documents ?? 0;
  const treeSelected = selectedNodeId != null;
  const allActive = activeLibrary === 'all' && !treeSelected;

  const hasHierarchy = useMemo(() => roots.length > 0, [roots]);

  return (
    <div className="card p-0 overflow-hidden">
      {/* Section 1 — LIBRARY */}
      <div className="px-3 pt-3 pb-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Library</span>
      </div>
      <div className="px-2 pb-2 space-y-0.5">
        <LibraryRow
          icon={<FileText className="h-4 w-4" strokeWidth={1.75} />}
          label="All documents"
          count={totalDocs}
          active={allActive}
          onClick={() => {
            onSelectNode(null);
            onSelectLibrary('all');
          }}
        />
        <LibraryRow
          icon={<Clock className="h-4 w-4" strokeWidth={1.75} />}
          label="Recently updated"
          active={activeLibrary === 'recent' && !treeSelected}
          onClick={() => {
            onSelectNode(null);
            onSelectLibrary('recent');
          }}
        />
        <LibraryRow
          icon={<User className="h-4 w-4" strokeWidth={1.75} />}
          label="My documents"
          count={myDocsCount}
          active={activeLibrary === 'mine' && !treeSelected}
          onClick={() => {
            onSelectNode(null);
            onSelectLibrary('mine');
          }}
        />
      </div>

      <div className="border-t border-slate-200" />

      {/* Section 2 — BY HIERARCHY */}
      <div className="px-3 pt-3 pb-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">By Hierarchy</span>
      </div>
      <div className="max-h-[70vh] overflow-y-auto scrollbar-thin p-2">
        {loading && !hasHierarchy ? (
          <div className="space-y-1.5 px-1 py-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-7 animate-pulse rounded-md bg-slate-100" />
            ))}
          </div>
        ) : !hasHierarchy ? (
          <p className="px-2 py-6 text-center text-sm text-slate-400">No documents yet.</p>
        ) : (
          <div className="space-y-0.5">
            {roots.map((node) => (
              <TreeNode
                key={node.id}
                node={node}
                depth={0}
                expanded={expanded}
                toggle={toggle}
                selectedNodeId={selectedNodeId}
                onSelectNode={onSelectNode}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
