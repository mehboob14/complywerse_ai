'use client';

// "How to implement": SCF's capability maturity model (SCR-CMM) for a control. SCF describes what the control looks like at each of six levels, and ways to implement it by organisation size.
// Both are shown VERBATIM, only laid out (a paragraph stays a paragraph; SCF's bullet lines become a numbered list), and are never sent to a model. The organisation rates where the control
// operates today and where it should get to; a signed-off test suggests a rating but never sets one.
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button, FormField, SegmentedControl, Select, Sheet, useReportedMutation } from '@/components/ui/ds';
import { automationApi } from '@/lib/api';
import { Body, Small } from './parts';
import { MATURITY_NAMES, levelWords, maturityGap, suggestedLevel } from './workspaceModel';
import { useWorkspace } from './workspaceContext';

/** Six segments: filled up to the current level, the target ringed. */
export function MaturityMeter({ current, target }: { current: number | null; target: number }) {
  return (
    <div className="flex gap-[4px]" role="img" aria-label={`Operates at ${current == null ? 'no rated level' : `level ${current}`}; the target is level ${target}`}>
      {MATURITY_NAMES.map((name, n) => (
        <span key={name} title={levelWords(n) ?? undefined} className={`h-[8px] flex-1 rounded-[2px] ${current != null && n <= current ? 'bg-ds-primary' : 'bg-ds-border'} ${n === target ? 'shadow-[0_0_0_2px_var(--ds-surface),0_0_0_4px_var(--ds-primary)]' : ''}`} />
      ))}
    </div>
  );
}

