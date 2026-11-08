'use client';

export const dynamic = 'force-dynamic';

// Issue & Incident Management > Corrective actions: the register of every corrective action (a facet explorer, _register/ActionRegister). The CAPA Actions tab of /issues forwards here.
import { routeFor } from '@/lib/navRegistry';
import ActionRegister from './_register/ActionRegister';

export default function CorrectiveActionsPage() {
  return <ActionRegister label={routeFor('/issues/actions')?.label ?? 'Corrective actions'} />;
}
