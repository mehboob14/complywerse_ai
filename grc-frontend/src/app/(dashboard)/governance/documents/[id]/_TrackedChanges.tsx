'use client';

// The document with its changes marked: what changed since an earlier version (by default the one before the newest edit, sign-off
// stamps passed over; or the original), the versions in between with how each was made, who made each change and on whose request,
// and a way to take a change back (a new version; an approved document goes back to review). Works on a document that is its file (an uploaded Word or PDF) as on a text document.
// Backend: governance/change_chain.py. Shown in the Document Viewer when the organisation has the document life cycle.
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitCompare, Loader2, Undo2 } from 'lucide-react';
import { documentChainApi, type ChainHunk } from '@/lib/documentChain';
import { problemOf } from '@/lib/studio/api';
import { plural } from '@/lib/studio/text';
import { useToast } from '@/components/ui/ToastProvider';
import RedlineView from '../studio/_components/RedlineView';
import { originLook } from '../studio/_components/ChangeAttribution';
import { dateTime, day } from '@/lib/documentLifecycle';
import { InitialsAvatar } from '../_workspace/lib';
import { approvedVersionId, compareLine, defaultBaseline, versionOrigin, versionPill, versionsBetween } from '../_view/trackedChanges';

const MUTED = 'text-[#586472]';

/** Nothing to compare yet: say so, and when changes start to show. */
function FirstVersion({ number, fileName, at }: { number: string; fileName?: string; at?: string | null }) {
  const how = at || fileName ? ` (${fileName ? `uploaded ${fileName}` : 'created'}${at ? ` on ${day(at)}` : ''})` : '';
  return (
    <div className="rounded-xl border border-dashed border-[#b8c4c8] bg-white p-6 text-center">
      <GitCompare className="mx-auto h-5 w-5 text-[#0f766e]" aria-hidden />
      <p className="mt-2 text-sm font-semibold text-[#1f2933]">Version {number} is the first version{how}.</p>
      <p className="mt-1 text-xs text-[#586472]">Changes made by hand, by Comply Agent, taken back or restored are marked here from the next version on.</p>
    </div>
  );
}

