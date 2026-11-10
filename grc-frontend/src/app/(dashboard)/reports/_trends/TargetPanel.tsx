'use client';

// The target of a figure, inside its Sheet: what it is now (read-only), and "Change target" behind a question. The target and the warning level colour the figure for EVERYONE in the organisation who can see it, and the server lets
// anyone who can see a figure change it (a rule recorded in the audit, not changed here), so the confirm says exactly that, in words, before anything is sent. A box that is not a number is told so (it used to be sent as NaN), a warning
// level on the wrong side of the target is told so, a failed save stays on screen with Retry, and a change is reported. "Reset to the default" is offered only when the organisation changed it, and asks too.
import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button, Fact, FactList, FormField, TextInput, useConfirm, useReportedMutation } from '@/components/ui/ds';
import { trendsApi } from '../_reports/trends';
import { checkTarget, directionWords, formatValue, levelsHint, targetBoxes, targetChanged, unitTag, type TargetCheck, type TrendCard } from './trendsModel';

const HEAD = 'm-0 !text-ds-body !font-[600] !text-ds-fg';

export function TargetPanel({ card, onDirty }: { card: TrendCard; /** the boxes hold something that is not saved: the Sheet asks before it closes */ onDirty: (dirty: boolean) => void }) {
  const { confirm, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState('');
  const [warn, setWarn] = useState('');
  const check = checkTarget(card.direction, target, warn);
  const changed = editing && targetChanged(card, target, warn);
  useEffect(() => { onDirty(changed); }, [changed, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);

  const start = () => { const boxes = targetBoxes(card); setTarget(boxes.target); setWarn(boxes.warn); setEditing(true); };

  const save = useReportedMutation({
    mutationFn: (c: TargetCheck) => trendsApi.setTarget({ metric: card.key, target: c.target, warn: c.warn, critical: card.critical }),
    success: 'Target changed',
    failure: "Couldn't change the target",
    invalidate: [['trends']],
    onSuccess: () => setEditing(false),
  });
  const reset = useReportedMutation({
    mutationFn: () => trendsApi.resetTarget(card.key),
    success: 'Target reset to the default',
    failure: "Couldn't reset the target",
    invalidate: [['trends']],
    onSuccess: () => setEditing(false),
  });

  const askSave = async () => {
    if (check.error) return;
    const now = `${check.target != null ? `target ${formatValue(check.target, card.unit)}` : 'no target'}${check.warn != null ? `, warning level ${formatValue(check.warn, card.unit)}` : ''}`;
    const yes = await confirm(check.target == null
      ? { title: 'Remove the target?', message: `Nobody in your organisation will see a status for “${card.label}” any more: it will read No target.`, confirmLabel: 'Remove target', tone: 'danger' }
      : { title: 'Change the target for everyone?', message: `“${card.label}” will read ${now} for everyone in your organisation who can see it, and its colour changes with it.`, confirmLabel: 'Change target' });
    if (yes) save.mutate(check);
  };
  const askReset = async () => {
    const back = `${card.default_target != null ? `target ${formatValue(card.default_target, card.unit)}` : 'no target'}${card.default_warn != null ? `, warning level ${formatValue(card.default_warn, card.unit)}` : ''}`;
    const yes = await confirm({ title: 'Reset to the default target?', message: `“${card.label}” goes back to ${back} for everyone in your organisation.`, confirmLabel: 'Reset target', tone: 'danger' });
    if (yes) reset.mutate();
  };

  return (
    <section aria-label="Target" className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">
      <div className="mb-[8px] flex flex-wrap items-center justify-between gap-[8px]">
        <h3 className={HEAD}>Target</h3>
        {!editing && (
          <div className="flex flex-wrap items-center gap-[8px]">
            {card.customized && <Button size="sm" variant="ghost" leftIcon={<RotateCcw aria-hidden />} loading={reset.isPending} onClick={() => { void askReset(); }}>Reset to the default</Button>}
            <Button size="sm" onClick={start}>Change target</Button>
          </div>
        )}
      </div>
      {!editing ? (
        <FactList min={140}>
          <Fact label="Target" empty="Not set">{card.target != null ? formatValue(card.target, card.unit) : null}</Fact>
          <Fact label="Warning level" empty="Not set">{card.warn != null ? formatValue(card.warn, card.unit) : null}</Fact>
          <Fact label="Better when">{directionWords(card.direction)}</Fact>
          {card.customized !== undefined && <Fact label="Set by">{card.customized ? 'Your organisation' : 'Default'}</Fact>}
        </FactList>
      ) : (
        <div className="flex flex-col gap-[12px]">
          <div className="grid gap-[12px] sm:grid-cols-2">
            <FormField label="Target" error={check.error && /target must/i.test(check.error) ? check.error : undefined} hint="Leave empty for no target.">
              <TextInput type="number" inputMode="decimal" step="any" value={target} unit={unitTag(card.unit) || undefined} onChange={(e) => setTarget(e.target.value)} autoComplete="off" />
            </FormField>
            <FormField label="Warning level" error={check.error && !/target must/i.test(check.error) ? check.error : undefined} hint="Optional.">
              <TextInput type="number" inputMode="decimal" step="any" value={warn} unit={unitTag(card.unit) || undefined} onChange={(e) => setWarn(e.target.value)} autoComplete="off" />
            </FormField>
          </div>
          <p className="m-0 text-ds-label text-ds-fg-muted">{levelsHint(card.direction)}</p>
          <p className="m-0 text-ds-label text-ds-fg-muted">The target and the warning level colour this figure for everyone in your organisation who can see it.</p>
          <div className="flex flex-wrap items-center gap-[8px]">
            <Button variant="primary" loading={save.isPending} disabled={!changed || !!check.error} onClick={() => { void askSave(); }}>Save target</Button>
            <Button onClick={() => setEditing(false)} disabled={save.isPending}>Cancel</Button>
            {card.customized && <Button variant="ghost" className="ml-auto" leftIcon={<RotateCcw aria-hidden />} loading={reset.isPending} onClick={() => { void askReset(); }}>Reset to the default</Button>}
          </div>
        </div>
      )}
      {confirmDialog}
    </section>
  );
}
