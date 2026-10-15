'use client';

// The document with its changes marked: what changed since an earlier version (the one before this one by default), who made each
// change and on whose request, and a way to take a change back (a new version; an approved document goes back to review).
// Backend: governance/change_chain.py. Shown in the Document Viewer when the organisation has the document life cycle.
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitCompare, Loader2 } from 'lucide-react';
import { documentChainApi, type ChainHunk } from '@/lib/documentChain';
import { problemOf } from '@/lib/studio/api';
import { useToast } from '@/components/ui/ToastProvider';
import RedlineView, { StatsLine } from '../studio/_components/RedlineView';
import { dateTime } from '@/lib/documentLifecycle';

export default function TrackedChanges({ documentId, status, initial, onChanged }: {
  documentId: number;
  /** the document's status: an approved or published document goes back to review when a change is taken back */
  status: string;
  /** start from this version (and show the changes up to `to`, a version, instead of up to the document as it is now) */
  initial?: { from: number; to?: number | null } | null;
  onChanged?: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [from, setFrom] = useState<number | null>(initial?.from ?? null);
  const [to, setTo] = useState<number | null>(initial?.to ?? null);
  const [asking, setAsking] = useState<ChainHunk | null>(null);
  const [reason, setReason] = useState('');

  const chain = useQuery({ queryKey: ['document-chain', documentId], queryFn: () => documentChainApi.chain(documentId), staleTime: 15_000 });
  const versions = useMemo(() => chain.data?.versions ?? [], [chain.data]);
  // the version before the current one is what a reviewer wants to see against, unless they asked for another
  const fallback = versions.length >= 2 ? versions[versions.length - 2].id : versions[0]?.id ?? null;
  const baseline = from ?? fallback;
  useEffect(() => { if (initial?.from) { setFrom(initial.from); setTo(initial.to ?? null); } }, [initial?.from, initial?.to]);

  const redline = useQuery({
    queryKey: ['document-chain-redline', documentId, baseline, to],
    queryFn: () => documentChainApi.redline(documentId, baseline as number, to),
    enabled: baseline != null,
    staleTime: 10_000,
  });

  const takeBack = useMutation({
    mutationFn: async () => documentChainApi.revert(documentId, {
      from_version_id: baseline as number, hunks: [asking!.current_id ?? asking!.id], hash: redline.data?.current_hash ?? redline.data?.hash, reason: reason.trim() || undefined,
    }),
    onSuccess: (r) => {
      setAsking(null);
      setReason('');
      for (const key of ['document-chain', 'document-chain-redline', 'document-versions', 'governance-document', 'document-lifecycle']) qc.invalidateQueries({ queryKey: [key] });
      onChanged?.();
      toast({ type: r.notes?.length ? 'warning' : 'success', title: 'Change taken back',
        message: `Saved as version ${r.version}.${r.status === 'pending_review' ? ' The document goes back to review.' : ''}${r.notes?.length ? ` ${r.notes.join(' ')}` : ''}` });
    },
    onError: (e) => {
      qc.invalidateQueries({ queryKey: ['document-chain-redline', documentId] });
      toast({ type: 'error', title: 'That change could not be taken back', message: problemOf(e) });
    },
  });

  if (chain.isLoading) return <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary-400" /></div>;
  if (versions.length === 0) return <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">This document has no earlier version to compare with yet. Once it is edited, its changes are shown here.</p>;
  const data = redline.data;
  const resets = status === 'approved' || status === 'published' || status === 'exception_applied';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <label className="flex items-center gap-2 text-slate-700">
          <span className="font-medium">Compared with</span>
          <select value={baseline ?? ''} onChange={(e) => { setFrom(Number(e.target.value)); setTo(null); }} aria-label="Version to compare with"
            className="max-w-[22rem] rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900">
            {[...versions].reverse().map((v, i) => (
              <option key={v.id} value={v.id} disabled={i === 0 && to == null}>
                v{v.number} · {v.by} · {dateTime(v.at)} · {v.stage_label}{i === 0 ? ' (the current one)' : i === versions.length - 1 ? ' (the original)' : ''}
              </option>
            ))}
          </select>
        </label>
        {to != null && data?.to && (
          <span className="inline-flex items-center gap-2 rounded-full bg-primary-50 px-2.5 py-0.5 text-xs text-primary-800">
            What v{data.to.number} changed
            <button type="button" onClick={() => setTo(null)} className="font-semibold underline">Show everything since v{data.from.number}</button>
          </span>
        )}
        <span className="text-xs text-slate-600">{data ? <StatsLine stats={data.stats} /> : null}</span>
        <span className="text-xs text-slate-500">Green was added, red was removed. Each change says who made it and why.</span>
      </div>

      {asking && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alertdialog" aria-label="Take back this change">
          <p className="font-semibold">Take back the change in “{asking.section || 'the top of the document'}”?</p>
          <p className="mt-0.5 text-xs">
            It becomes a new version made by you; the text goes back to what version {redline.data?.from.number} had. Nothing else changes.
            {resets ? ' This document is approved, so it goes back to review.' : ''}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why (recorded in the document's history)"
              className="min-w-[14rem] flex-1 rounded-md border border-amber-300 bg-white px-2 py-1.5 text-sm text-slate-900" />
            <button type="button" disabled={takeBack.isPending} onClick={() => takeBack.mutate()}
              className="inline-flex items-center gap-1.5 rounded-md bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-60">
              {takeBack.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Take it back
            </button>
            <button type="button" onClick={() => setAsking(null)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        {redline.isLoading && <p className="text-sm text-slate-600"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Comparing…</p>}
        {redline.isError && <p className="text-sm text-rose-700" role="alert">{problemOf(redline.error, 'These versions could not be compared.')}</p>}
        {data && (
          <RedlineView rows={data.rows} empty="Nothing changed since that version."
            changes={{ hunks: data.hunks, canRevert: data.can_revert, whyNot: data.why_not, busyId: takeBack.isPending ? asking?.id ?? null : null, onRevert: (h) => setAsking(h) }} />
        )}
      </div>
    </div>
  );
}

/** One line above the document: what changed since the version that was last approved (or since the first one), so the next person to
 *  review knows where to look. Nothing is shown when nothing changed. */
export function SinceApproved({ documentId, onShow }: { documentId: number; onShow: (fromVersionId: number) => void }) {
  const chain = useQuery({ queryKey: ['document-chain', documentId], queryFn: () => documentChainApi.chain(documentId), staleTime: 15_000 });
  const info = useMemo(() => {
    const d = chain.data;
    if (!d?.enabled || d.versions.length < 2) return null;
    const approvedAt = [...d.events].reverse().find((e) => e.to === 'approved' || e.to === 'published')?.at ?? null;
    let index = 0;
    if (approvedAt) d.versions.forEach((v, i) => { if ((v.at ?? '') <= approvedAt) index = i; });
    const after = d.versions.slice(index + 1);
    if (!after.length) return null;
    const items = after.flatMap((v) => v.items);
    return { base: d.versions[index], versions: after.length, changes: items.length, ai: items.filter((i) => i.origin === 'ai').length,
             people: Array.from(new Set(after.map((v) => v.by).filter(Boolean))), approved: !!approvedAt };
  }, [chain.data]);
  if (!info) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-primary-200 bg-primary-50/60 px-3 py-2 text-xs text-slate-800" role="note">
      <GitCompare className="h-4 w-4 shrink-0 text-primary-700" aria-hidden />
      <span className="min-w-0 flex-1">
        Since {info.approved ? 'the last approved version' : 'the original'} (v{info.base.number}): <strong>{info.changes} change{info.changes === 1 ? '' : 's'}</strong> in {info.versions} version{info.versions === 1 ? '' : 's'}
        {' '}by {info.people.join(', ')}{info.ai ? ` · ${info.ai} AI-assisted` : ''}.
      </span>
      <button type="button" onClick={() => onShow(info.base.id)} className="font-semibold text-primary-800 underline">See them marked in the document</button>
    </div>
  );
}
