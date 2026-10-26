'use client';

/**
 * A document's versions as the library shows them: under its row in the table and in the detail drawer. Read as the document page
 * reads them (its Change log: the change chain; where the chain is off, the version history), as a hierarchy: each major version
 * with its minor versions under it, newest major first (library.versionGroups); each opens the document on that version.
 */
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { governanceApi } from '@/lib/api';
import { documentChainApi } from '@/lib/documentChain';
import { day } from '@/lib/documentLifecycle';
import { problemOf } from '@/lib/studio/api';
import { type GovDoc, statusLabel, verLabel } from './lib';
import { versionGroups, versionStates, type VersionState } from './library';
import { retryUnlessRefused } from '../_view/docRoute';

/** px per level of the table's tree: the width of the arrow, and the gap between the arrow and the title */
export const STEP = 24;
export const GAP = 6;
// the version's size as the document's Versions view says it; the first one is the original
const SIZE: Record<string, string> = { major: 'Major', minor: 'Minor', patch: 'Patch' };

type VersionRow = { id: number; number: string; kind: string | null; at: string | null; by: string | null };

/** One version of a document: number, state, size, date and who made it; it opens the document on that version. Only the current
 *  version (the document's state) and the one in force carry a badge; an earlier version needs none (the user, 2026-10-21: every
 *  older row saying "Superseded" read as an error). */
function VersionLink({ doc, v, original }: { doc: GovDoc; v: VersionRow & { state: VersionState }; original: boolean }) {
  const earlier = v.state === 'superseded';
  const word = v.state === 'in-force' ? 'In force' : earlier ? null : statusLabel(doc.status);
  const inForce = v.state === 'in-force' || (v.state === 'current' && doc.status === 'published');
  // text-[#fff], not text-white: the library's governance-light repaints text-white grey
  const look = inForce ? 'border-[#0f766e] bg-[#0f766e] text-[#fff]' : 'border-[#9aa5b1] text-[#1f2933]';
  return (
    <Link
      href={`/governance/documents/${doc.id}?read=${v.id}`}
      className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md px-1.5 py-1 text-[12px] text-[#26323d] hover:bg-[#eef2f6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]"
    >
      <span className="font-semibold tabular-nums text-[#1f2933]">{verLabel(v.number)}</span>
      {word ? <span className={`rounded border px-1.5 text-[11px] font-medium leading-4 ${look}`}>{word}</span>
        : <span className="sr-only">earlier version</span>}
      {/* on a phone the table is wider than the screen: the rest of the line goes under the number, in view */}
      <span className="text-[11px] text-[#586472] max-sm:basis-full">{[original ? 'The original' : SIZE[v.kind ?? ''], day(v.at), v.by || 'Unknown'].filter(Boolean).join(' · ')}</span>
    </Link>
  );
}

/** Every version of a document, read as the document page reads them (its Change log: the change chain; where the chain is off, the
 *  version history), as a hierarchy: each major version with its minor versions under it, newest major first (library.versionGroups). */
export function Versions({ doc, depth = 0 }: { doc: GovDoc; depth?: number }) {
  const chain = useQuery({ queryKey: ['document-chain', doc.id], queryFn: () => documentChainApi.chain(doc.id), staleTime: 15_000, retry: retryUnlessRefused });
  const off = chain.data?.enabled === false;
  const history = useQuery({
    queryKey: ['document-versions', doc.id],
    enabled: off,
    retry: retryUnlessRefused,
    queryFn: async () => {                    // as the document page's version history reads it (same key, same shape)
      const d: any = (await governanceApi.getDocumentVersions(doc.id)).data;
      return (Array.isArray(d) ? d : d?.items || []) as any[];
    },
  });
  const rows: VersionRow[] = off
    ? (history.data ?? []).map((v) => ({ id: v.id, number: String(v.version_number), kind: v.change_type ?? null, at: v.created_at ?? null, by: v.creator_name ?? null }))
    : [...(chain.data?.versions ?? [])].reverse();
  const lines = versionStates(rows, doc);
  const failed = chain.error ?? history.error;
  const note = { paddingLeft: depth * STEP + STEP + GAP };

  if (chain.isPending || (off && history.isPending)) {
    return <p style={note} className="inline-flex items-center gap-1.5 text-[12px] text-[#586472]"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Reading the versions…</p>;
  }
  if (failed) return <p style={note} role="alert" className="text-[12px] text-[#9b1c1c]">{problemOf(failed, 'The versions could not be read.')}</p>;
  if (lines.length === 0) return <p style={note} className="text-[12px] text-[#586472]">No versions recorded yet.</p>;
  const original = lines[lines.length - 1].id;
  return (
    <ul aria-label={`Versions of ${doc.title}, newest major version first`} style={{ marginLeft: depth * STEP + STEP / 2 }} className="border-l border-[#d5dbe1] pl-2">
      {versionGroups(lines).map((g) => (
        <li key={g.head.id}>
          <VersionLink doc={doc} v={g.head} original={g.head.id === original} />
          {g.minors.length > 0 && (
            <ul aria-label={`Minor versions after ${verLabel(g.head.number)}, newest first`} className="ml-3 border-l border-[#e1e6eb] pl-2">
              {g.minors.map((v) => <li key={v.id}><VersionLink doc={doc} v={v} original={v.id === original} /></li>)}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
