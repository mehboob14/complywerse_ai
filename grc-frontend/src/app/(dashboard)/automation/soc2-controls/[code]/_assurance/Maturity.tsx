'use client';

// "How to implement": SCF's capability maturity model (SCR-CMM) for a control.
//
// SCF describes what the control looks like at each of six levels, plus
// implementation options by organisation size. Both are shown verbatim, only
// laid out: a paragraph stays a paragraph and SCF's "▪"/"∙" lines become a
// numbered list. The organisation rates where the control operates today and
// where it should get to; a signed-off test suggests a rating but never sets one.

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Sparkles } from 'lucide-react';
import { automationApi } from '@/lib/api';
import { useToast } from '@/components/ui';

export const LEVELS = [
  { n: 0, name: 'Not performed' },
  { n: 1, name: 'Performed informally' },
  { n: 2, name: 'Planned & tracked' },
  { n: 3, name: 'Well defined' },
  { n: 4, name: 'Quantitatively controlled' },
  { n: 5, name: 'Continuously improving' },
] as const;

/** What a signed-off test supports on SCF's scale: satisfactory testing is
 *  the Level 3 bar a compliance obligation asks for. */
const FROM_DESIGNATION: Record<string, number> = { satisfactory: 3, alternative_control: 3, partial: 2, deficient: 1 };
export const suggestedLevel = (designation?: string | null) =>
  designation != null && designation in FROM_DESIGNATION ? FROM_DESIGNATION[designation] : null;

const levelName = (n: number | null | undefined) => (n == null ? null : `Level ${n} · ${LEVELS[n]?.name ?? ''}`);

