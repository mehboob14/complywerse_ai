'use client';

// The list of a long questionnaire's sections, with how many questions of each are answered, to jump to one. A bottom sheet on a phone. Picking a section closes the
// sheet; the page then scrolls to it (SupplierQuestionnaire).
import { CheckCircle, ChevronRight } from 'lucide-react';
import { Sheet } from '@/components/ui/ds';
import { FOCUS } from './styles';

export interface SectionRow { label: string; answered: number; total: number }

export default function SectionsSheet({ open, rows, answered, total, onClose, onPick }: {
  open: boolean;
  rows: SectionRow[];
  answered: number;
  total: number;
  onClose: () => void;
  onPick: (index: number) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Sections" subtitle={`${answered} of ${total} answered`} width="sm" padded={false}>
      <ul className="divide-y divide-ds-border">
        {rows.map((row, i) => {
          const complete = row.total > 0 && row.answered >= row.total;
          return (
            <li key={`${row.label}-${i}`}>
              <button type="button" onClick={() => onPick(i)} className={`flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left hover:bg-ds-surface-hover ${FOCUS}`}>
                <span className="min-w-0 flex-1 break-words text-sm font-medium text-ds-fg">{row.label}</span>
                {complete && <CheckCircle aria-hidden className="h-4 w-4 shrink-0 text-emerald-700" />}
                <span className="shrink-0 text-sm tabular-nums text-ds-fg-body">{row.answered}/{row.total}<span className="sr-only"> answered{complete ? ', complete' : ''}</span></span>
                <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-ds-fg-muted" />
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
