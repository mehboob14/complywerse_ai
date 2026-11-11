'use client';

// The stages of a custom route, to change them: what a unit's documents go through, in order. Each stage has a kind (Review, Concurrence, Recommendation, Approval, For information),
// a name, who is asked (people, roles, departments and the owner of the document's unit or of the unit above it), whether they are asked together or one after another, who has
// to sign (everyone, any one, at least N) and the days they have. The model is lib/approvalRoutes.ts, the same one "Submit for review" uses for a document's own route (its stage
// editor is not exported and is not on the kit, so this is the kit's version of the same fields). A stage with nobody chosen is left out when it is sent. The server checks the
// whole route again and its sentences are shown by the card that saves it.
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { KIND_OPTIONS, blankStage, moved, picked, routeSummary, type DraftStage, type StageKind, type Target } from '@/lib/approvalRoutes';
import { pickKey, type PickOption } from '@/lib/approvalDefaults';
import { Button, FormField, IconButton, MultiSelect, Select, TextInput } from '@/components/ui/ds';

const KIND_NAME = Object.fromEntries(KIND_OPTIONS.map((k) => [k.value, k.label])) as Record<StageKind, string>;
const MAX_STAGES = 12;

interface Props {
  stages: DraftStage[];
  onChange: (next: DraftStage[]) => void;
  /** who can be asked (lib/approvalDefaults pickOptions) */
  options: readonly PickOption[];
  disabled?: boolean;
}

