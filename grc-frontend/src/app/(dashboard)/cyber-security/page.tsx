// /cyber-security[?tab=]: the Cyber Security hub (an Overview, seven types, the NIST library) is part of Assessments now: its Overview is the Assessments Overview, a type's tab is the register of
// that type (the assessments made for applications and functions, with Start on every page), and the NIST library is a tab of Types. Emails, tasks and bookmarks that carry ?tab= keep landing
// on the right thing (forwardModel.cyberTarget).
import { redirect } from 'next/navigation';
import { cyberTarget } from '../assessments/_forward/forwardModel';

export const dynamic = 'force-dynamic';

export default function CyberSecurityForward({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
  redirect(cyberTarget(first(searchParams?.tab), first(searchParams?.assessment)));
}
