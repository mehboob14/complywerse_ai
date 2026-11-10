'use client';

// The small sheet that opens AFTER the supplier has picked a file for a request: the file's name (so the dates are plainly about it) and the three dates we ask
// for, all optional. A bottom sheet on a phone. Nothing travels until "Attach file"; Cancel throws the pick away. A refusal from the server is said here, in the
// sheet, so the supplier can fix the dates and try again without picking the file twice.
import { useEffect, useId, useState } from 'react';
import { Paperclip } from 'lucide-react';
import { Button, Sheet } from '@/components/ui/ds';
import { NO_DATES, datesProblem, sizeWords, type FileDates } from './requestModel';
import { FIELD } from './styles';

export default function AttachSheet({ file, busy, error, onCancel, onAttach }: {
  /** the file picked; the sheet is open while there is one */
  file: File | null;
  busy: boolean;
  /** why the last attempt did not go, in words */
  error: string | null;
  onCancel: () => void;
  onAttach: (dates: FileDates) => void;
}) {
  const ids = useId();
  const [dates, setDates] = useState<FileDates>(NO_DATES);
  useEffect(() => { if (file) setDates(NO_DATES); }, [file]);                       // a new pick starts from empty dates
  const problem = datesProblem(dates);
  const set = (key: keyof FileDates) => (e: { target: { value: string } }) => setDates((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <Sheet open={!!file} onClose={() => { if (!busy) onCancel(); }} title="Attach file" width="sm"
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!!problem} onClick={() => onAttach(dates)}>Attach file</Button>
        </div>
      )}>
      {file && (
        <div className="space-y-4 text-sm text-ds-fg">
          <p className="flex items-start gap-2 rounded-lg border border-ds-border bg-ds-surface-subtle px-3 py-2">
            <Paperclip aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-ds-fg-muted" />
            <span className="min-w-0 break-all">
              <span className="font-medium">{file.name}</span>
              {file.size ? <span className="text-ds-fg-body"> · {sizeWords(file.size)}</span> : null}
            </span>
          </p>
          <p className="text-ds-fg-body">These dates are optional. They help us see how current the document is.</p>
          <label className="block font-medium text-ds-fg-body" htmlFor={`${ids}f`}>
            Covers from
            <input id={`${ids}f`} type="date" value={dates.coverage_from} onChange={set('coverage_from')} className={`mt-1 ${FIELD}`} />
          </label>
          <label className="block font-medium text-ds-fg-body" htmlFor={`${ids}t`}>
            Covers to
            <input id={`${ids}t`} type="date" value={dates.coverage_to} onChange={set('coverage_to')} className={`mt-1 ${FIELD}`}
              aria-invalid={!!problem} aria-describedby={problem ? `${ids}p` : undefined} />
          </label>
          {problem && <p id={`${ids}p`} role="alert" className="-mt-2 text-sm text-rose-700">{problem}</p>}
          <label className="block font-medium text-ds-fg-body" htmlFor={`${ids}e`}>
            Expires on
            <input id={`${ids}e`} type="date" value={dates.expires_on} onChange={set('expires_on')} className={`mt-1 ${FIELD}`} />
          </label>
          {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
        </div>
      )}
    </Sheet>
  );
}