export default function TrackedChanges({ documentId, status, initial, onChanged, canTakeBack = true }: {
  documentId: number;
  /** people who may not change the document see the changes but cannot take one back */
  canTakeBack?: boolean;
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
  // the version before the newest real edit (sign-off stamps passed over) is what a reviewer wants to see against, unless they asked for another
  const fallback = useMemo(() => defaultBaseline(versions), [versions]);
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
    // the refusal is said inside the prompt (it stays open to Cancel); the comparison is read again in case the document moved on
    onError: () => { qc.invalidateQueries({ queryKey: ['document-chain-redline', documentId] }); },
  });
  const ask = (h: ChainHunk | null) => { takeBack.reset(); setAsking(h); setReason(''); };

  if (chain.isLoading) return <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary-600" /></div>;
  const data = redline.data;
  if (versions.length === 0) return <FirstVersion number={chain.data?.document?.version || '1.0'} />;
  // one version: nothing to compare with, unless the document changed since without a version (then those changes show)
  if (versions.length === 1 && !data?.hunks.length) return <FirstVersion number={versions[0].number} fileName={versions[0].file_name} at={versions[0].at} />;
  const resets = status === 'approved' || status === 'published' || status === 'exception_applied';
  const stats = data?.stats;
  const newestFirst = [...versions].reverse();
  const baseNumber = versions.find((v) => v.id === baseline)?.number;
  const range = versionsBetween(versions, baseline, to);           // the versions this comparison covers: a take back or a restore shows even when it left no difference
  const onlyStamp = !!data?.hunks.length && data.hunks.every((h) => h.locked);
  const line = compareLine(versions, baseline, to, approvedVersionId(versions, chain.data?.events ?? []));
  // people who may not change the document: every change says who made it, none can be taken back (the server's per-change
  // can_revert only says whether the text allows it). `readOnly` hides the button once RedlineView reads it.
  const changes = data && {
    hunks: canTakeBack ? data.hunks : data.hunks.map((h) => ({ ...h, can_revert: false })), canRevert: data.can_revert && canTakeBack,
    whyNot: canTakeBack ? data.why_not : null, busyId: takeBack.isPending ? asking?.id ?? null : null, onRevert: ask, readOnly: !canTakeBack,
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-card">
        {line && <p className="mb-2 text-sm font-semibold text-[#1f2933]">{line}</p>}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <label className="flex min-w-0 items-center gap-2 text-sm">
            <GitCompare className="h-4 w-4 shrink-0 text-[#0b6b58]" aria-hidden />
            <span className="shrink-0 font-semibold text-slate-900">Compared with</span>
            <select value={baseline ?? ''} onChange={(e) => { setFrom(Number(e.target.value)); setTo(null); }} aria-label="Version to compare with"
              className="min-w-0 max-w-[24rem] rounded-lg border border-[#cbd5e1] bg-white px-2.5 py-1.5 text-sm text-[#1f2933] focus:outline-none focus:ring-2 focus:ring-primary-500/30">
              {newestFirst.map((v, i) => (
                <option key={v.id} value={v.id} disabled={i === 0 && to == null}>
                  v{v.number} · {versionOrigin(v)}{v.origin === 'initial' ? '' : ` · ${plural(v.changes, 'change')}`} · {dateTime(v.at)}{i === 0 ? ' (current)' : ''}
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
        {range.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-[#d5dbe1] pt-2" aria-label="Versions in this comparison">
            <span className="text-[11px] text-[#586472]">Since v{baseNumber}:</span>
            {range.map((v) => {
              const look = originLook(v.origin);
              const Icon = look.icon;
              return (
                <span key={v.id} title={`${v.by} · ${dateTime(v.at)}${v.summary ? ` · ${v.summary}` : ''}`}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${look.pill}`}>
                  <Icon className="h-3 w-3" aria-hidden /> v{v.number} · {versionPill(v)}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {asking && canTakeBack && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 shadow-card" role="alertdialog" aria-label="Take back this change">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-amber-700 ring-1 ring-inset ring-amber-200"><Undo2 className="h-4 w-4" aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Take back the change in “{asking.section || 'the top of the document'}”?</p>
              <p className="mt-0.5 text-xs text-amber-900">
                It becomes a new version made by you; the text goes back to what version {redline.data?.from.number} had. Nothing else changes.
                {resets ? ' This document is approved, so it goes back to review.' : ''}
              </p>
              <label className="mt-3 block">
                <span className="text-xs font-semibold text-amber-950">Why <span className="font-normal">(optional, kept with the new version)</span></span>
                <input type="text" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="e.g. This wording was agreed with Legal" autoFocus
                  className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-sm text-[#1f2933] placeholder:text-[#586472] focus:outline-none focus:ring-2 focus:ring-amber-400/40" />
              </label>
              {takeBack.isError && <p className="mt-2 rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-xs text-rose-800" role="alert">Not taken back: {problemOf(takeBack.error)}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" disabled={takeBack.isPending} onClick={() => takeBack.mutate()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-60">
                  {takeBack.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />} Take it back
                </button>
                <button type="button" onClick={() => ask(null)} className="rounded-lg border border-[#cbd5e1] bg-white px-3 py-1.5 text-sm font-semibold text-[#334155] hover:bg-[#f8fafc]">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-card sm:p-4">
        {redline.isLoading && <p className={`text-sm ${MUTED}`}><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Comparing…</p>}
        {redline.isError && <p className="text-sm text-rose-700" role="alert">{problemOf(redline.error, 'These versions could not be compared.')}</p>}
        {onlyStamp && <p className="mb-2 text-xs font-semibold text-[#26323d]">Only the sign-off record changed.</p>}
        {data && (
          <RedlineView rows={data.rows} empty={range.length ? `The text is the same as in v${data.from.number}.` : 'Nothing changed since that version.'}
            changes={changes} />
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
        {plural(info.changes, 'change')} in {plural(info.versions, 'version')}{info.ai ? `, ${info.ai} by Comply Agent` : ''}
        <span className="ml-2 inline-flex translate-y-0.5 items-center align-middle">{info.people.slice(0, 4).map((p, i) => <span key={p} className={i ? '-ml-1.5' : ''}><InitialsAvatar name={p} size="sm" /></span>)}</span>
      </span>
      <button type="button" onClick={() => onShow(info.base.id)}
        className="inline-flex items-center gap-1 rounded-lg border border-primary-600 bg-white px-2.5 py-1 text-xs font-semibold text-[#0b6b58] hover:bg-primary-50">
        See them marked in the document
      </button>
    </div>
  );
}
