'use client';

// The outline of a questionnaire: its sections and, in each, its questions in the order the assessor meets them. Every control is a real button that works from the keyboard (move up, move
// down, edit, duplicate, delete): nothing is drag-only. A question that cannot be saved as it is (a multiple choice with fewer than two choices, say) says so on its own row. Read only,
// the outline is the same list without the controls.
import { ArrowDown, ArrowUp, Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button, IconButton, Menu, StatusPill, type MenuItem } from '@/components/ui/ds';
import {
  canMoveQuestion, canMoveSection, emptySectionNote, kindLabel, plural, questionProblems, sectionLabel, type Draft, type DraftQuestion, type DraftSection,
} from '@/lib/rcsa/templatesModel';
import { truncate } from '@/lib/format';

export interface OutlineActions {
  onEdit: (q: DraftQuestion) => void;
  onMove: (q: DraftQuestion, dir: -1 | 1) => void;
  onDuplicate: (q: DraftQuestion) => void;
  onDelete: (q: DraftQuestion) => void;
  onAddQuestion: (section: DraftSection) => void;
  onRenameSection: (s: DraftSection) => void;
  onMoveSection: (s: DraftSection, dir: -1 | 1) => void;
  onRemoveSection: (s: DraftSection) => void;
}

function QuestionRow({ draft, q, number, editable, actions }: { draft: Draft; q: DraftQuestion; number: number; editable: boolean; actions: OutlineActions }) {
  const problem = questionProblems(q);
  const wrong = problem.text || problem.options;
  const short = truncate(q.text, 60).text || 'this question';
  const items: MenuItem[] = [
    { key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => actions.onEdit(q) },
    { key: 'duplicate', label: 'Duplicate', icon: Copy, onSelect: () => actions.onDuplicate(q) },
    { key: 'delete', label: 'Delete', icon: Trash2, danger: true, onSelect: () => actions.onDelete(q) },
  ];
  const up = canMoveQuestion(draft, q.key, -1);
  const down = canMoveQuestion(draft, q.key, 1);
  return (
    <li className="flex min-w-0 flex-wrap items-start gap-x-[8px] gap-y-[4px] border-t border-ds-border py-[8px] first:border-t-0" data-question={q.key}>
      <span aria-hidden className="w-[28px] shrink-0 pt-[2px] text-right text-ds-body tabular-nums text-ds-fg-muted">{number}</span>
      <div className="min-w-0 flex-1 basis-[14rem]">
        {editable ? (
          <button type="button" onClick={() => actions.onEdit(q)} className="block min-h-ds-control w-full min-w-0 rounded-ds-control py-[1px] text-left text-ds-body text-ds-fg [overflow-wrap:anywhere] hover:text-ds-primary-text focus-visible:outline-none focus-visible:shadow-ds-ring" aria-label={`Edit question ${number}: ${short}`}>
            <span dir="auto" className="line-clamp-2">{q.text.trim() || 'Untitled question'}</span>
          </button>
        ) : (
          <span dir="auto" className="line-clamp-3 text-ds-body text-ds-fg [overflow-wrap:anywhere]">{q.text}</span>
        )}
        <span className="mt-[4px] flex flex-wrap items-center gap-[6px]">
          <StatusPill size="sm" tone="neutral" label={kindLabel(q.kind)} />
          <StatusPill size="sm" tone={q.required ? 'pending' : 'neutral'} label={q.required ? 'Required' : 'Optional'} />
          {q.kind === 'multiple_choice' && <span className="text-ds-label text-ds-fg-muted">{plural(q.options.filter((o) => o.trim()).length, 'choice')}</span>}
        </span>
        {wrong && <span role="alert" className="mt-[4px] block text-ds-label text-ds-danger">{wrong}</span>}
      </div>
      {editable && (
        <span className="ml-auto flex shrink-0 items-center gap-[2px]">
          <IconButton label={`Move question ${number} up`} aria-disabled={!up || undefined} onClick={() => { if (up) actions.onMove(q, -1); }}><ArrowUp aria-hidden /></IconButton>
          <IconButton label={`Move question ${number} down`} aria-disabled={!down || undefined} onClick={() => { if (down) actions.onMove(q, 1); }}><ArrowDown aria-hidden /></IconButton>
          <Menu label={`More for question ${number}`} iconOnly items={items} />
        </span>
      )}
    </li>
  );
}

export function Outline({ draft, editable, actions }: { draft: Draft; editable: boolean; actions: OutlineActions }) {
  let n = 0;
  return (
    <div className="flex min-w-0 flex-col gap-[12px]">
      {draft.map((s) => {
        const heading = sectionLabel(s.name);
        const nobody = s.questions.length === 0;
        const menu: MenuItem[] = [
          { key: 'rename', label: 'Rename', icon: Pencil, onSelect: () => actions.onRenameSection(s), hidden: s.name === '' },
          { key: 'up', label: 'Move up', icon: ArrowUp, onSelect: () => actions.onMoveSection(s, -1), disabled: !canMoveSection(draft, s.key, -1) },
          { key: 'down', label: 'Move down', icon: ArrowDown, onSelect: () => actions.onMoveSection(s, 1), disabled: !canMoveSection(draft, s.key, 1) },
          { key: 'remove', label: 'Remove section', icon: Trash2, danger: true, onSelect: () => actions.onRemoveSection(s), disabled: !nobody, reason: nobody ? undefined : 'Move or delete its questions first.' },
        ];
        return (
          <section key={s.key} aria-label={heading} className="min-w-0 rounded-ds-card border border-ds-border bg-ds-surface">
            <div className="flex min-w-0 flex-wrap items-center gap-x-[8px] gap-y-[4px] border-b border-ds-border px-[12px] py-[6px]">
              <h3 className={`min-w-0 flex-1 basis-[10rem] break-words !text-ds-body !font-[600] ${s.name === '' ? '!text-ds-fg-muted' : '!text-ds-fg'}`}>{heading}</h3>
              <span className="text-ds-label text-ds-fg-muted">{plural(s.questions.length, 'question')}</span>
              {editable && (
                <span className="flex items-center gap-[4px]">
                  <Button size="sm" leftIcon={<Plus aria-hidden />} onClick={() => actions.onAddQuestion(s)} aria-label={`Add a question to ${heading}`}>Add question</Button>
                  <Menu label={`Actions for section ${heading}`} iconOnly size="sm" items={menu} />
                </span>
              )}
            </div>
            {nobody ? (
              <p className="px-[12px] py-[10px] text-ds-body text-ds-fg-muted">{emptySectionNote(0)}</p>
            ) : (
              <ul className="m-0 list-none px-[12px] py-0">
                {s.questions.map((q) => { n += 1; return <QuestionRow key={q.key} draft={draft} q={q} number={n} editable={editable} actions={actions} />; })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
