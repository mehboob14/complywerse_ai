'use client';

// The NCA workspace (the tenant's container: the DCC controls and the audit plan) on a page that already knows its id: a bridge to the NCA lenses (components/assessments/lenses).
// The workspace (`/assessments/a/nca`) draws the same two lenses as tabs. The tenant users are no longer passed down: the lenses read them themselves.
import { useState } from 'react';
import { SegmentedControl } from '@/components/ui/ds';
import AuditPlanLens from '@/components/assessments/lenses/AuditPlanLens';
import NcaDccLens from '@/components/assessments/lenses/NcaDccLens';
import { usePermissions } from '@/hooks/usePermissions';

interface Props {
  assessmentId: number;
  /** kept for the callers that still pass it */
  tenantUsers?: Array<{ id: number; label: string; email: string | null }>;
}

export default function NcaTab({ assessmentId }: Props) {
  const [view, setView] = useState<'dcc' | 'plan'>('dcc');
  const { hasPermission } = usePermissions();
  const readOnly = !hasPermission('compliance:assessments:edit');
  return (
    <div className="flex flex-col gap-[16px]">
      <SegmentedControl className="self-start" label="View" name="nca-view" value={view} onChange={setView} options={[{ value: 'dcc', label: 'DCC controls' }, { value: 'plan', label: 'Audit plan' }]} />
      {view === 'dcc' ? <NcaDccLens assessmentId={assessmentId} readOnly={readOnly} onChanged={() => undefined} /> : <AuditPlanLens assessmentId={assessmentId} readOnly={readOnly} onChanged={() => undefined} />}
    </div>
  );
}
