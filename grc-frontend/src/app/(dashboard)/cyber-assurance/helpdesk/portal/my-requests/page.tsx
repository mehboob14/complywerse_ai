"use client";

/**
 * Requester portal — "My Requests".
 *
 * Lists only the current user's own requests (server-scoped to
 * raised_by == current_user via GET /helpdesk/portal/my-requests). Friendly
 * status + a plain-language "we'll respond by…" SLA line; click into own detail.
 */
import Link from "next/link";
import { ListTodo, Inbox, Plus } from "lucide-react";
import { Chip, ErrorBanner, Empty, Loading, PageHeader, Table, timeAgo, slaState, useHd } from "../../_ui";
import { Btn } from "../../_admin";

// Agent statuses → requester-friendly words.
const FRIENDLY_STATUS: Record<string, string> = {
  open: "Received", new: "Received", replied: "Awaiting your reply",
  in_progress: "In progress", paused: "On hold", on_hold: "On hold",
  resolved: "Resolved", closed: "Closed", cancelled: "Cancelled",
};
const friendly = (s?: string | null) => FRIENDLY_STATUS[(s || "").toLowerCase().replace(/\s+/g, "_")] || s || "—";
const doneRe = /resolved|closed/i;

// Approval state → requester-facing label (only requests/changes that need sign-off carry one).
const APPROVAL: Record<string, { label: string; cls: string }> = {
  approved: { label: "Approved", cls: "text-emerald-600" },
  rejected: { label: "Rejected", cls: "text-red-600" },
  pending: { label: "Pending", cls: "text-amber-600" },
  draft: { label: "Pending", cls: "text-amber-600" },
};
const approval = (s?: string | null) => APPROVAL[(s || "").toLowerCase()] || null;

export default function MyRequests() {
  const { data, loading, error } = useHd<{ tickets: any[] }>("/helpdesk/portal/my-requests");
  const rows = data?.tickets || [];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-3 text-[#0F172A]">
      <PageHeader
        icon={ListTodo}
        title="My Requests"
        subtitle="Everything you've raised with us."
        actions={
          <Link href="/cyber-assurance/helpdesk/portal/report">
            <Btn variant="primary" icon={<Plus size={14} />}>Report an issue</Btn>
          </Link>
        }
      />

      {error && <ErrorBanner msg={error} />}

      {loading ? (
        <Loading what="your requests" />
      ) : rows.length === 0 ? (
        <Empty icon={Inbox} title="No requests yet" hint="Something not working? Use “Report an issue” and we'll help." />
      ) : (
        <Table head={["#", "Issue", "Status", "Approval", "We'll respond by", "Raised"]}>
          {rows.map((t) => {
            const done = doneRe.test(t.status || "");
            const sla = slaState(t.response_by, done);
            return (
              <tr key={t.name} className="hover:bg-[#F9FAFC]">
                <td className="px-4 py-2 font-mono text-[11px] text-[#94A3B8]">
                  <Link href={`/cyber-assurance/helpdesk/portal/my-requests/${encodeURIComponent(t.name)}`} className="hover:text-[#005B96]">#{t.name}</Link>
                </td>
                <td className="px-4 py-2">
                  <Link href={`/cyber-assurance/helpdesk/portal/my-requests/${encodeURIComponent(t.name)}`} className="font-medium text-[#0F172A] hover:text-[#005B96]">
                    {t.subject || "(no subject)"}
                  </Link>
                  {t.ci?.name && (
                    <span className="mt-0.5 block text-[11px] text-[#94A3B8]">Asset: {t.ci.name}</span>
                  )}
                </td>
                <td className="px-4 py-2"><Chip value={friendly(t.status)} /></td>
                <td className="px-4 py-2">
                  {(() => {
                    const a = approval(t.approval_state);
                    return a
                      ? <span className={`text-xs font-medium ${a.cls}`}>{a.label}</span>
                      : <span className="text-xs text-[#94A3B8]">—</span>;
                  })()}
                </td>
                <td className="px-4 py-2">
                  {done ? <span className="text-xs font-medium text-emerald-600">Done</span>
                        : <span className={`text-xs font-medium ${sla.cls}`}>{sla.label === "—" ? "As soon as we can" : sla.label}</span>}
                </td>
                <td className="px-4 py-2 text-[11.5px] text-[#94A3B8]">{timeAgo(t.created)}</td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}
