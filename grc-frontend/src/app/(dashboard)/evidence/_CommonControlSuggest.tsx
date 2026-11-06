'use client';

/**
 * Shown right after an upload: which common controls a document like this one can stand for.
 *
 * The matching is rule-based, not a model (SCF's licence does not allow AI to be given its text), so it
 * answers at once from the file's name, type and description. The evidence page runs it again once the
 * text has been read. Each suggestion says which artifact the control asks for, so a link made here shows
 * on that control's own Evidence tab against that artifact.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { AnimatedModal, useToast } from '@/components/ui';
import { CheckCircle, ExternalLink, Loader2, ShieldCheck } from 'lucide-react';

export interface CommonControlRec {
  id: number;
  code: string;
  title: string;
  subtitle?: string | null;
  confidence: number;
  rationale?: string | null;
  meta?: { scf_id?: string; artifact_name?: string } | null;
}

const STRONG = 0.8;

export default function CommonControlSuggest({
  evidence,
  recs,
  onClose,
}: {
  evidence: { id: number; name: string };
  recs: CommonControlRec[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  // The strong matches start ticked; a weaker one is the person's call.
  const [picked, setPicked] = useState<Set<number>>(new Set(recs.filter((r) => r.confidence >= STRONG).map((r) => r.id)));
  const [busy, setBusy] = useState(false);

  const toggle = (id: number) => setPicked((prev) => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  const link = async () => {
    const chosen = recs.filter((r) => picked.has(r.id) && r.meta?.scf_id);
    if (!chosen.length) return;
    setBusy(true);
    const results = await Promise.allSettled(chosen.map((r) =>
      apiClient.post(`/automation/common/controls/${encodeURIComponent(r.meta!.scf_id!)}/assurance/evidence`, {
        evidence_id: evidence.id, artifact_name: r.meta?.artifact_name || null,
      })));
    setBusy(false);
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    queryClient.invalidateQueries({ queryKey: ['ev-ws-items'] });
    queryClient.invalidateQueries({ queryKey: ['evidence-items'] });
    if (failed.length) {
      toast({ type: 'error', title: `Could not link ${failed.length} of ${chosen.length}`,
        message: failed[0].reason?.response?.data?.detail || 'Please try again, or link them from the evidence page.' });
      return;
    }
    toast({ type: 'success', title: `Linked to ${chosen.length} common ${chosen.length === 1 ? 'control' : 'controls'}` });
    onClose();
  };

  return (
    <AnimatedModal
      isOpen
      onClose={onClose}
      size="lg"
      title={<span className="inline-flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary-600" /> Common controls for this file</span>}
      subtitle={`“${evidence.name}” looks like a document these controls ask for.`}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link href={`/evidence/${evidence.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:underline">
            Open the evidence <ExternalLink className="h-3.5 w-3.5" />
          </Link>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Skip
            </button>
            <button
              type="button"
              onClick={link}
              disabled={busy || picked.size === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
              Link {picked.size > 0 ? picked.size : ''} selected
            </button>
          </div>
        </div>
      }
    >
      <div className="p-5">
      <p className="mb-3 text-xs text-slate-500">Tick the ones to link. You can change links any time on the evidence page.</p>
      <ul className="space-y-2">
        {recs.map((r) => {
          const pct = Math.round(r.confidence * 100);
          return (
            <li key={r.id}>
              <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${picked.has(r.id) ? 'border-primary-300 bg-primary-50/40' : 'border-slate-200 hover:bg-slate-50'}`}>
                <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} className="mt-1 h-4 w-4 rounded border-slate-300 text-primary-600" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-slate-600">{r.code}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${pct >= 80 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-500'}`}>{pct}% match</span>
                  </span>
                  <span className="mt-0.5 block text-sm font-semibold text-slate-800">{r.title}</span>
                  {r.subtitle && <span className="block text-xs text-slate-500">{r.subtitle}</span>}
                  {r.rationale && <span className="mt-1 block text-xs text-slate-500">{r.rationale}</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      </div>
    </AnimatedModal>
  );
}
