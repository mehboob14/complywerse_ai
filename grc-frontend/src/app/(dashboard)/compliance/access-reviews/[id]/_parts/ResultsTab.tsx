'use client';
// Results: what every rule found, failing first, with what each connector could not see said
// plainly above the table.

import { RefreshCw, Settings2 } from 'lucide-react';
import { errorText } from '../../api';
import type { CampaignDetail } from '../../types';
import { RuleResultsTable } from '../../_components/RuleResults';
import { Alert, Button } from '../../_components/ui';

export function ResultsTab({ campaign, onUser, onChangeRules, onRerun, rerunning, rerunError }: {
  campaign: CampaignDetail; onUser: (itemId: number) => void;
  /** only while the review is open */
  onChangeRules?: () => void; onRerun?: () => void; rerunning?: boolean; rerunError?: unknown;
}) {
  const results = campaign.rule_results ?? [];
  const count = (s: string) => results.filter((r) => r.status === s || (s === 'not_run' && r.status === 'error')).length;
  const failed = count('fail');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-800">
          <span className="font-semibold">{failed ? `${failed} rule${failed === 1 ? '' : 's'} failed` : 'No rule failed'}</span>
          {' · '}{count('not_run')} could not run · {count('pass')} passed · {count('not_applicable')} did not apply
        </p>
        {(onChangeRules || onRerun) && (
          <div className="flex flex-wrap gap-2">
            {onRerun && <Button size="sm" icon={RefreshCw} loading={rerunning} onClick={onRerun}>Run the rules again</Button>}
            {onChangeRules && <Button size="sm" icon={Settings2} disabled={rerunning} onClick={onChangeRules}>Change rules</Button>}
          </div>
        )}
      </div>
      {!!rerunError && <Alert tone="error">{errorText(rerunError, 'The rules could not be run.')}</Alert>}
      {(campaign.connector_notes ?? []).filter((n) => n.limits).map((n) => (
        <Alert key={n.connector} tone="info" title={`${n.label}: what this review cannot see`}>{n.limits}</Alert>
      ))}
      <RuleResultsTable results={results} items={campaign.items} onUser={onUser} notes={campaign.connector_notes ?? []} />
    </div>
  );
}
