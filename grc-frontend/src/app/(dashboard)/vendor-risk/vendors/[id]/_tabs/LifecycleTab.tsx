'use client';

// Lifecycle tab of the vendor record. Owner: B3. The workspace itself is _tpra/TpraLifecycle; this is the page's door to it: the
// engagement and the deep links come from the page (TabProps), and the address can ask for the tiering dialog (?tier=1 for the
// engagement on the page, ?tier=<engagement id> for another), which is opened once and then removed from the address.
import { useEffect } from 'react';
import { useUrlParams } from '@/app/(dashboard)/vendor-risk/_ui';
import { tierRequest } from '../../../_lib/lifecycleLogic';
import TpraLifecycle from '../_tpra/TpraLifecycle';
import type { TabProps } from './tabProps';

export default function LifecycleTab({ vendorId, engagementId, onEngagementChange, stage, findingId, onChanged }: TabProps) {
  const params = useUrlParams();
  const asked = params.get('tier');
  const ask = tierRequest(asked, engagementId);

  // Another engagement was asked for: go to it first; the dialog opens once the page has it.
  useEffect(() => {
    if (asked && ask.engagement !== engagementId) onEngagementChange?.(ask.engagement);
  }, [asked, ask.engagement, engagementId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <TpraLifecycle
      vendorId={vendorId}
      engagementId={engagementId}
      onEngagementChange={onEngagementChange}
      initialStage={stage}
      initialFindingId={findingId}
      onChanged={onChanged}
      tierRequest={ask.open}
      onTierRequestHandled={() => params.set({ tier: null })}
    />
  );
}
