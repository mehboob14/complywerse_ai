import { redirect } from 'next/navigation';

// /governance/approvals was the menu entry "My Approvals". Needs my action took its place (the global queue: To decide, To acknowledge, Sent by me); this address stays for ever and forwards
// to it, because stored notifications, task buttons and e-mails (the acknowledgement digest) carry it. A server redirect, so no flash of the old page and no change to next.config.js.
// Its old code is kept in _LegacyApprovalsPage.tsx, not routed: the action-review log it showed (approve/reject flips a status, nothing follows) has no new home yet.
export default function ApprovalsForward({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const query = new URLSearchParams();
  Object.keys(searchParams ?? {}).forEach((key) => {
    const value = searchParams?.[key];
    (Array.isArray(value) ? value : value === undefined ? [] : [value]).forEach((v) => query.append(key, v));
  });
  redirect(`/needs-my-action${query.toString() ? `?${query.toString()}` : ''}`);
}
