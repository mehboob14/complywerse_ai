'use client';

/**
 * The assessed risks of an assessment, scored IN PLACE: likelihood and impact (inherent and residual), the treatment decision and the control effectiveness are cells you change where they
 * are. A change is saved at once (no Save Scoring per risk) and the row says so: "Saving", "Saved" or "Not saved. Try again". The score and the level beside the cells follow the cells as you
 * choose, from the one rating function (assessmentModel.ratingOf). On a phone each risk is a card with the same cells. When the assessment can no longer be scored (approved, closed) or the
 * person may not write, the cells are plain words. The narrative (rationale, notes), the links, the AI suggestion and the 1LINK fields are in the drawer one press away.
 */
import { useId, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button, Select, StatusPill, Table, TableFrame, TBody, Td, Th, THead, Tr } from '@/components/ui/ds';
import { EMPTY } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { riskLevel } from '@/lib/statuses/risk';
import { controlEffectiveness, treatmentDecision } from '@/lib/statuses/assessments';
import { applyPatch, inherentOf, ratingOf, residualOf, type AssessedRisk, type RowPatch } from '../../_register/assessmentModel';
import type { RiskSort } from './workspaceData';

export type SaveState = 'saving' | 'saved' | 'failed';
const LEVELS = [1, 2, 3, 4, 5];
const TREATMENTS: Array<[string, string]> = [['accept', 'Accept'], ['mitigate', 'Mitigate'], ['transfer', 'Transfer'], ['avoid', 'Avoid']];
const EFFECTIVENESS: Array<[string, string]> = [['effective', 'Effective'], ['partially_effective', 'Partly effective'], ['ineffective', 'Ineffective']];

export interface RowsProps {
  rows: readonly AssessedRisk[];
  /** edits the server has not confirmed yet, by row */
  edits: Readonly<Record<number, RowPatch>>;
  state: Readonly<Record<number, SaveState>>;
  editable: boolean;
  narrow: boolean;
  /** the table is wide enough for the treatment and effectiveness columns */
  roomy: boolean;
  sort: RiskSort;
  onSort: (key: RiskSort['key']) => void;
  onChange: (row: AssessedRisk, patch: RowPatch) => void;
  onRetry: (row: AssessedRisk) => void;
  onOpen: (row: AssessedRisk) => void;
  activeId: number | null;
}

/** A 1-5 choice, or the number as text when the cell cannot be changed. */
function Axis({ label, value, editable, onPick }: { label: string; value: number | null | undefined; editable: boolean; onPick: (v: number | null) => void }) {
  if (!editable) return <span className="inline-block min-w-[20px] text-center text-ds-body tabular-nums text-ds-fg">{value ?? EMPTY}</span>;
  return (
    <Select aria-label={label} className="w-[64px]" value={value ?? ''} onChange={(e) => onPick(e.target.value ? Number(e.target.value) : null)}>
      <option value="">{EMPTY}</option>
      {LEVELS.map((v) => <option key={v} value={v}>{v}</option>)}
    </Select>
  );
}

/** "4 x 5 = 20": the two axes and the score they make. */
function Pair({ title, kind, row, editable, onChange }: { title: string; kind: 'inherent' | 'residual'; row: AssessedRisk; editable: boolean; onChange: (patch: RowPatch) => void }) {
  const l = kind === 'inherent' ? row.inherent_likelihood : row.residual_likelihood;
  const i = kind === 'inherent' ? row.inherent_impact : row.residual_impact;
  const score = kind === 'inherent' ? inherentOf(row) : residualOf(row);
  const key = (axis: 'likelihood' | 'impact') => `${kind}_${axis}` as 'inherent_likelihood' | 'inherent_impact' | 'residual_likelihood' | 'residual_impact';
  return (
    <span className="inline-flex items-center gap-[6px]">
      <Axis label={`${title}: ${kind} likelihood`} value={l} editable={editable} onPick={(v) => onChange({ [key('likelihood')]: v })} />
      <span aria-hidden className="text-ds-fg-muted">×</span>
      <Axis label={`${title}: ${kind} impact`} value={i} editable={editable} onPick={(v) => onChange({ [key('impact')]: v })} />
      <span aria-hidden className="text-ds-fg-muted">=</span>
      <span className="min-w-[24px] text-ds-body font-[600] tabular-nums text-ds-fg" title={`${kind === 'inherent' ? 'Inherent' : 'Residual'} score`}>
        {score ?? EMPTY}<span className="sr-only">{score == null ? ' (no score yet)' : ' (score)'}</span>
      </span>
    </span>
  );
}

