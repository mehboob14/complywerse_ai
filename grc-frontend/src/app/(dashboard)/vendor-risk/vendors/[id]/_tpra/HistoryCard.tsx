'use client';

// What moved the work, newest first (stages advanced, sent back, skipped, reopened), six at a time. Read from the audit trail by
// the lifecycle read; Compliverse's own Activity (every recorded change) stays one click away, beside it.
import { useState } from 'react';
import { History as HistoryIcon } from 'lucide-react';
import { BTN } from '../_record/btn';
import RecordPanel from '../_record/RecordPanel';
import { fmt } from '../../../_ui/fmt';
import { historyLine, shownHistory, type HistoryRow } from '../../../_lib/lifecycleLogic';

export default function HistoryCard({ rows, onActivity }: { rows: HistoryRow[]; onActivity?: () => void }) {
  const [all, setAll] = useState(false);
  const shown = shownHistory(rows, all);
  return (
    <RecordPanel
      title="History"
      count={rows.length || undefined}
      action={onActivity ? (
        <button type="button" className={BTN} onClick={onActivity}><HistoryIcon aria-hidden className="h-4 w-4" /> Activity</button>
      ) : undefined}
    >
      {rows.length === 0 ? (
        <p className="text-[13px] leading-5 text-ds-fg-muted">Nothing has moved yet.</p>
      ) : (
        <>
          <ul className="divide-y divide-[#eef1f4]">
            {shown.map((h) => (
              <li key={h.id} className="py-2">
                <p className="text-[13px] font-medium leading-5 text-ds-fg">{historyLine(h)}</p>
                {h.reason && <p className="text-[13px] leading-5 text-ds-fg-muted">{h.reason}</p>}
                <p className="text-[12px] leading-4 text-ds-fg-muted">
                  {h.actor || 'Platform'} · {fmt.date(h.at)}{h.review ? ` · review ${h.review}` : ''}
                </p>
              </li>
            ))}
          </ul>
          {rows.length > 6 && (
            <button type="button" className="mt-2 rounded-ds-control px-1 py-0.5 text-[13px] font-medium text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary"
              onClick={() => setAll((v) => !v)}>
              {all ? 'Show fewer' : `Show all ${rows.length}`}
            </button>
          )}
        </>
      )}
    </RecordPanel>
  );
}
