'use client';

// The eleven stages down the side, in their three groups. A gate is a diamond, the others circles. The marker says done, blocked,
// current or skipped; the note on the right says how many checks are open, "Now", "Skipped", or the tier on the tiering row.
// A skipped stage shows why when hovered. Colours are inline hex (the platform CSS repaints utilities in the shell).
import { Check, Minus } from 'lucide-react';
import { clsx } from 'clsx';
import { TONE } from '@/lib/status';
import {
  GROUPS, STAGES, railNote, skippedBy, stageNumber, type StageFact,
} from '../../../_lib/lifecycleLogic';

type Marker = 'done' | 'blocked' | 'current' | 'skipped' | 'upcoming';

function Mark({ state, gate }: { state: Marker; gate: boolean }) {
  const fill = state === 'done' ? TONE.success.dot : state === 'blocked' ? TONE.warning.dot : state === 'skipped' ? '#c9d1da' : '#fff';
  const ring = state === 'current' ? TONE.progress.dot : state === 'upcoming' ? '#aeb8c4' : fill;
  const size = gate ? 'h-3.5 w-3.5 rotate-45 rounded-[3px]' : 'h-[18px] w-[18px] rounded-full';
  return (
    <span aria-hidden className="grid h-[18px] w-[18px] shrink-0 place-items-center">
      <span className={clsx('grid place-items-center border-2', size)} style={{ background: fill, borderColor: ring }}>
        <span className={clsx('grid place-items-center', gate && '-rotate-45')} style={{ color: '#fff' }}>
          {state === 'done' && <Check className="h-2.5 w-2.5" strokeWidth={3.5} />}
          {state === 'skipped' && <Minus className="h-2.5 w-2.5" strokeWidth={3.5} />}
          {state === 'blocked' && <span className="text-[12px] font-[700] leading-none">!</span>}
          {state === 'current' && <span className="h-1.5 w-1.5 rounded-full" style={{ background: TONE.progress.dot }} />}
        </span>
      </span>
    </span>
  );
}

export default function StageRail({ stages, current, selected, openChecks, tier, onSelect }: {
  stages: StageFact[];
  current: string | null;
  selected: string;
  /** how many checks stand open on the current stage */
  openChecks: number;
  tier: string | null | undefined;
  onSelect: (key: string) => void;
}) {
  return (
    <nav aria-label="Lifecycle stages" className="space-y-[12px] border-b border-ds-border p-2.5 lg:border-b-0 lg:border-r">
      {GROUPS.map((group, g) => (
        <div key={group}>
          <p className="px-2 pb-1 text-[12px] font-[700] uppercase tracking-wider text-ds-fg-muted">{group}</p>
          <ul className="space-y-0.5">
            {STAGES.filter((s) => s.group === g).map((def) => {
              const row = stages.find((s) => s.stage_key === def.key);
              const isCurrent = def.key === current;
              const state: Marker = row?.status === 'skipped' ? 'skipped' : row?.status === 'complete' ? 'done'
                : isCurrent ? (openChecks > 0 ? 'blocked' : 'current') : 'upcoming';
              const note = railNote(row, isCurrent, openChecks, tier);
              const why = row?.status === 'skipped' ? `Skipped by ${skippedBy(row).byPolicy ? 'policy' : 'a person'}: ${skippedBy(row).reason}` : undefined;
              return (
                <li key={def.key}>
                  <button
                    type="button"
                    onClick={() => onSelect(def.key)}
                    aria-current={isCurrent ? 'step' : undefined}
                    title={why}
                    className={clsx(
                      'flex w-full items-center gap-2.5 rounded-ds-card px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary',
                      selected === def.key ? 'bg-ds-primary-soft' : 'hover:bg-ds-surface-hover',
                    )}
                  >
                    <Mark state={state} gate={def.gate} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-[600] leading-3 tabular-nums text-ds-fg-muted">{String(stageNumber(def.key)).padStart(2, '0')}</span>
                      <span className={clsx('block truncate text-[13px] leading-4', selected === def.key ? 'font-[600] text-ds-primary-hover' : 'font-medium text-ds-fg-body')}>{def.label}</span>
                    </span>
                    {note && <span className="shrink-0 text-[12px] font-[600]" style={{ color: note.tone === 'neutral' ? '#586472' : TONE[note.tone].text }}>{note.text}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