function LevelPill({ row }: { row: AssessedRisk }) {
  return <StatusPill size="sm" {...statusPill(riskLevel, ratingOf(row))} />;
}

function Choice({ label, value, options, editable, onPick, words }: { label: string; value: string | null | undefined; options: Array<[string, string]>; editable: boolean; onPick: (v: string | null) => void; words: string }) {
  if (!editable) return <span className="text-ds-body text-ds-fg-body">{value ? options.find(([v]) => v === value)?.[1] ?? value : EMPTY}</span>;
  return (
    <Select aria-label={label} className="w-full min-w-[110px]" value={value ?? ''} onChange={(e) => onPick(e.target.value || null)}>
      <option value="">{words}</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </Select>
  );
}

/** Where a row's save stands, in words (not a colour alone). */
export function SaveNote({ state, onRetry }: { state?: SaveState; onRetry: () => void }) {
  if (!state) return null;
  if (state === 'failed') {
    return <span role="alert" className="inline-flex flex-wrap items-center gap-x-[6px] text-ds-label font-[600] text-ds-danger">Not saved<Button variant="link" size="sm" onClick={onRetry}>Try again</Button></span>;
  }
  return <span role="status" className="text-ds-label text-ds-fg-muted">{state === 'saving' ? 'Saving…' : 'Saved'}</span>;
}

function Title({ row, onOpen, active }: { row: AssessedRisk; onOpen: () => void; active: boolean }) {
  return (
    <div className="min-w-0">
      <button type="button" onClick={onOpen} aria-current={active ? 'true' : undefined} title={row.risk_title ?? undefined} className="block max-w-full rounded-ds-control text-left focus-visible:outline-none focus-visible:shadow-ds-ring">
        <span dir="auto" className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere] hover:text-ds-primary-text hover:underline">{row.risk_title || 'A risk no longer in the register'}</span>
      </button>
      {row.risk_category && <p className="m-0 truncate text-ds-label text-ds-fg-muted">{row.risk_category.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())}</p>}
    </div>
  );
}