/** SCF prose, laid out: paragraphs, and bullet lines as a numbered list. */
export function SCFText({ text }: { text: string }) {
  const blocks: ({ kind: 'p'; text: string } | { kind: 'list'; items: string[] })[] = [];
  for (const raw of (text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = line.match(/^[▪•∙·◦‣*-]\s*(.+)$/);
    const last = blocks[blocks.length - 1];
    if (bullet) {
      if (last?.kind === 'list') last.items.push(bullet[1]);
      else blocks.push({ kind: 'list', items: [bullet[1]] });
    } else blocks.push({ kind: 'p', text: line });
  }
  return (
    <div className="flex flex-col gap-[10px]">
      {blocks.map((b, i) => (b.kind === 'p' ? <Body key={i}>{b.text}</Body> : (
        <ol key={i} className="flex flex-col gap-[6px]">
          {b.items.map((item, j) => (
            <li key={j} className="flex gap-[10px] text-ds-body text-ds-fg-body">
              <span aria-hidden className="mt-[1px] grid h-[20px] w-[20px] shrink-0 place-items-center rounded-full bg-ds-primary-soft text-ds-label font-[600] text-ds-primary-text">{j + 1}</span>
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">{item}</span>
            </li>
          ))}
        </ol>
      )))}
    </div>
  );
}

export function MaturitySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { code, d, rights, why, isCustom, refresh } = useWorkspace();
  const impl = d.implementation;
  const actual = d.cmm_actual ?? null;
  const target = d.cmm_target ?? d.cmm_target_default ?? 3;
  const suggestion = suggestedLevel(d.designation);
  const levels = new Map<number, string>();
  Object.entries(impl?.maturity_levels ?? {}).forEach(([key, text]) => { const m = key.match(/Level\s*(\d)/i); if (m) levels.set(Number(m[1]), text); });
  const sizes = Object.keys(impl?.solutions ?? {});
  const [shown, setShown] = useState<number>(target);
  const [size, setSize] = useState<string>(sizes.includes('medium') ? 'medium' : sizes[0] || '');

  const save = useReportedMutation({
    mutationFn: (body: { cmm_actual?: number | null; cmm_target?: number | null }) => automationApi.setControlMaturity(code, body),
    success: { title: 'Rating saved', message: 'The maturity is updated on the control.' },
    failure: "Couldn't save the rating",
    onSuccess: () => { void refresh(); },
  });
  const levelOptions = MATURITY_NAMES.map((_, n) => ({ value: String(n), label: levelWords(n) as string }));
  const off = !rights.testing || save.isPending;
  const reason = why('testing');

  return (
    <Sheet open={open} onClose={onClose} title="Maturity" subtitle={isCustom && impl?.maturity_from ? `Written for this control, with the criteria SCF publishes for ${impl.maturity_from}.` : 'Where this control operates today, where it should be, and what each level takes.'} width="lg" footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <div className="flex flex-col gap-[20px]">
        <section aria-label="Rating" className="rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
          <div className="grid gap-[12px] sm:grid-cols-2">
            <FormField label="Where it operates today" hint={reason}>
              <Select value={actual == null ? '' : String(actual)} disabled={off} onChange={(e) => save.mutate({ cmm_actual: e.target.value === '' ? null : Number(e.target.value) })} placeholder="Not rated">
                {levelOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </FormField>
            <FormField label="Target" hint={d.cmm_target == null ? 'The default of your scope.' : undefined}>
              <Select value={String(target)} disabled={off} onChange={(e) => save.mutate({ cmm_target: Number(e.target.value) })}>
                {levelOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </FormField>
          </div>
          <div className="mt-[12px]"><MaturityMeter current={actual} target={target} /></div>
          <Small className="mt-[6px]">{maturityGap(actual, target) ?? 'Not rated yet.'}</Small>
          {suggestion != null && suggestion !== actual && (
            <div className="mt-[12px] flex flex-wrap items-center justify-between gap-[8px] rounded-ds-control border border-ds-border bg-ds-surface px-[12px] py-[8px]">
              <p className="flex items-center gap-[6px] text-ds-body text-ds-fg-body"><Sparkles aria-hidden className="h-[14px] w-[14px] shrink-0 text-ds-primary" strokeWidth={1.75} />Signed-off testing supports <b className="font-[600]">{levelWords(suggestion)}</b>.</p>
              <Button size="sm" disabled={off} onClick={() => save.mutate({ cmm_actual: suggestion })}>Use this rating</Button>
            </div>
          )}
        </section>

        {(impl?.guidance || impl?.testing_guidance) && (
          <section aria-label="Guidance written for this control" className="flex flex-col gap-[12px]">
            {impl?.guidance && <div><Small className="mb-[2px] font-[600]">Implementation guidance</Small><Body>{impl.guidance}</Body></div>}
            {impl?.testing_guidance && <div><Small className="mb-[2px] font-[600]">Testing guidance</Small><Body>{impl.testing_guidance}</Body></div>}
          </section>
        )}

        <section aria-label="What each level takes" className="flex flex-col gap-[10px]">
          <SegmentedControl label="Maturity level" name="ws-maturity-level" options={MATURITY_NAMES.map((_, n) => ({ value: String(n), label: `${n}${n === target ? ' · target' : ''}${n === actual ? ' · now' : ''}` }))} value={String(shown)} onChange={(v) => setShown(Number(v))} />
          <p className="text-ds-body font-[600] text-ds-fg">{levelWords(shown)}</p>
          {levels.get(shown) ? <SCFText text={levels.get(shown) as string} /> : <Small>SCF publishes no criteria for this level of this control.</Small>}
        </section>

        {sizes.length > 0 && (
          <section aria-label="Ways to implement it" className="flex flex-col gap-[10px]">
            <p className="text-ds-body font-[600] text-ds-fg">Ways to implement it, by organisation size</p>
            <SegmentedControl label="Organisation size" name="ws-maturity-size" options={sizes.map((k) => ({ value: k, label: k.charAt(0).toUpperCase() + k.slice(1) }))} value={size} onChange={setSize} />
            <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">
              {impl?.solutions[size] ? <SCFText text={impl.solutions[size]} /> : <Small>No options are published for this organisation size.</Small>}
            </div>
          </section>
        )}
        <Small>Criteria and options are reproduced as the Secure Controls Framework publishes them.</Small>
      </div>
    </Sheet>
  );
}
