'use client';

// Attach evidence to a drill's result: the report of the test, a log, a screenshot. The drill's result already took an evidence id (and the server answers with its name); there was no screen
// for it. The field shows the evidence attached (its name, a link to open it) with Change and Remove, or an "Attach evidence" button; the choice is a panel with a search box that asks the
// server (GET /bcm/evidence-options, the picker route, so a BCM user needs no Evidence right): the first 50 matches, newest first. What is chosen is held in the result form and saved with the
// result, so it is one more field of the form, not a request of its own.
import { useState } from 'react';
import Link from 'next/link';
import { FileText, Paperclip } from 'lucide-react';
import { Button, DebouncedSearch, EmptyState, ErrorState, Sheet, SkeletonRows } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { useEvidenceOptions } from '../bcmData';
import { LABEL_LINK } from '../_bcm-ui';

export function EvidencePicker({ value, title, onChange }: { value: number | null; /** the name of the evidence attached (from the saved result, or from the choice just made) */ title: string | null; onChange: (id: number | null, title: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const q = useEvidenceOptions(search, open);
  return (
    <div className="flex flex-col gap-[6px]">
      {value ? (
        <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[6px] rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[12px] py-[6px]">
          <FileText aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" strokeWidth={1.75} />
          <Link href={`/evidence/${value}`} className={`min-w-0 flex-1 basis-[12rem] break-words text-ds-body ${LABEL_LINK}`}>{title || 'Open the evidence'}</Link>
          <Button size="sm" onClick={() => setOpen(true)}>Change</Button>
          <Button size="sm" variant="link" onClick={() => onChange(null, null)}>Remove</Button>
        </div>
      ) : (
        <div><Button leftIcon={<Paperclip aria-hidden />} onClick={() => setOpen(true)}>Attach evidence</Button></div>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title="Attach evidence" subtitle="The report of this drill, a log or a screenshot" width="sm">
        <div className="flex flex-col gap-[12px] p-[16px]">
          <DebouncedSearch label="Search evidence" placeholder="Search evidence by name" value={search} onSearch={setSearch} loading={q.isFetching} />
          {q.isPending && <SkeletonRows rows={5} columns={2} label="Loading evidence" />}
          {q.isError && <ErrorState compact title="Couldn't load the evidence" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />}
          {q.data && q.data.length === 0 && (
            <EmptyState bare kind="noMatches" title="No evidence found" description={search ? 'Try other words.' : 'Upload the file in Evidence Management first, then attach it here.'} />
          )}
          {q.data && q.data.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-[6px] p-0">
              {q.data.map((e) => (
                <li key={e.value}>
                  <button
                    type="button"
                    onClick={() => { onChange(e.value, e.label); setOpen(false); }}
                    className="flex w-full min-h-ds-control flex-col gap-[2px] rounded-ds-control border border-ds-border bg-ds-surface px-[10px] py-[8px] text-left hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring"
                  >
                    <span className="break-words text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{e.label}</span>
                    {e.subLabel && <span className="text-ds-label capitalize text-ds-fg-muted">{e.subLabel}</span>}
                  </button>
                </li>
              ))}
              {q.data.length >= 50 && <li className="px-[2px] text-ds-label text-ds-fg-muted">Only the first 50 are listed. Search to narrow them down.</li>}
            </ul>
          )}
        </div>
      </Sheet>
    </div>
  );
}