export function RiskRowsTable(p: RowsProps) {
  const uid = useId();
  const withEdits = (r: AssessedRisk): AssessedRisk => (p.edits[r.id] ? applyPatch(r, p.edits[r.id]) : r);
  const sortOf = (key: RiskSort['key']) => ({ sortKey: key, sort: { key: p.sort.key, dir: p.sort.dir }, onSortChange: () => p.onSort(key) });
  if (p.narrow) {
    return (
      <ul aria-label="Assessed risks" className="m-0 flex list-none flex-col gap-[8px] p-0">
        {p.rows.map((raw) => {
          const r = withEdits(raw);
          return (
            <li key={r.id} className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">
              <div className="flex items-start gap-[8px]">
                <Title row={r} onOpen={() => p.onOpen(raw)} active={p.activeId === r.id} />
                <span className="ml-auto shrink-0"><LevelPill row={r} /></span>
              </div>
              <div className="mt-[8px] grid gap-[8px]">
                <div><p className="m-0 text-ds-label text-ds-fg-muted">Inherent</p><Pair title={r.risk_title ?? 'Risk'} kind="inherent" row={r} editable={p.editable} onChange={(patch) => p.onChange(raw, patch)} /></div>
                <div><p className="m-0 text-ds-label text-ds-fg-muted">Residual</p><Pair title={r.risk_title ?? 'Risk'} kind="residual" row={r} editable={p.editable} onChange={(patch) => p.onChange(raw, patch)} /></div>
                <Choice label={`${r.risk_title ?? 'Risk'}: treatment`} value={r.treatment_decision} options={TREATMENTS} editable={p.editable} words="Treatment" onPick={(v) => p.onChange(raw, { treatment_decision: v })} />
                <Choice label={`${r.risk_title ?? 'Risk'}: control effectiveness`} value={r.control_effectiveness} options={EFFECTIVENESS} editable={p.editable} words="Control effectiveness" onPick={(v) => p.onChange(raw, { control_effectiveness: v })} />
              </div>
              <div className="mt-[8px] flex items-center gap-[8px]">
                <SaveNote state={p.state[r.id]} onRetry={() => p.onRetry(raw)} />
                <Button className="ml-auto" size="sm" rightIcon={<ChevronRight aria-hidden />} onClick={() => p.onOpen(raw)}>Details</Button>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <TableFrame aria-label="Assessed risks, scored in place">
      <Table caption="Assessed risks" className="table-fixed">
        <colgroup>
          <col />
          <col style={{ width: 200 }} />
          <col style={{ width: 200 }} />
          <col style={{ width: 104 }} />
          {p.roomy && <col style={{ width: 150 }} />}
          {p.roomy && <col style={{ width: 150 }} />}
          <col style={{ width: 132 }} />
        </colgroup>
        <THead>
          <Tr>
            <Th {...sortOf('title')}>Risk</Th>
            <Th {...sortOf('inherent')}>Inherent</Th>
            <Th {...sortOf('residual')}>Residual</Th>
            <Th {...sortOf('level')}>Level</Th>
            {p.roomy && <Th>Treatment</Th>}
            {p.roomy && <Th>Controls</Th>}
            <Th><span className="sr-only">Saved state and details</span></Th>
          </Tr>
        </THead>
        <TBody>
          {p.rows.map((raw) => {
            const r = withEdits(raw);
            const open = p.activeId === r.id;
            const t = r.risk_title ?? 'Risk';
            return (
              <Tr key={`${uid}-${r.id}`} selected={open} data-risk-row={r.id}>
                <Td><Title row={r} onOpen={() => p.onOpen(raw)} active={open} /></Td>
                <Td><Pair title={t} kind="inherent" row={r} editable={p.editable} onChange={(patch) => p.onChange(raw, patch)} /></Td>
                <Td><Pair title={t} kind="residual" row={r} editable={p.editable} onChange={(patch) => p.onChange(raw, patch)} /></Td>
                <Td><LevelPill row={r} /></Td>
                {p.roomy && <Td><Choice label={`${t}: treatment`} value={r.treatment_decision} options={TREATMENTS} editable={p.editable} words="Not decided" onPick={(v) => p.onChange(raw, { treatment_decision: v })} /></Td>}
                {p.roomy && <Td><Choice label={`${t}: control effectiveness`} value={r.control_effectiveness} options={EFFECTIVENESS} editable={p.editable} words="Not rated" onPick={(v) => p.onChange(raw, { control_effectiveness: v })} /></Td>}
                <Td>
                  <div className="flex items-center justify-end gap-[8px]">
                    <SaveNote state={p.state[r.id]} onRetry={() => p.onRetry(raw)} />
                    <Button size="sm" aria-label={`Details of ${t}`} onClick={() => p.onOpen(raw)} rightIcon={<ChevronRight aria-hidden />}>Details</Button>
                  </div>
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>
    </TableFrame>
  );
}

/** Slot for a caption above the table when it helps. */
export const Caption = ({ children }: { children: ReactNode }) => <p className="m-0 text-ds-label text-ds-fg-muted">{children}</p>;

export { TREATMENTS, EFFECTIVENESS };
export { treatmentDecision, controlEffectiveness };
