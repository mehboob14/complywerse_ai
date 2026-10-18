'use client';

/**
 * LibraryTree — LEFT sidebar of the governance documents workspace.
 * Section 1: LIBRARY quick-filters (All / Recently updated / My documents / Archived).
 * Section 2: BY HIERARCHY — recursive, expandable tree of the policy hierarchy; under each document its versions, base first
 * to the newest, each with who made it and why (a link to that version in the document's Versions view).
 * Presentational: selection + active-library state are owned by the shell.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { FileText, Clock, User, ChevronRight, ChevronDown, Archive } from 'lucide-react';
import { parseUtc } from '@/lib/serverTime';
import { DocTypeTile, inForceNote, verLabel } from './lib';
import type { GovDocNode, TreeVersion } from './lib';
import type { DashboardSummary } from './api';

export interface LibraryTreeProps {
  summary?: DashboardSummary;
  hierarchy: GovDocNode[];
  myDocsCount: number;
  /** All documents and Archived counts (archived documents count only there); All falls back to the summary's total */
  allCount?: number;
  archivedCount?: number;
  activeLibrary: 'all' | 'recent' | 'mine' | 'archived';
  onSelectLibrary: (key: 'all' | 'recent' | 'mine' | 'archived') => void;
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

/** What kind of version it is, as a small pill: the first one is the base. */
function versionKind(v: TreeVersion, isBase: boolean): string {
  if (isBase) return 'Base';
  if ((v.summary || '').toLowerCase().startsWith('rollback to')) return 'Restored';
  if ((v.summary || '').toLowerCase().startsWith('took back')) return 'Taken back';     // its kind is now major or minor by the rule
  const kind = (v.kind || '').toLowerCase();
  if (kind === 'major') return 'Major';
  if (kind === 'signoff') return 'Sign-off';
  if (kind === 'revert') return 'Taken back';
  return 'Minor';
}

function shortDate(at: string | null): string {
  const d = parseUtc(at);
  if (!d) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: '2-digit' });
}

