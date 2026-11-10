'use client';

// Pick questions from the library into a questionnaire: the starter sets, or the questions of another questionnaire of the organisation. Grouped by section, searchable; a question the questionnaire already
// has is shown as added rather than offered twice.
import { useMemo, useState } from 'react';
import { Button, Checkbox, DebouncedSearch, FormField, Select, Sheet, StatusPill } from '@/components/ui/ds';
import { evidenceOf, libraryGroups, TYPE_LABEL } from '../../_lib/questionnaires/model';
import type { LibrarySet, Question } from '../../_lib/questionnaires/types';

const pickKey = (setKey: string, q: Question) => `${setKey}|${q.id}`;

export function LibrarySheet({ open, sets, questions, onClose, onAdd }: {
  open: boolean;
  sets: LibrarySet[];
  /** What the questionnaire has now. */
  questions: Question[];
  onClose: () => void;
  onAdd: (picked: Question[]) => void;
}) {
  const [setKey, setSetKey] = useState('');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const set = sets.find((s) => s.key === setKey) ?? sets[0];
  const groups = useMemo(() => (set ? libraryGroups(set, questions, search) : []), [set, questions, search]);

  const close = () => { setPicked(new Set()); setSearch(''); setSetKey(''); onClose(); };
  const toggle = (key: string, on: boolean) => setPicked((now) => {
    const next = new Set(Array.from(now));
    if (on) next.add(key); else next.delete(key);
    return next;
  });
  const add = () => {
    const chosen = sets.flatMap((s) => s.questions.filter((q) => picked.has(pickKey(s.key, q))));
    close();
    onAdd(chosen);
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Add from the library"
      subtitle="Starter questions, or the questions of another questionnaire of yours."
      width="lg"
      dirty={open && picked.size > 0}
      footer={(
        <div className="flex flex-wrap items-center gap-[8px]">
          <span className="mr-auto text-ds-body text-ds-fg-muted">{picked.size} selected</span>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={picked.size === 0} onClick={add}>{picked.size === 0 ? 'Add questions' : `Add ${picked.size} ${picked.size === 1 ? 'question' : 'questions'}`}</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        {sets.length > 1 && (
          <FormField label="Questions from">
            <Select value={set?.key ?? ''} onChange={(e) => setSetKey(e.target.value)}>
              {sets.map((s) => <option key={s.key} value={s.key}>{s.source === 'questionnaire' ? `${s.name} (${s.questions.length} questions)` : `${s.name} (starter, ${s.questions.length} questions)`}</option>)}
            </Select>
          </FormField>
        )}
        <DebouncedSearch label="Search questions" placeholder="Search questions" value={search} onSearch={setSearch} />

        {groups.length === 0 ? (
          <p className="py-[24px] text-center text-ds-body text-ds-fg-muted">{set ? 'No questions match.' : 'No questions to pick from.'}</p>
        ) : groups.map((g) => {
          const key = set?.key ?? '';
          const offered = g.rows.filter((r) => !r.added);
          const all = offered.length > 0 && offered.every((r) => picked.has(pickKey(key, r.q)));
          return (
            <section key={g.section} aria-label={g.section} className="flex flex-col">
              <div className="flex items-center gap-[8px] border-b border-ds-border pb-[4px]">
                <Checkbox aria-label={`Select all in ${g.section}`} checked={all} disabled={offered.length === 0} onChange={(e) => offered.forEach((r) => toggle(pickKey(key, r.q), e.target.checked))} />
                <h3 className="min-w-0 flex-1 truncate !text-ds-body !font-[600] !text-ds-fg">{g.section}</h3>
                <span className="text-ds-label tabular-nums text-ds-fg-muted">{g.rows.length}</span>
              </div>
              <ul className="divide-y divide-ds-border">
                {g.rows.map(({ q, added }) => (
                  <li key={q.id}>
                    <Checkbox
                      className="w-full"
                      checked={added || picked.has(pickKey(key, q))}
                      disabled={added}
                      onChange={(e) => toggle(pickKey(key, q), e.target.checked)}
                      label={(
                        <span className="flex min-w-0 flex-col gap-[4px]">
                          <span className="text-ds-body text-ds-fg">{q.text}</span>
                          <span className="flex flex-wrap gap-[6px]">
                            <StatusPill size="sm" tone="neutral" label={TYPE_LABEL[q.type] ?? q.type} />
                            {q.critical_control && <StatusPill size="sm" tone="danger" label="Critical" />}
                            {q.type !== 'file' && evidenceOf(q) === 'required' && <StatusPill size="sm" tone="progress" label="Evidence" />}
                            {q.follow_up?.template_id ? <StatusPill size="sm" tone="neutral" label="Follow up" /> : null}
                            {added && <StatusPill size="sm" tone="warning" label="Already added" />}
                          </span>
                        </span>
                      )}
                    />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </Sheet>
  );
}
