'use client';

// Risk Management > Mitigation Actions: the mitigation-action register (a facet explorer over every action, _monitoring/MitigationRegister). Every address that opened this page still does.
import { routeFor } from '@/lib/navRegistry';
import MitigationRegister from '../_monitoring/MitigationRegister';

export default function MitigationActionsPage() {
  return <MitigationRegister label={routeFor('/erm/mitigation-actions')?.label ?? 'Mitigation Actions'} />;
}
