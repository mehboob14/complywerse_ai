'use client';
// Pick the review's rules again. Before its checks it only saves; after them, saving runs the
// checks again with the new set (decisions already made are kept).

import { useState } from 'react';
import { errorText, useRunChecks, useSetRules } from '../../api';
import type { Campaign, RuleSelection } from '../../types';
import { Dialog } from '../../_components/Dialog';
import { RulePicker, selectionReady, useRulesFor } from '../../_components/RulePicker';
import { Alert, Button } from '../../_components/ui';

export const selectionOf = (c: Campaign): RuleSelection => (
  { rule_scope: c.rule_scope ?? 'enabled', rule_framework: c.rule_framework ?? null, rule_ids: c.rule_ids ?? [] }
);

export function ChangeRulesDialog({ campaign, sourceLabel, rerun, onClose, onRan }: {
  campaign: Campaign; sourceLabel: string | null; rerun: boolean; onClose: () => void; onRan: () => void;
}) {
  const [value, setValue] = useState<RuleSelection>(selectionOf(campaign));
  const { rules } = useRulesFor(value, campaign.source);
  const save = useSetRules(campaign.id);
  const run = useRunChecks();
  const busy = save.isPending || run.isPending;
  const submit = () => save.mutate(value, {
    onSuccess: () => {
      if (!rerun) { onClose(); return; }
      run.mutate(campaign.id, { onSuccess: () => { onClose(); onRan(); } });
    },
  });
  return (
    <Dialog open onClose={onClose} busy={busy} width="max-w-3xl" title="Rules this review runs"
      description={rerun ? 'Saving runs the rules again with this selection. Decisions you have already made are kept.' : 'They run at step 3, when you run the rules.'}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!selectionReady(value, rules.length)}>
            {rerun ? `Save and run${rules.length ? ` ${rules.length} rule${rules.length === 1 ? '' : 's'}` : ''}` : 'Save'}
          </Button>
        </>
      )}>
      <RulePicker value={value} onChange={setValue} source={campaign.source} sourceLabel={sourceLabel} />
      {(save.isError || run.isError) && <Alert tone="error" className="mt-4">{errorText(save.error || run.error, 'The rules could not be changed.')}</Alert>}
    </Dialog>
  );
}