function VersionRow({ docId, v, isBase }: { docId: number; v: TreeVersion; isBase: boolean }) {
  const why = v.reason || v.summary;
  const line = [v.by, why].filter(Boolean).join(' · ');
  return (
    <li className="relative text-[12px] text-[#26323d]">
      <span aria-hidden className={`absolute -left-[4.5px] top-[9px] h-2 w-2 rounded-full border border-white ${v.current ? 'bg-[#0f766e]' : 'bg-[#b8c4c8]'}`} />
      <Link href={`/governance/documents/${docId}?tab=versions&version=${v.id}`} title={line ? `${verLabel(v.number)} · ${line}` : verLabel(v.number)}
        className="ml-2 block rounded-md px-1.5 py-1 hover:bg-[#f3f6f8]">
        <span className="flex items-center gap-1.5">
          <span className="text-[12px] font-semibold tabular-nums text-[#1f2933]">{verLabel(v.number)}</span>
          <span className="rounded border border-[#d5dbe1] px-1 text-[10px] font-medium leading-4 text-[#586472]">{versionKind(v, isBase)}</span>
          {v.current && <span className="rounded bg-[#0f766e] px-1 text-[10px] font-semibold leading-4 text-white">Current</span>}
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-[#586472]">{shortDate(v.at)}</span>
        </span>
        {line && <span className="block truncate text-[11px] text-[#586472]">{line}</span>}
      </Link>
    </li>
  );
}

function TreeNode({
  node,
  depth,
  expanded,
  toggle,
  versionsOpen,
  toggleVersions,
  selectedNodeId,
  onSelectNode,
}: {
  node: GovDocNode;
  depth: number;
  expanded: Set<number>;
  toggle: (id: number) => void;
  versionsOpen: Set<number>;
  toggleVersions: (id: number) => void;
  selectedNodeId: number | null;
  onSelectNode: (id: number | null) => void;
}) {
  const children = node.children ?? [];
  const hasChildren = children.length > 0;
  const isOpen = expanded.has(node.id);
  const isSelected = selectedNodeId === node.id;
  const versions = node.versions ?? [];
  const versionCount = node.version_count ?? versions.length;
  const hidden = versionCount - versions.length;          // the tree gets the base and the newest five
  const showVersions = versions.length > 0 && versionsOpen.has(node.id);
  const listId = `tree-versions-${node.id}`;
  const more = hidden > 0 && (
    <li className="text-[11px] text-[#586472]">
      <Link href={`/governance/documents/${node.id}?tab=versions`} className="ml-2 block rounded-md px-1.5 py-1 font-medium text-[#0f766e] hover:bg-[#f3f6f8] hover:text-[#0b5f58]">
        {hidden} more…
      </Link>
    </li>
  );

  return (
    <div>
      <div
        style={{ paddingLeft: 8 + depth * 14 }}
        className={`group flex items-center gap-1 pr-1 rounded-md text-sm ${
          isSelected ? 'bg-primary-50 text-primary-700 font-medium' : 'text-slate-700 hover:bg-slate-50'
        }`}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => toggle(node.id)}
            aria-expanded={isOpen}
            aria-label={`${isOpen ? 'Hide' : 'Show'} the documents under ${node.title}`}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            {isOpen ? <ChevronDown className="h-4 w-4" strokeWidth={1.75} /> : <ChevronRight className="h-4 w-4" strokeWidth={1.75} />}
          </button>
        ) : (
          <span aria-hidden className="h-5 w-5 shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onSelectNode(node.id)}
          aria-current={isSelected ? 'true' : undefined}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left"
        >
          <DocTypeTile docType={node.doc_type} size="sm" />
          <span className="min-w-0 flex-1 truncate text-left">{node.title}</span>
          {hasChildren && <span className="shrink-0 text-xs text-slate-400 tabular-nums">{children.length}</span>}
        </button>
        {inForceNote(node) && <span className="shrink-0 px-1 text-[11px] tabular-nums text-[#586472]">{inForceNote(node)}</span>}
        {versions.length > 0 ? (
          <button
            type="button"
            onClick={() => toggleVersions(node.id)}
            aria-expanded={showVersions}
            aria-controls={listId}
            title={`${showVersions ? 'Hide' : 'Show'} the versions of ${node.title}`}
            className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[11px] font-medium text-[#586472] hover:bg-[#eef2f6] hover:text-[#1f2933]"
          >
            {versionCount} {versionCount === 1 ? 'version' : 'versions'}
            <ChevronDown className={`h-3 w-3 transition-transform ${showVersions ? 'rotate-180' : ''}`} strokeWidth={2} aria-hidden />
          </button>
        ) : (
          <span className="shrink-0 px-1 text-[11px] tabular-nums text-[#586472]">{verLabel(node.current_version)}</span>
        )}
      </div>
      {versions.length > 0 && (
        <ul id={listId} hidden={!showVersions} aria-label={`Versions of ${node.title}`} style={{ marginLeft: 8 + depth * 14 + 10 }}
          className="my-0.5 border-l border-[#d5dbe1] pr-1">
          <VersionRow docId={node.id} v={versions[0]} isBase />
          {more}
          {versions.slice(1).map((v) => <VersionRow key={v.id} docId={node.id} v={v} isBase={false} />)}
        </ul>
      )}
      {hasChildren && isOpen && (
        <div>
          {children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              toggle={toggle}
              versionsOpen={versionsOpen}
              toggleVersions={toggleVersions}
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
  allCount,
  archivedCount,
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

  // a document's versions open on their own toggle: the roots opening at first load does not open every list of versions
  const [versionsOpen, setVersionsOpen] = useState<Set<number>>(new Set());
  const flip = (set: typeof setExpanded) => (id: number) =>
    set((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggle = flip(setExpanded);
  const toggleVersions = flip(setVersionsOpen);

  const totalDocs = allCount ?? summary?.total_documents ?? 0;
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
        <LibraryRow
          icon={<Archive className="h-4 w-4" strokeWidth={1.75} />}
          label="Archived"
          count={archivedCount}
          active={activeLibrary === 'archived' && !treeSelected}
          onClick={() => {
            onSelectNode(null);
            onSelectLibrary('archived');
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
                versionsOpen={versionsOpen}
                toggleVersions={toggleVersions}
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