/** SCF prose, laid out: paragraphs, and bullet lines as a numbered list. */
export function SCFText({ text, compact = false }: { text: string; compact?: boolean }) {
  const blocks: ({ kind: 'p'; text: string } | { kind: 'list'; items: string[] })[] = [];
  for (const raw of (text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = line.match(/^[▪•∙·◦‣*-]\s*(.+)$/);
    const last = blocks[blocks.length - 1];
    if (bullet) {
      if (last?.kind === 'list') last.items.push(bullet[1]);
      else blocks.push({ kind: 'list', items: [bullet[1]] });
    } else {
      blocks.push({ kind: 'p', text: line });
    }
  }
  const size = compact ? 'text-[12px]' : 'text-[13px]';
  return (
    <div className="space-y-2.5">
      {blocks.map((b, i) => (b.kind === 'p' ? (
        <p key={i} className={`${size} leading-relaxed text-slate-700`}>{b.text}</p>
      ) : (
        <ol key={i} className="space-y-1.5">
          {b.items.map((item, j) => (
            <li key={j} className={`flex gap-2.5 ${size} leading-relaxed text-slate-700`}>
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-50 text-[10px] font-bold text-primary-700">{j + 1}</span>
              <span className="min-w-0">{item}</span>
            </li>
          ))}
        </ol>
      )))}
    </div>
  );
}

/** Six segments: filled up to the current level, the target outlined. */
export function MaturityMeter({ current, target }: { current: number | null; target: number }) {
  return (
    <div className="flex gap-1" role="img" aria-label={`Current level ${current ?? 'not rated'}, target level ${target}`}>
      {LEVELS.map(({ n }) => (
        <span key={n} title={levelName(n) ?? undefined}
          className={`h-2 flex-1 rounded-sm ${current != null && n <= current ? 'bg-primary-500' : 'bg-slate-100'} ${n === target ? 'ring-2 ring-primary-300 ring-offset-1' : ''}`} />
      ))}
    </div>
  );
}

export function MaturityPanel({
  code, levels, solutions, cadence, pptdf, cmmActual, cmmTarget, targetDefault, designation,
}: {
  code: string;
  /** SCF's criteria per level, keyed "SCR-CMM Level 3 Well Defined". */
  levels: Record<string, string>;
  solutions: Record<string, string>;
  cadence?: string | null;
  pptdf?: string | null;
  cmmActual: number | null;
  cmmTarget: number | null;
  targetDefault: number;
  designation?: string | null;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const target = cmmTarget ?? targetDefault;
  const suggestion = suggestedLevel(designation);
  const byLevel = new Map<number, string>();
  for (const [key, text] of Object.entries(levels || {})) {
    const m = key.match(/Level\s*(\d)/i);
    if (m) byLevel.set(Number(m[1]), text);
  }
  const [shown, setShown] = useState<number>(target);
  const sizes = Object.keys(solutions || {});
  const [size, setSize] = useState<string>(sizes.includes('medium') ? 'medium' : sizes[0] || '');

  const save = useMutation({
    mutationFn: (body: { cmm_actual?: number | null; cmm_target?: number | null }) => automationApi.setControlMaturity(code, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['automation-common-detail', code] }),
    onError: (e) => toast({
      type: 'error', title: 'Could not save the rating',
      message: (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Try again.',
    }),
  });

  const select = (value: number | null, onChange: (v: number | null) => void, allowEmpty: boolean) => (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      disabled={save.isPending}
      className="h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-800 focus:border-primary-500 focus:outline-none">
      {allowEmpty && <option value="">Not rated</option>}
      {LEVELS.map((l) => <option key={l.n} value={l.n}>{levelName(l.n)}</option>)}
    </select>
  );

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Maturity rating</h3>
          {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-slate-500">Where it operates today</span>
            {select(cmmActual, (v) => save.mutate({ cmm_actual: v }), true)}
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-slate-500">
              Target {cmmTarget == null && <span className="text-slate-400">(scope default)</span>}
            </span>
            {select(target, (v) => save.mutate({ cmm_target: v }), false)}
          </label>
        </div>
        <div className="mt-3"><MaturityMeter current={cmmActual} target={target} /></div>
        <p className="mt-2 text-[12px] text-slate-600">
          {cmmActual == null ? 'Not rated yet.'
            : cmmActual >= target ? 'At or above target.'
              : `${target - cmmActual} level${target - cmmActual === 1 ? '' : 's'} below target.`}
        </p>
        {suggestion != null && suggestion !== cmmActual && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary-100 bg-white px-3 py-2">
            <p className="flex items-center gap-1.5 text-[12px] text-slate-700">
              <Sparkles className="h-3.5 w-3.5 text-primary-600" />
              Signed-off testing ({String(designation).replace(/_/g, ' ')}) supports <span className="font-semibold">{levelName(suggestion)}</span>
            </p>
            <button type="button" disabled={save.isPending} onClick={() => save.mutate({ cmm_actual: suggestion })}
              className="rounded-md bg-primary-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
              Use this rating
            </button>
          </div>
        )}
      </section>

      <section>
        <div className="flex flex-wrap gap-1 border-b border-slate-200" role="tablist" aria-label="Maturity levels">
          {LEVELS.map((l) => {
            const active = shown === l.n;
            return (
              <button key={l.n} type="button" role="tab" aria-selected={active} onClick={() => setShown(l.n)}
                className={`relative -mb-px flex items-center gap-1.5 px-2.5 py-2 text-[12px] font-medium ${active ? 'text-primary-700' : 'text-slate-500 hover:text-slate-800'}`}>
                Level {l.n}
                {l.n === target && <span className="rounded bg-primary-50 px-1 text-[9px] font-bold uppercase text-primary-700">Target</span>}
                {l.n === cmmActual && <span className="rounded bg-slate-800 px-1 text-[9px] font-bold uppercase text-white">Now</span>}
                {active && <span className="absolute inset-x-1.5 -bottom-px h-0.5 rounded-full bg-primary-600" />}
              </button>
            );
          })}
        </div>
        <div className="pt-4">
          <p className="mb-2 text-[13px] font-semibold text-slate-900">{levelName(shown)}</p>
          {byLevel.get(shown)
            ? <SCFText text={byLevel.get(shown)!} />
            : <p className="text-[13px] italic text-slate-400">SCF publishes no criteria for this level of this control.</p>}
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-500">
            {pptdf && <span className="rounded bg-slate-100 px-2 py-0.5 font-medium">{pptdf}</span>}
            {cadence && <span className="rounded bg-slate-100 px-2 py-0.5 font-medium">Reassess {cadence.toLowerCase()}</span>}
          </div>
        </div>
      </section>

      {sizes.length > 0 && (
        <section>
          <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[12px] font-semibold text-slate-900">Ways to implement it, by organisation size</span>
            {sizes.map((k) => (
              <button key={k} type="button" onClick={() => setSize(k)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize transition-colors ${size === k ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {k}
              </button>
            ))}
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-3.5 py-3">
            {solutions[size] ? <SCFText text={solutions[size]} /> : <p className="text-[13px] text-slate-500">No options published for this organisation size.</p>}
          </div>
        </section>
      )}

      <p className="text-[10px] text-slate-400">Criteria and options reproduced verbatim from the Secure Controls Framework 2026.2.</p>
    </div>
  );
}
