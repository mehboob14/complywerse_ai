'use client';

// The controls that meet one obligation: confirmed ones, suggestions to decide, and a search to link any control by hand. SCF suggestions come from a keyword match (no model reads SCF text);
// the organisation's own controls are weighed by the model, which says why. Every decision is reported when the server has answered (a failure stays on screen with a Retry).
import { useEffect, useState } from 'react';
import { Check, Link2, Search, X } from 'lucide-react';
import { Button, IconButton, StatusPill, TextInput, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { regulatoryApi } from '@/lib/api';
import { statusPill } from '@/lib/status';
import { linkStatus } from '@/lib/statuses/regulatory';
import type { RegLink } from '../_lib/types';

type Found = { type: string; id: number; ref: string; label: string; scf: boolean };
const SOURCE: Record<RegLink['source'], string> = { match: 'Keyword match', ai: 'AI', manual: 'Linked by hand' };
const KIND = (c: Found) => (c.type === 'internal_control' ? 'Internal control' : c.scf ? 'SCF' : 'Custom');

export default function ObligationControls({ obligationId, links, onChanged }: { obligationId: number; links: RegLink[]; onChanged: () => void }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[]>([]);
  const [searching, setSearching] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); setProblem(''); return undefined; }
    let cancelled = false;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const items = ((await regulatoryApi.searchControls(q.trim())).data?.items || []) as Found[];
        if (!cancelled) { setFound(items); setProblem(''); }
      } catch (e) {
        if (!cancelled) setProblem(errorMessage(e, 'The search did not work.'));
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  const decide = useReportedMutation({
    mutationFn: ({ id, to }: { id: number; to: 'confirmed' | 'rejected' }) => regulatoryApi.decideLink(id, to),
    success: (_, v) => (v.to === 'confirmed' ? 'Control confirmed' : 'Suggestion set aside'), failure: "Couldn't save that decision", onSuccess: onChanged,
  });
  const unlink = useReportedMutation({
    mutationFn: (id: number) => regulatoryApi.removeLink(id), success: 'Control unlinked', failure: "Couldn't unlink the control", onSuccess: onChanged,
  });
  const link = useReportedMutation({
    mutationFn: (c: Found) => regulatoryApi.addLink(obligationId, { target_type: c.type, target_id: c.id }),
    success: 'Control linked', failure: "Couldn't link the control", onSuccess: () => { setQ(''); onChanged(); },
  });

  const shown = links.filter((l) => l.status !== 'rejected');
  const linked = new Set(links.map((l) => `${l.target_type}:${l.target_id}`));

  return (
    <div className="flex flex-col gap-[8px]">
      {shown.length === 0 && <p className="m-0 text-ds-body text-ds-fg-muted">None yet. Search below to link one.</p>}
      {shown.map((l) => (
        <div key={l.id} className={`flex flex-wrap items-start gap-[8px] rounded-ds-control border px-[8px] py-[6px] ${l.status === 'confirmed' ? 'border-ds-border bg-ds-success-soft' : 'border-ds-border bg-ds-surface-subtle'}`}>
          <div className="min-w-0 flex-1">
            <p className="m-0 text-ds-body text-ds-fg [overflow-wrap:anywhere]">
              {l.target_ref && <span className="mr-[6px] font-[600]">{l.target_ref}</span>}{l.target_label}
            </p>
            <p className="m-0 flex flex-wrap items-center gap-[6px] text-ds-label text-ds-fg-muted">
              <StatusPill size="sm" {...statusPill(linkStatus, l.status)} />
              {l.status === 'confirmed' ? (l.decided_by ? `by ${l.decided_by}` : '') : SOURCE[l.source]}
            </p>
            {l.rationale && l.status === 'proposed' && <p className="m-0 mt-[2px] text-ds-label text-ds-fg-body">{l.rationale}</p>}
          </div>
          {l.status === 'proposed' ? (
            <span className="flex gap-[6px]">
              <Button size="sm" leftIcon={<Check aria-hidden />} loading={decide.isPending && decide.variables?.id === l.id && decide.variables.to === 'confirmed'} onClick={() => decide.mutate({ id: l.id, to: 'confirmed' })}>Confirm</Button>
              <Button size="sm" leftIcon={<X aria-hidden />} loading={decide.isPending && decide.variables?.id === l.id && decide.variables.to === 'rejected'} onClick={() => decide.mutate({ id: l.id, to: 'rejected' })}>Not this one</Button>
            </span>
          ) : (
            <IconButton label={`Unlink ${l.target_ref || 'this control'}`} onClick={() => unlink.mutate(l.id)}><X aria-hidden /></IconButton>
          )}
        </div>
      ))}
      <TextInput
        type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search controls to link" placeholder="Link a control: search by name or code" autoComplete="off"
        leftAdornment={<Search aria-hidden className="h-[14px] w-[14px]" />}
      />
      {searching && <p role="status" className="m-0 text-ds-label text-ds-fg-muted">Searching…</p>}
      {problem && <p role="alert" className="m-0 text-ds-label text-ds-danger">{problem}</p>}
      {!searching && !problem && q.trim().length >= 2 && found.length === 0 && <p className="m-0 text-ds-label text-ds-fg-muted">No control matches “{q.trim()}”.</p>}
      {found.length > 0 && (
        <ul className="m-0 max-h-[240px] list-none divide-y divide-ds-border overflow-y-auto rounded-ds-control border border-ds-border p-0">
          {found.map((c) => {
            const already = linked.has(`${c.type}:${c.id}`);
            return (
              <li key={`${c.type}:${c.id}`} className="flex items-center gap-[8px] px-[8px] py-[4px]">
                <Link2 aria-hidden className="h-[14px] w-[14px] shrink-0 text-ds-fg-muted" />
                <span className="min-w-0 flex-1 text-ds-body text-ds-fg [overflow-wrap:anywhere]"><span className="mr-[6px] font-[600]">{c.ref}</span>{c.label}<span className="ml-[6px] text-ds-label text-ds-fg-muted">{KIND(c)}</span></span>
                <Button size="sm" disabled={already} loading={link.isPending && link.variables?.id === c.id} onClick={() => link.mutate(c)}>{already ? 'Linked' : 'Link'}</Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
