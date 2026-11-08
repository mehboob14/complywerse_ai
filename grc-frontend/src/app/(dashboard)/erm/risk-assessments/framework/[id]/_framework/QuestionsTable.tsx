'use client';

/**
 * The questions of a framework assessment as a table (a card each on a phone): a tick, the number, the question (two lines, its clause under it), the phase, who answers it, the status
 * (changed where it is, saved at once), the level of its score and its files. Pressing the question opens the drawer. Nothing appears only on hover. Ticking rows offers "Assign" and "Set
 * status" for all of them (the page does the calls and says how many went).
 */
import { ChevronRight, Paperclip } from 'lucide-react';
import { Button, Checkbox, PersonChip, Select, StatusPill, Table, TableFrame, TBody, Td, Th, THead, Tr } from '@/components/ui/ds';
import { EMPTY } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { questionStatus } from '@/lib/statuses/riskAssessments';
import { riskLevel } from '@/lib/statuses/risk';
import { QUESTION_STATUSES, rating, type Question } from './frameworkModel';

const STATUS_WORDS: Record<string, string> = { not_started: 'Not started', in_progress: 'In progress', completed: 'Completed', blocked: 'Blocked' };

export interface QuestionsTableProps {
  rows: readonly Question[];
  /** the position of the first row in the whole list, for the numbers */
  offset: number;
  phaseName: (code: string | null | undefined) => string;
  ticked: ReadonlySet<number>;
  onTick: (id: number) => void;
  onTickAll: (on: boolean) => void;
  canWrite: boolean;
  narrow: boolean;
  roomy: boolean;
  activeId: number | null;
  onOpen: (q: Question) => void;
  onStatus: (q: Question, status: string) => void;
}

function Title({ q, n, onOpen, active }: { q: Question; n: number; onOpen: () => void; active: boolean }) {
  return (
    <div className="min-w-0">
      <button type="button" onClick={onOpen} aria-current={active ? 'true' : undefined} title={q.question_text} className="block max-w-full rounded-ds-control text-left focus-visible:outline-none focus-visible:shadow-ds-ring">
        <span dir="auto" className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere] hover:text-ds-primary-text hover:underline"><span className="mr-[6px] font-normal tabular-nums text-ds-fg-muted">{n}</span>{q.question_text}</span>
      </button>
      {q.clause_reference && <p className="m-0 truncate pl-[1px] text-ds-label text-ds-fg-muted">{q.clause_reference}</p>}
    </div>
  );
}

function StatusCell({ q, canWrite, onStatus }: { q: Question; canWrite: boolean; onStatus: (status: string) => void }) {
  if (!canWrite) return <StatusPill size="sm" {...statusPill(questionStatus, q.status)} />;
  return (
    <Select aria-label={`Status of question: ${q.question_text.slice(0, 60)}`} className="w-full min-w-[128px]" value={q.status} onChange={(e) => onStatus(e.target.value)}>
      {QUESTION_STATUSES.map((s) => <option key={s} value={s}>{STATUS_WORDS[s]}</option>)}
    </Select>
  );
}

const Level = ({ q }: { q: Question }) => {
  const b = rating(q);
  return b === 'none' ? <span className="text-ds-body text-ds-fg-muted">{EMPTY}<span className="sr-only">Not scored</span></span> : <StatusPill size="sm" {...statusPill(riskLevel, b)} />;
};

