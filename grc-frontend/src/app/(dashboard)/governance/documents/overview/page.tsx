import { redirect } from 'next/navigation';
import { legacyQuery } from '../../_overview/docs/_views';

export const dynamic = 'force-dynamic';

// Governance > Documents > At a glance (and its own Overview before it) became the Governance Overview at /governance, in three views. This address stays for ever and forwards to it,
// because bookmarks, e-mails and the links of other pages carry it: `dept`, `group` and `measure` as they were, `view` mapped (summary and graph to the Summary, table to
// Departments, board to the Board; legacyQuery, tested). A server redirect, so no flash of an empty page.
export default function DocumentsOverviewForward({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  redirect(`/governance${legacyQuery(searchParams)}`);
}
