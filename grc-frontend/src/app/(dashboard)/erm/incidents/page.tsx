'use client';

// Issue & Incident Management > Incidents: the incident register (a facet explorer over every incident, _monitoring/IncidentRegister). Every address that opened this page still does.
import { routeFor } from '@/lib/navRegistry';
import IncidentRegister from '../_monitoring/IncidentRegister';

export default function IncidentsPage() {
  return <IncidentRegister label={routeFor('/erm/incidents')?.label ?? 'Incidents'} />;
}
