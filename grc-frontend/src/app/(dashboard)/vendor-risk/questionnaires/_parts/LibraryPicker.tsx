'use client';

// Pick questions from the library into a questionnaire: the starter sets, or the questions of another questionnaire of the
// organisation. Grouped by section, searchable; one the questionnaire already has is shown as added rather than offered twice.
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Dialog, ToggleChip, BTN, BTN_PRIMARY } from '@/app/(dashboard)/vendor-risk/_ui';
import { evidenceOf, libraryGroups, TYPE_LABEL } from '../../_lib/questionnaires/model';
import type { LibrarySet, Question } from '../../_lib/questionnaires/types';
import { Chip } from './ui';

const pickKey = (setKey: string, q: Question) => `${setKey}|${q.id}`;

export function LibraryPicker({ open, sets, questions, onClose, onAdd }: {
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
    const next = new Set(now);
    if (on) next.add(key); else next.delete(key);
    return next;
  });
  const add = () => {
    const chosen = sets.flatMap((s) => s.questions.filter((q) => picked.has(pickKey(s.key, q))));
    close();
    onAdd(chosen);
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="From library"
      size={720}
      footer={(
        <>
          <span className="mr-auto text-[13px] text-[#586472]">{picked.size} selected</span>
          <button type="button" onClick={close} className={BTN}>Cancel</button>
          <button type="button" disabled={picked.size === 0} onClick={add} className={BTN_PRIMARY}>
            {picked.size === 0 ? 'Add questions' : `Add ${picked.size} ${picked.size === 1 ? 'question' : 'questions'}`}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        {sets.length > 1 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Question sets">
            {sets.map((s) => <ToggleChip key={s.key} on={s.key === set?.key} onClick={() => setSetKey(s.key)}>{s.name}</ToggleChip>)}
          </div>
        )}
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64707e]" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search questions"
            aria-label="Search questions"
            className="block h-9 w-full rounded-lg border border-[#c3ccd5] bg-[#fff] pl-9 pr-3 text-sm text-[#1f2933] placeholder:text-[#64707e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]"
          />
        </div>

        {groups.length === 0 ? (
          <p className="py-6 text-center text-sm text-[#586472]">{set ? 'No questions match.' : 'No questions to pick from.'}</p>
        ) : groups.map((g) => {
          const key = set?.key ?? '';
          const offered = g.rows.filter((r) => !r.added);
          const all = offered.length > 0 && offered.every((r) => picked.has(pickKey(key, r.q)));
          return (
            <section key={g.section} aria-label={g.section}>
              <div className="flex items-center gap-2 border-b border-[#e1e6eb] pb-1.5">
                <input
                  type="checkbox"
                  aria-label={`Select all in ${g.section}`}
                  checked={all}
                  disabled={offered.length === 0}
                  onChange={(e) => offered.forEach((r) => toggle(pickKey(key, r.q), e.target.checked))}
                  className="h-4 w-4 shrink-0 accent-[#0f766e]"
                />
                <h3 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[#1f2933]">{g.section}</h3>
                <span className="text-[12px] tabular-nums text-[#64707e]">{g.rows.length}</span>
              </div>
              <ul className="divide-y divide-[#eef1f4]">
                {g.rows.map(({ q, added }) => (
                  <li key={q.id}>
                    <label className={`flex items-start gap-2.5 py-2 ${added ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-[#f7f9fa]'}`}>
                      <input
                        type="checkbox"
                        checked={added || picked.has(pickKey(key, q))}
                        disabled={added}
                        onChange={(e) => toggle(pickKey(key, q), e.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-[#0f766e]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm leading-5 text-[#26323d]">{q.text}</span>
                        <span className="mt-1 flex flex-wrap gap-1.5">
                          <Chip>{TYPE_LABEL[q.type] ?? q.type}</Chip>
                          {q.critical_control && <Chip tone="danger">Critical</Chip>}
                          {q.type !== 'file' && evidenceOf(q) === 'required' && <Chip tone="accent">Evidence</Chip>}
                          {q.follow_up?.template_id ? <Chip>Follow up</Chip> : null}
                          {added && <Chip tone="warn">Added</Chip>}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </Dialog>
  );
}
