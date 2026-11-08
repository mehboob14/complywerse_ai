'use client';

export const dynamic = 'force-dynamic';

// Issue & Incident Management > Issues: the issue register (a facet explorer over every issue, _register/IssueRegister). The Enterprise Log and Contract Compliance tabs of /issues forward here.
import { routeFor } from '@/lib/navRegistry';
import IssueRegister from './_register/IssueRegister';

export default function IssueRegisterPage() {
  return <IssueRegister label={routeFor('/issues/register')?.label ?? 'Issues'} />;
}
