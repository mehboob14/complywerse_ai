'use client';

// One question of the builder: its number, the words, what departs from the ordinary as chips, the answers of a choice in one line, and (for a person who may edit) move up, move down and a menu. The
// question opens the editor on press or Enter. Nothing here saves: the page does.
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { IconButton, Menu, StatusPill, type MenuItem } from '@/components/ui/ds';
import type { Tone } from '@/lib/status';
import type { Chip } from '../../_lib/questionnaires/model';
import type { Question } from '../../_lib/questionnaires/types';

/** A chip's tone in the platform's words: teal (an extra rule) reads "progress", amber "warning". */
const TONE: Record<Chip['tone'], Tone> = { neutral: 'neutral', accent: 'progress', danger: 'danger', warn: 'warning' };

export function QuestionRow({ question: q, number, chips, answers, editable, busy, canUp, canDown, onEdit, onAddBelow, onUp, onDown, onRemove }: {
  question: Question;
  number: number;
  chips: Chip[];
  answers: string;
  editable: boolean;
  busy: boolean;
  canUp: boolean;
  canDown: boolean;
  onEdit: () => void;
  onAddBelow: () => void;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
}) {
  const body = (
    <>
      <span className="block break-words text-ds-body text-ds-fg">{q.text}</span>
      <span className="mt-[6px] flex flex-wrap items-center gap-[6px]">
        {chips.map((c) => <span key={c.key} title={c.title}><StatusPill size="sm" tone={TONE[c.tone]} label={c.text} /></span>)}
      </span>
      {answers && <span className="mt-[6px] line-clamp-2 block text-ds-label font-normal text-ds-fg-muted">{answers}</span>}
    </>
  );
  const items: MenuItem[] = [
    { key: 'edit', label: 'Edit', icon: Pencil, onSelect: onEdit },
    { key: 'below', label: 'Add a question below', icon: Plus, onSelect: onAddBelow },
    { key: 'remove', label: 'Remove', icon: Trash2, danger: true, onSelect: onRemove },
  ];
  return (
    <li className="flex items-start gap-[12px] py-[12px]">
      <span className="mt-[2px] w-[32px] shrink-0 text-ds-body font-[600] tabular-nums text-ds-fg-muted">Q{number}</span>
      {editable ? (
        <button type="button" onClick={onEdit} className="min-w-0 flex-1 rounded-[4px] text-left focus-visible:outline-none focus-visible:shadow-ds-ring" aria-label={`Edit Q${number}: ${q.text.slice(0, 80)}`}>{body}</button>
      ) : <div className="min-w-0 flex-1">{body}</div>}
      {editable && (
        <div className="flex shrink-0 items-center">
          <IconButton label={`Move Q${number} up`} disabled={!canUp || busy} onClick={onUp}><ArrowUp aria-hidden /></IconButton>
          <IconButton label={`Move Q${number} down`} disabled={!canDown || busy} onClick={onDown}><ArrowDown aria-hidden /></IconButton>
          <Menu iconOnly label={`Actions for Q${number}`} items={items} />
        </div>
      )}
    </li>
  );
}