export function QuestionsTable(p: QuestionsTableProps) {
  const allOn = p.rows.length > 0 && p.rows.every((r) => p.ticked.has(r.id));
  const some = p.rows.some((r) => p.ticked.has(r.id));
  if (p.narrow) {
    return (
      <ul aria-label="Questions" className="m-0 flex list-none flex-col gap-[8px] p-0">
        {p.rows.map((q, i) => (
          <li key={q.id} className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">
            <div className="flex items-start gap-[8px]">
              {p.canWrite && <Checkbox checked={p.ticked.has(q.id)} onChange={() => p.onTick(q.id)} aria-label={`Select question ${p.offset + i + 1}`} />}
              <Title q={q} n={p.offset + i + 1} onOpen={() => p.onOpen(q)} active={p.activeId === q.id} />
            </div>
            <div className="mt-[8px] grid gap-[8px]">
              <StatusCell q={q} canWrite={p.canWrite} onStatus={(s) => p.onStatus(q, s)} />
              <div className="flex flex-wrap items-center gap-x-[10px] gap-y-[4px] text-ds-label text-ds-fg-muted">
                {q.assigned_user_name ? <PersonChip name={q.assigned_user_name} /> : <span>Unassigned</span>}
                <Level q={q} />
                {(q.evidence?.length ?? 0) > 0 && <span className="inline-flex items-center gap-[2px]"><Paperclip aria-hidden className="h-[12px] w-[12px]" />{q.evidence?.length}<span className="sr-only"> files</span></span>}
                <Button className="ml-auto" size="sm" rightIcon={<ChevronRight aria-hidden />} onClick={() => p.onOpen(q)}>Open</Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <TableFrame aria-label="Questions">
      <Table caption="Questions of the assessment" className="table-fixed">
        <colgroup>
          {p.canWrite && <col style={{ width: 44 }} />}
          <col />
          {p.roomy && <col style={{ width: 130 }} />}
          <col style={{ width: 160 }} />
          <col style={{ width: 150 }} />
          <col style={{ width: 112 }} />
          <col style={{ width: 60 }} />
          <col style={{ width: 52 }} />
        </colgroup>
        <THead>
          <Tr>
            {p.canWrite && <Th><Checkbox checked={allOn} indeterminate={!allOn && some} onChange={() => p.onTickAll(!allOn)} aria-label="Select every question on this page" /></Th>}
            <Th>Question</Th>
            {p.roomy && <Th>Phase</Th>}
            <Th>Answered by</Th>
            <Th>Status</Th>
            <Th>Level</Th>
            <Th>Files</Th>
            <Th><span className="sr-only">Open</span></Th>
          </Tr>
        </THead>
        <TBody>
          {p.rows.map((q, i) => (
            <Tr key={q.id} selected={p.activeId === q.id} chosen={p.ticked.has(q.id)} data-question-row={q.id}>
              {p.canWrite && <Td><Checkbox checked={p.ticked.has(q.id)} onChange={() => p.onTick(q.id)} aria-label={`Select question ${p.offset + i + 1}`} /></Td>}
              <Td><Title q={q} n={p.offset + i + 1} onOpen={() => p.onOpen(q)} active={p.activeId === q.id} /></Td>
              {p.roomy && <Td><span className="line-clamp-2 text-ds-body text-ds-fg-body">{p.phaseName(q.phase_code)}</span></Td>}
              <Td>{q.assigned_user_name ? <PersonChip name={q.assigned_user_name} /> : <span className="text-ds-body text-ds-fg-muted">Unassigned</span>}</Td>
              <Td><StatusCell q={q} canWrite={p.canWrite} onStatus={(s) => p.onStatus(q, s)} /></Td>
              <Td><Level q={q} /></Td>
              <Td>{(q.evidence?.length ?? 0) > 0 ? <span className="inline-flex items-center gap-[2px] text-ds-body text-ds-fg-body"><Paperclip aria-hidden className="h-[12px] w-[12px]" />{q.evidence?.length}<span className="sr-only"> files</span></span> : <span className="text-ds-body text-ds-fg-muted">{EMPTY}</span>}</Td>
              <Td><Button size="sm" aria-label={`Open question ${p.offset + i + 1}`} onClick={() => p.onOpen(q)} rightIcon={<ChevronRight aria-hidden />}><span className="sr-only">Open</span></Button></Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </TableFrame>
  );
}
