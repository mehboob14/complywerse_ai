'use client';

/**
 * A document's versions as the library shows them: under its row in the table and in the details panel. Read as the document page
 * reads them (its Change log: the change chain; where the chain is off, the version history), as a hierarchy: each major version
 * with its minor versions under it, newest major first (library.versionGroups); each opens the document on that version.
 * Written on the design-system tokens, 12px at the least; the date is "12 Nov 2026".
 */
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { withFrom } from '@/components/shell/withFrom';
import { governanceApi } from '@/lib/api';
import { documentChainApi } from '@/lib/documentChain';
import { formatDate } from '@/lib/format';
import { problemOf } from '@/lib/studio/api';
import { type GovDoc, statusLabel, verLabel } from './lib';
import { versionGroups, versionStates, type VersionState } from './library';
import { retryUnlessRefused } from '../_view/docRoute';
import { useHere } from './useHere';

/** px per level of the table's tree: the width of the arrow, and the gap between the arrow and the title */
export const STEP = 24;
export const GAP = 6;
// the version's size as the document's Versions view says it; the first one is the original
const SIZE: Record<string, string> = { major: 'Major', minor: 'Minor', patch: 'Patch' };

type VersionRow = { id: number; number: string; kind: string | null; at: string | null; by: string | null };

/** One version of a document: number, state, size, date and who made it; it opens the document on that version. Only the current
 *  version (the document's state) and the one in force carry a badge; an earlier version needs none (the user, 2026-10-21: every
 *  older row saying "Superseded" read as an error). */
function VersionLink({ doc, v, original, here }: { doc: GovDoc; v: VersionRow & { state: VersionState }; original: boolean; here: string }) {
  const earlier = v.state === 'superseded';
  const word = v.state === 'in-force' ? 'Published' : earlier ? null : statusLabel(doc.status);
  const inForce = v.state === 'in-force' || (v.state === 'current' && doc.status === 'published');
  const look = inForce ? 'border-ds-primary bg-ds-primary text-ds-on-primary' : 'border-ds-border-control text-ds-fg';
  return (
    <Link
      href={withFrom(`/governance/documents/${doc.id}?read=${v.id}`, here)}
      className="flex min-h-ds-control flex-wrap items-center gap-x-2 gap-y-[2px] rounded-ds-control px-[6px] py-[2px] text-ds-label text-ds-fg-body hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring"
    >
      <span className="text-ds-body font-[600] tabular-nums text-ds-fg">{verLabel(v.number)}</span>
      {word ? <span className={`rounded-ds-control border px-[6px] text-ds-label ${look}`}>{word}</span>
        : <span className="sr-only">earlier version</span>}
      {/* on a phone the table is wider than the screen: the rest of the line goes under the number, in view */}
      <span className="text-ds-label text-ds-fg-muted max-sm:basis-full">{[original ? 'The original' : SIZE[v.kind ?? ''], formatDate(v.at, { empty: '' }), v.by || 'Unknown'].filter(Boolean).join(' · ')}</span>
    </Link>
  );
}

/** Every version of a document, read as the document page reads them (its Change log: the change chain; where the chain is off, the
 *  version history), as a hierarchy: each major version with its minor versions under it, newest major first (library.versionGroups). */
export function Versions({ doc, depth = 0 }: { doc: GovDoc; depth?: number }) {
  const here = useHere();            // a version opens the document on it: the way back is this page as it is
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
    return <p style={note} role="status" className="inline-flex items-center gap-1.5 text-ds-label text-ds-fg-muted"><Loader2 className="h-[16px] w-[16px] animate-spin motion-reduce:animate-none" aria-hidden /> Reading the versions…</p>;
  }
  if (failed) return <p style={note} role="alert" className="text-ds-label text-ds-danger">{problemOf(failed, 'The versions could not be read.')}</p>;
  if (lines.length === 0) return <p style={note} className="text-ds-label text-ds-fg-muted">No versions recorded yet.</p>;
  const original = lines[lines.length - 1].id;
  return (
    <ul aria-label={`Versions of ${doc.title}, newest major version first`} style={{ marginLeft: depth * STEP + STEP / 2 }} className="border-l border-ds-border-strong pl-2">
      {versionGroups(lines).map((g) => (
        <li key={g.head.id}>
          <VersionLink doc={doc} v={g.head} original={g.head.id === original} here={here} />
          {g.minors.length > 0 && (
            <ul aria-label={`Minor versions after ${verLabel(g.head.number)}, newest first`} className="ml-3 border-l border-ds-border pl-2">
              {g.minors.map((v) => <li key={v.id}><VersionLink doc={doc} v={v} original={v.id === original} here={here} /></li>)}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
