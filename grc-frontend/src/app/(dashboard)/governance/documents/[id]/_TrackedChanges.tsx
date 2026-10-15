'use client';

// The document with its changes marked: what changed since an earlier version (the one before this one by default, or the
// original), who made each change and on whose request, and a way to take a change back (a new version; an approved document
// goes back to review). Works on a document that is its file (an uploaded Word or PDF) as on a text document.
// Backend: governance/change_chain.py. Shown in the Document Viewer when the organisation has the document life cycle.
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitCompare, Loader2, Undo2 } from 'lucide-react';
import { documentChainApi, type ChainHunk } from '@/lib/documentChain';
import { problemOf } from '@/lib/studio/api';
import { plural } from '@/lib/studio/text';
import { useToast } from '@/components/ui/ToastProvider';
import RedlineView from '../studio/_components/RedlineView';
import { dateTime } from '@/lib/documentLifecycle';
import { InitialsAvatar } from '../_workspace/lib';

const MUTED = 'text-[#586472]';

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

  if (chain.isLoading) return <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary-600" /></div>;
  if (versions.length === 0) {
    return <p className={`rounded-xl border border-dashed border-[#cbd5e1] bg-white p-8 text-center text-sm ${MUTED}`}>This document has no earlier version to compare with yet. Once it is edited, its changes are shown here.</p>;
  }
  const data = redline.data;
  const resets = status === 'approved' || status === 'published' || status === 'exception_applied';
  const stats = data?.stats;
  const newestFirst = [...versions].reverse();

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-card">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <label className="flex min-w-0 items-center gap-2 text-sm">
            <GitCompare className="h-4 w-4 shrink-0 text-[#0b6b58]" aria-hidden />
            <span className="shrink-0 font-semibold text-slate-900">Compared with</span>
            <select value={baseline ?? ''} onChange={(e) => { setFrom(Number(e.target.value)); setTo(null); }} aria-label="Version to compare with"
              className="min-w-0 max-w-[24rem] rounded-lg border border-[#cbd5e1] bg-white px-2.5 py-1.5 text-sm text-[#1f2933] focus:outline-none focus:ring-2 focus:ring-primary-500/30">
              {newestFirst.map((v, i) => (
                <option key={v.id} value={v.id} disabled={i === 0 && to == null}>
                  v{v.number} · {v.by} · {dateTime(v.at)} · {v.stage_label}{i === 0 ? ' (the current one)' : i === newestFirst.length - 1 ? ' (the original)' : ''}
                </option>
              ))}
            </select>
          </label>
          {versions.length > 2 && baseline !== versions[0].id && (
            <button type="button" onClick={() => { setFrom(versions[0].id); setTo(null); }} className="text-xs font-semibold text-[#0b6b58] hover:underline">Compare with the original</button>
          )}
          {to != null && data?.to && (
            <span className="inline-flex items-center gap-2 rounded-full bg-primary-50 px-2.5 py-1 text-xs text-[#0b6b58] ring-1 ring-inset ring-primary-100">
              Only what v{data.to.number} changed
              <button type="button" onClick={() => setTo(null)} className="font-semibold underline">Show everything since v{data.from.number}</button>
            </span>
          )}
          <span className="ml-auto flex flex-wrap items-center gap-1.5 text-[11px]">
            {stats && (stats.inserted + stats.deleted + stats.modified > 0) ? (
              <>
                {stats.inserted > 0 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200">{plural(stats.inserted, 'block')} added</span>}
                {stats.deleted > 0 && <span className="rounded-full bg-rose-50 px-2 py-0.5 font-semibold text-rose-800 ring-1 ring-inset ring-rose-200">{plural(stats.deleted, 'block')} removed</span>}
                {stats.modified > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">{plural(stats.modified, 'block')} changed</span>}
                <span className="font-mono font-semibold text-emerald-700">+{stats.words_added}</span><span className="font-mono font-semibold text-rose-700">−{stats.words_removed}</span><span className={MUTED}>words</span>
              </>
            ) : stats ? <span className={MUTED}>No changes</span> : null}
          </span>
        </div>
        <p className={`mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] ${MUTED}`}>
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-200" aria-hidden /> added</span>
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-rose-200" aria-hidden /> removed</span>
          <span>Each change says who made it, on whose request and from which sources.</span>
          {data && !data.can_revert && data.why_not && <span className="text-amber-800">{data.why_not}</span>}
        </p>
      </div>

      {asking && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 shadow-card" role="alertdialog" aria-label="Take back this change">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-amber-700 ring-1 ring-inset ring-amber-200"><Undo2 className="h-4 w-4" aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Take back the change in “{asking.section || 'the top of the document'}”?</p>
              <p className="mt-0.5 text-xs text-amber-900">
                It becomes a new version made by you; the text goes back to what version {redline.data?.from.number} had. Nothing else changes.
                {resets ? ' This document is approved, so it goes back to review.' : ''}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why (recorded in the document's history)"
                  className="min-w-[14rem] flex-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-sm text-[#1f2933] focus:outline-none focus:ring-2 focus:ring-amber-400/40" />
                <button type="button" disabled={takeBack.isPending} onClick={() => takeBack.mutate()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-60">
                  {takeBack.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />} Take it back
                </button>
                <button type="button" onClick={() => setAsking(null)} className="rounded-lg border border-[#cbd5e1] bg-white px-3 py-1.5 text-sm font-semibold text-[#334155] hover:bg-[#f8fafc]">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-card sm:p-4">
        {redline.isLoading && <p className={`text-sm ${MUTED}`}><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Comparing…</p>}
        {redline.isError && <p className="text-sm text-rose-700" role="alert">{problemOf(redline.error, 'These versions could not be compared.')}</p>}
        {data && (
          <RedlineView rows={data.rows} empty="Nothing changed since that version."
            changes={{ hunks: data.hunks, canRevert: data.can_revert, whyNot: data.why_not, busyId: takeBack.isPending ? asking?.id ?? null : null, onRevert: (h) => setAsking(h) }} />
        )}
      </div>
    </div>
  );
}

/** One line above the document: what changed since the version that was last approved (or since the original), so the next person to
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-primary-100 bg-primary-50/60 px-3 py-2.5 text-xs text-[#1f2933]" role="note">
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-[#0b6b58] ring-1 ring-inset ring-primary-100"><GitCompare className="h-4 w-4" aria-hidden /></span>
      <span className="min-w-0 flex-1">
        <span className="font-semibold">Since {info.approved ? 'the last approved version' : 'the original'} (v{info.base.number}):</span>{' '}
        {plural(info.changes, 'change')} in {plural(info.versions, 'version')}{info.ai ? `, ${info.ai} AI-assisted` : ''}
        <span className="ml-2 inline-flex translate-y-0.5 items-center align-middle">{info.people.slice(0, 4).map((p, i) => <span key={p} className={i ? '-ml-1.5' : ''}><InitialsAvatar name={p} size="sm" /></span>)}</span>
      </span>
      <button type="button" onClick={() => onShow(info.base.id)}
        className="inline-flex items-center gap-1 rounded-lg border border-primary-600 bg-white px-2.5 py-1 text-xs font-semibold text-[#0b6b58] hover:bg-primary-50">
        See them marked in the document
      </button>
    </div>
  );
}