export function RouteEditor({ stages, onChange, options, disabled }: Props) {
  const update = (i: number, patch: Partial<DraftStage>) => onChange(stages.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const nameOf = (t: Target) => t.display || options.find((o) => o.value === pickKey(t.target_type, t.target_id))?.label || 'Somebody';
  // a new stage goes before the last one when that is an approval: the approval usually closes a route
  const add = () => {
    const at = stages.length && stages[stages.length - 1].kind === 'approval' ? stages.length - 1 : stages.length;
    onChange([...stages.slice(0, at), blankStage('review'), ...stages.slice(at)]);
  };
  const summary = routeSummary(stages, nameOf);

  return (
    <div className="flex flex-col gap-[12px]">
      <ol aria-label="Stages of the route" className="m-0 flex list-none flex-col gap-[12px] p-0">
        {stages.map((s, i) => {
          const n = i + 1;
          const inTurn = s.order === 'in_turn';
          return (
            <li key={s.key} className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">
              <div className="flex flex-wrap items-center gap-[8px]">
                <span aria-hidden className="inline-flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-full bg-ds-primary-soft text-ds-label font-[600] text-ds-primary-text">{n}</span>
                <Select aria-label={`Stage ${n}: what it is`} value={s.kind} disabled={disabled} className="w-[176px]"
                  onChange={(e) => {
                    const kind = e.target.value as StageKind;
                    update(i, { kind, name: s.name.trim() === KIND_NAME[s.kind] || !s.name.trim() ? KIND_NAME[kind] : s.name });
                  }}>
                  {KIND_OPTIONS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </Select>
                <TextInput aria-label={`Stage ${n}: name`} value={s.name} maxLength={120} disabled={disabled} placeholder={KIND_NAME[s.kind]} className="min-w-[160px] flex-1" onChange={(e) => update(i, { name: e.target.value })} />
                <span className="ml-auto flex items-center">
                  <IconButton label={`Move stage ${n} up`} disabled={disabled || i === 0} onClick={() => onChange(moved(stages, i, -1))}><ArrowUp aria-hidden /></IconButton>
                  <IconButton label={`Move stage ${n} down`} disabled={disabled || i === stages.length - 1} onClick={() => onChange(moved(stages, i, 1))}><ArrowDown aria-hidden /></IconButton>
                  <IconButton label={`Remove stage ${n}`} disabled={disabled || stages.length === 1} onClick={() => onChange(stages.filter((_, j) => j !== i))}><X aria-hidden /></IconButton>
                </span>
              </div>

              <div className="mt-[8px]">
                <FormField label={s.kind === 'information' ? 'Who is told' : 'Who is asked'}>
                  <MultiSelect
                    label={`Stage ${n}: ${s.kind === 'information' ? 'who is told' : 'who is asked'}`}
                    options={options}
                    value={s.people.map((p) => pickKey(p.target_type, p.target_id))}
                    onChange={(values) => update(i, { people: picked(values, s.people) })}
                    display="chips"
                    placeholder="People, roles, departments or owners"
                    searchPlaceholder="Search"
                    disabled={disabled}
                  />
                </FormField>
              </div>

              {inTurn && s.people.length > 1 && (
                <ol aria-label={`Stage ${n}: the order they are asked in`} className="m-0 mt-[8px] flex list-none flex-col gap-[4px] p-0">
                  {s.people.map((p, k) => (
                    <li key={pickKey(p.target_type, p.target_id)} className="flex items-center gap-[8px] rounded-ds-control bg-ds-surface-subtle px-[8px] py-[2px] text-ds-label text-ds-fg-body">
                      <span className="w-[16px] text-right font-[600] text-ds-fg-muted">{k + 1}.</span>
                      <span className="min-w-0 flex-1 truncate">{nameOf(p)}</span>
                      <IconButton label={`Ask ${nameOf(p)} earlier`} disabled={disabled || k === 0} onClick={() => update(i, { people: moved(s.people, k, -1) })}><ArrowUp aria-hidden /></IconButton>
                      <IconButton label={`Ask ${nameOf(p)} later`} disabled={disabled || k === s.people.length - 1} onClick={() => update(i, { people: moved(s.people, k, 1) })}><ArrowDown aria-hidden /></IconButton>
                    </li>
                  ))}
                </ol>
              )}

              {s.kind !== 'information' && (
                <div className="mt-[8px] flex flex-wrap items-end gap-[12px]">
                  {s.people.length > 1 && (
                    <FormField label="Asked" className="w-[176px]">
                      <Select value={s.order} disabled={disabled} onChange={(e) => update(i, { order: e.target.value as DraftStage['order'] })}>
                        <option value="together">All at once</option>
                        <option value="in_turn">One after another</option>
                      </Select>
                    </FormField>
                  )}
                  {s.people.length > 1 && s.order === 'together' && (
                    <>
                      <FormField label="Who signs" className="w-[160px]">
                        <Select value={s.rule} disabled={disabled} onChange={(e) => update(i, { rule: e.target.value as DraftStage['rule'] })}>
                          <option value="all">Everyone</option>
                          <option value="any">Any one</option>
                          <option value="at_least">At least…</option>
                        </Select>
                      </FormField>
                      {s.rule === 'at_least' && (
                        <FormField label="At least">
                          <TextInput type="number" inputMode="numeric" min={1} max={s.people.length} disabled={disabled} unit={`of ${s.people.length}`} className="w-[128px]"
                            value={s.min_count} onChange={(e) => update(i, { min_count: Number(e.target.value) })} />
                        </FormField>
                      )}
                    </>
                  )}
                  <FormField label="Days to act" optional>
                    <TextInput type="number" inputMode="numeric" min={1} max={365} disabled={disabled} unit="days" className="w-[144px]" value={s.due_days ?? ''}
                      onChange={(e) => update(i, { due_days: e.target.value === '' ? null : Number(e.target.value) })} />
                  </FormField>
                </div>
              )}
              {!s.people.length && <p className="mt-[8px] text-ds-label font-normal text-ds-fg-muted">Nobody chosen: this stage is left out.</p>}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-[8px]">
        <Button leftIcon={<Plus aria-hidden />} disabled={disabled || stages.length >= MAX_STAGES} title={stages.length >= MAX_STAGES ? `At most ${MAX_STAGES} stages` : undefined} onClick={add}>Add stage</Button>
        {summary && <p className="min-w-0 flex-1 text-ds-label font-normal text-ds-fg-muted [overflow-wrap:anywhere]">{summary}</p>}
      </div>
    </div>
  );
}
