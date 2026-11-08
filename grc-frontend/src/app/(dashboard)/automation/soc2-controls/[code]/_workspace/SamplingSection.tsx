'use client';

// Testing > Sampling: the sampled evidence used to test this control. A file is uploaded (it is kept in the Evidence Library, read and reviewable there too) or linked from the library, and a
// reviewer approves or rejects each one. The server asks only for a sign-in for these three (control_library/routers/workbench.py), so the page does not gate them by a right; that is a
// gap for the owner to decide, not something to hide here. A control nobody has acted on has no work item yet; the first sample creates it (POST .../assurance/track), because the reads no longer do.
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Search, Upload, X } from 'lucide-react';
import { Button, EmptyState, ErrorState, IconButton, StatusPill, TextInput, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { statusLabel } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { evidenceFile } from '@/lib/statuses/controls';
import { Loaded, Small } from './parts';
import { attachSample, reviewSample, searchLibrary, ensureWorkItem } from './workspaceApi';
import { useTesting } from './workspaceData';
import { useWorkspace } from './workspaceContext';

/** A sample file's review word in the evidence registry's vocabulary (pending / approved / rejected). */
const reviewWord = (s: string): string => (s === 'approved' || s === 'rejected' ? s : 'pending');

export function SamplingSection() {
  const { code, refresh } = useWorkspace();
  const q = useTesting(code);
  const input = useRef<HTMLInputElement>(null);
  const [linking, setLinking] = useState(false);
  const [term, setTerm] = useState('');
  const lib = useQuery({ queryKey: ['wb-evidence-lib', term], enabled: linking, queryFn: () => searchLibrary(term.trim()), staleTime: 15_000 });
  const done = () => { void refresh(); };

  const upload = useReportedMutation({
    mutationFn: async (file: File) => attachSample(await ensureWorkItem(code), { file }),
    success: { title: 'Sample attached', message: 'It waits here for a reviewer.' }, failure: "Couldn't attach the sample", onSuccess: done,
  });
  const link = useReportedMutation({
    mutationFn: async (evidenceId: number) => attachSample(await ensureWorkItem(code), { evidence_id: String(evidenceId) }),
    success: { title: 'Sample linked', message: 'It waits here for a reviewer.' }, failure: "Couldn't link the evidence", onSuccess: () => { setLinking(false); setTerm(''); done(); },
  });
  const review = useReportedMutation({
    mutationFn: (v: { id: number; action: 'approved' | 'rejected' }) => reviewSample(v.id, v.action),
    success: (_d, v) => (v.action === 'approved' ? 'Sample approved' : 'Sample rejected'), failure: "Couldn't record the review", onSuccess: done,
  });

  return (
    <Loaded q={q} what="the samples" rows={3}>
      {(rec) => {
        const items = [...rec.control_files.map((f) => ({ ...f, step: null as number | null })), ...rec.procedures.flatMap((p) => p.files.map((f) => ({ ...f, step: p.seq })))];
        const linked = new Set(items.map((e) => e.evidence_id).filter(Boolean));
        const available = (lib.data?.items ?? []).filter((e) => !linked.has(e.id));
        return (
          <div className="flex flex-col gap-[12px]">
            <div className="flex flex-wrap items-center gap-[8px]">
              <Button variant="primary" leftIcon={<Upload aria-hidden />} loading={upload.isPending} onClick={() => input.current?.click()}>Upload a sample</Button>
              <Button leftIcon={<Search aria-hidden />} aria-expanded={linking} onClick={() => setLinking(!linking)}>Link from the library</Button>
              <input ref={input} type="file" className="hidden" tabIndex={-1} aria-hidden="true" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload.mutate(f); }} />
            </div>
            {linking && (
              <div className="flex flex-col gap-[8px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
                <TextInput autoFocus aria-label="Search the evidence library" placeholder="Search the evidence library" value={term} onChange={(e) => setTerm(e.target.value)} leftAdornment={<Search aria-hidden className="h-[14px] w-[14px]" strokeWidth={1.75} />} />
                {lib.isError ? <ErrorState compact title="Couldn’t search the library" message={errorMessage(lib.error)} onRetry={canRetry(lib.error) ? () => { void lib.refetch(); } : undefined} />
                  : lib.isPending ? <Small>Searching…</Small>
                    : available.length === 0 ? <Small>Nothing to link.</Small>
                      : (
                        <ul className="max-h-[260px] divide-y divide-ds-border overflow-y-auto rounded-ds-control border border-ds-border bg-ds-surface">
                          {available.map((e) => (
                            <li key={e.id} className="flex items-center gap-[8px] px-[10px] py-[6px]">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-ds-body font-[500] text-ds-fg" title={e.name}>{e.name}</p>
                                <Small>{[e.evidence_type, e.status].filter(Boolean).map((x) => statusLabel(x as string)).join(' · ') || 'Evidence'}</Small>
                              </div>
                              <Button size="sm" variant="primary" loading={link.isPending && link.variables === e.id} onClick={() => link.mutate(e.id)}>Link</Button>
                            </li>
                          ))}
                        </ul>
                      )}
              </div>
            )}
            {items.length === 0 ? (
              <EmptyState kind="firstUse" bare title="No samples attached yet" description="Upload the sampled evidence, or link it from the library." />
            ) : (
              <ul className="divide-y divide-ds-border rounded-ds-card border border-ds-border bg-ds-surface" aria-label="Samples">
                {items.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-[8px] px-[12px] py-[8px]">
                    <span className="min-w-0 flex-1 basis-[12rem] truncate text-ds-body text-ds-fg" title={e.file_name || undefined}>{e.file_name || 'A file'}</span>
                    {e.step != null && <StatusPill size="sm" tone="neutral" label={`Step ${e.step}`} />}
                    {e.evidence_id ? <StatusPill size="sm" tone="neutral" label="In the library" /> : null}
                    <StatusPill size="sm" {...statusPill(evidenceFile, reviewWord(e.review_status))} />
                    {e.review_status === 'pending' && (
                      <span className="flex gap-[4px]">
                        <IconButton label={`Approve ${e.file_name || 'the sample'}`} onClick={() => review.mutate({ id: e.id, action: 'approved' })}><Check aria-hidden strokeWidth={1.75} /></IconButton>
                        <IconButton label={`Reject ${e.file_name || 'the sample'}`} onClick={() => review.mutate({ id: e.id, action: 'rejected' })}><X aria-hidden strokeWidth={1.75} /></IconButton>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      }}
    </Loaded>
  );
}
