'use client';

/**
 * Shown right after an upload: which common controls a document like this one can stand for.
 *
 * The matching is rule-based, not a model (SCF's licence does not allow AI to be given its text), so it answers at once from the file's name, type and
 * description. The evidence page runs it again once the text has been read. Each suggestion says which artifact the control asks for, so a link made here shows
 * on that control's own Evidence tab against that artifact. On the kit: AnimatedModal, Checkbox rows, Button; a link that fails says so in the server's words
 * and the dialog stays open, so pressing the button again is the retry.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import apiClient from '@/lib/api';
import { AnimatedModal } from '@/components/ui';
import { Button, Checkbox, StatusPill, useNotify } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { truncate } from '@/lib/format';

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

export default function CommonControlSuggest({ evidence, recs, onClose }: {
  evidence: { id: number; name: string };
  recs: CommonControlRec[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const notify = useNotify();
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
    void queryClient.invalidateQueries({ queryKey: ['ev-ws-items'] });
    void queryClient.invalidateQueries({ queryKey: ['evidence-items'] });
    if (failed.length) {
      notify.error(errorMessage(failed[0].reason, 'Please try again, or link them from the evidence page.'), { title: `Couldn't link ${failed.length} of ${chosen.length}` });
      return;
    }
    notify.success(`Linked to ${chosen.length} common ${chosen.length === 1 ? 'control' : 'controls'}`);
    onClose();
  };

  return (
    <AnimatedModal
      isOpen
      onClose={onClose}
      size="lg"
      title={<span className="inline-flex items-center gap-[8px]"><ShieldCheck aria-hidden className="h-[20px] w-[20px] text-ds-primary-text" strokeWidth={1.75} /> Common controls for this file</span>}
      subtitle={`“${truncate(evidence.name, 90).text}” looks like a document these controls ask for.`}
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-[8px]">
          <Button variant="link" href={`/evidence/${evidence.id}`} rightIcon={<ExternalLink aria-hidden />}>Open the evidence</Button>
          <div className="flex items-center gap-[8px]">
            <Button onClick={onClose}>Skip</Button>
            <Button variant="primary" loading={busy} disabled={picked.size === 0} onClick={() => { void link(); }}>{picked.size > 0 ? `Link ${picked.size} selected` : 'Link selected'}</Button>
          </div>
        </div>
      )}
    >
      <div className="p-[20px]">
        <p className="mb-[12px] text-ds-body text-ds-fg-muted">Tick the ones to link. You can change links any time on the evidence page.</p>
        <ul className="flex flex-col gap-[8px]">
          {recs.map((r) => {
            const pct = Math.round(r.confidence * 100);
            return (
              <li key={r.id} className={`rounded-ds-card border p-[12px] ${picked.has(r.id) ? 'border-ds-primary bg-ds-primary-soft' : 'border-ds-border bg-ds-surface'}`}>
                <Checkbox
                  checked={picked.has(r.id)} onChange={() => toggle(r.id)}
                  label={(
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-[8px]">
                        <span className="font-mono text-ds-label text-ds-fg-body">{r.code}</span>
                        <StatusPill size="sm" tone={pct >= 80 ? 'success' : 'neutral'} label={`${pct}% match`} />
                      </span>
                      <span className="mt-[2px] block break-words text-ds-body font-[600] text-ds-fg">{r.title}</span>
                      {r.subtitle && <span className="block break-words text-ds-label text-ds-fg-muted">{r.subtitle}</span>}
                      {r.rationale && <span className="mt-[4px] block break-words text-ds-label text-ds-fg-muted">{r.rationale}</span>}
                    </span>
                  )}
                />
              </li>
            );
          })}
        </ul>
      </div>
    </AnimatedModal>
  );
}
